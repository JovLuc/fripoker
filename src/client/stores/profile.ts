// Player identity, persisted in localStorage for seamless reconnect.

import { reactive } from "vue";
import { LS_KEYS } from "../../shared/constants.js";

export const profile = reactive({
  playerId: localStorage.getItem(LS_KEYS.playerId) || "",
  nickname: localStorage.getItem(LS_KEYS.nickname) || "",
});

export function persistNickname(nickname: string): void {
  profile.nickname = nickname;
  localStorage.setItem(LS_KEYS.nickname, nickname);
}

export function persistPlayerId(playerId: string): void {
  profile.playerId = playerId;
  localStorage.setItem(LS_KEYS.playerId, playerId);
}

/** 「改昵称」— wipe nickname, keep playerId so the seat can be reclaimed. */
export function clearNickname(): void {
  profile.nickname = "";
  localStorage.removeItem(LS_KEYS.nickname);
}
