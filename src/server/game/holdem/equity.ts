// Monte Carlo equity estimation for bot decisions — self-contained bot-side
// module. Equity = hero's expected pot share against `opponents` random
// holdings on a random runout, estimated by sampling. evaluate7/compareEval
// are reused via the engine facade so the ranking always matches the real
// showdown (including the short-deck 6+ renumbering). Other players' actual
// hole cards are never read: unknown cards are dealt from a scratch deck.
//
// Cost: iterations × (opponents+1) evaluate7 calls — a few ms per decision;
// bot actions ride on timers, so it is imperceptible.

import { compareEval, evaluate7 } from "./evaluator.js";
import { createDeck } from "../core/cards.js";
import type { Card } from "../core/types.js";

export type Rng = () => number;

export interface EquityInput {
  /** Random hands hero is up against (the whole field, not per-player). */
  opponents: number;
  shortDeck?: boolean;
  /** Sample count; more = stabler estimate. Default 500 (std ≈ 2%). */
  iterations?: number;
  /** Injectable for tests; defaults to Math.random. */
  rng?: Rng;
}

/** Fractional win probability in [0,1]; ties split the pot evenly. */
export function estimateEquity(hole: Card[], board: Card[], input: EquityInput): number {
  const { opponents, shortDeck = false, iterations = 500, rng = Math.random } = input;
  const known = new Set([...hole, ...board].map((c) => c.code));
  const pool = createDeck(shortDeck).filter((c) => !known.has(c.code));
  const runoutNeed = 5 - board.length;
  const need = runoutNeed + 2 * opponents;
  if (need > pool.length) return 0.5; // degenerate table; refuse to guess

  let score = 0;
  for (let iter = 0; iter < iterations; iter++) {
    // Partial Fisher–Yates on the reused pool: each pick is uniform without
    // replacement, and leaving the pool permuted keeps later rounds uniform.
    const dealt: Card[] = [];
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(rng() * (pool.length - i));
      const t = pool[i];
      pool[i] = pool[j];
      pool[j] = t;
      dealt.push(pool[i]);
    }

    const fullBoard = board.concat(dealt.slice(0, runoutNeed));
    const hero = evaluate7(hole.concat(fullBoard), shortDeck);
    let ties = 0;
    let beaten = false;
    for (let o = 0; o < opponents; o++) {
      const at = runoutNeed + 2 * o;
      const villain = evaluate7([dealt[at], dealt[at + 1], ...fullBoard], shortDeck);
      const cmp = compareEval(villain, hero);
      if (cmp > 0) {
        beaten = true;
        break;
      }
      if (cmp === 0) ties++;
    }
    score += beaten ? 0 : 1 / (1 + ties);
  }
  return score / iterations;
}
