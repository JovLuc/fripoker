// Bot heuristics — botDecide(state, playerId) → {action, amount?}.
// Randomized thresholds keep bots from being trivially exploitable.
// Strength is a Monte Carlo equity estimate (equity.ts) on every street.
// Preflop calls discount the raw price (the raiser's range beats random), so
// bots defend wide against cheap action but still muck trash facing raises;
// the hand tables survive only for open-bet sizing, where equity vs random
// is a poor proxy for playability.
// Invariant tested in bot.test.ts: whatever it returns, applyAction accepts it.
//
// Short deck (6+) uses its own open-size table (pairs/big cards dominate the
// 36-card deck) and re-maps evaluator categories, which the short-deck
// evaluate7 already numbers per 6+ ranking. Same decision skeleton otherwise.

import { RANK_VALUE } from "../core/cards.js";
import type { Card } from "../core/types.js";
import type { GameState, Player } from "./types.js";
import { legalActions } from "./handFlow.js";
import { estimateEquity } from "./equity.js";

export interface BotDecision {
  action: "fold" | "check" | "call" | "raise";
  /** raise-TO total, present only for action === "raise". */
  amount?: number;
}

export function preflopStrength(hole: Card[]): number {
  const [a, b] = hole;
  const ra = RANK_VALUE[a.rank];
  const rb = RANK_VALUE[b.rank];
  const suited = a.suit === b.suit;
  const pair = ra === rb;
  const hi = Math.max(ra, rb);
  const lo = Math.min(ra, rb);
  const gap = hi - lo;

  if (pair) {
    if (ra >= 10) return 0.95;
    if (ra >= 7) return 0.75;
    if (ra >= 4) return 0.6;
    return 0.5;
  }
  if (hi === 14 && lo >= 10) return suited ? 0.85 : 0.78;
  if (hi === 14 && suited && lo >= 7) return 0.65;
  if (hi === 14 && lo >= 7) return 0.55;
  if (suited && gap <= 2 && hi >= 10) return 0.6;
  if (suited && hi >= 9 && lo >= 6) return 0.52;
  if (gap === 0 && hi >= 6) return 0.45;
  if (hi >= 13 && lo >= 10) return 0.58;
  if (gap <= 1 && hi >= 9) return 0.48;
  if (suited && hi >= 8) return 0.42;
  if (hi >= 12 && lo >= 9) return 0.45;
  if (suited && gap <= 2) return 0.4;   // small suiteds limp fine
  if (gap <= 1 && hi >= 6) return 0.38; // small connectors
  return 0.32;
}

/**
 * Short deck preflop: with only 6..A in the deck, pairs and high cards carry
 * far more equity (AA ~78% HU vs ~85% in a full deck; every pair is above
 * average). Suitedness matters less — flushes are rarer relative to the deck.
 */
export function shortDeckPreflopStrength(hole: Card[]): number {
  const [a, b] = hole;
  const ra = RANK_VALUE[a.rank];
  const rb = RANK_VALUE[b.rank];
  const suited = a.suit === b.suit;
  const hi = Math.max(ra, rb);
  const lo = Math.min(ra, rb);
  const gap = hi - lo;

  if (ra === rb) {
    if (ra >= 13) return 0.92; // AA / KK
    if (ra >= 11) return 0.84; // QQ / JJ
    if (ra >= 9) return 0.76;  // TT / 99
    return 0.66;               // 88 / 77 / 66
  }
  if (hi === 14) {
    if (lo >= 12) return suited ? 0.84 : 0.8; // AK / AQ
    if (lo >= 10) return suited ? 0.74 : 0.7; // AJ / AT
    return suited ? 0.6 : 0.56;               // A9..A6
  }
  if (hi >= 12 && lo >= 10) return suited ? 0.7 : 0.64;   // KQ..QT, QJ
  if (gap <= 2 && hi >= 10) return suited ? 0.6 : 0.54;   // ten-high connectors
  if (hi >= 12 && lo >= 8) return suited ? 0.56 : 0.5;
  if (suited) return 0.46;
  if (hi >= 11) return 0.44;
  return 0.32;
}

function preflopStrengthOf(shortDeck: boolean, hole: Card[]): number {
  return shortDeck ? shortDeckPreflopStrength(hole) : preflopStrength(hole);
}

/** Players still contesting the pot (dealt in and not folded). All-in
 *  players count — they can still win. */
function activeOpponents(state: GameState, playerId: string): number {
  return state.players.filter(
    (p) => p.id !== playerId && !p.folded && p.holeCards.length === 2,
  ).length;
}

export function botDecide(state: GameState, playerId: string): BotDecision | null {
  const raw = decide(state, playerId);
  return raw ? clampRaise(state, raw) : null;
}

function decide(state: GameState, playerId: string): BotDecision | null {
  const idx = state.players.findIndex((p) => p.id === playerId);
  if (idx !== state.actionIndex) return null;
  const player: Player = state.players[idx];
  const rand = Math.random();
  const opps = Math.max(1, activeOpponents(state, playerId));
  const equity = estimateEquity(player.holeCards, state.board, {
    opponents: opps,
    shortDeck: state.shortDeck,
  });
  return state.phase === "preflop" && state.board.length === 0
    ? decidePreflop(state, player, equity, opps, rand)
    : decidePostflop(state, player, equity, opps, rand);
}

/**
 * Preflop off sampled equity. The call rule is equity vs the pot-odds price
 * with a discount (potOdds × 1.15 + 0.03): against the field's random hands
 * equity overstates a calling range because bettors hold better-than-random
 * cards, but the raw table scale was worse — it mucked playable hands against
 * ordinary raises, which read as bots folding far too much. Junk still folds
 * and shoves get priced correctly; opens (needToCall === 0) stay table-driven.
 */
function decidePreflop(
  state: GameState,
  player: Player,
  equity: number,
  opponents: number,
  rand: number,
): BotDecision {
  const needToCall = Math.max(0, state.currentBet - player.roundBet);
  const pot = state.pot;
  const potOdds = needToCall > 0 ? needToCall / (pot + needToCall) : 0;
  const norm = equity * (opponents + 1);
  const maxTo = player.roundBet + player.chips;
  const bb = state.bigBlind || 20;

  // monsters — pressure the pot but keep all-ins rare: a flat 0.32 jam rate
  // shipped 200bb stacks in and folded the field out. Deep stacks mostly
  // overbet-raise (sometimes just call to trap); only a stack already shallow
  // vs the pot leans on the jam. norm stays high because multiway
  // equity-vs-random averages 1/(N+1) — 2.3 still means "crushing the field".
  if (equity > 0.82 || norm > 2.3) {
    const jam = player.chips <= pot * 2;
    if (rand < (jam ? 0.22 : 0.08)) return { action: "raise", amount: maxTo };
    if (rand < 0.5) {
      const size = Math.min(maxTo, Math.max(bb * 2, Math.floor(pot * 1.2)));
      if (size > state.currentBet) return { action: "raise", amount: size };
    }
  }

  if (needToCall === 0) {
    // open-betting: tables calibrate sizes better than equity-vs-random
    const strength = preflopStrengthOf(state.shortDeck, player.holeCards);
    if (strength > 0.72 && rand < 0.6) {
      const size = Math.min(maxTo, Math.max(bb, Math.floor(pot * (strength > 0.9 ? 0.7 : 0.5))));
      const min = state.currentBet === 0 ? bb : state.currentBet + (state.lastRaiseSize || bb);
      return { action: "raise", amount: Math.max(min, Math.min(size, maxTo)) };
    }
    if (strength > 0.5 && rand < 0.3) {
      const to = Math.min(maxTo, Math.max(bb, Math.floor(pot * 0.4)));
      if (to > state.currentBet) return { action: "raise", amount: to };
    }
    return { action: "check" };
  }

  // facing a bet: value-raise the top of the range (equity gate for shallow
  // fields, norm for multiway where raw equity never clears 0.6)
  if (((equity > 0.6 && opponents <= 2) || norm > 2.0) && rand < 0.5) {
    const raiseTo = Math.min(
      maxTo,
      state.currentBet + Math.max(state.lastRaiseSize || 20, Math.floor(pot * 0.5)),
    );
    if (raiseTo > state.currentBet) return { action: "raise", amount: raiseTo };
    return { action: "call" };
  }

  // cheap action (limp/complete): the field hasn't paid yet, so potOdds on a
  // one-blind call dwarfs equity computed vs everyone still seated — pricing
  // it "honestly" folded most of the first orbit. Play any non-junk hand.
  const infl = needToCall / Math.max(1, player.chips + player.roundBet);
  if (needToCall <= bb && infl < 0.25) {
    const strength = preflopStrengthOf(state.shortDeck, player.holeCards);
    return strength > 0.34 + 0.1 * rand ? { action: "call" } : { action: "fold" };
  }

  // light 3-bet bluff, more when the price is steep
  if (equity < 0.45 && rand < 0.04 && maxTo > state.currentBet + 40) {
    const raiseTo = Math.min(maxTo, state.currentBet + Math.max(40, Math.floor(pot * 0.5)));
    if (raiseTo > state.currentBet) return { action: "raise", amount: raiseTo };
  }

  // the EV core with a range discount; the margin jitters so sizing gives
  // nothing away, but a hand that clears it never folds here
  if (equity > potOdds * 1.15 + 0.03 + 0.04 * rand) {
    return { action: "call" };
  }

  return { action: "fold" };
}

/**
 * Postflop decisions off sampled equity. Two principles replace the old magic
 * thresholds: call iff equity clears the pot-odds price (plus a randomized
 * margin), and scale aggression by `norm` — equity times the field size, ≈1
 * meaning exactly an average hand against everyone still in. Multiway pots
 * therefore tighten on their own, and shoves are priced correctly instead of
 * folded by a stack-fraction rule.
 */
function decidePostflop(
  state: GameState,
  player: Player,
  equity: number,
  opponents: number,
  rand: number,
): BotDecision {
  const needToCall = Math.max(0, state.currentBet - player.roundBet);
  const pot = state.pot;
  const potOdds = needToCall > 0 ? needToCall / (pot + needToCall) : 0;
  const norm = equity * (opponents + 1);
  const maxTo = player.roundBet + player.chips;
  const bb = state.bigBlind || 20;

  // monsters — same all-in discipline as preflop: shallow stacks still jam
  // (pot-committed anyway), deep stacks overbet-raise or slow-play so shoves
  // stay rare enough that callers need a real hand.
  if (equity > 0.88 || norm > 2.0) {
    const jam = player.chips <= pot * 2;
    if (rand < (jam ? 0.25 : 0.1)) return { action: "raise", amount: maxTo };
    if (rand < 0.55) {
      const size = Math.min(maxTo, Math.max(bb * 2, Math.floor(pot * 1.2)));
      if (size > state.currentBet) return { action: "raise", amount: size };
    }
  }

  if (needToCall === 0) {
    if (norm > 1.35 && rand < 0.55) {
      const size = Math.floor(pot * (norm > 1.8 ? 0.7 : 0.5));
      return { action: "raise", amount: Math.min(maxTo, Math.max(bb, size)) };
    }
    if (norm > 1.08 && rand < 0.3) {
      return { action: "raise", amount: Math.min(maxTo, Math.max(bb, Math.floor(pot * 0.4))) };
    }
    // occasional stab with air so checked ranges aren't face-up
    if (norm < 0.75 && rand < 0.06) {
      return { action: "raise", amount: Math.min(maxTo, Math.max(bb, Math.floor(pot * 0.5))) };
    }
    return { action: "check" };
  }

  // value raise when well ahead of the field
  if (norm > 1.6 && rand < 0.45) {
    const raiseTo = Math.min(
      maxTo,
      state.currentBet + Math.max(state.lastRaiseSize || 20, Math.floor(pot * 0.55)),
    );
    if (raiseTo > state.currentBet) return { action: "raise", amount: raiseTo };
    return { action: "call" };
  }

  // the EV core: call iff equity beats the price; the margin jitters so
  // sizing gives nothing away, but a hand that clears it never folds here
  if (equity > potOdds + 0.04 + 0.06 * rand) {
    return { action: "call" };
  }

  // rare bluff raise
  if (norm < 0.8 && rand < 0.05 && maxTo > state.currentBet + 40) {
    const raiseTo = Math.min(maxTo, state.currentBet + Math.max(40, Math.floor(pot * 0.5)));
    if (raiseTo > state.currentBet) return { action: "raise", amount: raiseTo };
  }

  return { action: "fold" };
}

/**
 * Clamp a raise into the legal [minRaiseTo, maxRaiseTo] window. The raw
 * heuristics above can undershoot the min-raise (they ignore lastRaiseSize on
 * one path); the original JS silently dropped those actions and retried on a
 * later tick — here the decision is made legal up front instead.
 */
function clampRaise(state: GameState, decision: BotDecision): BotDecision {
  if (decision.action !== "raise") return decision;
  const legal = legalActions(state);
  if (!legal) return { action: "check" };
  const to = Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, decision.amount ?? 0));
  // A raise-to at or below the current bet is not a raise; fall back.
  if (to <= state.currentBet) {
    return legal.needToCall > 0 ? { action: "call" } : { action: "check" };
  }
  return { action: "raise", amount: to };
}
