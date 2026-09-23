// Side pots, settlement, showdown. awardPots is the single place chips
// leave the pot and return to players.

import { evaluate7, compareEval } from "./evaluator.js";
import type { GameState } from "./types.js";

export interface Pot {
  amount: number;
  /** Player ids allowed to win this layer: contributed above the previous level and not folded. */
  eligibleIds: string[];
}

/** Layer side pots by totalBet levels ascending. */
export function buildPots(state: GameState): Pot[] {
  const withBet = state.players.filter((p) => p.totalBet > 0);
  if (withBet.length === 0) return [];
  const levels = [...new Set(withBet.map((p) => p.totalBet))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const p of state.players) {
      const contrib = Math.min(p.totalBet, level) - Math.min(p.totalBet, prev);
      if (contrib > 0) amount += contrib;
    }
    const eligibleIds = state.players.filter((p) => !p.folded && p.totalBet > prev).map((p) => p.id);
    if (amount > 0) pots.push({ amount, eligibleIds });
    prev = level;
  }
  return pots;
}

/** Run the board out to 5 cards (used at showdown / all-in runouts). */
export function dealRemainingBoard(state: GameState): void {
  while (state.board.length < 5) {
    if (state.board.length === 0) {
      state.board.push(state.deck.pop()!, state.deck.pop()!, state.deck.pop()!);
    } else {
      state.board.push(state.deck.pop()!);
    }
  }
}

export function awardPots(state: GameState): void {
  const pots = buildPots(state);
  const evals = new Map<string, ReturnType<typeof evaluate7>>();
  for (const p of state.players) {
    if (p.folded || p.holeCards.length < 2) continue;
    const all = [...p.holeCards, ...state.board];
    if (all.length >= 5) evals.set(p.id, evaluate7(all));
  }

  const wins = new Map<string, number>();
  for (const pot of pots) {
    const elig = pot.eligibleIds.filter((id) => evals.has(id));
    if (elig.length === 0) continue;
    let best = evals.get(elig[0])!;
    let winners = [elig[0]];
    for (let i = 1; i < elig.length; i++) {
      const c = compareEval(evals.get(elig[i])!, best);
      if (c > 0) {
        best = evals.get(elig[i])!;
        winners = [elig[i]];
      } else if (c === 0) {
        winners.push(elig[i]);
      }
    }
    const share = Math.floor(pot.amount / winners.length);
    let rem = pot.amount - share * winners.length;
    for (const id of winners) {
      const extra = rem > 0 ? 1 : 0;
      rem -= 1;
      const gain = share + extra;
      const player = state.players.find((p) => p.id === id)!;
      player.chips += gain;
      wins.set(id, (wins.get(id) || 0) + gain);
    }
  }

  state.lastResults = [...wins.entries()].map(([playerId, amount]) => {
    const player = state.players.find((p) => p.id === playerId);
    const ev = evals.get(playerId);
    return {
      playerId,
      name: player?.name || "",
      amount,
      hand: ev?.name || "",
    };
  });
  state.pot = 0;
  const parts = state.lastResults.map((r) => `${r.name} +${r.amount}${r.hand ? ` (${r.hand})` : ""}`);
  state.message = parts.length ? parts.join(" · ") : "本手结束";
}

/** Everyone folded but one — no reveal, whole pot to the survivor. */
export function endHandByFold(state: GameState): void {
  state.phase = "showdown";
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

export function showdown(state: GameState): void {
  state.phase = "showdown";
  state.actionIndex = -1;
  state.handOver = true;
  state.revealAll = true;
  dealRemainingBoard(state);
  awardPots(state);
}
