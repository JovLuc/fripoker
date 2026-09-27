import { describe, expect, it } from "vitest";
import { TP_ANTE } from "../../../shared/constants.js";
import { tpMode } from "./mode.js";
import { applyAction, createTpGame, startHand, stepAfterAction, tpShowdown } from "./flow.js";
import type { TpGameSnapshot } from "../../../shared/protocol.js";
import type { TpState } from "./types.js";

function dealt(): TpState {
  const g = createTpGame([
    { id: "p1", name: "甲", isBot: false },
    { id: "p2", name: "乙", isBot: false },
  ]);
  expect(startHand(g)).toBe("continue");
  return g;
}

function snap(g: TpState, viewerId: string): TpGameSnapshot {
  return tpMode.serialize(g, viewerId, new Set()) as TpGameSnapshot;
}

describe("tp snapshot", () => {
  it("carries tp fields; the button acts first (dealt seat 0 = dealer)", () => {
    const g = dealt();
    const s = snap(g, "p1");
    expect(s.kind).toBe("tp");
    expect(s.ante).toBe(TP_ANTE);
    expect(g.dealerIndex).toBe(0);
    expect(g.actionIndex).toBe(0); // the button acts first
    expect(s.myLegal).not.toBeNull(); // p1 IS the actor
    expect(s.myLegal!.canLook).toBe(true);

    // the other seat has no turn
    expect(snap(g, "p2").myLegal).toBeNull();

    const me = s.players.find((p) => p.id === "p1")!;
    expect(me.isMe).toBe(true);
    // nobody has peeked — even own cards are backs
    expect(me.holeCards).toEqual(["back", "back", "back"]);
    expect(me.handLabel).toBe("");
    expect(me.looked).toBe(false);
    expect(me.isDealer).toBe(true); // 庄 badge on seat 0
  });

  it("shows own cards to the peeker only", () => {
    const g = dealt();
    const actor = g.players[g.actionIndex];
    expect(applyAction(g, "look").ok).toBe(true);

    const forActor = snap(g, actor.id);
    const actorView = forActor.players.find((p) => p.id === actor.id)!;
    expect(actorView.holeCards).toHaveLength(3);
    expect(actorView.holeCards[0]).not.toBe("back");
    expect(actorView.handLabel).not.toBe("");
    expect(actorView.looked).toBe(true);
    expect(forActor.myLegal).toBeTruthy();
    expect(forActor.myLegal!.canLook).toBe(false);

    const forOther = snap(g, g.players.find((p) => p.id !== actor.id)!.id);
    const otherView = forOther.players.find((p) => p.id === actor.id)!;
    expect(otherView.holeCards).toEqual(["back", "back", "back"]);
    expect(otherView.handLabel).toBe("");
  });

  it("showdown reveals live hands to everyone", () => {
    const g = dealt();
    tpShowdown(g);
    expect(g.handOver).toBe(true);
    expect(g.revealAll).toBe(true);

    for (const viewer of ["p1", "p2"]) {
      const s = snap(g, viewer);
      for (const p of s.players.filter((pl) => !pl.folded)) {
        expect(p.holeCards).toHaveLength(3);
        expect(p.holeCards[0]).not.toBe("back");
        expect(p.handLabel).not.toBe("");
      }
    }
    expect(snap(g, "p1").dealerSeat).toBe(g.dealerIndex);
  });

  it("a peeked loser of an open is revealed even without showdown", () => {
    const g = dealt();
    const actor = g.players[g.actionIndex];
    const other = g.players.find((p) => p.id !== actor.id)!;
    // both peeked: actor peeks + pays, other peeks + pays, action returns to actor
    applyAction(g, "look");
    applyAction(g, "call");
    stepAfterAction(g);
    applyAction(g, "look");
    applyAction(g, "call");
    stepAfterAction(g);
    expect(g.actionIndex).toBe(actor.seat);
    expect(actor.looked && other.looked).toBe(true);

    // force a loss: actor high card vs other trips
    actor.holeCards = [
      { rank: "2", suit: "c", code: "2C" },
      { rank: "5", suit: "d", code: "5D" },
      { rank: "8", suit: "s", code: "8S" },
    ];
    other.holeCards = [
      { rank: "9", suit: "s", code: "9S" },
      { rank: "9", suit: "h", code: "9H" },
      { rank: "9", suit: "d", code: "9D" },
    ];
    expect(applyAction(g, "compare", 0, other.id).ok).toBe(true);
    expect(actor.folded).toBe(true);
    const s = snap(g, other.id);
    const loser = s.players.find((p) => p.id === actor.id)!;
    expect(loser.revealed).toBe(true);
    expect(loser.holeCards[0]).not.toBe("back");
    expect(loser.handLabel).not.toBe("");
  });
});
