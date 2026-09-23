// Bot heuristics — botDecide(state, playerId) → {action, amount?}.
// Randomized thresholds keep bots from being trivially exploitable.
// Invariant tested in bot.test.ts: whatever it returns, applyAction accepts it.
//
// Short deck (6+) uses its own preflop table (pairs/big cards dominate the
// 36-card deck) and re-maps evaluator categories, which the short-deck
// evaluate7 already numbers per 6+ ranking. Same decision skeleton otherwise.

import { RANK_VALUE, evaluate7, legalActions } from "../game/index.js";
import type { Card, GameState, Player } from "../game/index.js";

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
  return 0.3;
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

/** Cheap postflop proxy: made-hand category first, high cards fallback. */
function boardStrength(hole: Card[], board: Card[], shortDeck: boolean): number {
  const cards = [...hole, ...board];
  if (cards.length >= 5) {
    const ev = evaluate7(cards, shortDeck);
    const pairTail = (): number => {
      if (ev.category === 2) return 0.7;
      if (ev.category === 1) {
        const top = ev.tiebreak[0];
        if (top >= 12) return 0.6;
        return 0.5;
      }
      const hi = Math.max(...hole.map((c) => RANK_VALUE[c.rank]));
      if (hi >= 13) return 0.45;
      return 0.35;
    };
    if (shortDeck) {
      // categories here are 6+ numbered: flush 6 / full house 5 / trips 4 / straight 3
      if (ev.category >= 6) return 0.9;
      if (ev.category === 5) return 0.82;
      if (ev.category === 4) return 0.75;
      if (ev.category === 3) return 0.65;
      return pairTail();
    }
    if (ev.category >= 3) return 0.9;
    return pairTail();
  }
  return preflopStrengthOf(shortDeck, hole) * 0.5;
}

function preflopStrengthOf(shortDeck: boolean, hole: Card[]): number {
  return shortDeck ? shortDeckPreflopStrength(hole) : preflopStrength(hole);
}

export function botDecide(state: GameState, playerId: string): BotDecision | null {
  const raw = decide(state, playerId);
  return raw ? clampRaise(state, raw) : null;
}

function decide(state: GameState, playerId: string): BotDecision | null {
  const idx = state.players.findIndex((p) => p.id === playerId);
  if (idx !== state.actionIndex) return null;
  const player: Player = state.players[idx];
  const needToCall = Math.max(0, state.currentBet - player.roundBet);
  const pot = state.pot;
  const stack = player.chips;
  const rand = Math.random();
  const strength =
    state.phase === "preflop" && state.board.length === 0
      ? preflopStrengthOf(state.shortDeck, player.holeCards)
      : boardStrength(player.holeCards, state.board, state.shortDeck);

  const potOdds = needToCall > 0 ? needToCall / (pot + needToCall) : 0;
  const infl = needToCall / Math.max(1, stack + player.roundBet);

  // always all-in with monsters sometimes
  if (strength > 0.9 && rand < 0.55) {
    return { action: "raise", amount: player.roundBet + player.chips };
  }

  if (needToCall === 0) {
    // can check or bet
    if (strength > 0.72 && rand < 0.75) {
      const size = Math.min(
        player.roundBet + player.chips,
        Math.max(state.bigBlind || 20, Math.floor(pot * (strength > 0.9 ? 0.8 : 0.55))),
      );
      const min = state.currentBet === 0 ? state.bigBlind || 20 : state.currentBet + (state.lastRaiseSize || state.bigBlind || 20);
      const to = Math.max(min, Math.min(size, player.roundBet + player.chips));
      return { action: "raise", amount: to };
    }
    if (strength > 0.5 && rand < 0.35) {
      const min = Math.max(state.bigBlind || 20, Math.floor(pot * 0.4));
      const to = Math.min(player.roundBet + player.chips, Math.max(state.bigBlind || 20, min));
      if (to > state.currentBet) return { action: "raise", amount: to };
    }
    return { action: "check" };
  }

  // facing a bet
  if (strength >= 0.85 && rand < 0.7) {
    if (player.roundBet + player.chips > state.currentBet) {
      const raiseTo = Math.min(
        player.roundBet + player.chips,
        state.currentBet + Math.max(state.lastRaiseSize || 20, Math.floor(pot * 0.6)),
      );
      if (raiseTo > state.currentBet) return { action: "raise", amount: raiseTo };
    }
    return { action: "call" };
  }

  if (strength > potOdds + 0.08 && infl < 0.45) {
    if (rand < 0.85) return { action: "call" };
  }

  if (strength > potOdds + 0.2 && infl < 0.7) {
    if (rand < 0.7) return { action: "call" };
  }

  // occasional bluff raise
  if (strength < 0.4 && rand < 0.08 && player.roundBet + player.chips > state.currentBet + 40) {
    const raiseTo = Math.min(player.roundBet + player.chips, state.currentBet + Math.max(40, Math.floor(pot * 0.5)));
    if (raiseTo > state.currentBet) return { action: "raise", amount: raiseTo };
  }

  // facing huge shove
  if (infl > 0.6 && strength < 0.75) {
    if (rand < 0.85) return { action: "fold" };
  }

  if (strength > 0.55 && rand < 0.6) return { action: "call" };
  if (strength > 0.45 && potOdds < 0.2 && rand < 0.5) return { action: "call" };

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
