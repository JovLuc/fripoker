// Three-card bot: opens FIRST (before any peek — a blind bot blind-opens
// strong hands), then routes: monsters may stay blind (cheaper bets + keeps
// open rights), everyone else peeks, then bets by category-strength odds.
// Invariant tested in flow.test: whatever this returns, applyAction accepts.

import { TP_BET_STEP } from "../../../shared/constants.js";
import { evaluate3, type TpEval } from "./evaluator.js";
import { applyAction, compareTargets, legalActionsFor } from "./flow.js";
import type { TpState } from "./types.js";
import type { BotDecision } from "../core/types.js";

/** Category base + a small top-card nudge, clamped to 0..1. */
function strengthOf(hand: TpEval): number {
  const base = [0.05, 0.3, 0.48, 0.58, 0.8, 0.96][hand.category];
  const nudge = ((hand.tiebreak[0] ?? 0) / 14) * 0.12;
  return Math.min(1, base + nudge);
}

function raiseTo(state: TpState, maxPay: number, minPay: number): number {
  // actual-payment semantics: minimum in, plus a randomized bump
  const bump = TP_BET_STEP * Math.floor(Math.random() * 3); // 0..20 extra
  return Math.min(maxPay, minPay + bump);
}

export function tpBotDecide(state: TpState, playerId: string): BotDecision | null {
  if (state.handOver || state.actionIndex < 0) return null;
  const actor = state.players[state.actionIndex];
  if (!actor || actor.id !== playerId || !actor.isBot) return null;
  if (state.phase !== "betting") return null;

  const legal = legalActionsFor(state, playerId);
  if (!legal) return null;
  const ev = evaluate3(actor.holeCards);
  const strength = strengthOf(ev);

  // 1) OPEN FIRST — decided before any peek, so a blind bot blind-opens.
  //    canCompare already enforces same-peek-state targets; trips+ always
  //    open, flush-and-up often, pairs occasionally.
  if (legal.canCompare && strength >= 0.35) {
    const mustOpen = strength >= 0.85; // trips / straight flush
    const openChance = strength >= 0.55 ? 0.4 : 0.15;
    if (mustOpen || Math.random() < openChance) {
      const targets = compareTargets(state, actor);
      if (targets.length > 0) {
        const pick = targets[Math.floor(Math.random() * targets.length)];
        return { action: "compare", targetId: pick.id };
      }
    }
  }

  // 2) not peeked yet: monsters sometimes STAY blind (pay 1× and keep the
  //    right to blind-open); everyone else peeks first.
  if (!actor.looked) {
    const staysBlind = strength > 0.6 && Math.random() < 0.35;
    if (!staysBlind) return { action: "look" };
  }

  // 3) betting: every turn costs chips (no check exists)
  const need = legal.needToCall;
  const potOdds = need / (state.pot + need);
  if (strength > 0.85 && Math.random() < 0.5) {
    return { action: "raise", amount: raiseTo(state, legal.maxRaiseTo, legal.minRaiseTo) };
  }
  const cheap = need <= TP_BET_STEP;
  if (strength >= potOdds * 0.85 || (cheap && Math.random() < 0.55)) {
    // mid-plus hands push for value when there is room above the minimum
    if (strength > 0.6 && legal.maxRaiseTo > legal.minRaiseTo && Math.random() < 0.35) {
      return { action: "raise", amount: raiseTo(state, legal.maxRaiseTo, legal.minRaiseTo) };
    }
    return { action: "call" };
  }
  return { action: "fold" };
}

/** Exposed for the invariant test: run one bot decision through the engine. */
export function tpBotActOnce(state: TpState, playerId: string): boolean {
  const decision = tpBotDecide(state, playerId);
  if (!decision) return false;
  const res = applyAction(state, decision.action, decision.amount, decision.targetId);
  return res.ok;
}
