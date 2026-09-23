"use strict";
// MODULE: rooms — lobby list, seats, chat, start/next hand, bot scheduling,
// per-viewer snapshot (serializeFor). Rules stay in engine.js.
// L2: server/AGENTS.md

const crypto = require("crypto");
const {
  createGameState,
  startHand,
  applyAction,
  stepAfterAction,
  legalActionsFor,
  evaluate7,
  describeHand,
  MAX_PLAYERS,
} = require("./engine");
const { botDecide } = require("./bot");
const { noteBusted, playersWithChips } = require("./engine");
const { tryChatCheat } = require("./cheat");

const rooms = new Map();

function rid(len = 6) {
  return crypto.randomBytes(8).toString("base64url").slice(0, len);
}

function publicRoomList() {
  return [...rooms.values()].map((room) => ({
    id: room.id,
    name: room.name,
    hostName: room.hostName,
    status: room.status,
    humanCount: room.humanPlayers.length,
    maxPlayers: MAX_PLAYERS,
    humanNames: room.humanPlayers.map((p) => p.name),
    createdAt: room.createdAt,
  }));
}

function createRoom({ name, hostId, hostName }) {
  const id = rid(6).toLowerCase();
  const room = {
    id,
    name: name || `${hostName} 的房间`,
    hostId,
    hostName,
    status: "waiting",
    createdAt: Date.now(),
    humanPlayers: [{ id: hostId, name: hostName }],
    spectators: [],
    sockets: new Map(), // playerId -> ws (humans)
    spectatorSockets: new Set(),
    game: null,
    handTimer: null,
    botTimer: null,
    tickTimer: null,
    handStop: false,
    chat: [],
    // total messages ever (chat[] only keeps last 80)
    chatTotal: 0,
  };
  rooms.set(id, room);
  startRoomLoop(room);
  return room;
}

function getRoom(id) {
  return rooms.get(id) || null;
}

function joinRoom(room, playerId, playerName) {
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
  if (room.humanPlayers.length >= MAX_PLAYERS) {
    return { error: "房间已满" };
  }
  room.humanPlayers.push({ id: playerId, name: playerName });
  return { role: playerId === room.hostId ? "host" : "player" };
}

function maybeDestroyEmpty(room) {
  if (room.sockets.size === 0 && room.spectatorSockets.size === 0) {
    destroyRoom(room);
    return true;
  }
  return false;
}

function leaveRoom(room, playerId) {
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
        } else if (maybeDestroyEmpty(room)) {
          return;
        } else {
          destroyRoom(room);
          return;
        }
      }
    }
    maybeDestroyEmpty(room);
    return;
  }

  // playing: keep seat for reconnect; transfer host if needed
  if (room.hostId === playerId) {
    const nextHostWs = [...room.sockets.keys()][0];
    if (nextHostWs) {
      room.hostId = nextHostWs;
      const hp = room.humanPlayers.find((p) => p.id === room.hostId);
      room.hostName = hp ? hp.name : room.hostName;
    }
  }

  maybeDestroyEmpty(room);
}

function destroyRoom(room) {
  clearTimers(room);
  if (room.emptyTimer) clearTimeout(room.emptyTimer);
  room.emptyTimer = null;
  rooms.delete(room.id);
}

function clearTimers(room) {
  if (room.botTimer) clearTimeout(room.botTimer);
  if (room.tickTimer) clearInterval(room.tickTimer);
  if (room.handStop) clearTimeout(room.handStop);
  room.botTimer = null;
  room.tickTimer = null;
  room.handStop = null;
}

function startRoomLoop() {
  // no human action timeout
}

function startGame(room) {
  if (room.status === "playing") return { error: "已开局" };
  if (room.humanPlayers.length < 1) return { error: "没有玩家" };
  room.game = createGameState(room.humanPlayers);
  room.status = "playing";
  room.handStop = null;
  room.game.readyIds = new Set();
  const result = startHand(room.game);
  broadcastRoom(room);
  afterStep(room, result);
  return { ok: true };
}

function ensureReadySet(game) {
  if (!game.readyIds) game.readyIds = new Set();
  return game.readyIds;
}

// Seats that must ready to deal next hand: chips > 0 (bots count as auto-ready).
function requiredReadyPlayers(game) {
  return game.players.filter((p) => p.chips > 0);
}

function allRequiredReady(game) {
  const req = requiredReadyPlayers(game);
  if (req.length < 2) return false;
  const ready = ensureReadySet(game);
  return req.every((p) => p.isBot || ready.has(p.id));
}

function playerReady(room, playerId) {
  if (room.status !== "playing" || !room.game) return { error: "对局未开始" };
  const g = room.game;
  if (!g.handOver) return { error: "本手尚未结束" };
  const player = g.players.find((p) => p.id === playerId);
  if (!player) return { error: "你不在对局中" };
  if (player.chips <= 0) return { error: "余额为0，先借钱才能准备" };

  ensureReadySet(g).add(playerId);
  broadcastRoom(room);
  if (allRequiredReady(g)) {
    return startNextHand(room);
  }
  return { ok: true, waiting: true };
}

function afterStep(room, result) {
  if (!room.game) return;
  if (result === "hand-end") {
    // Busts sit out; match continues while ≥2 seats still have chips.
    const added = noteBusted(room.game);
    const left = playersWithChips(room.game);
    room.game.readyIds = new Set();
    if (left.length < 2) {
      room.game.gameOver = true;
      room.game.handOver = true;
      const broke = room.game.players.filter((p) => p.chips <= 0).map((p) => p.name);
      room.game.message = left.length
        ? `对局结束 · ${broke.join("、")} 破产 · ${left[0].name} 赢家`
        : `对局结束 · ${broke.join("、")} 破产`;
      broadcastRoom(room);
      return;
    }
    if (added.length) {
      const names = added.map((p) => p.name).join("、");
      room.game.message = `${names} 已破产 · 剩余玩家准备下一局`;
    }
    // wait until all chips>0 players ready — then auto-deal
    broadcastRoom(room);
    return;
  }
  scheduleBot(room, 700 + Math.floor(Math.random() * 600));
}

function scheduleBot(room, delay) {
  if (room.botTimer) {
    clearTimeout(room.botTimer);
    room.botTimer = null;
  }
  room.botTimer = setTimeout(() => {
    runBotIfNeeded(room);
  }, delay);
}

function runBotIfNeeded(room) {
  if (room.status !== "playing" || !room.game) return;
  const g = room.game;
  if (g.handOver || g.actionIndex < 0) return;
  const actor = g.players[g.actionIndex];
  if (!actor || !actor.isBot) return;

  const decision = botDecide(g, actor.id) || { action: "check" };
  const amount = decision.action === "raise" ? decision.amount : 0;
  applyAction(g, decision.action, amount);
  const result = stepAfterAction(g);
  broadcastRoom(room);
  afterStep(room, result);
}

function startNextHand(room) {
  if (!room || room.status !== "playing" || !room.game) return { error: "对局未开始" };
  if (room.game.gameOver) return { error: "对局已结束" };
  if (!room.game.handOver) return { error: "本手尚未结束" };
  if (playersWithChips(room.game).length < 2) return { error: "可继续的玩家不足" };
  if (!allRequiredReady(room.game)) return { error: "还有人未准备" };
  const result = startHand(room.game);
  room.game.readyIds = new Set();
  if (room.game.gameOver) {
    broadcastRoom(room);
    return { ok: true };
  }
  broadcastRoom(room);
  afterStep(room, result);
  return { ok: true };
}

function playerAction(room, playerId, action, amount) {
  if (room.status !== "playing" || !room.game) return { error: "对局未开始" };
  const g = room.game;
  if (g.handOver) return { error: "本手已结束" };
  const idx = g.players.findIndex((p) => p.id === playerId);
  if (idx < 0) return { error: "你不在对局中" };
  if (g.actionIndex !== idx) return { error: "还没轮到你" };

  const res = applyAction(g, action, amount);
  if (!res.ok) return res;
  const result = stepAfterAction(g);
  broadcastRoom(room);
  afterStep(room, result);
  return { ok: true };
}

function serializeFor(room, viewerId) {
  const base = {
    roomId: room.id,
    name: room.name,
    status: room.status,
    hostId: room.hostId,
    hostName: room.hostName,
    humanPlayers: room.humanPlayers.map((p) => ({ id: p.id, name: p.name })),
    spectators: room.spectators.map((s) => ({ id: s.id, name: s.name })),
    maxPlayers: MAX_PLAYERS,
    chat: (room.chat || []).slice(-80),
    chatTotal: room.chatTotal || (room.chat || []).length,
  };

  if (!room.game) return { ...base, game: null };

  const g = room.game;
  const actionActor = g.actionIndex >= 0 ? g.players[g.actionIndex] : null;
  const myLegal = legalActionsFor(g, viewerId);

  return {
    ...base,
    game: {
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
      readyIds: [...ensureReadySet(g)],
      requiredReady: requiredReadyPlayers(g).map((p) => ({
        id: p.id,
        name: p.name,
        isBot: p.isBot,
        ready: p.isBot || ensureReadySet(g).has(p.id),
      })),
      busted: (g.busted || []).map((b) => ({ id: b.id, name: b.name })),
      actionDeadline: null,
      actionPlayerId: actionActor ? actionActor.id : null,
      actionPlayerName: actionActor ? actionActor.name : null,
      lastResults: g.lastResults,
      revealAll: g.revealAll,
      dealerSeat: g.dealerIndex,
      players: g.players.map((p) => {
        const isMe = p.id === viewerId;
        const revealHole = p.holeCards.length > 0 && (isMe || g.revealAll);
        let handLabel = "";
        if (revealHole && p.holeCards.length === 2 && !p.folded && !p.sittingOut) {
          try {
            handLabel = describeHand(p.holeCards, g.board);
          } catch {
            handLabel = "";
          }
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
          debt: p.debt || 0,
          ready: !!(g.readyIds && g.readyIds.has(p.id)),
          // seat badge only — history lives in game.busted and is never cleared
          busted: p.chips <= 0 && !p.allIn,
          isDealer: p.isDealer,
          isSB: p.isSB,
          isBB: p.isBB,
          lastAction: p.lastAction,
          inHand: !p.folded && !p.sittingOut && p.holeCards.length > 0,
          holeCards: revealHole ? p.holeCards.map((c) => c.code) : (p.holeCards.length ? (isMe ? p.holeCards.map((c) => c.code) : (g.revealAll ? p.holeCards.map((c) => c.code) : ["back", "back"])) : []),
          handLabel,
          isMe,
        };
      }),
      myLegal: myLegal,
      iAmInGame: g.players.some((p) => p.id === viewerId),
    },
  };
}

function broadcastRoom(room) {
  const humanIds = new Set(room.humanPlayers.map((p) => p.id));
  for (const [pid, ws] of room.sockets) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "room", payload: serializeFor(room, pid) }));
    }
  }
  for (const ws of room.spectatorSockets) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "room", payload: serializeFor(room, `spectator_${rid(4)}`) }));
    }
  }
}

function broadcastRoomList() {
  const payload = JSON.stringify({ type: "rooms", payload: publicRoomList() });
  // sent by server to lobby watchers
  return payload;
}

function addRoomChat(room, playerId, name, text) {
  const body = String(text || "").trim().slice(0, 200);
  if (!body) return;
  if (!room.chat) room.chat = [];
  room.chat.push({
    id: rid(8),
    playerId,
    name,
    text: body,
    ts: Date.now(),
  });
  room.chatTotal = (room.chatTotal || 0) + 1;
  if (room.chat.length > 80) room.chat = room.chat.slice(-80);
}

function pushSystemChat(room, text) {
  if (!room.chat) room.chat = [];
  room.chat.push({
    id: rid(8),
    playerId: "system",
    name: "系统",
    text: String(text).slice(0, 200),
    ts: Date.now(),
  });
  room.chatTotal = (room.chatTotal || 0) + 1;
  if (room.chat.length > 80) room.chat = room.chat.slice(-80);
}

/** Append chat, then optionally run env-gated chat cheats (see cheat.js). */
function handleRoomChat(room, playerId, name, text) {
  const body = String(text || "").trim().slice(0, 200);
  if (!body) return null;
  addRoomChat(room, playerId, name, body);
  const cheat = tryChatCheat(room.game, playerId, body);
  if (!cheat) return null;
  if (cheat.ok) {
    if (cheat.action === "repay") {
      pushSystemChat(room, `${name} 还款 -${cheat.amount}`);
    } else if (cheat.wasBusted) {
      pushSystemChat(room, `${name} 重回战局 +${cheat.chips}`);
    } else {
      pushSystemChat(room, `${name} 借款 +${cheat.chips}`);
    }
  }
  return cheat;
}

/** Button「还钱」— same rules as chat cheat, no user chat line. */
function playerRepay(room, playerId, name) {
  if (!room || !room.game || !name) return null;
  const cheat = tryChatCheat(room.game, playerId, "还钱");
  if (!cheat) return null;
  if (cheat.ok) {
    pushSystemChat(room, `${name} 还款 -${cheat.amount}`);
  }
  return cheat;
}

module.exports = {
  rooms,
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
  addRoomChat,
  handleRoomChat,
  serializeFor,
  broadcastRoom,
  publicRoomList,
};
