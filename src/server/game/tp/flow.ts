// Three-card hand flow. Continuous-seat model — NO betting rounds:
// seats rotate forever, and every turn you must PAY a bet (blind: N, peeked:
// 2N), fold, or open (compare). A payment above the current level raises the
// base N = ceil(payment / multiplier). Play runs until one player remains
// (all-in table falls through to a showdown). All chip movement funnels
// through core commitChips; pot layering and fold-wins are the shared core's.

import { STARTING_CHIPS, TP_ANTE, TP_BET_STEP } from "../../../shared/constants.js";
import type { LegalActions, PlayerActionName } from "../../../shared/protocol.js";
import { createDeck, shuffle } from "../core/cards.js";
import { accrueInterest, endGameIfBusted } from "../core/economy.js";
import {
  awardSplit,
  buildPots,
  canAct,
  commitChips,
  endHandByFold,
  nextSeatFrom,
} from "../core/flow.js";
import type { ApplyResult, HandStep, SeatSeed } from "../core/types.js";
import { compare3, evaluate3, type TpEval } from "./evaluator.js";
import type { TpPlayer, TpState } from "./types.js";

/** Payment multiplier: peeked players act at double value. */
function mult(p: TpPlayer): number {
  return p.looked ? 2 : 1;
}

/** Open cost equals this player's bet cost this turn: N blind / 2N peeked. */
function compareFee(state: TpState, p: TpPlayer): number {
  return state.currentBet * mult(p);
}

/**
 * Open targets — the rule is peek-state parity ONLY: you may open a blind
 * rival while blind, or an already-peeked rival once you have peeked.
 * (All-ins stay openable: they cannot fold away from a duel they can still lose.)
 */
export function compareTargets(state: TpState, p: TpPlayer): TpPlayer[] {
  return state.players.filter(
    (t) => t.id !== p.id && !t.folded && !t.sittingOut && t.holeCards.length === 3 && t.looked === p.looked,
  );
}

/** A bet may raise the base: blind payment → N = pay; peeked → N = ceil(pay/2). */
function notePayment(state: TpState, p: TpPlayer, pay: number): void {
  const newBase = Math.ceil(pay / mult(p));
  if (newBase > state.currentBet) state.currentBet = newBase;
}

export function createTpGame(seats: SeatSeed[]): TpState {
  const players: TpPlayer[] = seats.map((s, i) => ({
    id: s.id,
    name: s.name,
    isBot: s.isBot,
    seat: i,
    chips: STARTING_CHIPS,
    holeCards: [],
    roundBet: 0,
    totalBet: 0,
    folded: false,
    allIn: false,
    acted: false,
    lastAction: null,
    sittingOut: false,
    left: false,
    debt: 0,
    debtHands: 0,
    bustLogged: false,
    looked: false,
    revealed: false,
  }));
  return {
    kind: "tp",
    handId: 0,
    phase: "idle",
    players,
    deck: shuffle(createDeck()),
    pot: 0,
    currentBet: 0,
    dealerIndex: -1,
    actionIndex: -1,
    handOver: false,
    gameOver: false,
    revealAll: false,
    lastResults: null,
    message: "已开局，等待发牌",
    busted: [],
    lastWinnerId: null,
  };
}

/** Ante pays pot + totalBet only — NOT roundBet (ante is entry, not a bet). */
function payAnte(state: TpState, p: TpPlayer): void {
  const pay = Math.min(TP_ANTE, p.chips);
  p.chips -= pay;
  p.totalBet += pay;
  state.pot += pay;
  if (p.chips === 0) p.allIn = true;
}

export function startHand(state: TpState): HandStep {
  accrueInterest(state.players);
  state.deck = shuffle(createDeck());
  state.pot = 0;
  state.currentBet = TP_BET_STEP; // base N opens at one unit
  state.revealAll = false;
  state.lastResults = null;
  state.handOver = false;
  state.phase = "betting";

  for (const p of state.players) {
    p.holeCards = [];
    p.roundBet = 0;
    p.totalBet = 0;
    p.folded = false;
    p.allIn = false;
    p.lastAction = null;
    p.looked = false;
    p.revealed = false;
    p.sittingOut = p.chips <= 0 || p.left;
  }

  const elig = state.players.filter((p) => !p.sittingOut);
  if (elig.length < 2) {
    state.phase = "idle";
    state.actionIndex = -1;
    if (!endGameIfBusted(state)) {
      state.handOver = true;
      state.message = "等待破产玩家借款后准备";
    }
    return "hand-end";
  }

  // button (庄): last hand's winner if still alive, else rotate; first hand = seat 0
  const winner = state.lastWinnerId
    ? state.players.find((p) => p.id === state.lastWinnerId && !p.sittingOut)
    : undefined;
  if (winner) {
    state.dealerIndex = winner.seat;
  } else {
    state.dealerIndex = nextSeatFrom(state.players, state.dealerIndex, (p) => !p.sittingOut);
    if (state.dealerIndex < 0) state.dealerIndex = elig[0].seat;
  }

  for (const p of elig) {
    p.holeCards = [state.deck.pop()!, state.deck.pop()!, state.deck.pop()!];
    payAnte(state, p);
  }

  state.handId += 1;
  // the button acts first (falls to the next seat when the button cannot act)
  const first = canAct(state.players[state.dealerIndex])
    ? state.dealerIndex
    : nextSeatFrom(state.players, state.dealerIndex, (p) => canAct(p));
  if (first < 0) {
    // everyone all-in from the ante — settle immediately
    tpShowdown(state);
    return "hand-end";
  }
  state.actionIndex = first;
  state.message = `第 ${state.handId} 手 · 底注 ${TP_ANTE}`;
  return "continue";
}

export function legalActionsFor(state: TpState, playerId: string): LegalActions | null {
  const idx = state.players.findIndex((p) => p.id === playerId);
  if (idx < 0 || idx !== state.actionIndex) return null;
  const p = state.players[state.actionIndex];
  if (!p || !canAct(p)) return null;

  const minBet = state.currentBet * mult(p); // this action's minimum payment
  const fee = minBet; // open costs exactly the same as betting
  return {
    needToCall: minBet,
    canCheck: false, // there is no check — every turn pays a bet
    canCall: true,
    minRaiseTo: Math.min(minBet, p.chips),
    maxRaiseTo: p.chips,
    pot: state.pot,
    currentBet: state.currentBet,
    chips: p.chips,
    roundBet: p.roundBet,
    bigBlind: TP_BET_STEP,
    canLook: !p.looked,
    canCompare: compareTargets(state, p).length > 0 && p.chips >= fee,
    compareFee: fee,
  };
}

export function applyAction(
  state: TpState,
  action: PlayerActionName,
  amount = 0,
  targetId = "",
): ApplyResult {
  const p = state.players[state.actionIndex];
  if (!p || !canAct(p)) return { ok: false, error: "当前不可操作" };
  const legal = legalActionsFor(state, p.id);
  if (!legal) return { ok: false, error: "非法状态" };

  switch (action) {
    case "look": {
      // peek only on your own turn, once per hand; free and non-consuming
      if (p.looked) return { ok: false, error: "已经看过牌" };
      p.looked = true;
      return { ok: true, advance: false };
    }
    case "fold": {
      p.folded = true;
      p.lastAction = "fold";
      return { ok: true };
    }
    case "check":
      return { ok: false, error: "不能过牌" };
    case "call": {
      const min = state.currentBet * mult(p);
      const pay = commitChips(state, p, min);
      notePayment(state, p, pay);
      p.lastAction = pay >= min ? "call" : "allin";
      return { ok: true };
    }
    case "raise": {
      const to = Math.floor(Number(amount));
      if (!Number.isFinite(to) || to <= 0) return { ok: false, error: "非法金额" };
      if (to > p.chips) return { ok: false, error: "超出上限" };
      const min = state.currentBet * mult(p);
      // below the minimum only a full shove (to === all remaining chips) passes
      if (to < min && to < p.chips) return { ok: false, error: `下注至少 ${min}` };
      commitChips(state, p, to);
      notePayment(state, p, to);
      p.lastAction = p.allIn ? "allin" : "raise";
      return { ok: true };
    }
    case "allin": {
      if (p.chips <= 0) return { ok: false, error: "筹码不足" };
      const pay = p.chips;
      commitChips(state, p, p.chips);
      notePayment(state, p, pay);
      p.lastAction = "allin";
      return { ok: true };
    }
    case "compare": {
      const target = compareTargets(state, p).find((t) => t.id === targetId);
      if (!target) return { ok: false, error: "无效的比牌对象" };
      const fee = compareFee(state, p);
      if (p.chips < fee) return { ok: false, error: "筹码不足" };
      commitChips(state, p, fee); // fee enters the pot but never raises N
      p.lastAction = "compare";
      const cmp = compare3(evaluate3(p.holeCards), evaluate3(target.holeCards));
      if (cmp > 0) {
        // loser reveals — even a blind loser shows; a blind WINNER stays blind
        target.folded = true;
        target.revealed = true;
        target.lastAction = "fold";
        state.message = `${p.name} 开牌胜 ${target.name}`;
      } else {
        p.folded = true;
        p.revealed = true;
        state.message = `${target.name} 开牌胜 ${p.name}`;
      }
      return { ok: true };
    }
    default:
      return { ok: false, error: "未知操作" };
  }
}

/** The hand's winner keeps the button next hand (赢家坐庄). */
function recordWinner(state: TpState): void {
  const w = state.lastResults?.[0];
  if (w) state.lastWinnerId = w.playerId;
}

export function stepAfterAction(state: TpState): HandStep {
  if (state.handOver) return "hand-end";
  const stillIn = state.players.filter((p) => !p.folded && !p.sittingOut);
  if (stillIn.length <= 1) {
    endHandByFold(state, "showdown");
    recordWinner(state);
    return "hand-end";
  }
  const active = stillIn.filter(canAct);
  if (active.length === 0) {
    tpShowdown(state);
    return "hand-end";
  }

  const next = nextSeatFrom(state.players, state.actionIndex, (p) => canAct(p));
  if (next < 0) {
    tpShowdown(state);
    return "hand-end";
  }
  state.actionIndex = next;
  return "continue";
}

/** Reveal the table and award pots by 3-card strength. */
export function tpShowdown(state: TpState): void {
  state.phase = "showdown";
  state.actionIndex = -1;
  state.handOver = true;
  state.revealAll = true;

  const pots = buildPots(state.players);
  const evals = new Map<string, TpEval>();
  for (const p of state.players) {
    if (!p.folded && !p.sittingOut && p.holeCards.length === 3) {
      evals.set(p.id, evaluate3(p.holeCards));
    }
  }

  const wins = new Map<string, number>();
  for (const pot of pots) {
    const elig = pot.eligibleIds.filter((id) => evals.has(id));
    if (elig.length === 0) continue;
    let best = evals.get(elig[0])!;
    let winners = [elig[0]];
    for (let i = 1; i < elig.length; i++) {
      const c = compare3(evals.get(elig[i])!, best);
      if (c > 0) {
        best = evals.get(elig[i])!;
        winners = [elig[i]];
      } else if (c === 0) {
        winners.push(elig[i]);
      }
    }
    awardSplit(state.players, pot.amount, winners, wins);
  }

  state.lastResults = [...wins.entries()].map(([playerId, amount]) => {
    const player = state.players.find((p) => p.id === playerId);
    const ev = evals.get(playerId);
    return { playerId, name: player?.name || "", amount, hand: ev?.name || "" };
  });
  if (state.lastResults.length > 0) state.lastWinnerId = state.lastResults[0].playerId;
  state.pot = 0;  const parts = state.lastResults.map((r) => `${r.name} +${r.amount}${r.hand ? ` (${r.hand})` : ""}`);
  state.message = parts.length ? parts.join(" · ") : "本手结束";
}

export function endByFold(state: TpState): void {
  endHandByFold(state, "showdown");
  recordWinner(state);
}
