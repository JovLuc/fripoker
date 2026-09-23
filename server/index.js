"use strict";
// MODULE: process entry — static HTTP + WebSocket message router.
// L2: server/AGENTS.md | L1: /AGENTS.md
// Do not put poker rules here; those live in engine.js / rooms.js.

const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");
const {
  createRoom,
  getRoom,
  joinRoom,
  leaveRoom,
  destroyRoom,
  startGame,
  startNextHand,
  playerReady,
  playerRepay,
  playerAction,
  handleRoomChat,
  serializeFor,
  broadcastRoom,
  publicRoomList,
} = require("./rooms");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = path.join(__dirname, "..");
// Optional reverse-proxy path prefix. Empty → root only (no prefix in logs).
// /fpk is always accepted as an alias so nginx /fpk/ works even without BASE_PATH.
const BASE_PATH = normalizeBase(process.env.BASE_PATH || "");

function normalizeBase(raw) {
  if (!raw) return "";
  let p = String(raw).trim();
  if (!p || p === "/") return "";
  if (!p.startsWith("/")) p = `/${p}`;
  return p.replace(/\/+$/, "");
}

function pathPrefixes() {
  const list = ["/fpk"];
  if (BASE_PATH) list.push(BASE_PATH);
  return [...new Set(list)];
}

function stripBase(urlPath) {
  let pathname = urlPath.split("?")[0];
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    /* keep raw */
  }
  for (const prefix of pathPrefixes()) {
    if (pathname === prefix || pathname === `${prefix}/`) return "/";
    if (pathname.startsWith(`${prefix}/`)) {
      pathname = pathname.slice(prefix.length);
      break;
    }
  }
  return pathname || "/";
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

function safeJoin(root, urlPath) {
  const clean = stripBase(urlPath);
  const rel = clean === "/" ? "/index.html" : clean;
  const full = path.normalize(path.join(root, rel));
  if (!full.startsWith(root)) return null;
  return full;
}

const server = http.createServer((req, res) => {
  const rawUrl = req.url || "/";
  const pathOnly = rawUrl.split("?")[0];
  // redirect bare /fpk (and BASE_PATH) to trailing slash for relative assets + nginx location /fpk/
  for (const prefix of pathPrefixes()) {
    if (pathOnly === prefix) {
      res.writeHead(302, { Location: `${prefix}/` });
      res.end();
      return;
    }
  }
  const pathname = stripBase(rawUrl);
  const file = safeJoin(ROOT, rawUrl);
  if (!file) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      if (pathname === "/" && pathOnly === "/") {
        res.writeHead(404);
        res.end("Not Found");
        return;
      }
      // SPA fallback
      fs.readFile(path.join(ROOT, "index.html"), (err2, html) => {
        if (err2) {
          res.writeHead(404);
          res.end("Not Found");
          return;
        }
        res.writeHead(200, { "Content-Type": MIME[".html"] });
        res.end(html);
      });
      return;
    }
    const ext = path.extname(file);
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

const lobbySockets = new Set();

function sendRooms() {
  const msg = JSON.stringify({ type: "rooms", payload: publicRoomList() });
  for (const ws of lobbySockets) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

function sendError(ws, message) {
  if (ws.readyState === 1) ws.send(JSON.stringify({ type: "error", payload: { message } }));
}

function leaveAll(ws) {
  lobbySockets.delete(ws);
  const roomId = ws.roomId;
  if (!roomId) return;
  const room = getRoom(roomId);
  if (!room) {
    ws.roomId = null;
    sendRooms();
    return;
  }
  room.spectatorSockets.delete(ws);
  if (ws.playerId && room.sockets.has(ws.playerId)) {
    leaveRoom(room, ws.playerId);
  } else if (ws.playerId) {
    // seated player socket already gone; still try leave path
    leaveRoom(room, ws.playerId);
  }
  ws.roomId = null;

  const stillThere = getRoom(room.id);
  if (!stillThere) {
    sendRooms();
    return;
  }
  if (stillThere.sockets.size === 0 && stillThere.spectatorSockets.size === 0) {
    destroyRoom(stillThere);
    sendRooms();
    return;
  }
  broadcastRoom(stillThere);
  sendRooms();
}

wss.on("connection", (ws) => {
  ws.playerId = null;
  ws.nickname = null;
  ws.roomId = null;

  ws.send(JSON.stringify({ type: "rooms", payload: publicRoomList() }));

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      sendError(ws, "消息格式错误");
      return;
    }

    const type = msg.type;

    if (type === "setNickname") {
      const nick = String(msg.nickname || "").trim().slice(0, 16);
      if (!nick) {
        sendError(ws, "请输入昵称");
        return;
      }
      ws.nickname = nick;
      const clientPid = String(msg.playerId || "").trim().slice(0, 40);
      if (clientPid && /^[A-Za-z0-9_-]{4,40}$/.test(clientPid)) {
        ws.playerId = clientPid;
      } else if (!ws.playerId) {
        ws.playerId = `p_${Math.random().toString(36).slice(2, 10)}`;
      }
      ws.send(JSON.stringify({ type: "profile", payload: { playerId: ws.playerId, nickname: nick } }));
      return;
    }

    if (type === "listRooms") {
      lobbySockets.add(ws);
      ws.send(JSON.stringify({ type: "rooms", payload: publicRoomList() }));
      return;
    }

    if (type === "createRoom") {
      if (!ws.nickname) {
        sendError(ws, "请先设置昵称");
        return;
      }
      leaveAll(ws);
      const room = createRoom({
        name: msg.name,
        hostId: ws.playerId,
        hostName: ws.nickname,
      });
      ws.roomId = room.id;
      room.sockets.set(ws.playerId, ws);
      ws.send(JSON.stringify({
        type: "joined",
        payload: { roomId: room.id, role: "host", playerId: ws.playerId, nickname: ws.nickname },
      }));
      ws.send(JSON.stringify({ type: "room", payload: serializeFor(room, ws.playerId) }));
      sendRooms();
      return;
    }

    if (type === "joinRoom") {
      if (!ws.nickname) {
        sendError(ws, "请先设置昵称");
        return;
      }
      const room = getRoom(String(msg.roomId || ""));
      if (!room) {
        sendError(ws, "房间不存在");
        return;
      }
      leaveAll(ws);
      const result = joinRoom(room, ws.playerId, ws.nickname);
      if (result.error) {
        sendError(ws, result.error);
        return;
      }
      ws.roomId = room.id;
      if (result.role === "spectator") {
        room.spectatorSockets.add(ws);
      } else {
        room.sockets.set(ws.playerId, ws);
      }
      ws.send(JSON.stringify({
        type: "joined",
        payload: {
          roomId: room.id,
          role: result.role,
          playerId: ws.playerId,
          nickname: ws.nickname,
          isHost: room.hostId === ws.playerId,
        },
      }));
      ws.send(JSON.stringify({ type: "room", payload: serializeFor(room, ws.playerId) }));
      broadcastRoom(room);
      sendRooms();
      return;
    }

    if (type === "leaveRoom") {
      leaveAll(ws);
      ws.send(JSON.stringify({ type: "left" }));
      return;
    }

    if (type === "startGame") {
      const room = getRoom(ws.roomId);
      if (!room) return sendError(ws, "不在房间中");
      if (room.hostId !== ws.playerId) return sendError(ws, "只有房主可以开局");
      const res = startGame(room);
      if (res.error) sendError(ws, res.error);
      else {
        sendRooms();
      }
      return;
    }

    if (type === "ready") {
      const room = getRoom(ws.roomId);
      if (!room) return sendError(ws, "不在房间中");
      const res = playerReady(room, ws.playerId);
      if (res.error) sendError(ws, res.error);
      return;
    }

    if (type === "repay") {
      const room = getRoom(ws.roomId);
      if (!room || !ws.nickname) return;
      const cheat = playerRepay(room, ws.playerId, ws.nickname);
      if (cheat && cheat.error) sendError(ws, cheat.error);
      broadcastRoom(room);
      return;
    }

    if (type === "nextHand") {
      const room = getRoom(ws.roomId);
      if (!room) return sendError(ws, "不在房间中");
      const res = playerReady(room, ws.playerId);
      if (res.error) sendError(ws, res.error);
      return;
    }

    if (type === "action") {
      const room = getRoom(ws.roomId);
      if (!room) return sendError(ws, "不在房间中");
      const res = playerAction(room, ws.playerId, msg.action, msg.amount);
      if (res.error) sendError(ws, res.error);
      return;
    }

    if (type === "chat") {
      const room = getRoom(ws.roomId);
      if (!room || !ws.nickname) return;
      const cheat = handleRoomChat(room, ws.playerId, ws.nickname, msg.text);
      if (cheat && cheat.error) {
        // still show the chat line; surface cheat failure only to sender
        sendError(ws, cheat.error);
      }
      broadcastRoom(room);
      return;
    }

    if (type === "sync") {
      const room = getRoom(ws.roomId);
      if (!room) return;
      ws.send(JSON.stringify({ type: "room", payload: serializeFor(room, ws.playerId || `spec_ws`) }));
      return;
    }
  });

  ws.on("close", () => {
    leaveAll(ws);
  });
});

server.listen(PORT, HOST, () => {
  const nets = require("os").networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) ips.push(net.address);
    }
  }
  console.log(`fripoker listening on http://127.0.0.1:${PORT}`);
  if (BASE_PATH) console.log(`BASE_PATH=${BASE_PATH}`);
  for (const ip of ips) {
    console.log(`LAN: http://${ip}:${PORT}${BASE_PATH}/`);
  }
});
