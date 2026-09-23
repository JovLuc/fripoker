"use strict";
// MODULE: bot heuristics — botDecide(state, playerId) → {action, amount?}.
// Uses evaluate7 from engine for postflop strength. No UI.
// L2: server/AGENTS.md

function preflopStrength(hole) {
  const [a, b] = hole;
  const ra = rankVal(a.rank);
  const rb = rankVal(b.rank);
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

function rankVal(r) {
  const map = { 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, T: 10, J: 11, Q: 12, K: 13, A: 14 };
  return map[r];
}

function boardStrength(hole, board) {
  const cards = [...hole, ...board];
  // cheap proxy: pair/trips hits and high cards
  const { evaluate7 } = require("./engine");
  if (cards.length >= 5) {
    const ev = evaluate7(cards);
    if (ev.category >= 3) return 0.9;
    if (ev.category === 2) return 0.7;
    if (ev.category === 1) {
      const top = ev.tiebreak[0];
      if (top >= 12) return 0.6;
      return 0.5;
    }
    const hi = Math.max(...hole.map((c) => rankVal(c.rank)));
    if (hi >= 13) return 0.45;
    return 0.35;
  }
  return preflopStrength(hole) * 0.5;
}

function botDecide(state, playerId) {
  const idx = state.players.findIndex((p) => p.id === playerId);
  if (idx !== state.actionIndex) return null;
  const player = state.players[idx];
  const needToCall = Math.max(0, state.currentBet - player.roundBet);
  const pot = state.pot;
  const stack = player.chips;
  const rand = Math.random();
  const strength = state.phase === "preflop" && state.board.length === 0
    ? preflopStrength(player.holeCards)
    : boardStrength(player.holeCards, state.board);

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
        Math.max(state.bigBlind || 20, Math.floor(pot * (strength > 0.9 ? 0.8 : 0.55)))
      );
      const min = state.currentBet === 0 ? (state.bigBlind || 20) : state.currentBet + (state.lastRaiseSize || state.bigBlind || 20);
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
        state.currentBet + Math.max(state.lastRaiseSize || 20, Math.floor(pot * 0.6))
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

module.exports = { botDecide, preflopStrength };
