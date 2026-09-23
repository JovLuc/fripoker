// Player economy: bust logging, borrowing (chat cheats / rebuy), repayment.
// Borrowing adds chips from thin air on purpose (LAN house money); debt
// compounds ×1.1 per hand after a one-hand grace period (see handFlow.resetHand).

import { REPAY_CHIPS } from "../../shared/constants.js";
import type { GameState, Player } from "./types.js";

export interface BorrowOk {
  ok: true;
  action: "borrow";
  chips: number;
  wasBusted: boolean;
  debt: number;
  midHand: boolean;
}
export type BorrowResult = BorrowOk | { ok: false; error: string };

export interface RepayOk {
  ok: true;
  action: "repay";
  amount: number;
  remaining: number;
}
export type RepayResult = RepayOk | { ok: false; error: string };

/** Append-only: one log entry per bust episode; history never cleared. */
export function noteBusted(state: GameState): { id: string; name: string }[] {
  const added: { id: string; name: string }[] = [];
  for (const p of state.players) {
    if (p.chips > 0) continue;
    if (p.bustLogged) continue;
    p.bustLogged = true;
    state.busted.push({ id: p.id, name: p.name });
    added.push({ id: p.id, name: p.name });
  }
  return added;
}

export function playersWithChips(state: GameState): Player[] {
  return state.players.filter((p) => p.chips > 0);
}

/**
 * Borrow chips anytime (busted or not). A seat that busted mid-hand stays out
 * (folded, sittingOut) until the next deal. Does not clear the bust history.
 */
export function borrowChips(state: GameState, playerId: string, amount: number): BorrowResult {
  const chips = Math.floor(Number(amount));
  if (!Number.isFinite(chips) || chips <= 0) return { ok: false, error: "非法金额" };
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { ok: false, error: "你不在对局中" };

  const wasBusted = player.chips <= 0;
  player.chips += chips;
  player.debt = (player.debt || 0) + chips;
  player.debtHands = 0; // just borrowed — no interest on the next deal
  player.bustLogged = false;

  const midHand = !state.handOver && state.phase !== "idle";
  if (wasBusted && midHand) {
    player.sittingOut = true;
    player.folded = true;
    player.allIn = false;
    player.holeCards = [];
  } else if (wasBusted) {
    player.sittingOut = false;
    player.folded = false;
    player.allIn = false;
  }

  if (state.gameOver && playersWithChips(state).length >= 2) {
    state.gameOver = false;
    state.message = `${player.name} 重回战局`;
  }
  return {
    ok: true,
    action: "borrow",
    chips,
    wasBusted,
    debt: player.debt,
    midHand: wasBusted && midHand,
  };
}

/** Each repay pays min(debt, REPAY_CHIPS); partials OK so compound debt clears over clicks. */
export function repayDebt(state: GameState, playerId: string): RepayResult {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { ok: false, error: "你不在对局中" };
  const debt = player.debt || 0;
  if (debt <= 0) return { ok: false, error: "无欠款" };
  const pay = Math.min(debt, REPAY_CHIPS);
  if (player.chips < pay) return { ok: false, error: "余额不足" };
  player.chips -= pay;
  player.debt = debt - pay;
  if (player.debt === 0) player.debtHands = 0;
  return {
    ok: true,
    action: "repay",
    amount: pay,
    remaining: player.debt,
  };
}
