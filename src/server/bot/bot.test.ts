import { describe, expect, it } from "vitest";
import { applyAction, createGameState, startHand, stepAfterAction } from "../game/index.js";
import { botDecide, preflopStrength } from "./bot.js";

describe("preflopStrength", () => {
  it("ranks premiums above trash", () => {
    const AA = preflopStrength([
      { rank: "A", suit: "s", code: "As" },
      { rank: "A", suit: "h", code: "Ah" },
    ]);
    const trash = preflopStrength([
      { rank: "2", suit: "s", code: "2s" },
      { rank: "7", suit: "h", code: "7h" },
    ]);
    expect(AA).toBeGreaterThan(0.9);
    expect(trash).toBeLessThanOrEqual(0.4);
  });
});

describe("botDecide", () => {
  it("returns null off turn", () => {
    const state = createGameState([{ id: "p1", name: "甲" }]);
    startHand(state);
    expect(botDecide(state, "p1")).toBeNull();
  });

  // The invariant that matters: whatever the heuristics produce under any
  // random shuffle, the engine must accept it. Runs several full hands.
  it("never produces an action the engine rejects", () => {
    for (let round = 0; round < 8; round++) {
      const state = createGameState([{ id: "p1", name: "甲" }]);
      startHand(state);
      let guard = 0;
      while (!state.handOver && guard++ < 300) {
        const actor = state.players[state.actionIndex];
        if (!actor) break;
        if (actor.isBot) {
          const decision = botDecide(state, actor.id);
          expect(decision).not.toBeNull();
          const res = applyAction(
            state,
            decision!.action,
            decision!.action === "raise" ? decision!.amount : 0,
          );
          expect(res.ok, `bot action rejected: ${JSON.stringify(decision)} → ${JSON.stringify(res)}`).toBe(true);
        } else {
          applyAction(state, "fold"); // the single human folds immediately
        }
        stepAfterAction(state);
      }
      expect(state.handOver).toBe(true);
      const total = state.players.reduce((sum, p) => sum + p.chips, 0) + state.pot;
      expect(total).toBe(2000 * 6);
    }
  });
});
