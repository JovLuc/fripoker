import { describe, expect, it } from "vitest";
import { RANK_VALUE, SHORT_DECK_MIN_RANK, createDeck } from "./cards.js";

describe("createDeck", () => {
  it("long deck: 52 unique cards, ranks 2..A", () => {
    const deck = createDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map((c) => c.code)).size).toBe(52);
    expect(deck.every((c) => RANK_VALUE[c.rank] >= 2)).toBe(true);
  });

  it("short deck: 36 unique cards, no rank below 6", () => {
    const deck = createDeck(true);
    expect(deck).toHaveLength(36);
    expect(new Set(deck.map((c) => c.code)).size).toBe(36);
    expect(deck.every((c) => RANK_VALUE[c.rank] >= SHORT_DECK_MIN_RANK)).toBe(true);
    expect(deck.some((c) => ["2", "3", "4", "5"].includes(c.rank))).toBe(false);
  });
});
