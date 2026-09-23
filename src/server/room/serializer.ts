// Snapshots: viewer-aware serialization (hole-card visibility) and per-room
// broadcast. Pure over Room/GameState — no side effects beyond ws sends.

import { CHAT_HISTORY_KEEP, MAX_PLAYERS } from "../../shared/constants.js";
import type {
  GameSnapshot,
  LegalActions,
  PlayerView,
  RequiredReadyPlayer,
  RoomSnapshot,
} from "../../shared/protocol.js";
import { describeHand, legalActionsFor } from "../game/index.js";
import type { ClientConn } from "../net/connections.js";
import type { Room } from "./room.js";

export function serializeFor(room: Room, viewerId: string): RoomSnapshot {
  const base = {
    roomId: room.id,
    name: room.name,
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
  };

  if (!room.game) return { ...base, game: null };

  const g = room.game;
  const actionActor = g.actionIndex >= 0 ? g.players[g.actionIndex] : null;
  const myLegal: LegalActions | null = legalActionsFor(g, viewerId);

  const requiredReady: RequiredReadyPlayer[] = g.players
    .filter((p) => p.chips > 0 && !p.left)
    .map((p) => ({ id: p.id, name: p.name, isBot: p.isBot, ready: p.isBot || room.readyIds.has(p.id) }));

  const players: PlayerView[] = g.players.map((p) => {
    const isMe = p.id === viewerId;
    const revealHole = p.holeCards.length > 0 && (isMe || g.revealAll);
    let handLabel = "";
    if (revealHole && p.holeCards.length === 2 && !p.folded && !p.sittingOut) {
      handLabel = describeHand(p.holeCards, g.board, g.shortDeck);
    }
    return {
      id: p.id,
      name: p.name,
      seat: p.seat,
      isBot: p.isBot,
      chips: p.chips,
      roundBet: p.roundBet,
      folded: p.folded,
      allIn: p.allIn,
      sittingOut: p.sittingOut,
      left: p.left,
      debt: p.debt,
      ready: room.readyIds.has(p.id),
      // seat badge only — history lives in game.busted and is never cleared
      busted: p.chips <= 0 && !p.allIn,
      isDealer: p.isDealer,
      isSB: p.isSB,
      isBB: p.isBB,
      lastAction: p.lastAction,
      inHand: !p.folded && !p.sittingOut && p.holeCards.length > 0,
      holeCards: revealHole
        ? p.holeCards.map((c) => c.code)
        : p.holeCards.length > 0
          ? ["back", "back"]
          : [],
      handLabel,
      isMe,
    };
  });

  const game: GameSnapshot = {
    handId: g.handId,
    phase: g.phase,
    board: g.board.map((c) => c.code),
    pot: g.pot,
    currentBet: g.currentBet,
    smallBlind: g.smallBlind,
    bigBlind: g.bigBlind,
    message: g.message,
    handOver: g.handOver,
    gameOver: !!g.gameOver,
    readyIds: [...room.readyIds],
    requiredReady,
    busted: g.busted.map((b) => ({ id: b.id, name: b.name })),
    actionPlayerId: actionActor ? actionActor.id : null,
    actionPlayerName: actionActor ? actionActor.name : null,
    lastResults: g.lastResults,
    revealAll: g.revealAll,
    dealerSeat: g.dealerIndex,
    players,
    myLegal,
    iAmInGame: g.players.some((p) => p.id === viewerId),
  };

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
