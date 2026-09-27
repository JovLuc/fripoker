import { describe, expect, it } from "vitest";
import type { Card, Rank, Suit } from "../core/types.js";
import { estimateEquity } from "./equity.js";

/** mulberry32 — small seeded PRNG so the distribution assertions are stable. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const card = (rank: Rank, suit: Suit): Card => ({ rank, suit, code: `${rank}${suit.toUpperCase()}` });
const hold = (r1: Rank, s1: Suit, r2: Rank, s2: Suit): [Card, Card] => [card(r1, s1), card(r2, s2)];

const N = 3000; // std ≈ 0.9% — tight enough for ±0.03 windows at these seeds

describe("estimateEquity", () => {
  it("AA heads-up preflop ≈ 85% in a full deck", () => {
    const eq = estimateEquity(hold("A", "s", "A", "h"), [], {
      opponents: 1,
      iterations: N,
      rng: seeded(1),
    });
    expect(eq).toBeGreaterThan(0.82);
    expect(eq).toBeLessThan(0.88);
  });

  it("AA equity falls as the field grows (5 random opponents ≈ 49%)", () => {
    const hu = estimateEquity(hold("A", "s", "A", "h"), [], { opponents: 1, iterations: N, rng: seeded(2) });
    const sixWay = estimateEquity(hold("A", "s", "A", "h"), [], { opponents: 5, iterations: N, rng: seeded(3) });
    expect(sixWay).toBeLessThan(hu);
    expect(sixWay).toBeGreaterThan(0.42);
    expect(sixWay).toBeLessThan(0.56);
  });

  it("AA heads-up preflop ≈ 78% in short deck", () => {
    const eq = estimateEquity(hold("A", "s", "A", "h"), [], {
      opponents: 1,
      shortDeck: true,
      iterations: N,
      rng: seeded(4),
    });
    expect(eq).toBeGreaterThan(0.73);
    expect(eq).toBeLessThan(0.82);
  });

  it("ranks premium over trash preflop", () => {
    const aks = estimateEquity(hold("A", "s", "K", "s"), [], { opponents: 1, iterations: N, rng: seeded(5) });
    const junk = estimateEquity(hold("7", "d", "2", "c"), [], { opponents: 1, iterations: N, rng: seeded(6) });
    expect(aks).toBeGreaterThan(junk + 0.15);
  });

  it("top set crushes ace-high on the same flop", () => {
    const board = [card("K", "d"), card("7", "s"), card("2", "h")];
    const set = estimateEquity(hold("K", "c", "K", "h"), board, { opponents: 1, iterations: N, rng: seeded(7) });
    const air = estimateEquity(hold("A", "c", "Q", "d"), board, { opponents: 1, iterations: N, rng: seeded(8) });
    expect(set).toBeGreaterThan(0.85);
    // vs a uniform random hand AQ-high keeps real equity (overcards beat junk),
    // so assert the gap, not an absolute window.
    expect(set).toBeGreaterThan(air + 0.3);
  });

  it("the nuts on the river wins outright (ties impossible)", () => {
    // Royal flush using T♠; the T is held, so no other royal exists.
    const board = [card("A", "s"), card("K", "s"), card("Q", "s"), card("J", "s"), card("2", "d")];
    const eq = estimateEquity(hold("T", "s", "3", "h"), board, { opponents: 3, iterations: N, rng: seeded(9) });
    expect(eq).toBe(1);
  });

  it("is deterministic under a fixed seed and always in [0,1]", () => {
    const hole = hold("J", "h", "T", "h");
    const board = [card("Q", "h"), card("8", "d"), card("3", "c")];
    const a = estimateEquity(hole, board, { opponents: 2, iterations: 500, rng: seeded(42) });
    const b = estimateEquity(hole, board, { opponents: 2, iterations: 500, rng: seeded(42) });
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(1);
  });
});
