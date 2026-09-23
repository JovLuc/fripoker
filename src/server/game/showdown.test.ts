import { describe, expect, it } from "vitest";
import type { Card, GameState, Rank, Suit } from "./types.js";
import { buildPots, endHandByFold, showdown } from "./showdown.js";

function card(code: string): Card {
  const rank = code[0] as Rank;
  const suit = code[1].toLowerCase() as Suit;
  return { rank, suit, code: `${rank}${suit.toUpperCase()}` };
}

/** A crafted post-betting state: chips already moved, holes/board fixed. */
function crafted(): GameState {
  const state = {
    players: [
      { id: "folded", name: "弃牌人", holeCards: [card("2h"), card("7d")] },
      { id: "big", name: "大筹码", holeCards: [card("Ah"), card("Ac")] },
      { id: "short", name: "小筹码", holeCards: [card("Kh"), card("Kc")] },
    ],
  } as unknown as GameState;
  state.board = [card("Ad"), card("4s"), card("9c"), card("2c"), card("Jh")];
  state.pot = 240;
  state.players.forEach((p) => {
    p.folded = false;
    p.allIn = true;
    p.sittingOut = false;
    p.chips = 0;
  });
  // folded put in 100, big put in 100, short covered only 40
  state.players[0].totalBet = 100;
  state.players[1].totalBet = 100;
  state.players[2].totalBet = 40;
  state.players[0].folded = true;
  state.handId = 1;
  state.lastRaiseSize = 20;
  state.currentBet = 100;
  state.dealerIndex = 0;
  state.revealAll = false;
  state.handOver = false;
  state.gameOver = false;
  state.lastResults = null;
  state.message = "";
  return state;
}

describe("buildPots", () => {
  it("layers side pots by totalBet", () => {
    const pots = buildPots(crafted());
    expect(pots).toHaveLength(2);
    // level 40: 40 × 3 contributors = 120, contested by both live players
    expect(pots[0]).toEqual({ amount: 120, eligibleIds: ["big", "short"] });
    // level 100: 60 + 60 = 120, short stack cannot win it
    expect(pots[1]).toEqual({ amount: 120, eligibleIds: ["big"] });
  });

  it("returns nothing when nobody bet", () => {
    const state = crafted();
    state.players.forEach((p) => (p.totalBet = 0));
    expect(buildPots(state)).toEqual([]);
  });
});

describe("showdown / awardPots", () => {
  it("best hand wins both layers; short stack only the main pot", () => {
    const state = crafted();
    showdown(state);
    expect(state.revealAll).toBe(true);
    expect(state.handOver).toBe(true);
    expect(state.pot).toBe(0);
    // big has trips aces: wins 120 + 120 = 240
    const big = state.players.find((p) => p.id === "big")!;
    const short = state.players.find((p) => p.id === "short")!;
    expect(big.chips).toBe(240);
    expect(short.chips).toBe(0);
    expect(state.lastResults).toEqual([
      { playerId: "big", name: "大筹码", amount: 240, hand: "三条" },
    ]);
    expect(state.message).toBe("大筹码 +240 (三条)");
  });

  it("splits a tied pot with the odd chip to the first winner", () => {
    const state = crafted();
    // board plays for everyone: royal on board, both live hands tie
    state.board = [card("As"), card("Ks"), card("Qs"), card("Js"), card("Ts")];
    state.players[1].holeCards = [card("2h"), card("3h")];
    state.players[2].holeCards = [card("2d"), card("3d")];
    // folded 1, big 2, short 2 → layers [1, 2]; odd main pot 3 splits 2/1
    state.players[0].totalBet = 1;
    state.players[1].totalBet = 2;
    state.players[2].totalBet = 2;
    state.players[1].folded = false;
    showdown(state);
    const big = state.players.find((p) => p.id === "big")!;
    const short = state.players.find((p) => p.id === "short")!;
    // layer 1: amount 3 → 1 each, first winner takes the extra 1
    // layer 2: amount 2 → 1 each
    expect(big.chips).toBe(3);
    expect(short.chips).toBe(2);
    expect(state.message).toContain("同花顺");
  });

  it("endHandByFold awards the whole pot without revealing", () => {
    const state = crafted();
    state.players[1].folded = true;
    state.players[2].folded = false;
    state.pot = 77;
    endHandByFold(state);
    expect(state.handOver).toBe(true);
    expect(state.revealAll).toBe(false);
    expect(state.players[2].chips).toBe(77);
    expect(state.message).toBe("小筹码 +77（其他人弃牌）");
    expect(state.lastResults).toEqual([
      { playerId: "short", name: "小筹码", amount: 77, hand: "" },
    ]);
  });
});
