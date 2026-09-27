// Shared state helpers every ruleset's flow uses: seat rotation, chip commits,
// action reopening, side-pot layering. All pure over BaseGame/BasePlayer.

import type { ApplyResult, BaseGame, BasePlayer } from "./types.js";

export function canAct(p: BasePlayer): boolean {
  return !p.folded && !p.allIn && !p.sittingOut && p.chips > 0;
}

/** First seat clockwise from `from` (exclusive) matching the predicate; -1 if none. */
export function nextSeatFrom<T>(
  arr: T[],
  from: number,
  predicate: (item: T, idx: number) => boolean,
): number {
  const n = arr.length;
  for (let i = 1; i <= n; i++) {
    const idx = (from + i + n) % n;
    if (predicate(arr[idx], idx)) return idx;
  }
  return -1;
}

/** Move chips into the pot; marks all-in when a player runs dry. Returns paid. */
export function commitChips(
  state: { pot: number },
  player: BasePlayer,
  amount: number,
): number {
  const pay = Math.min(Math.floor(amount), player.chips);
  player.chips -= pay;
  player.roundBet += pay;
  player.totalBet += pay;
  state.pot += pay;
  if (player.chips === 0) player.allIn = true;
  return pay;
}

/** A full raise reopens action for everyone except the aggressor. */
export function reopenAction(
  state: { players: BasePlayer[] },
  aggressor: BasePlayer,
): void {
  for (const p of state.players) {
    if (p !== aggressor && canAct(p)) p.acted = false;
  }
}

export interface Pot {
  amount: number;
  /** Player ids allowed to win this layer: contributed above the previous level and not folded. */
  eligibleIds: string[];
}

/** Layer side pots by totalBet levels ascending — shared by every game with all-ins. */
export function buildPots(players: BasePlayer[]): Pot[] {
  const withBet = players.filter((p) => p.totalBet > 0);
  if (withBet.length === 0) return [];
  const levels = [...new Set(withBet.map((p) => p.totalBet))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const p of players) {
      const contrib = Math.min(p.totalBet, level) - Math.min(p.totalBet, prev);
      if (contrib > 0) amount += contrib;
    }
    const eligibleIds = players.filter((p) => !p.folded && p.totalBet > prev).map((p) => p.id);
    if (amount > 0) pots.push({ amount, eligibleIds });
    prev = level;
  }
  return pots;
}

/**
 * Everyone folded but one — no reveal, whole pot to the survivor.
 * Sets `phase` to the given showdown phase label (game-specific wording).
 */
export function endHandByFold(state: BaseGame, showdownPhase: string): void {
  state.phase = showdownPhase;
  state.actionIndex = -1;
  state.handOver = true;
  const winner = state.players.find((p) => !p.folded && !p.sittingOut);
  if (winner && state.pot > 0) {
    const gain = state.pot;
    winner.chips += gain;
    state.lastResults = [{ playerId: winner.id, name: winner.name, amount: gain, hand: "" }];
    state.message = `${winner.name} +${gain}（其他人弃牌）`;
    state.pot = 0;
  }
}

/** Split `amount` evenly among winners; remainder +1 to earlier array order. */
export function awardSplit(
  players: BasePlayer[],
  amount: number,
  winnerIds: string[],
  wins: Map<string, number>,
): void {
  const share = Math.floor(amount / winnerIds.length);
  let rem = amount - share * winnerIds.length;
  for (const id of winnerIds) {
    const extra = rem > 0 ? 1 : 0;
    rem -= 1;
    const gain = share + extra;
    const player = players.find((p) => p.id === id)!;
    player.chips += gain;
    wins.set(id, (wins.get(id) || 0) + gain);
  }
}

export type { ApplyResult };
