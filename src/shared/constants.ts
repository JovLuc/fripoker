// Wire-level constants shared by client and server.
// Game-rule constants (chips/blinds/seats) are re-exported by the engine;
// localStorage keys are used by the client only but live here so the
// persistence contract is documented in one place.

export const STARTING_CHIPS = 2000;
export const SMALL_BLIND = 10;
export const BIG_BLIND = 20;
export const MAX_PLAYERS = 6;

/** One「还钱」click pays at most this much (partial repay allowed). */
export const REPAY_CHIPS = 500;

/** 「爸爸」borrow amount (chat cheat). */
export const CHEAT_BORROW_CHIPS = 200;
/** 「爷爷」borrow amount (chat cheat). */
export const CHEAT_GRANDPA_CHIPS = 500;

/** Chat line hard cap (server truncates, input maxlength matches). */
export const CHAT_TEXT_MAX = 200;
/** Chat history kept in memory / sent in snapshots. */
export const CHAT_HISTORY_KEEP = 80;
/** Nickname hard cap. */
export const NICKNAME_MAX = 16;

export const LS_KEYS = {
  playerId: "fripoker_pid",
  nickname: "fripoker_nick",
  room: "fripoker_room",
  chatPos: "fripoker_chat_pos",
} as const;
