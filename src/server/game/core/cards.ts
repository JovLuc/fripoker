// Deck construction and shuffling.

import type { Card, Rank, Suit } from "./types.js";

export const SUITS: readonly Suit[] = ["s", "h", "d", "c"];
export const RANKS: readonly Rank[] = [
  "2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A",
];

/** Short deck (6+) keeps ranks 6..A only — 36 cards instead of 52. */
export const SHORT_DECK_MIN_RANK = 6;

/** "2"→2 … "A"→14. */
export const RANK_VALUE: Record<Rank, number> = Object.fromEntries(
  RANKS.map((r, i) => [r, i + 2]),
) as Record<Rank, number>;

export function createDeck(shortDeck = false): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      if (shortDeck && RANK_VALUE[rank] < SHORT_DECK_MIN_RANK) continue;
      deck.push({ rank, suit, code: `${rank}${suit.toUpperCase()}` });
    }
  }
  return deck;
}

/** In-place Fisher–Yates; returns the same array for call-site convenience. */
export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
