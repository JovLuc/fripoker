// Room snapshot state + every derived UI value (role, labels, busted views).
// One applySnapshot entry point; role derivation lives in exactly one place.

import { computed, reactive, ref } from "vue";
import type {
  GameKind,
  GameSnapshot,
  PlayerView,
  RoomRole,
  RoomSnapshot,
} from "../../shared/protocol.js";
import { applyChat, resetChat } from "./chat.js";
import { profile } from "./profile.js";

export type Screen = "lobby" | "game";
export type Role = RoomRole;

export const screen = ref<Screen>("lobby");
export const role = ref<Role>("player");

export const room = reactive({
  id: "",
  name: "",
  kind: "holdem" as GameKind,
  status: "waiting" as RoomSnapshot["status"],
  hostId: "",
  hostName: "",
  cheatEnabled: true,
  shortDeck: false,
  humanPlayers: [] as RoomSnapshot["humanPlayers"],
  botPlayers: [] as RoomSnapshot["botPlayers"],
  spectators: [] as RoomSnapshot["spectators"],
  borrowRequests: [] as RoomSnapshot["borrowRequests"],
  maxPlayers: 10,
  game: null as GameSnapshot | null,
});

export function applyRoomSnapshot(snap: RoomSnapshot): void {
  room.id = snap.roomId;
  room.name = snap.name;
  room.kind = snap.kind;
  room.status = snap.status;
  room.hostId = snap.hostId;
  room.hostName = snap.hostName;
  room.cheatEnabled = snap.cheatEnabled;
  room.shortDeck = !!snap.shortDeck;
  room.humanPlayers = snap.humanPlayers || [];
  room.botPlayers = snap.botPlayers || [];
  room.spectators = snap.spectators || [];
  room.borrowRequests = snap.borrowRequests || [];
  room.maxPlayers = snap.maxPlayers || 10;
  room.game = snap.game;
  applyChat(snap.chat, snap.chatTotal);
  deriveRole();
}

/**
 * Role from the snapshot: host / seated player. Spectator is sticky — it is
 * set on join (mid-game joins spectate) and only a re-join changes it.
 */
function deriveRole(): void {
  if (role.value === "spectator") return;
  if (room.hostId === profile.playerId) role.value = "host";
  else if (room.humanPlayers.some((p) => p.id === profile.playerId)) role.value = "player";
}

export function resetRoomState(): void {
  room.game = null;
  room.id = "";
  room.kind = "holdem";
  room.status = "waiting";
  room.cheatEnabled = true;
  room.borrowRequests = [];
  room.shortDeck = false;
  role.value = "player";
  resetChat();
}

// ---------------------------------------------------------------------------
// derived state (ported verbatim from the old single-component app.js)
// ---------------------------------------------------------------------------

export const mySeat = computed<PlayerView | null>(() => {
  if (!room.game || !profile.playerId) return null;
  return room.game.players.find((p) => p.id === profile.playerId) || null;
});

export const bustedList = computed(() => room.game?.busted || []);

/** True bust (server flag chips<=0 && !allIn — a mid-hand all-in is NOT bust),
 *  or rebought mid-hand (still sitting out until the next deal). */
export const isBusted = computed(() => {
  if (!room.game || room.status !== "playing") return false;
  if (!profile.playerId) return false;
  const me = room.game.players.find((p) => p.id === profile.playerId);
  if (!me) return false;
  return me.busted || (me.sittingOut && !room.game.handOver);
});

export const watchLabel = computed(() => {
  const me = room.game?.players.find((p) => p.id === profile.playerId);
  if (me && me.chips > 0 && me.sittingOut && !room.game?.handOver) {
    return "已复活 · 本手观战，下一手参战";
  }
  return "你已破产 · 只能观战";
});

export const myActionState = computed(() => room.game?.myLegal || null);

export const readyStatusText = computed(() => {
  if (!room.game) return "";
  if (room.game.gameOver) return room.game.message || "对局结束";
  const req = room.game.requiredReady || [];
  const waiting = req.filter((r) => !r.ready).map((r) => r.name);
  const done = req.length - waiting.length;
  if (!room.game.handOver) return "本手进行中";
  if (!waiting.length) return "全员已准备 · 开局中…";
  return `本手结束 · 准备 ${done}/${req.length} · 等待 ${waiting.join("、")}`;
});

export const waitingLabel = computed(() => {
  if (!room.game) return "";
  if (isBusted.value) return watchLabel.value;
  if (role.value === "spectator") return "观战中 · 等待选手行动";
  if (room.game.actionPlayerName) return `等待 ${room.game.actionPlayerName} 行动…`;
  return "等待…";
});

const PHASE_LABELS: Record<string, string> = {
  preflop: "翻前",
  flop: "翻牌",
  turn: "转牌",
  river: "河牌",
  showdown: "摊牌",
  idle: "等待",
};

const TP_PHASE_LABELS: Record<string, string> = {
  betting: "下注",
  showdown: "开牌",
  idle: "等待",
};

export const phaseLabel = computed(() => {
  const g = room.game;
  if (!g) return "";
  if (g.gameOver) return "结束";
  if (g.kind === "tp") return TP_PHASE_LABELS[g.phase] || g.phase;
  return PHASE_LABELS[g.phase] || g.phase;
});
