// Snapshots: room-level serialization + broadcast. Game-specific fields are
// built by each mode's serialize() — this file only knows Room.

import { CHAT_HISTORY_KEEP, MAX_PLAYERS } from "../../shared/constants.js";
import type { RoomSnapshot } from "../../shared/protocol.js";
import { getMode } from "../game/registry.js";
import type { ClientConn } from "../net/connections.js";
import type { Room } from "./room.js";

export function serializeFor(room: Room, viewerId: string): RoomSnapshot {
  const base = {
    roomId: room.id,
    name: room.name,
    kind: room.kind,
    status: room.status,
    hostId: room.hostId,
    hostName: room.hostName,
    cheatEnabled: room.cheatEnabled,
    shortDeck: room.shortDeck,
    humanPlayers: room.humanPlayers.map((p) => ({ id: p.id, name: p.name })),
    botPlayers: room.botPlayers.map((p) => ({ id: p.id, name: p.name })),
    spectators: room.spectators.map((s) => ({ id: s.id, name: s.name })),
    maxPlayers: MAX_PLAYERS,
    chat: room.chat.slice(-CHAT_HISTORY_KEEP),
    chatTotal: room.chatTotal,
    borrowRequests: room.borrowRequests,
    borrowHistory: room.borrowHistory,
  };

  if (!room.game) return { ...base, game: null };

  const game = getMode(room.game.kind).serialize(room.game, viewerId, room.readyIds);
  return { ...base, game };
}

/** Send every live connection in the room its own personalized snapshot. */
export function broadcastRoom(room: Room): void {
  for (const [pid, conn] of room.sockets) {
    conn.send({ type: "room", payload: serializeFor(room, pid) });
  }
  for (const conn of room.spectatorSockets) {
    conn.send({ type: "room", payload: serializeFor(room, conn.spectatorViewId) });
  }
}

/** Convenience for the sync handler: one conn's snapshot. */
export function sendRoomSnapshot(room: Room, conn: ClientConn): void {
  const viewerId = conn.playerId || conn.spectatorViewId;
  conn.send({ type: "room", payload: serializeFor(room, viewerId) });
}
