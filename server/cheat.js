"use strict";
// MODULE: optional chat cheats — env-gated, no room/chat/UI imports.
// rooms.js asks here after a chat line; rules live in engine.borrowChips / repayDebt.
// Enable: CHEAT_ENABLED=1 (or true/yes/on).
// Optional: CHEAT_BORROW_CHIPS=200 (alias: CHEAT_REBUY_CHIPS); CHEAT_GRANDPA_CHIPS=500
// L2: server/AGENTS.md

const { borrowChips, repayDebt } = require("./engine");

const ENABLED = /^(1|true|yes|on)$/i.test(String(process.env.CHEAT_ENABLED || ""));
const BORROW_CHIPS = Math.max(
  1,
  Math.floor(
    Number(process.env.CHEAT_BORROW_CHIPS || process.env.CHEAT_REBUY_CHIPS || 200)
  )
);
const GRANDPA_CHIPS = Math.max(1, Math.floor(Number(process.env.CHEAT_GRANDPA_CHIPS || 500)));

// Exact-match chat triggers (after trim).
const CHAT_CHEATS = [
  { trigger: "爸爸", run: (game, playerId) => borrowChips(game, playerId, BORROW_CHIPS) },
  { trigger: "爷爷", run: (game, playerId) => borrowChips(game, playerId, GRANDPA_CHIPS) },
  { trigger: "还钱", run: (game, playerId) => repayDebt(game, playerId) },
];

/**
 * @returns {object|null}
 *   null = not a cheat line (or cheats disabled) — normal chat path only.
 *   ok borrow: {ok, action:"borrow", chips, wasBusted, debt, midHand, trigger}
 *   ok repay:  {ok, action:"repay", amount, trigger}
 *   error:     {error, trigger}
 */
function tryChatCheat(game, playerId, text) {
  if (!ENABLED || !game) return null;
  const body = String(text || "").trim();
  if (!body) return null;
  for (const cheat of CHAT_CHEATS) {
    if (body !== cheat.trigger) continue;
    const res = cheat.run(game, playerId);
    if (!res) return null;
    if (res.error) return { error: res.error, trigger: cheat.trigger };
    return { ...res, trigger: cheat.trigger };
  }
  return null;
}

module.exports = {
  CHEAT_ENABLED: ENABLED,
  BORROW_CHIPS,
  GRANDPA_CHIPS,
  REBUY_CHIPS: BORROW_CHIPS,
  tryChatCheat,
};
