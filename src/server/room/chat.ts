// Chat pipeline: append the line, then run the room's cheat triggers.
// Cheat failures surface only to the sender (handled by the router);
// the chat line itself always goes out.

import { CHAT_TEXT_MAX } from "../../shared/constants.js";
import type { CheatOutcome } from "../cheat/cheat.js";
import { tryChatCheat } from "../cheat/cheat.js";
import type { Room } from "./room.js";

export function handleRoomChat(room: Room, playerId: string, name: string, text: string): CheatOutcome | null {
  const body = String(text || "").trim().slice(0, CHAT_TEXT_MAX);
  if (!body) return null;
  room.appendChat(playerId, name, body);

  const cheat = tryChatCheat(room.game, playerId, body, room.cheatEnabled);
  if (!cheat) return null;
  if (cheat.ok) {
    if (cheat.action === "repay") {
      room.appendChat("system", "系统", `${name} 还款 -${cheat.amount}`);
    } else if (cheat.wasBusted) {
      room.appendChat("system", "系统", `${name} 重回战局 +${cheat.chips}`);
    } else {
      room.appendChat("system", "系统", `${name} 借款 +${cheat.chips}`);
    }
  }
  return cheat;
}

/** Button「还钱」— same rules as the chat cheat, but no user chat line. */
export function playerRepay(room: Room, playerId: string, name: string): CheatOutcome | null {
  if (!room.game || !name) return null;
  const cheat = tryChatCheat(room.game, playerId, "还钱", room.cheatEnabled);
  if (!cheat) return null;
  if (cheat.ok && cheat.action === "repay") {
    room.appendChat("system", "系统", `${name} 还款 -${cheat.amount}`);
  }
  return cheat;
}
