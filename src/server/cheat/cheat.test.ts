import { describe, expect, it } from "vitest";
import { createGameState } from "../game/holdem/handFlow.js";
import { tryChatCheat } from "./cheat.js";

function state() {
  return createGameState([{ id: "p1", name: "甲", isBot: false }]);
}

describe("tryChatCheat (room-level switch, fixed amounts)", () => {
  it("off → always null, chat stays plain", () => {
    expect(tryChatCheat(state(), "p1", "爸爸", false)).toBeNull();
  });

  it("「爸爸」 borrows 200", () => {
    const g = state();
    const res = tryChatCheat(g, "p1", "爸爸", true);
    expect(res).toMatchObject({ ok: true, action: "borrow", chips: 200, debt: 200, trigger: "爸爸" });
    expect(g.players[0].chips).toBe(700);
  });

  it("「爷爷」 borrows 500", () => {
    const g = state();
    const res = tryChatCheat(g, "p1", "爷爷", true);
    expect(res).toMatchObject({ ok: true, action: "borrow", chips: 500, trigger: "爷爷" });
  });

  it("「还钱」 repays one installment", () => {
    const g = state();
    g.players[0].debt = 700;
    const res = tryChatCheat(g, "p1", "还钱", true);
    expect(res).toMatchObject({ ok: true, action: "repay", amount: 500, remaining: 200, trigger: "还钱" });
  });

  it("exact-match only after trim; anything else is plain chat", () => {
    expect(tryChatCheat(state(), "p1", " 爸爸 ", true)).toMatchObject({ ok: true });
    expect(tryChatCheat(state(), "p1", "爸爸们", true)).toBeNull();
    expect(tryChatCheat(state(), "p1", "hello", true)).toBeNull();
    expect(tryChatCheat(state(), "p1", "", true)).toBeNull();
  });

  it("repay with no debt errors to the sender", () => {
    const res = tryChatCheat(state(), "p1", "还钱", true);
    expect(res).toEqual({ ok: false, error: "无欠款", trigger: "还钱" });
  });

  it("null game (room not started) → null", () => {
    expect(tryChatCheat(null, "p1", "爸爸", true)).toBeNull();
  });
});
