import { describe, expect, it } from "vitest";
import type { GameState } from "../game/index.js";
import { applyAction, createGameState, startHand, stepAfterAction } from "../game/index.js";
import { botDecide, preflopStrength, shortDeckPreflopStrength } from "./bot.js";

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

describe("shortDeckPreflopStrength", () => {
  it("pairs and big cards dominate the 36-card deck", () => {
    const card = (rank: "A" | "9" | "6", suit: "s" | "h") => ({ rank, suit, code: `${rank}${suit}` });
    const AA = shortDeckPreflopStrength([card("A", "s"), card("A", "h")]);
    const trash = shortDeckPreflopStrength([card("9", "s"), card("6", "h")]);
    expect(AA).toBeGreaterThan(0.9);
    expect(trash).toBeLessThan(0.4);
  });
});

/** One human + five bots, like a table the host filled on the room page. */
function botTable(shortDeck = false) {
  return createGameState(
    [
      { id: "p1", name: "甲", isBot: false },
      ...["东", "西", "南", "北", "中"].map((name, i) => ({ id: `bot_${i + 1}`, name, isBot: true })),
    ],
    { shortDeck },
  );
}

/** The invariant that matters: whatever the heuristics produce under any
 *  random shuffle, the engine must accept it. Plays one full hand. */
function expectBotHandAccepted(state: GameState): void {
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

describe("botDecide", () => {
  it("returns null off turn", () => {
    const state = createGameState([{ id: "p1", name: "甲", isBot: false }]);
    startHand(state);
    expect(botDecide(state, "p1")).toBeNull();
  });

  it("never produces an action the engine rejects", () => {
    for (let round = 0; round < 8; round++) {
      expectBotHandAccepted(botTable());
    }
  });

  it("same invariant in short deck mode", () => {
    for (let round = 0; round < 8; round++) {
      expectBotHandAccepted(botTable(true));
    }
  });
});
