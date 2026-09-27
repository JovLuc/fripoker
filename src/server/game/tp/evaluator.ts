// 3-card hand evaluation for the three-card game. Category 0..5
// (high card → trips); compare3 never returns 0 for two distinct hands from
// one deck: equal ranks fall through to suit order (♠ > ♥ > ♣ > ♦).
// Names are Chinese for direct UI use.

import { RANK_VALUE } from "../core/cards.js";
import type { Card } from "../core/types.js";

export interface TpEval {
  category: number;
  tiebreak: number[];
  /** Suits of the canonical (rank-desc, suit-desc) card order — final tiebreak. */
  suitKey: number[];
  name: string;
}

const SUIT_VALUE: Record<string, number> = { s: 3, h: 2, c: 1, d: 0 };

const CATEGORY_NAMES = ["高牌", "对子", "顺子", "同花", "同花顺", "三条"];

/** Highest straight top card among exactly three rank values; 0 if none. A23 is the wheel (high 3). */
function straightHigh3(values: number[]): number {
  const v = [...values].sort((a, b) => b - a);
  if (v[0] - v[1] === 1 && v[1] - v[2] === 1) return v[0];
  const set = new Set(v);
  if (set.has(14) && set.has(2) && set.has(3)) return 3;
  return 0;
}

export function evaluate3(cards: Card[]): TpEval {
  const values = cards.map((c) => RANK_VALUE[c.rank]);
  const canonical = [...cards].sort(
    (a, b) => RANK_VALUE[b.rank] - RANK_VALUE[a.rank] || SUIT_VALUE[b.suit] - SUIT_VALUE[a.suit],
  );
  const suitKey = canonical.map((c) => SUIT_VALUE[c.suit]);
  const desc = [...values].sort((a, b) => b - a);
  const flush = cards.every((c) => c.suit === cards[0].suit);
  const high = straightHigh3(values);

  let category: number;
  let tiebreak: number[];

  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  const pairs = [...counts.entries()].filter(([, n]) => n === 2).map(([r]) => r);
  const trips = [...counts.entries()].find(([, n]) => n === 3);

  if (trips) {
    category = 5;
    tiebreak = [trips[0]];
  } else if (high && flush) {
    category = 4;
    tiebreak = [high];
  } else if (flush) {
    category = 3;
    tiebreak = desc;
  } else if (high) {
    category = 2;
    tiebreak = [high];
  } else if (pairs.length === 1) {
    category = 1;
    const pairRank = pairs[0];
    const kicker = Math.max(...values.filter((v) => v !== pairRank));
    tiebreak = [pairRank, kicker];
  } else {
    category = 0;
    tiebreak = desc;
  }

  return { category, tiebreak, suitKey, name: CATEGORY_NAMES[category] };
}

/** >0 if a wins, <0 if b wins. Two distinct hands from one deck never tie. */
export function compare3(a: TpEval, b: TpEval): number {
  if (a.category !== b.category) return a.category - b.category;
  const len = Math.max(a.tiebreak.length, b.tiebreak.length);
  for (let i = 0; i < len; i++) {
    const av = a.tiebreak[i] ?? 0;
    const bv = b.tiebreak[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  for (let i = 0; i < Math.max(a.suitKey.length, b.suitKey.length); i++) {
    const av = a.suitKey[i] ?? 0;
    const bv = b.suitKey[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}
