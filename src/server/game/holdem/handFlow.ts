// Hand flow: game state creation (seat seeding), dealing, blinds, betting
// actions, street advancement. Chip movement funnels through core commitChips.

import { BIG_BLIND, SMALL_BLIND, STARTING_CHIPS } from "../../../shared/constants.js";
import type { LegalActions, PlayerActionName } from "../../../shared/protocol.js";
import { createDeck, shuffle } from "../core/cards.js";
import { accrueInterest, endGameIfBusted } from "../core/economy.js";
import { canAct, commitChips, nextSeatFrom, reopenAction } from "../core/flow.js";
import type { ApplyResult, HandStep, SeatSeed } from "../core/types.js";
import { endHandByFold, showdown } from "./showdown.js";
import type { GameState, Player } from "./types.js";

export { canAct, nextSeatFrom } from "../core/flow.js";

const PHASES = ["preflop", "flop", "turn", "river"] as const;

function createPlayer(id: string, name: string, isBot: boolean, seat: number): Player {
  return {
    id,
    name,
    isBot,
    seat,
    chips: STARTING_CHIPS,
    holeCards: [],
    roundBet: 0,
    totalBet: 0,
    folded: false,
    allIn: false,
    acted: false,
    isDealer: false,
    isSB: false,
    isBB: false,
    lastAction: null,
    sittingOut: false,
    left: false,
    debt: 0,
    debtHands: 0,
    bustLogged: false,
  };
}

/** Seats dealt in: chips > 0 at deal time (sittingOut is recomputed then). */
function eligibleIndexes(state: GameState): number[] {
  return state.players
    .map((p, i) => (p.chips > 0 && !p.sittingOut ? i : -1))
    .filter((i) => i >= 0);
}

/** One seat at table creation; bots are decided by the room, not the engine. */
export type { SeatSeed } from "../core/types.js";

export function createGameState(seats: SeatSeed[], opts: { shortDeck?: boolean } = {}): GameState {
  const shortDeck = !!opts.shortDeck;
  const players = seats.map((s, i) => createPlayer(s.id, s.name, s.isBot, i));

  return {
    kind: "holdem",
    handId: 0,
    phase: "idle",
    players,
    board: [],
    deck: shuffle(createDeck(shortDeck)),
    pot: 0,
    currentBet: 0,
    lastRaiseSize: BIG_BLIND,
    dealerIndex: -1,
    sbIndex: -1,
    bbIndex: -1,
    actionIndex: -1,
    handOver: false,
    gameOver: false,
    revealAll: false,
    lastResults: null,
    message: "已开局，等待发牌",
    smallBlind: SMALL_BLIND,
    bigBlind: BIG_BLIND,
    shortDeck,
    busted: [],
  };
}

function postBlind(state: GameState, index: number, amount: number): void {
  const p = state.players[index];
  const pay = Math.min(amount, p.chips);
  p.chips -= pay;
  p.roundBet += pay;
  p.totalBet += pay;
  state.pot += pay;
  if (p.chips === 0) p.allIn = true;
}

/**
 * Deal a new hand. Charges debt interest first (skip the first deal after a
 * fresh borrow, then ×1.1 per hand), then rotates the button, posts blinds.
 * Returns false when fewer than 2 funded seats exist; live human seats may
 * still borrow before the next hand, so only the room decides game over.
 */
function resetHand(state: GameState): boolean {
  accrueInterest(state.players);
  state.board = [];
  state.deck = shuffle(createDeck(state.shortDeck));
  state.pot = 0;
  state.currentBet = 0;
  state.lastRaiseSize = BIG_BLIND;
  state.phase = "preflop";
  state.handOver = false;
  state.revealAll = false;
  state.lastResults = null;

  for (const p of state.players) {
    p.holeCards = [];
    p.roundBet = 0;
    p.totalBet = 0;
    p.folded = false;
    p.allIn = false;
    p.acted = false;
    p.isDealer = false;
    p.isSB = false;
    p.isBB = false;
    p.lastAction = null;
    // simple join rule: chips must be > 0 at deal time; departed seats never come back
    p.sittingOut = p.chips <= 0 || p.left;
  }

  const elig = eligibleIndexes(state);
  if (elig.length < 2) {
    state.phase = "idle";
    if (!endGameIfBusted(state)) {
      state.handOver = true;
      state.message = "等待破产玩家借款后准备";
    }
    return false;
  }

  state.dealerIndex = nextSeatFrom(state.players, state.dealerIndex, (_, idx) => elig.includes(idx));
  if (state.dealerIndex < 0) state.dealerIndex = elig[0];

  const others = elig.filter((i) => i !== state.dealerIndex);
  if (others.length === 1) {
    // heads-up: dealer is SB
    state.sbIndex = state.dealerIndex;
    state.bbIndex = others[0];
  } else {
    state.sbIndex = nextSeatFrom(state.players, state.dealerIndex, (_, idx) => idx !== state.dealerIndex && elig.includes(idx));
    state.bbIndex = nextSeatFrom(state.players, state.sbIndex, (_, idx) => idx !== state.dealerIndex && idx !== state.sbIndex && elig.includes(idx));
  }

  state.players[state.dealerIndex].isDealer = true;
  state.players[state.sbIndex].isSB = true;
  state.players[state.bbIndex].isBB = true;

  for (const p of state.players) {
    if (p.sittingOut) continue;
    p.holeCards = [state.deck.pop()!, state.deck.pop()!];
  }

  postBlind(state, state.sbIndex, SMALL_BLIND);
  postBlind(state, state.bbIndex, BIG_BLIND);
  state.currentBet = Math.max(state.players[state.sbIndex].roundBet, state.players[state.bbIndex].roundBet);
  state.lastRaiseSize = BIG_BLIND;
  state.handId += 1;

  const first = nextSeatFrom(state.players, state.bbIndex, (p) => canAct(p));
  if (first < 0) {
    // everyone all-in from blinds
    state.actionIndex = -1;
    return true;
  }
  state.actionIndex = first;
  state.message = `第 ${state.handId} 手 · ${SMALL_BLIND}/${BIG_BLIND}`;
  return true;
}

export function startHand(state: GameState): HandStep {
  const ok = resetHand(state);
  if (!ok) {
    state.handOver = true;
    state.actionIndex = -1;
    return "hand-end";
  }
  if (state.actionIndex < 0) {
    // blinds all-in edge case
    showdown(state);
    return "hand-end";
  }
  return "continue";
}

export function legalActions(state: GameState): LegalActions | null {
  const player = state.players[state.actionIndex];
  if (!player || !canAct(player)) return null;
  const needToCall = Math.max(0, state.currentBet - player.roundBet);
  const maxRaiseTo = player.roundBet + player.chips;
  let minRaiseTo: number;
  if (state.currentBet === 0) {
    minRaiseTo = Math.min(BIG_BLIND, maxRaiseTo);
  } else {
    const minInc = Math.max(state.lastRaiseSize, BIG_BLIND);
    minRaiseTo = Math.min(state.currentBet + minInc, maxRaiseTo);
    if (minRaiseTo < state.currentBet) minRaiseTo = state.currentBet;
  }
  return {
    needToCall,
    canCheck: needToCall === 0,
    canCall: needToCall > 0,
    minRaiseTo,
    maxRaiseTo,
    pot: state.pot,
    currentBet: state.currentBet,
    chips: player.chips,
    roundBet: player.roundBet,
    bigBlind: state.bigBlind,
  };
}

export function legalActionsFor(state: GameState, playerId: string): LegalActions | null {
  const idx = state.players.findIndex((p) => p.id === playerId);
  if (idx < 0 || idx !== state.actionIndex) return null;
  return legalActions(state);
}

/**
 * Apply a player action for the current actor.
 * `raise` amount is raise-TO (a total bet level, not a delta); a raise below
 * minRaiseTo is rejected unless it is an all-in.
 */
export function applyAction(state: GameState, action: PlayerActionName, amount = 0): ApplyResult {
  const player = state.players[state.actionIndex];
  if (!player || !canAct(player)) return { ok: false, error: "当前不可操作" };
  const legal = legalActions(state);
  if (!legal) return { ok: false, error: "非法状态" };

  if (action === "fold") {
    player.folded = true;
    player.acted = true;
    player.lastAction = "fold";
  } else if (action === "check") {
    if (!legal.canCheck) return { ok: false, error: "不能过牌" };
    player.acted = true;
    player.lastAction = "check";
  } else if (action === "call") {
    if (legal.needToCall <= 0) return { ok: false, error: "无需跟注" };
    const pay = commitChips(state, player, legal.needToCall);
    player.acted = true;
    player.lastAction = pay >= legal.needToCall ? "call" : "allin";
  } else if (action === "raise") {
    const to = Math.floor(Number(amount));
    if (!Number.isFinite(to) || to <= 0) return { ok: false, error: "非法金额" };
    if (to < legal.minRaiseTo && to < legal.maxRaiseTo) {
      return { ok: false, error: `加注至少到 ${legal.minRaiseTo}` };
    }
    if (to > legal.maxRaiseTo) return { ok: false, error: "超出上限" };
    const need = to - player.roundBet;
    if (need > player.chips) return { ok: false, error: "筹码不足" };
    const raiseSize = to - state.currentBet;
    commitChips(state, player, need);
    state.lastRaiseSize = Math.max(state.bigBlind || BIG_BLIND, raiseSize);
    state.currentBet = player.roundBet;
    reopenAction(state, player);
    player.acted = true;
    player.lastAction = player.allIn ? "allin" : "raise";
  } else if (action === "allin") {
    const to = player.roundBet + player.chips;
    const raiseSize = to - state.currentBet;
    commitChips(state, player, player.chips);
    if (to > state.currentBet) {
      if (raiseSize > 0) state.lastRaiseSize = Math.max(state.lastRaiseSize, raiseSize);
      state.currentBet = player.roundBet;
      reopenAction(state, player);
    } else {
      player.acted = true;
    }
    player.lastAction = "allin";
  } else {
    return { ok: false, error: "未知操作" };
  }

  return { ok: true };
}

function bettingRoundComplete(state: GameState): boolean {
  const contenders = state.players.filter((p) => !p.folded && !p.sittingOut);
  if (contenders.length <= 1) return true;
  const actors = contenders.filter(canAct);
  if (actors.length === 0) return true;
  const maxBet = Math.max(...contenders.map((p) => p.roundBet));
  return actors.every((p) => p.acted && (p.roundBet === maxBet || p.allIn));
}

function startNextPhase(state: GameState): HandStep {
  for (const p of state.players) {
    p.roundBet = 0;
    p.acted = false;
    if (!p.folded && !p.allIn) p.lastAction = null;
  }
  state.currentBet = 0;
  state.lastRaiseSize = BIG_BLIND;

  if (state.phase === "river") {
    showdown(state);
    return "hand-end";
  }

  const idx = PHASES.indexOf(state.phase as (typeof PHASES)[number]);
  if (idx < 0) {
    showdown(state);
    return "hand-end";
  }
  state.phase = PHASES[idx + 1];
  if (state.phase === "flop") {
    state.board.push(state.deck.pop()!, state.deck.pop()!, state.deck.pop()!);
  } else {
    state.board.push(state.deck.pop()!);
  }

  const liveActors = state.players.filter(canAct);
  if (liveActors.length === 0) {
    showdown(state);
    return "hand-end";
  }

  const first = nextSeatFrom(state.players, state.dealerIndex, (p) => canAct(p));
  if (first < 0) {
    showdown(state);
    return "hand-end";
  }
  state.actionIndex = first;
  state.message = state.phase === "flop" ? "翻牌" : state.phase === "turn" ? "转牌" : "河牌";
  return "continue";
}

function advanceAction(state: GameState): HandStep {
  const stillIn = state.players.filter((p) => !p.folded && !p.sittingOut);
  if (stillIn.length <= 1) {
    endHandByFold(state);
    return "hand-end";
  }
  if (stillIn.every((p) => p.allIn)) {
    showdown(state);
    return "hand-end";
  }

  if (bettingRoundComplete(state)) {
    return startNextPhase(state);
  }

  const next = nextSeatFrom(state.players, state.actionIndex, (p) => canAct(p));
  if (next < 0) {
    if (stillIn.every((p) => p.allIn || p.folded)) {
      showdown(state);
      return "hand-end";
    }
    return startNextPhase(state);
  }
  state.actionIndex = next;
  return "continue";
}

/** Move the hand forward after an action (or an all-in blind edge case). */
export function stepAfterAction(state: GameState): HandStep {
  if (state.handOver) return "hand-end";
  const stillIn = state.players.filter((p) => !p.folded && !p.sittingOut);
  if (stillIn.length <= 1) {
    endHandByFold(state);
    return "hand-end";
  }
  if (state.actionIndex < 0) {
    if (stillIn.every((p) => p.allIn)) {
      showdown(state);
      return "hand-end";
    }
    return startNextPhase(state);
  }
  return advanceAction(state);
}
