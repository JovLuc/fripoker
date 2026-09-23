// Room entity: seats, spectators, connections, chat log, ready-set, and the
// single live timer (bot action delay). Poker state hangs off `game`;
// ready-flow state lives here so the engine stays pure.

import { CHAT_HISTORY_KEEP, CHAT_TEXT_MAX, MAX_PLAYERS } from "../../shared/constants.js";
import type { ChatMessage, RoomStatus } from "../../shared/protocol.js";
import type { GameState } from "../game/index.js";
import type { ClientConn } from "../net/connections.js";
import { rid } from "../util/id.js";

export interface SeatPlayer {
  id: string;
  name: string;
}

/** Display names for host-added bots; one per add, never reused within a room. */
const BOT_NAMES = ["东", "西", "南", "北", "中", "发", "白", "梅", "兰", "竹", "菊"];

export class Room {
  readonly id: string;
  name: string;
  hostId: string;
  hostName: string;
  status: RoomStatus = "waiting";
  /** Chat cheats on? Host toggles from the room page; default on. */
  cheatEnabled = true;
  readonly createdAt = Date.now();
  humanPlayers: SeatPlayer[];
  /** Host-added bots; occupy seats like humans once the game starts. */
  botPlayers: SeatPlayer[] = [];
  spectators: SeatPlayer[] = [];
  /** playerId → conn, seated humans only. */
  readonly sockets = new Map<string, ClientConn>();
  readonly spectatorSockets = new Set<ClientConn>();
  game: GameState | null = null;
  chat: ChatMessage[] = [];
  /** Total messages ever (chat[] keeps only the last CHAT_HISTORY_KEEP). */
  chatTotal = 0;
  /** Humans ready for the next deal (hand-over flow); bots are always ready. */
  readyIds = new Set<string>();
  /** The only timer concept in a room: the delayed bot action. */
  botTimer: NodeJS.Timeout | null = null;
  /** Monotonic bot id source — ids stay unique across add/remove cycles. */
  botSeq = 0;

  constructor(opts: { id: string; name: string; hostId: string; hostName: string }) {
    this.id = opts.id;
    this.name = opts.name;
    this.hostId = opts.hostId;
    this.hostName = opts.hostName;
    this.humanPlayers = [{ id: opts.hostId, name: opts.hostName }];
  }

  get hasConnections(): boolean {
    return this.sockets.size > 0 || this.spectatorSockets.size > 0;
  }

  get seatCount(): number {
    return this.humanPlayers.length + this.botPlayers.length;
  }

  get hasFreeSeat(): boolean {
    return this.seatCount < MAX_PLAYERS;
  }

  clearTimers(): void {
    if (this.botTimer) clearTimeout(this.botTimer);
    this.botTimer = null;
  }

  /** Append one chat line (system lines pass playerId "system" / name "系统"). */
  appendChat(playerId: string, name: string, text: string): void {
    const body = String(text || "").trim().slice(0, CHAT_TEXT_MAX);
    this.chat.push({ id: rid(8), playerId, name, text: body, ts: Date.now() });
    this.chatTotal += 1;
    if (this.chat.length > CHAT_HISTORY_KEEP) this.chat = this.chat.slice(-CHAT_HISTORY_KEEP);
  }
}

// ---------------------------------------------------------------------------
// Membership operations (pure room mutations; destruction is the registry's job)
// ---------------------------------------------------------------------------

export type JoinResult = { role: "host" | "player" } | { role: "spectator" } | { error: string };

export type BotResult = { ok: true } | { ok: false; error: string };

/** Host adds one bot seat (waiting rooms only). */
export function addRoomBot(room: Room): BotResult {
  if (room.status !== "waiting") return { ok: false, error: "对局中不能调整机器人" };
  if (!room.hasFreeSeat) return { ok: false, error: "房间已满" };
  room.botSeq += 1;
  const name = BOT_NAMES[room.botPlayers.length] ?? `机器人${room.botSeq}`;
  room.botPlayers.push({ id: `bot_${room.botSeq}`, name });
  return { ok: true };
}

/** Host drops the most recently added bot (LIFO keeps names unique). */
export function removeRoomBot(room: Room): BotResult {
  if (room.status !== "waiting") return { ok: false, error: "对局中不能调整机器人" };
  if (!room.botPlayers.length) return { ok: false, error: "没有机器人" };
  room.botPlayers.pop();
  return { ok: true };
}

/** Take a seat, reconnect a seated player (renaming), or become a spectator. */
export function joinRoom(room: Room, playerId: string, playerName: string): JoinResult {
  const alreadySeated = room.humanPlayers.some((p) => p.id === playerId);
  if (alreadySeated) {
    const seat = room.humanPlayers.find((p) => p.id === playerId);
    if (seat) seat.name = playerName;
    room.spectators = room.spectators.filter((s) => s.id !== playerId);
    return { role: playerId === room.hostId ? "host" : "player" };
  }
  if (room.status === "playing") {
    if (!room.spectators.find((s) => s.id === playerId)) {
      room.spectators.push({ id: playerId, name: playerName });
    }
    return { role: "spectator" };
  }
  if (!room.hasFreeSeat) {
    return { error: "房间已满" };
  }
  room.humanPlayers.push({ id: playerId, name: playerName });
  return { role: playerId === room.hostId ? "host" : "player" };
}

/**
 * Leave a room. Waiting rooms free the seat (and die when the last human
 * leaves); playing rooms keep the seat for reconnect and only move the button
 * of hosting. Returns true when the room was destroyed.
 */
export function leaveRoom(registry: { remove: (room: Room) => void }, room: Room, playerId: string): boolean {
  room.spectators = room.spectators.filter((s) => s.id !== playerId);
  room.sockets.delete(playerId);

  if (room.status === "waiting") {
    const idx = room.humanPlayers.findIndex((p) => p.id === playerId);
    if (idx >= 0) {
      room.humanPlayers.splice(idx, 1);
      if (room.hostId === playerId) {
        if (room.humanPlayers[0]) {
          room.hostId = room.humanPlayers[0].id;
          room.hostName = room.humanPlayers[0].name;
        } else {
          registry.remove(room);
          return true;
        }
      }
    }
    if (!room.hasConnections) {
      registry.remove(room);
      return true;
    }
    return false;
  }

  // playing: keep seat for reconnect; transfer host if needed
  if (room.hostId === playerId) {
    const nextHostId = [...room.sockets.keys()][0];
    if (nextHostId) {
      room.hostId = nextHostId;
      const hp = room.humanPlayers.find((p) => p.id === room.hostId);
      room.hostName = hp ? hp.name : room.hostName;
    }
  }

  if (!room.hasConnections) {
    registry.remove(room);
    return true;
  }
  return false;
}
