// Composition root: builds the http server, WebSocket layer, registries and
// the typed message router. index.ts just calls createServerApp + listen;
// tests call it directly with a custom config.

import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientMessage, PlayerActionName } from "../shared/protocol.js";
import { ClientConn } from "./net/connections.js";
import { createStaticHandler } from "./net/staticFiles.js";
import { LobbyHub } from "./lobby/lobby.js";
import { handleRoomChat, playerRepay } from "./room/chat.js";
import { GameHost } from "./room/gameHost.js";
import { joinRoom, leaveRoom } from "./room/room.js";
import { RoomRegistry } from "./room/roomManager.js";
import { broadcastRoom, sendRoomSnapshot } from "./room/serializer.js";
import type { ServerConfig } from "./config.js";

const PLAYER_ID_RE = /^[A-Za-z0-9_-]{4,40}$/;

export interface ServerApp {
  httpServer: Server;
  registry: RoomRegistry;
  lobbyHub: LobbyHub;
  gameHost: GameHost;
  listen(): Promise<{ port: number }>;
  close(): Promise<void>;
}

export function createServerApp(config: ServerConfig): ServerApp {
  const registry = new RoomRegistry();
  const lobbyHub = new LobbyHub();
  const gameHost = new GameHost(registry, { broadcastRoom, roomsChanged }, config.botDelay);
  const conns = new Set<ClientConn>();

  // Static serving (skipped when the client build is absent, e.g. under tsx dev).
  const staticEnabled = config.staticRoot != null && existsSync(config.staticRoot);
  const serveStatic = staticEnabled
    ? createStaticHandler({ root: config.staticRoot!, basePath: config.basePath })
    : null;

  const httpServer = createServer((req, res) => {
    if (serveStatic) {
      void serveStatic(req, res);
      return;
    }
    res.writeHead(404);
    res.end("Not Found");
  });

  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (ws: WebSocket) => {
    const conn = new ClientConn(ws);
    conns.add(conn);
    conn.send({ type: "rooms", payload: registry.publicRoomList() });

    ws.on("message", (raw) => {
      const msg = parseClientMessage(raw.toString());
      if (!msg) {
        conn.sendError("消息格式错误");
        return;
      }
      routeMessage(conn, msg);
    });

    ws.on("close", () => {
      conns.delete(conn);
      leaveAll(conn);
    });
  });

  function roomsChanged(): void {
    lobbyHub.broadcastRooms(registry.publicRoomList());
  }

  /** Drop a conn from lobby + room (seat kept while playing, for reconnect). */
  function leaveAll(conn: ClientConn): void {
    lobbyHub.remove(conn);
    const roomId = conn.roomId;
    if (!roomId) return;
    conn.roomId = null;

    const room = registry.get(roomId);
    if (!room) {
      roomsChanged();
      return;
    }
    room.spectatorSockets.delete(conn);
    if (conn.playerId) {
      leaveRoom(registry, room, conn.playerId);
    }

    const still = registry.get(room.id);
    if (!still || !still.hasConnections) {
      if (still) registry.remove(still);
      roomsChanged();
      return;
    }
    broadcastRoom(still);
    roomsChanged();
  }

  function routeMessage(conn: ClientConn, msg: ClientMessage): void {
    switch (msg.type) {
      case "setNickname": {
        const nick = msg.payload.nickname.trim().slice(0, 16);
        if (!nick) {
          conn.sendError("请输入昵称");
          return;
        }
        conn.nickname = nick;
        const clientPid = (msg.payload.playerId || "").trim().slice(0, 40);
        if (clientPid && PLAYER_ID_RE.test(clientPid)) {
          conn.playerId = clientPid;
        } else if (!conn.playerId) {
          conn.playerId = `p_${Math.random().toString(36).slice(2, 10)}`;
        }
        conn.send({ type: "profile", payload: { playerId: conn.playerId, nickname: nick } });
        return;
      }

      case "listRooms": {
        lobbyHub.add(conn);
        conn.send({ type: "rooms", payload: registry.publicRoomList() });
        return;
      }

      case "createRoom": {
        if (!conn.nickname || !conn.playerId) {
          conn.sendError("请先设置昵称");
          return;
        }
        leaveAll(conn);
        const room = registry.create({
          name: msg.payload.name,
          hostId: conn.playerId,
          hostName: conn.nickname,
        });
        conn.roomId = room.id;
        room.sockets.set(conn.playerId, conn);
        conn.send({
          type: "joined",
          payload: { roomId: room.id, role: "host", playerId: conn.playerId, nickname: conn.nickname },
        });
        sendRoomSnapshot(room, conn);
        roomsChanged();
        return;
      }

      case "joinRoom": {
        if (!conn.nickname || !conn.playerId) {
          conn.sendError("请先设置昵称");
          return;
        }
        const room = registry.get(msg.payload.roomId);
        if (!room) {
          conn.sendError("房间不存在");
          return;
        }
        leaveAll(conn);
        const result = joinRoom(room, conn.playerId, conn.nickname);
        if ("error" in result) {
          conn.sendError(result.error);
          return;
        }
        conn.roomId = room.id;
        if (result.role === "spectator") {
          room.spectatorSockets.add(conn);
        } else {
          room.sockets.set(conn.playerId, conn);
        }
        conn.send({
          type: "joined",
          payload: {
            roomId: room.id,
            role: result.role,
            playerId: conn.playerId,
            nickname: conn.nickname,
            isHost: room.hostId === conn.playerId,
          },
        });
        sendRoomSnapshot(room, conn);
        broadcastRoom(room);
        roomsChanged();
        return;
      }

      case "leaveRoom": {
        leaveAll(conn);
        conn.send({ type: "left" });
        return;
      }

      case "startGame": {
        const room = conn.roomId ? registry.get(conn.roomId) : null;
        if (!room) {
          conn.sendError("不在房间中");
          return;
        }
        if (room.hostId !== conn.playerId) {
          conn.sendError("只有房主可以开局");
          return;
        }
        const res = gameHost.startGame(room);
        if (!res.ok) conn.sendError(res.error);
        else roomsChanged();
        return;
      }

      case "ready": {
        const room = conn.roomId ? registry.get(conn.roomId) : null;
        if (!room || !conn.playerId) {
          conn.sendError("不在房间中");
          return;
        }
        const res = gameHost.playerReady(room, conn.playerId);
        if (!res.ok) conn.sendError(res.error);
        return;
      }

      case "repay": {
        const room = conn.roomId ? registry.get(conn.roomId) : null;
        if (!room || !conn.nickname || !conn.playerId) return;
        const cheat = playerRepay(room, conn.playerId, conn.nickname);
        if (cheat && !cheat.ok) conn.sendError(cheat.error);
        broadcastRoom(room);
        return;
      }

      case "setCheat": {
        const room = conn.roomId ? registry.get(conn.roomId) : null;
        if (!room) {
          conn.sendError("不在房间中");
          return;
        }
        if (room.hostId !== conn.playerId) {
          conn.sendError("只有房主可以切换作弊");
          return;
        }
        room.cheatEnabled = msg.payload.enabled;
        broadcastRoom(room);
        return;
      }

      case "action": {
        const room = conn.roomId ? registry.get(conn.roomId) : null;
        if (!room || !conn.playerId) {
          conn.sendError("不在房间中");
          return;
        }
        const res = gameHost.playerAction(room, conn.playerId, msg.payload.action, msg.payload.amount);
        if (!res.ok) conn.sendError(res.error);
        return;
      }

      case "chat": {
        const room = conn.roomId ? registry.get(conn.roomId) : null;
        if (!room || !conn.nickname || !conn.playerId) return;
        const cheat = handleRoomChat(room, conn.playerId, conn.nickname, msg.payload.text);
        if (cheat && !cheat.ok) {
          // still show the chat line; surface cheat failure only to sender
          conn.sendError(cheat.error);
        }
        broadcastRoom(room);
        return;
      }

      case "sync": {
        const room = conn.roomId ? registry.get(conn.roomId) : null;
        if (!room) return;
        sendRoomSnapshot(room, conn);
        return;
      }
    }
  }

  return {
    httpServer,
    registry,
    lobbyHub,
    gameHost,
    listen: () =>
      new Promise((resolveListen, rejectListen) => {
        httpServer.once("error", rejectListen);
        httpServer.listen(config.port, "0.0.0.0", () => {
          const addr = httpServer.address();
          const port = typeof addr === "object" && addr ? addr.port : config.port;
          resolveListen({ port });
        });
      }),
    close: () =>
      new Promise((resolveClose) => {
        for (const room of registry.list()) room.clearTimers();
        for (const conn of conns) conn.close();
        wss.close(() => {
          httpServer.close(() => resolveClose());
        });
      }),
  };
}

// ---------------------------------------------------------------------------
// Inbound message parsing: coerce untrusted JSON into the ClientMessage union.
// Business rules (empty nickname, illegal amounts…) stay in the handlers.
// ---------------------------------------------------------------------------

const ACTION_NAMES: readonly PlayerActionName[] = ["fold", "check", "call", "raise", "allin"];

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function parseClientMessage(raw: string): ClientMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const obj = asRecord(data);
  if (!obj) return null;
  const payload = asRecord(obj.payload);

  switch (obj.type) {
    case "setNickname":
      return {
        type: "setNickname",
        payload: {
          nickname: str(payload?.nickname),
          playerId: str(payload?.playerId) || undefined,
        },
      };
    case "listRooms":
    case "leaveRoom":
    case "startGame":
    case "ready":
    case "repay":
    case "sync":
      return { type: obj.type };
    case "setCheat":
      return { type: "setCheat", payload: { enabled: payload?.enabled === true } };
    case "createRoom": {
      const name = str(payload?.name).trim().slice(0, 20);
      return { type: "createRoom", payload: name ? { name } : {} };
    }
    case "joinRoom":
      return { type: "joinRoom", payload: { roomId: str(payload?.roomId) } };
    case "action": {
      const action = str(payload?.action) as PlayerActionName;
      if (!ACTION_NAMES.includes(action)) return null;
      const rawAmount = payload?.amount;
      return {
        type: "action",
        payload: {
          action,
          amount: rawAmount == null ? undefined : Number(rawAmount),
        },
      };
    }
    case "chat":
      return { type: "chat", payload: { text: str(payload?.text) } };
    default:
      return null;
  }
}
