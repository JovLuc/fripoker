import { describe, expect, it } from "vitest";
import { BIG_BLIND, SMALL_BLIND, STARTING_CHIPS } from "../../../shared/constants.js";
import { RANK_VALUE } from "../core/cards.js";
import { applyAction, createGameState, legalActions, startHand, stepAfterAction } from "./handFlow.js";

/** Two funded humans only; no bots are seeded. */
function headsUpState() {
  return createGameState([
    { id: "p1", name: "甲", isBot: false },
    { id: "p2", name: "乙", isBot: false },
  ]);
}

function totalChips(state: ReturnType<typeof createGameState>): number {
  return state.players.reduce((sum, p) => sum + p.chips, 0) + state.pot;
}

describe("createGameState", () => {
  it("seats exactly the given humans and bots (no auto-fill)", () => {
    const state = createGameState([
      { id: "pa", name: "甲", isBot: false },
      { id: "bot_1", name: "东", isBot: true },
    ]);
    expect(state.players).toHaveLength(2);
    expect(state.players.every((p) => p.chips === STARTING_CHIPS)).toBe(true);
  });

  it("keeps ids, bot flags and seat order", () => {
    const state = createGameState([
      { id: "pa", name: "甲", isBot: false },
      { id: "pb", name: "乙", isBot: false },
      { id: "bot_1", name: "东", isBot: true },
    ]);
    expect(state.players[0]).toMatchObject({ id: "pa", isBot: false, seat: 0 });
    expect(state.players[1]).toMatchObject({ id: "pb", isBot: false, seat: 1 });
    expect(state.players[2]).toMatchObject({ id: "bot_1", isBot: true, seat: 2 });
  });

  it("a departed (left) seat sits out from the next deal", () => {
    const state = createGameState([
      { id: "p1", name: "甲", isBot: false },
      { id: "p2", name: "乙", isBot: false },
      { id: "p3", name: "丙", isBot: false },
    ]);
    state.players[2].left = true;
    const step = startHand(state);
    expect(step).toBe("continue");
    expect(state.players[2].sittingOut).toBe(true);
    expect(state.players[2].holeCards).toHaveLength(0);
    // blinds rotate among present players only
    expect([state.dealerIndex, state.sbIndex, state.bbIndex]).not.toContain(2);
  });

  it("defaults to the 52-card long deck", () => {
    const state = headsUpState();
    expect(state.shortDeck).toBe(false);
    expect(state.deck).toHaveLength(52);
  });

  it("short deck mode deals and reshuffles only ranks 6..A", () => {
    const state = createGameState(
      [
        { id: "p1", name: "甲", isBot: false },
        { id: "p2", name: "乙", isBot: false },
      ],
      { shortDeck: true },
    );
    expect(state.shortDeck).toBe(true);
    expect(state.deck).toHaveLength(36);
    startHand(state);
    const seen = state.players.flatMap((p) => p.holeCards);
    expect(seen).toHaveLength(4);
    expect([...seen, ...state.deck]).toHaveLength(36);
    expect([...seen, ...state.deck].every((c) => RANK_VALUE[c.rank] >= 6)).toBe(true);
  });
});

describe("startHand", () => {
  it("posts blinds and sets the message", () => {
    const state = headsUpState();
    const step = startHand(state);
    expect(step).toBe("continue");
    expect(state.phase).toBe("preflop");
    expect(state.message).toBe(`第 1 手 · ${SMALL_BLIND}/${BIG_BLIND}`);
    // heads-up: dealer is SB
    expect(state.sbIndex).toBe(state.dealerIndex);
    expect(state.players[state.sbIndex].roundBet).toBe(SMALL_BLIND);
    expect(state.players[state.bbIndex].roundBet).toBe(BIG_BLIND);
    expect(state.currentBet).toBe(BIG_BLIND);
    // dealer acts first heads-up preflop
    expect(state.actionIndex).toBe(state.dealerIndex);
    expect(state.pot).toBe(SMALL_BLIND + BIG_BLIND);
  });

  it("game over when fewer than 2 funded seats", () => {
    const state = headsUpState();
    state.players[0].chips = 0;
    const step = startHand(state);
    expect(step).toBe("hand-end");
    expect(state.gameOver).toBe(true);
    expect(state.handOver).toBe(true);
    expect(state.message).toContain("对局结束");
  });
});

describe("applyAction validation", () => {
  it("rejects raising below the minimum", () => {
    const state = headsUpState();
    startHand(state);
    // currentBet 20, lastRaiseSize 20 → min raise-to is 40
    const legal = legalActions(state)!;
    expect(legal.minRaiseTo).toBe(40);
    const res = applyAction(state, "raise", 30);
    expect(res).toEqual({ ok: false, error: "加注至少到 40" });
  });

  it("rejects raising above the maximum", () => {
    const state = headsUpState();
    startHand(state);
    const res = applyAction(state, "raise", 99999);
    expect(res).toEqual({ ok: false, error: "超出上限" });
  });

  it("allows an all-in raise below the minimum (short stack)", () => {
    const state = headsUpState();
    startHand(state);
    const actor = state.players[state.actionIndex];
    actor.chips = 15; // can only reach 25 total, below minRaiseTo 40
    const legal = legalActions(state)!;
    expect(legal.maxRaiseTo).toBe(actor.roundBet + 15);
    const res = applyAction(state, "raise", legal.maxRaiseTo);
    expect(res.ok).toBe(true);
    expect(actor.allIn).toBe(true);
  });

  it("rejects checking when a bet is outstanding", () => {
    const state = headsUpState();
    startHand(state);
    // heads-up preflop, dealer/SB faces the BB's 20
    const res = applyAction(state, "check");
    expect(res).toEqual({ ok: false, error: "不能过牌" });
  });

  it("min-raise tracks the last raise size", () => {
    const state = headsUpState();
    startHand(state);
    applyAction(state, "raise", 60); // raise size 40 over the 20 BB
    stepAfterAction(state);
    expect(state.currentBet).toBe(60);
    // BB now faces a min re-raise of 60 + 40 = 100
    expect(legalActions(state)!.minRaiseTo).toBe(100);
    expect(applyAction(state, "call").ok).toBe(true);
    expect(stepAfterAction(state)).toBe("continue");
    expect(state.phase).toBe("flop");
  });
});

describe("betting flow", () => {
  it("call + check gets to the flop with 3 board cards", () => {
    const state = headsUpState();
    startHand(state);
    expect(applyAction(state, "call").ok).toBe(true);
    expect(stepAfterAction(state)).toBe("continue");
    expect(applyAction(state, "check").ok).toBe(true);
    expect(stepAfterAction(state)).toBe("continue");
    expect(state.phase).toBe("flop");
    expect(state.board).toHaveLength(3);
    expect(state.message).toBe("翻牌");
    expect(totalChips(state)).toBe(STARTING_CHIPS * 2);
  });

  it("fold ends the hand without revealing", () => {
    const state = headsUpState();
    startHand(state);
    applyAction(state, "fold");
    expect(stepAfterAction(state)).toBe("hand-end");
    expect(state.handOver).toBe(true);
    expect(state.revealAll).toBe(false);
    expect(state.pot).toBe(0);
    expect(state.message).toContain("其他人弃牌");
    expect(totalChips(state)).toBe(STARTING_CHIPS * 2);
  });

  it("preflop all-in call runs the board out to showdown", () => {
    const state = headsUpState();
    startHand(state);
    expect(applyAction(state, "allin").ok).toBe(true);
    expect(stepAfterAction(state)).toBe("continue");
    // BB must decide on the shove
    expect(applyAction(state, "call").ok).toBe(true);
    expect(stepAfterAction(state)).toBe("hand-end");
    expect(state.handOver).toBe(true);
    expect(state.revealAll).toBe(true);
    expect(state.board).toHaveLength(5);
    expect(state.pot).toBe(0);
    expect(state.lastResults!.length).toBeGreaterThanOrEqual(1);
    expect(totalChips(state)).toBe(STARTING_CHIPS * 2);
  });

  it("chips are conserved across every action", () => {
    const state = headsUpState();
    startHand(state);
    applyAction(state, "raise", 100);
    stepAfterAction(state);
    expect(totalChips(state)).toBe(STARTING_CHIPS * 2);
    applyAction(state, "raise", 300);
    stepAfterAction(state);
    expect(totalChips(state)).toBe(STARTING_CHIPS * 2);
    applyAction(state, "allin");
    stepAfterAction(state);
    expect(totalChips(state)).toBe(STARTING_CHIPS * 2);
    applyAction(state, "call");
    stepAfterAction(state);
    expect(totalChips(state)).toBe(STARTING_CHIPS * 2);
    expect(state.handOver).toBe(true);
  });
});
