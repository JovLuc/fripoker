// Room snapshot state + every derived UI value (role, labels, busted views).
// One applySnapshot entry point; role derivation lives in exactly one place.

import { computed, reactive, ref } from "vue";
import type { GameSnapshot, PlayerView, RoomRole, RoomSnapshot } from "../../shared/protocol.js";
import { applyChat } from "./chat.js";
import { profile } from "./profile.js";

export type Screen = "lobby" | "game";
export type Role = RoomRole;

export const screen = ref<Screen>("lobby");
export const role = ref<Role>("player");

export const room = reactive({
  id: "",
  name: "",
  status: "waiting" as RoomSnapshot["status"],
  hostId: "",
  hostName: "",
  cheatEnabled: true,
  humanPlayers: [] as RoomSnapshot["humanPlayers"],
  spectators: [] as RoomSnapshot["spectators"],
  maxPlayers: 6,
  game: null as GameSnapshot | null,
});

export function applyRoomSnapshot(snap: RoomSnapshot): void {
  room.id = snap.roomId;
  room.name = snap.name;
  room.status = snap.status;
  room.hostId = snap.hostId;
  room.hostName = snap.hostName;
  room.cheatEnabled = snap.cheatEnabled;
  room.humanPlayers = snap.humanPlayers || [];
  room.spectators = snap.spectators || [];
  room.maxPlayers = snap.maxPlayers || 6;
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
  room.status = "waiting";
  room.cheatEnabled = true;
  role.value = "player";
}

// ---------------------------------------------------------------------------
// derived state (ported verbatim from the old single-component app.js)
// ---------------------------------------------------------------------------

export const mySeat = computed<PlayerView | null>(() => {
  if (!room.game || !profile.playerId) return null;
  return room.game.players.find((p) => p.id === profile.playerId) || null;
});

export const bustedList = computed(() => room.game?.busted || []);

/** True bust, or rebought mid-hand (still sitting out until the next deal). */
export const isBusted = computed(() => {
  if (!room.game || room.status !== "playing") return false;
  if (!profile.playerId) return false;
  const me = room.game.players.find((p) => p.id === profile.playerId);
  if (!me) return false;
  if (me.chips <= 0) return true;
  if (me.sittingOut && !room.game.handOver) return true;
  return false;
});

export const watchLabel = computed(() => {
  const me = room.game?.players.find((p) => p.id === profile.playerId);
  if (me && me.chips > 0 && me.sittingOut && !room.game?.handOver) {
    return "已复活 · 本手观战，下一手参战";
  }
  return "你已破产 · 只能观战";
});

export const myActionState = computed(() => {
  if (!room.game) return null;
  if (role.value === "spectator") return null;
  if (isBusted.value) return null;
  return room.game.myLegal || null;
});

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

export const phaseLabel = computed(() => {
  if (!room.game) return "";
  if (room.game.gameOver) return "结束";
  return PHASE_LABELS[room.game.phase] || room.game.phase;
});
