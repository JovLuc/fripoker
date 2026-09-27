import { describe, expect, it } from "vitest";
import { REPAY_CHIPS } from "../../../shared/constants.js";
import { createGameState, startHand } from "../holdem/handFlow.js";
import { borrowChips, noteBusted, playersWithChips, repayDebt } from "./economy.js";

function state1() {
  return createGameState([
    { id: "p1", name: "甲", isBot: false },
    { id: "p2", name: "乙", isBot: false },
  ]);
}

describe("borrowChips", () => {
  it("adds chips and debt with a one-hand grace period", () => {
    const state = state1();
    const res = borrowChips(state, "p1", 200);
    expect(res).toEqual({
      ok: true, action: "borrow", chips: 200, wasBusted: false, debt: 200, midHand: false,
    });
    expect(state.players[0].chips).toBe(2200);
    expect(state.players[0].debtHands).toBe(0);
  });

  it("a busted player who borrows mid-hand stays out until the next deal", () => {
    const state = state1();
    const p = state.players[0];
    p.chips = 0;
    p.sittingOut = true;
    state.phase = "flop"; // mid-hand
    const res = borrowChips(state, "p1", 200);
    expect(res.ok).toBe(true);
    expect((res as { midHand: boolean }).midHand).toBe(true);
    expect(p.chips).toBe(200);
    expect(p.sittingOut).toBe(true);
    expect(p.folded).toBe(true);
    expect(p.holeCards).toEqual([]);
  });

  it("a busted player who borrows between hands returns next deal", () => {
    const state = state1();
    const p = state.players[0];
    p.chips = 0;
    p.sittingOut = true;
    state.phase = "idle"; // not mid-hand
    borrowChips(state, "p1", 200);
    expect(p.sittingOut).toBe(false);
    expect(p.folded).toBe(false);
  });

  it("borrowing clears the bust badge so a later bust logs again", () => {
    const state = state1();
    const p = state.players[0];
    p.chips = 0;
    const first = noteBusted(state);
    expect(first).toEqual([{ id: "p1", name: "甲" }]);
    borrowChips(state, "p1", 200);
    p.chips = 0;
    const second = noteBusted(state);
    expect(second).toEqual([{ id: "p1", name: "甲" }]);
    // history keeps both episodes
    expect(state.busted).toHaveLength(2);
  });

  it("rejects bad amounts and strangers", () => {
    const state = state1();
    expect(borrowChips(state, "p1", 0)).toEqual({ ok: false, error: "非法金额" });
    expect(borrowChips(state, "nobody", 100)).toEqual({ ok: false, error: "你不在对局中" });
  });
});

describe("debt interest", () => {
  it("first deal after borrowing is free, then ×1.1 per hand (integer ceil)", () => {
    const state = state1();
    borrowChips(state, "p1", 100);
    // hand 1 after borrow: grace, no interest
    startHand(state);
    expect(state.players[0].debt).toBe(100);
    // hand 2: ×1.1 → 110
    state.handOver = true;
    startHand(state);
    expect(state.players[0].debt).toBe(110);
    // hand 3: ×1.1 → 121
    state.handOver = true;
    startHand(state);
    expect(state.players[0].debt).toBe(121);
  });
});

describe("repayDebt", () => {
  it("pays in min(debt, REPAY_CHIPS) installments", () => {
    const state = state1();
    const p = state.players[0];
    p.debt = 1200;
    p.debtHands = 3;
    expect(repayDebt(state, "p1")).toEqual({ ok: true, action: "repay", amount: REPAY_CHIPS, remaining: 700 });
    expect(repayDebt(state, "p1")).toEqual({ ok: true, action: "repay", amount: REPAY_CHIPS, remaining: 200 });
    expect(repayDebt(state, "p1")).toEqual({ ok: true, action: "repay", amount: 200, remaining: 0 });
    expect(p.debtHands).toBe(0);
  });

  it("rejects with no debt or insufficient chips", () => {
    const state = state1();
    expect(repayDebt(state, "p1")).toEqual({ ok: false, error: "无欠款" });
    const p = state.players[0];
    p.debt = 500;
    p.chips = 100;
    expect(repayDebt(state, "p1")).toEqual({ ok: false, error: "余额不足" });
  });
});

describe("playersWithChips / noteBusted", () => {
  it("counts funded, present seats only", () => {
    const state = state1();
    expect(playersWithChips(state)).toHaveLength(2);
    state.players[0].chips = 0;
    expect(playersWithChips(state)).toHaveLength(1);
    state.players[1].left = true;
    expect(playersWithChips(state)).toHaveLength(0);
  });
});
