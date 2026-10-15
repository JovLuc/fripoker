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

describe("short deck (6+) rankings", () => {
  it("flush beats a full house", () => {
    const fh = hand("Ah Ac Ad 6s 6c 9h 9d"); // AAA66
    const flush = hand("6s 7s 9s Js Qs Ah Ad"); // queen-high flush + pair aces
    expect(evaluate7(fh, true).name).toBe("葫芦");
    expect(evaluate7(flush, true).name).toBe("同花");
    expect(compareEval(evaluate7(flush, true), evaluate7(fh, true))).toBeGreaterThan(0);
    // the same shapes under long-deck rules flip back
    expect(compareEval(evaluate7(fh), evaluate7(flush))).toBeGreaterThan(0);
  });

  it("a straight beats trips in short deck and long deck", () => {
    const trips = hand("Ah Ac Ad 6s 7h 9c Kd"); // AAA, no 5-run (needs the 8)
    const straight = hand("6s 7h 8d 9c Th Kd Kc"); // ten-high straight + pair K
    expect(evaluate7(trips, true).name).toBe("三条");
    expect(evaluate7(straight, true).name).toBe("顺子");
    expect(compareEval(evaluate7(straight, true), evaluate7(trips, true))).toBeGreaterThan(0);
    expect(compareEval(evaluate7(straight), evaluate7(trips))).toBeGreaterThan(0);
  });

  it("A-6-7-8-9 is the lowest straight (nine-high)", () => {
    const wheel = evaluate7(hand("Ah 6c 7d 8s 9h Kc Kd"), true);
    expect(wheel.name).toBe("顺子");
    expect(wheel.tiebreak).toEqual([9]);
    const tenHigh = evaluate7(hand("6s 7h 8d 9c Th Kd Kc"), true);
    expect(compareEval(tenHigh, wheel)).toBeGreaterThan(0);
  });

  it("A-6-7-8-9 suited is a straight flush", () => {
    const sf = evaluate7(hand("Ah 6h 7h 8h 9h Kc Kd"), true);
    expect(sf.name).toBe("同花顺");
    expect(sf.tiebreak).toEqual([9]);
  });

  it("renumbers categories only in short mode", () => {
    // short: trips 3 / straight 4 / full house 5 / flush 6
    expect(evaluate7(hand("6s 7h 8d 9c Th Kd Kc"), true).category).toBe(4);
    expect(evaluate7(hand("Ah Ac Ad 6s 7h 9c Kd"), true).category).toBe(3);
    expect(evaluate7(hand("6s 7s 9s Js Qs Ah Ad"), true).category).toBe(6);
    expect(evaluate7(hand("Ah Ac Ad 6s 6c 9h 9d"), true).category).toBe(5);
    // long: straight 4 / trips 3 (flush/full house are 5/6)
    expect(evaluate7(hand("6s 7h 8d 9c Th Kd Kc")).category).toBe(4);
    expect(evaluate7(hand("Ah Ac Ad 6s 7h 9c Kd")).category).toBe(3);
  });

  it("describeHand honors short deck", () => {
    expect(describeHand(hand("Ah Ac"), hand("Ad 6s 6c 9h 9d"), true)).toBe("葫芦");
    expect(describeHand(hand("Ks Qs"), hand("Ad 6s 6c 9s Js"), true)).toBe("同花");
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
