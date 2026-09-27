import { describe, expect, it } from "vitest";
import { STARTING_CHIPS, TP_ANTE, TP_BET_STEP } from "../../../shared/constants.js";
import { tpBotDecide } from "./bot.js";
import { applyAction, createTpGame, legalActionsFor, startHand, stepAfterAction } from "./flow.js";
import type { TpState } from "./types.js";

function twoPlayers(): TpState {
  return createTpGame([
    { id: "p1", name: "甲", isBot: false },
    { id: "p2", name: "乙", isBot: false },
  ]);
}

function dealt(): TpState {
  const g = twoPlayers();
  expect(startHand(g)).toBe("continue");
  return g;
}

/** Σchips + pot — the conservation invariant every test can assert. */
function total(g: TpState): number {
  return g.players.reduce((s, p) => s + p.chips, 0) + g.pot;
}

function current(g: TpState) {
  const p = g.players[g.actionIndex];
  expect(p).toBeTruthy();
  return p!;
}

function opponent(g: TpState) {
  return g.players.find((p) => p.id !== current(g).id)!;
}

describe("tp deal", () => {
  it("antes each player, opens the base at one unit, deals three cards", () => {
    const g = dealt();
    expect(g.kind).toBe("tp");
    expect(g.handId).toBe(1);
    expect(g.phase).toBe("betting");
    expect(g.currentBet).toBe(TP_BET_STEP); // base N
    expect(g.pot).toBe(TP_ANTE * 2);
    for (const p of g.players) {
      expect(p.holeCards).toHaveLength(3);
      expect(p.chips).toBe(STARTING_CHIPS - TP_ANTE);
      expect(p.totalBet).toBe(TP_ANTE);
    }
    expect(g.actionIndex).toBeGreaterThanOrEqual(0);
    expect(total(g)).toBe(STARTING_CHIPS * 2);
  });

  it("rotates the button across hands", () => {
    const g = dealt();
    const firstDealer = g.dealerIndex;
    g.players.forEach((p) => (p.chips = 1000));
    g.handOver = true;
    startHand(g);
    expect(g.dealerIndex).not.toBe(firstDealer);
  });

  it("the previous hand's winner takes the button and acts first", () => {
    const g = dealt();
    // fold the current actor away → opponent wins the hand
    expect(applyAction(g, "fold").ok).toBe(true);
    expect(stepAfterAction(g)).toBe("hand-end");
    const winnerId = g.lastResults![0].playerId;
    expect(g.lastWinnerId).toBe(winnerId);

    g.players.forEach((p) => (p.chips = 1000));
    expect(startHand(g)).toBe("continue");
    const winner = g.players.find((p) => p.id === winnerId)!;
    expect(g.dealerIndex).toBe(winner.seat); // 赢家坐庄
    expect(g.actionIndex).toBe(winner.seat); // 庄先行动
  });
});

describe("tp betting", () => {
  it("there is no check — every turn pays the base", () => {
    const g = dealt();
    const legal = legalActionsFor(g, current(g).id)!;
    expect(legal.canCheck).toBe(false);
    expect(legal.needToCall).toBe(TP_BET_STEP);
    const res = applyAction(g, "check");
    expect(res.ok).toBe(false);
    expect(res).toMatchObject({ error: "不能过牌" });
  });

  it("continuous action: seats keep rotating with no round barrier", () => {
    const g = dealt();
    // both pay the minimum twice in a row — action just keeps flowing
    for (let i = 0; i < 4; i++) {
      const actor = current(g);
      const before = actor.chips;
      expect(applyAction(g, "call").ok).toBe(true);
      expect(actor.chips).toBe(before - TP_BET_STEP);
      expect(stepAfterAction(g)).toBe("continue");
      expect(total(g)).toBe(STARTING_CHIPS * 2);
    }
  });

  it("blind action pays N, peeked action pays 2N", () => {
    const g = dealt();
    const blind = current(g);
    expect(legalActionsFor(g, blind.id)!.needToCall).toBe(TP_BET_STEP);
    applyAction(g, "call");
    expect(blind.chips).toBe(STARTING_CHIPS - TP_ANTE - TP_BET_STEP);

    stepAfterAction(g);
    const other = current(g);
    applyAction(g, "look");
    expect(legalActionsFor(g, other.id)!.needToCall).toBe(TP_BET_STEP * 2);
    const chipsBefore = other.chips;
    applyAction(g, "call");
    expect(other.chips).toBe(chipsBefore - TP_BET_STEP * 2);
    expect(total(g)).toBe(STARTING_CHIPS * 2);
  });

  it("a blind raise to 40 raises the base to 40", () => {
    const g = dealt();
    const actor = current(g);
    const res = applyAction(g, "raise", 40);
    expect(res.ok).toBe(true);
    expect(g.currentBet).toBe(40);
    expect(actor.lastAction).toBe("raise");

    stepAfterAction(g);
    expect(legalActionsFor(g, current(g).id)!.needToCall).toBe(40);
    expect(total(g)).toBe(STARTING_CHIPS * 2);
  });

  it("reported scenario: base 20 → peeked pays 100 → base 50 → blind pays 90 → base 90", () => {
    const g = dealt();
    g.currentBet = 20;

    // 2号看牌加到100（实付）→ 基数 ceil(100/2)=50
    const p2 = current(g);
    expect(applyAction(g, "look").ok).toBe(true);
    expect(applyAction(g, "raise", 100).ok).toBe(true);
    expect(g.currentBet).toBe(50);

    // 没看牌的最少下50
    stepAfterAction(g);
    const p3 = current(g);
    expect(p3.looked).toBe(false);
    expect(legalActionsFor(g, p3.id)!.needToCall).toBe(50);

    // 3号不看加注到90 → 基数90
    expect(applyAction(g, "raise", 90).ok).toBe(true);
    expect(g.currentBet).toBe(90);

    // 看牌的最少上180
    stepAfterAction(g);
    expect(g.actionIndex).toBe(p2.seat);
    expect(legalActionsFor(g, p2.id)!.needToCall).toBe(90 * 2);
    expect(total(g)).toBe(STARTING_CHIPS * 2);
  });

  it("a peeked payment folds in half, rounded UP: pay 41 → base 21", () => {
    const g = dealt();
    const actor = current(g);
    applyAction(g, "look");
    expect(applyAction(g, "raise", 41).ok).toBe(true);
    expect(g.currentBet).toBe(Math.ceil(41 / 2)); // 21
    stepAfterAction(g);
    // next blind player owes exactly the new base
    expect(legalActionsFor(g, current(g).id)!.needToCall).toBe(21);
    expect(total(g)).toBe(STARTING_CHIPS * 2);
  });

  it("raising below the minimum is rejected unless it is a full shove", () => {
    const g = dealt();
    const actor = current(g);
    const low = applyAction(g, "raise", TP_BET_STEP - 1);
    expect(low.ok).toBe(false);
    const over = applyAction(g, "raise", actor.chips + 1);
    expect(over.ok).toBe(false);
    // short stack: only an all-in shove passes
    actor.chips = 5;
    const before = total(g);
    expect(applyAction(g, "raise", 5).ok).toBe(true);
    expect(actor.allIn).toBe(true);
    expect(total(g)).toBe(before);
  });

  it("a short stack calling goes all-in", () => {
    const g = dealt();
    const actor = current(g);
    actor.chips = 5;
    const before = total(g);
    const res = applyAction(g, "call");
    expect(res.ok).toBe(true);
    expect(actor.allIn).toBe(true);
    expect(actor.chips).toBe(0);
    expect(actor.lastAction).toBe("allin");
    expect(total(g)).toBe(before);
  });

  it("when no one can pay anymore the table falls through to a showdown", () => {
    const g = dealt();
    g.players.forEach((p) => (p.chips = 5)); // both can barely ante-actions
    const before = total(g);
    let guard = 0;
    while (!g.handOver && guard++ < 20) {
      expect(applyAction(g, "call").ok).toBe(true);
      stepAfterAction(g);
    }
    expect(g.handOver).toBe(true);
    expect(g.phase).toBe("showdown");
    expect(g.revealAll).toBe(true);
    expect(g.pot).toBe(0);
    expect(g.lastResults!.length).toBeGreaterThanOrEqual(1);
    expect(total(g)).toBe(before);
  });
});

describe("tp peek", () => {
  it("look applies without consuming the turn, then locks", () => {
    const g = dealt();
    const actor = current(g);
    const before = g.actionIndex;
    expect(legalActionsFor(g, actor.id)!.canLook).toBe(true);

    const res = applyAction(g, "look");
    expect(res).toEqual({ ok: true, advance: false });
    expect(g.actionIndex).toBe(before);
    expect(actor.looked).toBe(true);
    expect(applyAction(g, "look").ok).toBe(false);
  });
});

describe("tp fold win", () => {
  it("everyone folds → last player wins without reveal", () => {
    const g = dealt();
    const actor = current(g);
    const other = opponent(g);
    expect(applyAction(g, "fold").ok).toBe(true);
    expect(stepAfterAction(g)).toBe("hand-end");
    expect(g.handOver).toBe(true);
    expect(g.revealAll).toBe(false);
    expect(other.chips).toBe(STARTING_CHIPS + TP_ANTE);
    expect(g.lastResults).toEqual([
      { playerId: other.id, name: other.name, amount: TP_ANTE * 2, hand: "" },
    ]);
    expect(total(g)).toBe(STARTING_CHIPS * 2);
  });
});

describe("tp open (compare)", () => {
  it("blind may only open blind, peeked only peeked — no round restriction", () => {
    const g = dealt();
    const b = opponent(g);
    // blind vs blind: legal with zero prior actions
    expect(applyAction(g, "compare", 0, b.id).ok).toBe(true);
    expect(stepAfterAction(g)).toBe("hand-end"); // someone lost → one left
  });

  it("rejects a rival with the opposite peek state", () => {
    const g = dealt();
    const a = current(g);
    const b = opponent(g);
    applyAction(g, "look"); // a peeked, b still blind
    expect(a.looked).not.toBe(b.looked);
    const res = applyAction(g, "compare", 0, b.id);
    expect(res.ok).toBe(false);
    expect(res).toMatchObject({ error: "无效的比牌对象" });
    expect(legalActionsFor(g, a.id)!.canCompare).toBe(false); // no peeked rival exists
  });

  it("strong initiator opens: loser reveals, blind winner stays blind", () => {
    const g = dealt();
    const a = current(g);
    const b = opponent(g);
    a.holeCards = [
      { rank: "9", suit: "s", code: "9S" },
      { rank: "9", suit: "h", code: "9H" },
      { rank: "9", suit: "d", code: "9D" },
    ];
    b.holeCards = [
      { rank: "2", suit: "c", code: "2C" },
      { rank: "5", suit: "d", code: "5D" },
      { rank: "8", suit: "s", code: "8S" },
    ];
    const fee = TP_BET_STEP; // blind open costs the blind bet
    const chipsBefore = a.chips;
    const potBefore = g.pot;

    const res = applyAction(g, "compare", 0, b.id);
    expect(res.ok).toBe(true);
    expect(a.chips).toBe(chipsBefore - fee);
    expect(g.pot).toBe(potBefore + fee);
    expect(g.currentBet).toBe(TP_BET_STEP); // fee never raises the base
    expect(b.folded).toBe(true);
    expect(b.revealed).toBe(true); // loser shows
    expect(a.revealed).toBe(false); // blind winner stays blind
    expect(g.message).toContain("开牌胜");
    expect(total(g)).toBe(STARTING_CHIPS * 2);

    expect(stepAfterAction(g)).toBe("hand-end");
    expect(a.chips).toBe(STARTING_CHIPS + TP_ANTE);
  });

  it("weak initiator loses: self folds and reveals", () => {
    const g = dealt();
    const a = current(g);
    const b = opponent(g);
    a.holeCards = [
      { rank: "2", suit: "c", code: "2C" },
      { rank: "5", suit: "d", code: "5D" },
      { rank: "8", suit: "s", code: "8S" },
    ];
    b.holeCards = [
      { rank: "9", suit: "s", code: "9S" },
      { rank: "9", suit: "h", code: "9H" },
      { rank: "9", suit: "d", code: "9D" },
    ];
    expect(applyAction(g, "compare", 0, b.id).ok).toBe(true);
    expect(a.folded).toBe(true);
    expect(a.revealed).toBe(true);
    expect(stepAfterAction(g)).toBe("hand-end");
    // survivor collects both antes plus the loser's fee (blind open = one unit)
    expect(b.chips).toBe(STARTING_CHIPS + TP_ANTE + TP_BET_STEP);
  });

  it("open costs exactly the bet cost of the opener (blind N / peeked 2N)", () => {
    const g = dealt();
    let legal = legalActionsFor(g, current(g).id)!;
    expect(legal.compareFee).toBe(legal.needToCall);
    expect(legal.compareFee).toBe(TP_BET_STEP); // blind

    expect(applyAction(g, "look").ok).toBe(true);
    legal = legalActionsFor(g, current(g).id)!;
    expect(legal.compareFee).toBe(legal.needToCall);
    expect(legal.compareFee).toBe(TP_BET_STEP * 2); // peeked
  });

  it("rejects invalid targets", () => {
    const g = dealt();
    expect(applyAction(g, "compare", 0, "nobody").ok).toBe(false);
    expect(applyAction(g, "compare", 0, current(g).id).ok).toBe(false);
  });
});

describe("tp bot opens", () => {
  function botHands(): TpState {
    return createTpGame([
      { id: "b1", name: "东", isBot: true },
      { id: "b2", name: "西", isBot: true },
    ]);
  }

  it("a blind monster always blind-opens a blind rival", () => {
    const g = botHands();
    expect(startHand(g)).toBe("continue");
    const actor = g.players[g.actionIndex];
    actor.holeCards = [
      { rank: "9", suit: "s", code: "9S" },
      { rank: "9", suit: "h", code: "9H" },
      { rank: "9", suit: "d", code: "9D" },
    ];
    const d = tpBotDecide(g, actor.id)!;
    expect(d.action).toBe("compare");
    expect(actor.looked).toBe(false); // never needed a peek to open
    const res = applyAction(g, "compare", 0, d.targetId);
    expect(res.ok).toBe(true);
  });

  it("never blind-opens a peeked rival (state parity)", () => {
    const g = botHands();
    expect(startHand(g)).toBe("continue");
    const actor = g.players[g.actionIndex];
    const rival = g.players.find((p) => p.id !== actor.id)!;
    rival.looked = true;
    actor.holeCards = [
      { rank: "9", suit: "s", code: "9S" },
      { rank: "9", suit: "h", code: "9H" },
      { rank: "9", suit: "d", code: "9D" },
    ];
    const d = tpBotDecide(g, actor.id)!;
    expect(d.action).not.toBe("compare");
    expect(legalActionsFor(g, actor.id)!.canCompare).toBe(false);
  });
});

describe("tp bot invariant", () => {
  it("every bot decision passes the engine, and hands terminate", () => {
    for (let iter = 0; iter < 30; iter++) {
      const g = createTpGame([
        { id: "b1", name: "东", isBot: true },
        { id: "b2", name: "西", isBot: true },
        { id: "b3", name: "南", isBot: true },
      ]);
      const start = startHand(g);
      if (start === "hand-end") continue;
      const chipsTotal = total(g);
      let guard = 0;
      while (!g.handOver && guard++ < 900) {
        expect(g.actionIndex).toBeGreaterThanOrEqual(0);
        const actor = g.players[g.actionIndex];
        const decision = tpBotDecide(g, actor.id);
        expect(decision, "bot must decide on its turn").toBeTruthy();
        const res = applyAction(g, decision!.action, decision!.amount, decision!.targetId);
        if (!res.ok) {
          throw new Error(`bot action rejected: ${decision!.action} → ${res.error}`);
        }
        if (res.advance !== false) stepAfterAction(g);
        expect(total(g)).toBe(chipsTotal);
      }
      expect(g.handOver, "hand must terminate").toBe(true);
    }
  });
});
