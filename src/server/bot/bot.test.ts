import { describe, expect, it } from "vitest";
import type { Card, GameState, Rank, Suit } from "../game/index.js";
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

const pc = (rank: Rank, suit: Suit): Card => ({ rank, suit, code: `${rank}${suit.toUpperCase()}` });

/** Stage preflop: one bot on the BB facing a single 3BB raise, rest folded. */
function faceRaise(hole: [Card, Card]): { state: GameState; botId: string } {
  const state = createGameState([
    { id: "h", name: "人", isBot: false },
    { id: "b1", name: "东", isBot: true },
    { id: "b2", name: "南", isBot: true },
  ]);
  startHand(state);
  const bb = state.bigBlind || 20;
  const hero = state.players.find((p) => p.isBot)!;
  for (const p of state.players) if (p !== hero) p.folded = true;
  hero.holeCards = hole;
  hero.roundBet = bb;
  state.currentBet = 3 * bb;
  state.lastRaiseSize = 2 * bb;
  state.pot = 3 * bb + bb + Math.floor(bb / 2);
  state.actionIndex = state.players.indexOf(hero);
  return { state, botId: hero.id };
}

describe("preflop fold discipline (BB vs a single 3BB raise)", () => {
  const foldRate = (hole: [Card, Card]): number => {
    const { state, botId } = faceRaise(hole);
    let folds = 0;
    for (let i = 0; i < 100; i++) {
      if (botDecide(state, botId)?.action === "fold") folds++;
    }
    return folds / 100;
  };

  it("premiums never fold", () => {
    expect(foldRate([pc("A", "h"), pc("A", "d")])).toBe(0);
  });

  it("deep-stacked premiums rarely jam — big raise instead", () => {
    const { state, botId } = faceRaise([pc("A", "h"), pc("A", "d")]);
    const hero = state.players.find((p) => p.id === botId)!;
    const allIn = hero.roundBet + hero.chips;
    let jams = 0;
    for (let i = 0; i < 200; i++) {
      const d = botDecide(state, botId);
      if (d?.action === "raise" && d.amount === allIn) jams++;
    }
    expect(jams / 200).toBeLessThan(0.2);
  });

  it("broadways mostly defend — the old tables mucked these", () => {
    expect(foldRate([pc("K", "d"), pc("J", "c")])).toBeLessThan(0.25);
  });

  it("junk still folds", () => {
    expect(foldRate([pc("7", "d"), pc("2", "c")])).toBeGreaterThan(0.6);
  });
});

/** Stage preflop: first to act, only the blinds in, everyone yet to speak. */
function faceLimp(hole: [Card, Card]): { state: GameState; botId: string } {
  const state = createGameState([
    { id: "h", name: "人", isBot: false },
    { id: "b1", name: "东", isBot: true },
    { id: "b2", name: "南", isBot: true },
  ]);
  startHand(state);
  const bb = state.bigBlind || 20;
  const hero = state.players.find((p) => p.isBot)!;
  hero.holeCards = hole;
  hero.roundBet = 0;
  state.currentBet = bb;
  state.lastRaiseSize = bb;
  state.pot = Math.floor(bb * 1.5);
  state.actionIndex = state.players.indexOf(hero);
  return { state, botId: hero.id };
}

describe("preflop limp zone (first orbit, one blind to call)", () => {
  const foldRate = (hole: [Card, Card]): number => {
    const { state, botId } = faceLimp(hole);
    let folds = 0;
    for (let i = 0; i < 100; i++) {
      if (botDecide(state, botId)?.action === "fold") folds++;
    }
    return folds / 100;
  };

  it("playable suited connectors mostly limp in", () => {
    expect(foldRate([pc("7", "s"), pc("6", "s")])).toBeLessThan(0.5);
  });

  it("rags still fold", () => {
    expect(foldRate([pc("7", "d"), pc("2", "c")])).toBeGreaterThan(0.6);
  });
});
