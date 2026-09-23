// 5–7 card hand evaluation. category 0..8 (high card → straight flush);
// compareEval(a, b) > 0 means a wins. Names are Chinese for direct UI use.

import { RANK_VALUE } from "./cards.js";
import type { Card } from "./types.js";

export interface HandEval {
  category: number;
  tiebreak: number[];
  name: string;
}

/** Highest straight top card among the given rank values; 5 for the wheel; 0 if none. */
export function straightHighFromRanks(rankSetInput: Iterable<number>): number {
  const set = new Set(rankSetInput);
  if (set.has(14)) set.add(1);
  let run = 0;
  for (let r = 14; r >= 1; r--) {
    if (set.has(r)) {
      run += 1;
      if (run >= 5) return r + 4 > 14 && run === 5 && r >= 10 ? 14 : r + 4;
    } else {
      run = 0;
    }
  }
  if (set.has(14) && set.has(2) && set.has(3) && set.has(4) && set.has(5)) return 5;
  return 0;
}

function findStraightFlush(cards: Card[]): number {
  const bySuit = new Map<string, Set<number>>();
  for (const c of cards) {
    let ranks = bySuit.get(c.suit);
    if (!ranks) {
      ranks = new Set();
      bySuit.set(c.suit, ranks);
    }
    ranks.add(RANK_VALUE[c.rank]);
  }
  for (const ranks of bySuit.values()) {
    const high = straightHighFromRanks(ranks);
    if (high) return high;
  }
  return 0;
}

export function evaluate7(cards: Card[]): HandEval {
  const ranks = cards.map((c) => RANK_VALUE[c.rank]);
  const suitCounts: Record<string, number> = {};
  for (const c of cards) suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1;
  const flushSuit = Object.keys(suitCounts).find((s) => suitCounts[s] >= 5);

  const rankCounts: Record<number, number> = {};
  for (const r of ranks) rankCounts[r] = (rankCounts[r] || 0) + 1;
  const groups = Object.entries(rankCounts)
    .map(([rank, count]) => ({ rank: Number(rank), count }))
    .sort((a, b) => b.count - a.count || b.rank - a.rank);

  if (flushSuit) {
    const sf = findStraightFlush(cards.filter((c) => c.suit === flushSuit));
    if (sf) return { category: 8, tiebreak: [sf], name: "同花顺" };
  }

  if (groups[0]?.count === 4) {
    const quad = groups[0].rank;
    const kicker = Math.max(...ranks.filter((r) => r !== quad));
    return { category: 7, tiebreak: [quad, kicker], name: "四条" };
  }

  const trips = groups.filter((g) => g.count >= 3).map((g) => g.rank).sort((a, b) => b - a);
  // full house: trips + pair (a second trips also contributes its pair)
  if (trips.length >= 1) {
    const trip = trips[0];
    const pairRanks = groups
      .filter((g) => g.count >= 2 && g.rank !== trip)
      .map((g) => g.rank)
      .sort((a, b) => b - a);
    if (trips.length >= 2) {
      const trip2 = trips[1];
      return { category: 6, tiebreak: [trip, trip2], name: "葫芦" };
    }
    if (pairRanks.length >= 1) {
      return { category: 6, tiebreak: [trip, pairRanks[0]], name: "葫芦" };
    }
  }

  if (flushSuit) {
    const flushRanks = [
      ...new Set(cards.filter((c) => c.suit === flushSuit).map((c) => RANK_VALUE[c.rank])),
    ]
      .sort((a, b) => b - a)
      .slice(0, 5);
    return { category: 5, tiebreak: flushRanks, name: "同花" };
  }

  const sh = straightHighFromRanks(ranks);
  if (sh) return { category: 4, tiebreak: [sh], name: "顺子" };

  if (trips.length >= 1) {
    const trip = trips[0];
    const kickers = ranks.filter((r) => r !== trip).sort((a, b) => b - a).slice(0, 2);
    return { category: 3, tiebreak: [trip, ...kickers], name: "三条" };
  }

  const pairRanks = groups.filter((g) => g.count >= 2).map((g) => g.rank).sort((a, b) => b - a);
  if (pairRanks.length >= 2) {
    const [p1, p2] = pairRanks;
    const kicker = Math.max(...ranks.filter((r) => r !== p1 && r !== p2));
    return { category: 2, tiebreak: [p1, p2, kicker], name: "两对" };
  }
  if (pairRanks.length === 1) {
    const p = pairRanks[0];
    const kickers = ranks.filter((r) => r !== p).sort((a, b) => b - a).slice(0, 3);
    return { category: 1, tiebreak: [p, ...kickers], name: "一对" };
  }

  const high = [...new Set(ranks)].sort((a, b) => b - a).slice(0, 5);
  return { category: 0, tiebreak: high, name: "高牌" };
}

/** >0 if a is better, <0 if b is better, 0 on an exact tie. */
export function compareEval(a: HandEval, b: HandEval): number {
  if (a.category !== b.category) return a.category - b.category;
  const len = Math.max(a.tiebreak.length, b.tiebreak.length);
  for (let i = 0; i < len; i++) {
    const av = a.tiebreak[i] ?? 0;
    const bv = b.tiebreak[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

/** Best visible hand name for UI: preflop uses the 2 cards; flop+ evaluates fully. */
export function describeHand(holeCards: Card[], board: Card[]): string {
  if (!holeCards || holeCards.length < 2) return "";
  if (board && board.length >= 3) {
    const all = [...holeCards, ...board];
    if (all.length >= 5) return evaluate7(all).name;
  }
  const a = RANK_VALUE[holeCards[0].rank];
  const b = RANK_VALUE[holeCards[1].rank];
  const faceNames: Record<number, string> = { 14: "A", 13: "K", 12: "Q", 11: "J", 10: "T" };
  if (a === b) {
    const label = faceNames[a] || String(a);
    return `一对 ${label}`;
  }
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  const rankName = (v: number): string => faceNames[v] || String(v);
  const suited = holeCards[0].suit === holeCards[1].suit;
  return `${rankName(hi)}${rankName(lo)}${suited ? "s" : ""} 高牌`;
}
