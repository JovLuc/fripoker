// Session orchestration: connection lifecycle (connect / reconnect /
// re-join), the ServerMessage dispatcher, and every user action.
// initSession() returns a disposer so App.vue can clean up on unmount.

import { LS_KEYS } from "../../shared/constants.js";
import type { GameKind, PlayerActionName, ServerMessage } from "../../shared/protocol.js";
import { ws } from "../api/ws.js";
import { rooms } from "./lobby.js";
import { chatInput } from "./chat.js";
import { clearError, showError } from "./error.js";
import { persistNickname, persistPlayerId, profile } from "./profile.js";
import { applyRoomSnapshot, resetRoomState, role, room, screen } from "./room.js";

export function initSession(): () => void {
  const offMessage = ws.onMessage(handleMessage);
  const offOpen = ws.onOpen(handleOpen);
  ws.connect();

  // Periodic refresh: room list in the lobby, snapshot in a room. The old
  // code leaked this interval; now it is tracked and disposed.
  const pollTimer = window.setInterval(() => {
    if (screen.value === "lobby") ws.send({ type: "listRooms" });
    else ws.send({ type: "sync" });
  }, 2000);

  return () => {
    offMessage();
    offOpen();
    window.clearInterval(pollTimer);
    ws.disconnect();
  };
}

function handleOpen(): void {
  if (profile.nickname) {
    ws.send({
      type: "setNickname",
      payload: { nickname: profile.nickname, playerId: profile.playerId || undefined },
    });
  }
  const savedRoom = localStorage.getItem(LS_KEYS.room);
  if (profile.nickname && savedRoom) {
    ws.send({ type: "joinRoom", payload: { roomId: savedRoom } });
  } else {
    ws.send({ type: "listRooms" });
  }
}

function handleMessage(msg: ServerMessage): void {
  switch (msg.type) {
    case "rooms":
      rooms.value = msg.payload || [];
      break;
    case "profile":
      persistPlayerId(msg.payload.playerId);
      persistNickname(msg.payload.nickname);
      break;
    case "error":
      showError(msg.payload.message);
      if (String(msg.payload.message).includes("房间不存在")) {
        localStorage.removeItem(LS_KEYS.room);
        screen.value = "lobby";
        ws.send({ type: "listRooms" });
      }
      break;
    case "joined":
      role.value =
        msg.payload.role === "spectator"
          ? "spectator"
          : msg.payload.isHost || msg.payload.role === "host"
            ? "host"
            : "player";
      room.id = msg.payload.roomId;
      persistPlayerId(msg.payload.playerId);
      localStorage.setItem(LS_KEYS.room, msg.payload.roomId);
      screen.value = "game";
      break;
    case "room":
      applyRoomSnapshot(msg.payload);
      break;
    case "left":
      backToLobby();
      break;
  }
}

export function backToLobby(): void {
  screen.value = "lobby";
  resetRoomState();
  localStorage.removeItem(LS_KEYS.room);
  ws.send({ type: "listRooms" });
}

// ---------------------------------------------------------------------------
// actions
// ---------------------------------------------------------------------------

/** Optimistic like the original: switch to the lobby immediately; the server
 *  reply arrives a moment later and finalizes the playerId. */
export function submitNickname(nickname: string): void {
  const n = nickname.trim();
  if (!n) {
    showError("请输入昵称");
    return;
  }
  ws.send({ type: "setNickname", payload: { nickname: n, playerId: profile.playerId || undefined } });
  persistNickname(n);
  screen.value = "lobby";
  ws.send({ type: "listRooms" });
}

/**
 * Ensure the server knows our identity before a room action. With a stored
 * playerId the server processes messages in order, so fire-and-forget is
 * safe; without one we must await the profile reply (promise-based version
 * of the old ensureProfileThen temp-listener dance).
 */
async function ensureProfile(): Promise<void> {
  if (!profile.nickname) {
    showError("请先设置昵称");
    throw new Error("no nickname");
  }
  if (profile.playerId) {
    ws.send({ type: "setNickname", payload: { nickname: profile.nickname, playerId: profile.playerId } });
    return;
  }
  ws.send({ type: "setNickname", payload: { nickname: profile.nickname } });
  try {
    await ws.awaitType("profile", 3000);
  } catch {
    showError("连接超时，请重试");
    throw new Error("profile timeout");
  }
}

export async function createRoom(name: string, kind: GameKind = "holdem"): Promise<void> {
  clearError();
  try {
    await ensureProfile();
    ws.send({ type: "createRoom", payload: { ...(name ? { name } : {}), kind } });
  } catch {
    /* error already shown */
  }
}

export async function joinRoomById(roomId: string): Promise<void> {
  clearError();
  try {
    await ensureProfile();
    localStorage.setItem(LS_KEYS.room, roomId);
    ws.send({ type: "joinRoom", payload: { roomId } });
  } catch {
    /* error already shown */
  }
}

export function leaveRoom(): void {
  ws.send({ type: "leaveRoom" });
  backToLobby();
}

export function startGame(): void {
  ws.send({ type: "startGame" });
}

/** Host-only, waiting-status bot seat management (server enforces both). */
export function addRoomBot(): void {
  ws.send({ type: "addBot" });
}

export function removeRoomBot(): void {
  ws.send({ type: "removeBot" });
}

export function toggleReady(): void {
  ws.send({ type: "ready" });
}

export function toggleRepay(): void {
  ws.send({ type: "repay" });
}

export function requestBorrow(targetId: string, amount: number): void {
  ws.send({ type: "borrowRequest", payload: { targetId, amount } });
}

export function respondBorrow(requestId: string, accept: boolean): void {
  ws.send({ type: "borrowRespond", payload: { requestId, accept } });
}

/** Host-only room-page switch for chat cheats (server enforces the role). */
export function setRoomCheat(enabled: boolean): void {
  ws.send({ type: "setCheat", payload: { enabled } });
}

/** Host-only 长牌/短牌 switch; server rejects it mid-hand, so the next deal
 *  always plays with the new mode. */
export function setRoomShortDeck(enabled: boolean): void {
  ws.send({ type: "setShortDeck", payload: { enabled } });
}

export function sendAction(action: PlayerActionName): void {
  ws.send({ type: "action", payload: { action } });
  clearError();
}

/** Three-card: peek at own cards — free, does not consume the turn. */
export function sendLook(): void {
  ws.send({ type: "action", payload: { action: "look" } });
  clearError();
}

/** Three-card: pay the fee and duel `targetId`; loser folds and is revealed. */
export function sendCompare(targetId: string): void {
  ws.send({ type: "action", payload: { action: "compare", targetId } });
  clearError();
}

export function sendChatText(): void {
  const text = (chatInput.value || "").trim();
  if (!text) return;
  ws.send({ type: "chat", payload: { text } });
  chatInput.value = "";
}

export function sendRaiseTo(to: number): void {
  ws.send({ type: "action", payload: { action: "raise", amount: to } });
  clearError();
}

export function sendAllIn(): void {
  ws.send({ type: "action", payload: { action: "allin" } });
  clearError();
}
