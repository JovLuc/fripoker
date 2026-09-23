// Engine facade — the only import surface for the rest of the server.
// Everything under game/ is pure: no I/O, no rooms, no timers.

export * from "./types.js";
export { RANKS, RANK_VALUE, SUITS, createDeck, shuffle } from "./cards.js";
export { compareEval, describeHand, evaluate7 } from "./evaluator.js";
export type { HandEval } from "./evaluator.js";
export {
  applyAction,
  canAct,
  createGameState,
  legalActions,
  legalActionsFor,
  nextSeatFrom,
  startHand,
  stepAfterAction,
} from "./handFlow.js";
export { awardPots, buildPots, dealRemainingBoard, endHandByFold, showdown } from "./showdown.js";
export type { Pot } from "./showdown.js";
export { borrowChips, noteBusted, playersWithChips, repayDebt } from "./economy.js";
export type { BorrowResult, BorrowOk, RepayOk, RepayResult } from "./economy.js";
