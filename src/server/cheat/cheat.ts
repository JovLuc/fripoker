// Chat cheats: exact-match triggers 爸爸 / 爷爷 / 还钱, amounts fixed constants.
// Enablement is per-room — the host toggles it on the room page (default on);
// the old env gate is gone. Rooms call tryChatCheat after appending a chat
// line; failures surface only to the sender, the chat line always broadcasts.

import { CHEAT_BORROW_CHIPS, CHEAT_GRANDPA_CHIPS } from "../../shared/constants.js";
import { borrowChips, repayDebt } from "../game/core/economy.js";
import type { BaseGame } from "../game/core/types.js";

export type CheatOutcome =
  | { ok: true; action: "borrow"; chips: number; wasBusted: boolean; debt: number; midHand: boolean; trigger: string }
  | { ok: true; action: "repay"; amount: number; remaining: number; trigger: string }
  | { ok: false; error: string; trigger: string };

/**
 * @param game the acting player's game state (null between hands)
 * @param playerId the chatting player
 * @param text the raw chat line
 * @param enabled the room's cheat switch
 * @returns null when the line is not a cheat (or cheats are off) — the caller
 *  then keeps the plain-chat path. Never null for an exact trigger.
 */
export function tryChatCheat(game: BaseGame | null, playerId: string, text: string, enabled: boolean): CheatOutcome | null {
  if (!enabled || !game) return null;
  const body = String(text || "").trim();
  if (!body) return null;

  const amount = body === "爸爸" ? CHEAT_BORROW_CHIPS : body === "爷爷" ? CHEAT_GRANDPA_CHIPS : null;
  if (body === "还钱") {
    const res = repayDebt(game, playerId);
    if (!res.ok) return { ok: false, error: res.error, trigger: "还钱" };
    return { ok: true, action: "repay", amount: res.amount, remaining: res.remaining, trigger: "还钱" };
  }
  if (amount != null) {
    const res = borrowChips(game, playerId, amount);
    if (!res.ok) return { ok: false, error: res.error, trigger: body };
    return {
      ok: true,
      action: "borrow",
      chips: res.chips,
      wasBusted: res.wasBusted,
      debt: res.debt,
      midHand: res.midHand,
      trigger: body,
    };
  }
  return null;
}
