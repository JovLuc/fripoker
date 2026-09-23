import { describe, expect, it } from "vitest";
import type { Card, Rank, Suit } from "./types.js";
import { compareEval, describeHand, evaluate7 } from "./evaluator.js";

function card(code: string): Card {
  const rank = code[0] as Rank;
  const suit = code[1].toLowerCase() as Suit;
  return { rank, suit, code: `${rank}${suit.toUpperCase()}` };
}
const hand = (codes: string): Card[] => codes.split(" ").map(card);

describe("evaluate7 categories", () => {
  it("straight flush beats quads", () => {
    const sf = evaluate7(hand("As Ks Qs Js Ts 2h 3d"));
    const quads = evaluate7(hand("Ah Ac Ad As Kh Qh Jh"));
    expect(sf.name).toBe("同花顺");
    expect(quads.name).toBe("四条");
    expect(compareEval(sf, quads)).toBeGreaterThan(0);
  });

  it("royal flush", () => {
    const ev = evaluate7(hand("As Ks Qs Js Ts 2h 3d"));
    expect(ev.category).toBe(8);
    expect(ev.tiebreak).toEqual([14]);
  });

  it("wheel straight: A2345 is a 5-high straight", () => {
    const ev = evaluate7(hand("Ah 2c 3d 4s 5h 9c 9d"));
    expect(ev.name).toBe("顺子");
    expect(ev.tiebreak).toEqual([5]);
  });

  it("6-high straight beats the wheel", () => {
    const six = evaluate7(hand("2h 3c 4d 5s 6h 9c 9d"));
    const wheel = evaluate7(hand("Ah 2c 3d 4s 5h 9c 9d"));
    expect(compareEval(six, wheel)).toBeGreaterThan(0);
  });

  it("flush beats a straight", () => {
    const flush = evaluate7(hand("2s 4s 6s 8s Ts Ah Kd"));
    const straight = evaluate7(hand("Ah 2c 3d 4s 5h 9c 9d"));
    expect(flush.name).toBe("同花");
    expect(compareEval(flush, straight)).toBeGreaterThan(0);
  });

  it("two trips make a full house (AAA over KKK)", () => {
    const ev = evaluate7(hand("Ah Ac Ad Ks Kc 2d 3d"));
    expect(ev.name).toBe("葫芦");
    expect(ev.tiebreak).toEqual([14, 13]);
  });

  it("trips + pair full house", () => {
    const ev = evaluate7(hand("7h 7c 7d Ks Kc 2d 3d"));
    expect(ev.name).toBe("葫芦");
    expect(ev.tiebreak).toEqual([7, 13]);
  });

  it("two pair with kicker", () => {
    const ev = evaluate7(hand("Ah Ac Ks Kc Qd 2d 3d"));
    expect(ev.name).toBe("两对");
    expect(ev.tiebreak).toEqual([14, 13, 12]);
  });

  it("pair kicker decides", () => {
    const withAce = evaluate7(hand("Kh Kc As Jd 2h 3c 4s"));
    const withQueen = evaluate7(hand("Kh Kc Qs Jd 2h 3c 4s"));
    expect(withAce.name).toBe("一对");
    expect(compareEval(withAce, withQueen)).toBeGreaterThan(0);
  });

  it("pair beats high card", () => {
    const pair = evaluate7(hand("2h 2c As Kd Qd Jd 9d"));
    const high = evaluate7(hand("Ah Kc Qs Jd 9d 3c 4d"));
    expect(compareEval(pair, high)).toBeGreaterThan(0);
  });

  it("exact tie compares 0", () => {
    const a = evaluate7(hand("Ah Ac Ks Kc Qd 2d 3d"));
    const b = evaluate7(hand("Ad As Kh Ks Qc 2c 3c"));
    expect(compareEval(a, b)).toBe(0);
  });
});

describe("describeHand", () => {
  it("pocket aces preflop", () => {
    expect(describeHand(hand("Ah Ac"), [])).toBe("一对 A");
  });

  it("AK suited preflop label", () => {
    expect(describeHand(hand("Kh Ah"), [])).toBe("AKs 高牌");
  });

  it("AK offsuit preflop label", () => {
    expect(describeHand(hand("Kh Ad"), [])).toBe("AK 高牌");
  });

  it("with a full board, evaluates the 7-card hand", () => {
    expect(describeHand(hand("Ah 2c"), hand("As 4s 5s Kd Qc"))).toBe("一对");
    expect(describeHand(hand("Ah Ac"), hand("As 4s 5s Kd Qc"))).toBe("三条");
  });
});
