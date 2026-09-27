import { describe, expect, it } from "vitest";
import type { Card, Rank, Suit } from "../core/types.js";
import { compare3, evaluate3 } from "./evaluator.js";

function card(code: string): Card {
  const rank = code[0] as Rank;
  const suit = code[1].toLowerCase() as Suit;
  return { rank, suit, code: `${rank}${suit.toUpperCase()}` };
}

function hand(...codes: string[]) {
  return evaluate3(codes.map(card));
}

describe("tp hand ranking", () => {
  it("orders all six categories", () => {
    const high = hand("2h", "5d", "9c");
    const pair = hand("9h", "9d", "2c");
    const straight = hand("4h", "5d", "6c");
    const flush = hand("2h", "5h", "9h");
    const straightFlush = hand("4h", "5h", "6h");
    const trips = hand("9h", "9d", "9c");
    // classic three-card order: flush BEATS straight, trips on top
    expect(compare3(pair, high)).toBeGreaterThan(0);
    expect(compare3(straight, pair)).toBeGreaterThan(0);
    expect(compare3(flush, straight)).toBeGreaterThan(0);
    expect(compare3(straightFlush, flush)).toBeGreaterThan(0);
    expect(compare3(trips, straightFlush)).toBeGreaterThan(0);
  });

  it("names categories in Chinese", () => {
    expect(hand("2h", "5d", "9c").name).toBe("高牌");
    expect(hand("9h", "9d", "2c").name).toBe("对子");
    expect(hand("4h", "5d", "6c").name).toBe("顺子");
    expect(hand("2h", "5h", "9h").name).toBe("同花");
    expect(hand("4h", "5h", "6h").name).toBe("同花顺");
    expect(hand("9h", "9d", "9c").name).toBe("三条");
  });

  it("A23 is the wheel — lowest straight", () => {
    const wheel = hand("Ah", "2d", "3c");
    const deuceHigh = hand("2h", "3d", "4c"); // 234 straight
    expect(wheel.category).toBe(2);
    expect(deuceHigh.category).toBe(2);
    expect(compare3(deuceHigh, wheel)).toBeGreaterThan(0);
    expect(compare3(wheel, hand("Ah", "2d", "5c"))).toBeGreaterThan(0); // wheel > A25 high card
  });

  it("QKA is the top straight", () => {
    const top = hand("Qh", "Kd", "Ac");
    expect(top.category).toBe(2);
    expect(compare3(top, hand("Jh", "Qd", "Kc"))).toBeGreaterThan(0);
  });

  it("compares trips by rank", () => {
    expect(compare3(hand("9h", "9d", "9c"), hand("8h", "8d", "8c"))).toBeGreaterThan(0);
  });

  it("compares pairs by pair rank then kicker", () => {
    expect(compare3(hand("9h", "9d", "2c"), hand("8h", "8d", "Ac"))).toBeGreaterThan(0);
    expect(compare3(hand("9h", "9d", "Ac"), hand("9h", "9c", "Kd"))).toBeGreaterThan(0);
  });

  it("compares flushes by ranks", () => {
    expect(compare3(hand("Ah", "Kh", "Qh"), hand("Kd", "Qd", "Jd"))).toBeGreaterThan(0);
  });

  it("never ties distinct hands — suit order breaks equal ranks", () => {
    // same rank multisets, different suits → deterministic, non-zero
    const a = hand("Ah", "Kd", "Qc");
    const b = hand("As", "Kh", "Qd");
    expect(compare3(a, b)).not.toBe(0);
    expect(compare3(a, b) === 0).toBe(false);
    // identical hands compare equal (only reachable with the same cards)
    expect(compare3(hand("Ah", "Kd", "Qc"), hand("Ah", "Kd", "Qc"))).toBe(0);
  });
});
