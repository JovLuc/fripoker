"use strict";
// MODULE: pure Hold'em engine — deal, blinds, actions, streets, hand rank,
// side pots, settlement. No I/O, no rooms, no timers (no action timeout).
// compareEval(a,b) > 0 means a is better. STARTING_CHIPS=2000, blinds 10/20.
// L2: server/AGENTS.md

const STARTING_CHIPS = 2000;
const SMALL_BLIND = 10;
const BIG_BLIND = 20;
const MAX_PLAYERS = 6;
const MIN_PLAYERS = 1;
const SUITS = ["s", "h", "d", "c"];
const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
const PHASES = ["preflop", "flop", "turn", "river"];
const RANK_VALUE = Object.fromEntries(RANKS.map((r, i) => [r, i + 2]));

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit, code: `${rank}${suit.toUpperCase()}` });
    }
  }
  return deck;
}

function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function straightHighFromRanks(rankSetInput) {
  const set = new Set(rankSetInput);
  if (set.has(14)) set.add(1);
  let run = 0;
  for (let r = 14; r >= 1; r--) {
    if (set.has(r)) {
      run += 1;
      if (run >= 5) return r + 4 > 14 && run === 5 && r >= 10 ? 14 : r + 4;
    } else {
      run = 0;
    }
  }
  if (set.has(14) && set.has(2) && set.has(3) && set.has(4) && set.has(5)) return 5;
  return 0;
}

function findStraightFlush(cards) {
  const bySuit = {};
  for (const c of cards) {
    if (!bySuit[c.suit]) bySuit[c.suit] = new Set();
    bySuit[c.suit].add(RANK_VALUE[c.rank]);
  }
  for (const suit of Object.keys(bySuit)) {
    const high = straightHighFromRanks(bySuit[suit]);
    if (high) return high;
  }
  return 0;
}

function evaluate7(cards) {
  const ranks = cards.map((c) => RANK_VALUE[c.rank]);
  const suitCounts = {};
  for (const c of cards) suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1;
  const flushSuit = Object.keys(suitCounts).find((s) => suitCounts[s] >= 5);

  const rankCounts = {};
  for (const r of ranks) rankCounts[r] = (rankCounts[r] || 0) + 1;
  const groups = Object.entries(rankCounts)
    .map(([rank, count]) => ({ rank: Number(rank), count }))
    .sort((a, b) => b.count - a.count || b.rank - a.rank);

  if (flushSuit) {
    const sf = findStraightFlush(cards.filter((c) => c.suit === flushSuit));
    if (sf) return { category: 8, tiebreak: [sf], name: "同花顺" };
  }

  if (groups[0]?.count === 4) {
    const quad = groups[0].rank;
    const kicker = Math.max(...ranks.filter((r) => r !== quad));
    return { category: 7, tiebreak: [quad, kicker], name: "四条" };
  }

  const trips = groups.filter((g) => g.count >= 3).map((g) => g.rank).sort((a, b) => b - a);
  const pairs = groups.filter((g) => g.count >= 2 && !trips.includes(g.rank) || g.count >= 3).map((g) => g.rank);
  // full house: trips + pair (a trips can also contribute pair)
  if (trips.length >= 1) {
    const trip = trips[0];
    const pairRanks = groups.filter((g) => g.count >= 2 && g.rank !== trip).map((g) => g.rank).sort((a, b) => b - a);
    if (trips.length >= 2) {
      const trip2 = trips[1];
      return { category: 6, tiebreak: [trip, trip2], name: "葫芦" };
    }
    if (pairRanks.length >= 1) {
      return { category: 6, tiebreak: [trip, pairRanks[0]], name: "葫芦" };
    }
  }

  if (flushSuit) {
    const flushRanks = [...new Set(cards.filter((c) => c.suit === flushSuit).map((c) => RANK_VALUE[c.rank]))]
      .sort((a, b) => b - a)
      .slice(0, 5);
    return { category: 5, tiebreak: flushRanks, name: "同花" };
  }

  const sh = straightHighFromRanks(ranks);
  if (sh) return { category: 4, tiebreak: [sh], name: "顺子" };

  if (trips.length >= 1) {
    const trip = trips[0];
    const kickers = ranks.filter((r) => r !== trip).sort((a, b) => b - a).slice(0, 2);
    return { category: 3, tiebreak: [trip, ...kickers], name: "三条" };
  }

  const pairRanks = groups.filter((g) => g.count >= 2).map((g) => g.rank).sort((a, b) => b - a);
  if (pairRanks.length >= 2) {
    const [p1, p2] = pairRanks;
    const kicker = Math.max(...ranks.filter((r) => r !== p1 && r !== p2));
    return { category: 2, tiebreak: [p1, p2, kicker], name: "两对" };
  }
  if (pairRanks.length === 1) {
    const p = pairRanks[0];
    const kickers = ranks.filter((r) => r !== p).sort((a, b) => b - a).slice(0, 3);
    return { category: 1, tiebreak: [p, ...kickers], name: "一对" };
  }

  const high = [...new Set(ranks)].sort((a, b) => b - a).slice(0, 5);
  return { category: 0, tiebreak: high, name: "高牌" };
}

// Returns >0 if a is better than b, <0 if b is better, 0 if tie.
function compareEval(a, b) {
  if (a.category !== b.category) return a.category - b.category;
  const len = Math.max(a.tiebreak.length, b.tiebreak.length);
  for (let i = 0; i < len; i++) {
    const av = a.tiebreak[i] ?? 0;
    const bv = b.tiebreak[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

// Best visible hand name for UI: preflop uses 2 cards only; flop+ uses full eval.
function describeHand(holeCards, board) {
  if (!holeCards || holeCards.length < 2) return "";
  if (board && board.length >= 3) {
    const all = [...holeCards, ...board];
    if (all.length >= 5) return evaluate7(all).name;
  }
  const a = RANK_VALUE[holeCards[0].rank];
  const b = RANK_VALUE[holeCards[1].rank];
  if (a === b) {
    const names = { 14: "A", 13: "K", 12: "Q", 11: "J", 10: "T" };
    const label = names[a] || String(a);
    return `一对 ${label}`;
  }
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  const rankName = (v) => ({ 14: "A", 13: "K", 12: "Q", 11: "J", 10: "T", 9: "9", 8: "8", 7: "7", 6: "6", 5: "5", 4: "4", 3: "3", 2: "2" }[v] || String(v));
  const suited = holeCards[0].suit === holeCards[1].suit;
  return `${rankName(hi)}${rankName(lo)}${suited ? "s" : ""} 高牌`;
}

function createPlayer(id, name, isBot, seat) {
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
    debt: 0,
    // hands since last borrow: 0 = just borrowed (no interest on next deal)
    debtHands: 0,
    // internal: one bust log per episode; cleared on borrow so next bust logs again
    _bustLogged: false,
  };
}

function canAct(p) {
  return !p.folded && !p.allIn && !p.sittingOut && p.chips > 0;
}

function nextSeatFrom(players, from, predicate) {
  const n = players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (from + i + n) % n;
    if (predicate(players[idx], idx)) return idx;
  }
  return -1;
}

function eligibleIndexes(state) {
  return state.players
    .map((p, i) => (p.chips > 0 && !p.sittingOut ? i : -1))
    .filter((i) => i >= 0);
}

function createGameState(humanPlayers) {
  const players = humanPlayers.map((p, i) => createPlayer(p.id, p.name, false, i));
  const botNames = ["东", "西", "南", "北", "中"];
  let botCount = 0;
  while (players.length < MAX_PLAYERS) {
    const seat = players.length;
    players.push(createPlayer(`bot_${seat}`, botNames[botCount % botNames.length], true, seat));
    botCount += 1;
  }

  return {
    handId: 0,
    phase: "idle",
    players,
    board: [],
    deck: shuffle(createDeck()),
    pot: 0,
    currentBet: 0,
    lastRaiseSize: BIG_BLIND,
    dealerIndex: -1,
    sbIndex: -1,
    bbIndex: -1,
    actionIndex: -1,
    actionDeadline: null,
    handOver: false,
    gameOver: false,
    revealAll: false,
    lastResults: null,
    message: "已开局，等待发牌",
    smallBlind: SMALL_BLIND,
    bigBlind: BIG_BLIND,
    showdownName: null,
    // append-only bust log for UI; never cleared on rebuy/borrow
    busted: [],
  };
}

function postBlind(state, index, amount) {
  const p = state.players[index];
  const pay = Math.min(amount, p.chips);
  p.chips -= pay;
  p.roundBet += pay;
  p.totalBet += pay;
  state.pot += pay;
  if (p.chips === 0) p.allIn = true;
}

function resetHand(state) {
  // Interest: skip the first deal after a fresh borrow (debtHands===0), then ×1.1 each hand.
  for (const p of state.players) {
    if (p.debt > 0) {
      if ((p.debtHands | 0) > 0) {
        // integer math: ceil(debt * 1.1) without float 1.1 rounding up
        p.debt = Math.ceil((p.debt * 11) / 10);
      }
      p.debtHands = (p.debtHands | 0) + 1;
    } else {
      p.debtHands = 0;
    }
  }
  state.board = [];
  state.deck = shuffle(createDeck());
  state.pot = 0;
  state.currentBet = 0;
  state.lastRaiseSize = BIG_BLIND;
  state.phase = "preflop";
  state.handOver = false;
  state.revealAll = false;
  state.lastResults = null;
  state.showdownName = null;

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
    // simple join rule: chips must be > 0 at deal time
    p.sittingOut = p.chips <= 0;
  }

  const elig = eligibleIndexes(state);
  if (elig.length < 2) {
    state.phase = "idle";
    state.gameOver = true;
    const left = state.players.filter((p) => p.chips > 0);
    const broke = state.players.filter((p) => p.chips <= 0).map((p) => p.name);
    state.message = left.length
      ? `对局结束 · ${broke.join("、")} 破产 · ${left[0].name} 赢家`
      : `对局结束 · ${broke.join("、")} 破产`;
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
    p.holeCards = [state.deck.pop(), state.deck.pop()];
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
  state.actionDeadline = null;
  state.message = `第 ${state.handId} 手 · ${SMALL_BLIND}/${BIG_BLIND}`;
  return true;
}

function legalActions(state) {
  const player = state.players[state.actionIndex];
  if (!player || !canAct(player)) return null;
  const needToCall = Math.max(0, state.currentBet - player.roundBet);
  const maxRaiseTo = player.roundBet + player.chips;
  let minRaiseTo;
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
  };
}

function commitChips(state, player, amount) {
  const pay = Math.min(Math.floor(amount), player.chips);
  player.chips -= pay;
  player.roundBet += pay;
  player.totalBet += pay;
  state.pot += pay;
  if (player.chips === 0) player.allIn = true;
  return pay;
}

function reopenAction(state, aggressor) {
  for (const p of state.players) {
    if (p !== aggressor && canAct(p)) p.acted = false;
  }
}

function applyAction(state, action, amount = 0) {
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

function bettingRoundComplete(state) {
  const contenders = state.players.filter((p) => !p.folded && !p.sittingOut);
  if (contenders.length <= 1) return true;
  const actors = contenders.filter(canAct);
  if (actors.length === 0) return true;
  const maxBet = Math.max(...contenders.map((p) => p.roundBet));
  return actors.every((p) => p.acted && (p.roundBet === maxBet || p.allIn));
}

function buildPots(state) {
  const withBet = state.players.filter((p) => p.totalBet > 0);
  if (withBet.length === 0) return [];
  const levels = [...new Set(withBet.map((p) => p.totalBet))].sort((a, b) => a - b);
  const pots = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const p of state.players) {
      const contrib = Math.min(p.totalBet, level) - Math.min(p.totalBet, prev);
      if (contrib > 0) amount += contrib;
    }
    const eligibleIds = state.players.filter((p) => !p.folded && p.totalBet >= level).map((p) => p.id);
    // eligible: contributed to this layer (totalBet > prev) and not folded
    const eligibleIds2 = state.players.filter((p) => !p.folded && p.totalBet > prev).map((p) => p.id);
    if (amount > 0) pots.push({ amount, eligibleIds: eligibleIds2 });
    prev = level;
  }
  return pots;
}

function dealRemainingBoard(state) {
  while (state.board.length < 5) {
    if (state.board.length === 0) {
      state.board.push(state.deck.pop(), state.deck.pop(), state.deck.pop());
    } else {
      state.board.push(state.deck.pop());
    }
  }
}

function awardPots(state) {
  const pots = buildPots(state);
  const evals = new Map();
  for (const p of state.players) {
    if (p.folded || p.holeCards.length < 2) continue;
    const all = [...p.holeCards, ...state.board];
    if (all.length >= 5) evals.set(p.id, evaluate7(all));
  }

  const wins = new Map();
  for (const pot of pots) {
    const elig = pot.eligibleIds.filter((id) => evals.has(id));
    if (elig.length === 0) continue;
    let best = evals.get(elig[0]);
    let winners = [elig[0]];
    for (let i = 1; i < elig.length; i++) {
      const c = compareEval(evals.get(elig[i]), best);
      if (c > 0) {
        best = evals.get(elig[i]);
        winners = [elig[i]];
      } else if (c === 0) {
        winners.push(elig[i]);
      }
    }
    const share = Math.floor(pot.amount / winners.length);
    let rem = pot.amount - share * winners.length;
    for (const id of winners) {
      const extra = rem > 0 ? 1 : 0;
      rem -= 1;
      const gain = share + extra;
      const player = state.players.find((p) => p.id === id);
      player.chips += gain;
      wins.set(id, (wins.get(id) || 0) + gain);
    }
  }

  state.lastResults = [...wins.entries()].map(([playerId, amount]) => {
    const player = state.players.find((p) => p.id === playerId);
    const ev = evals.get(playerId);
    return {
      playerId,
      name: player?.name || "",
      amount,
      hand: ev?.name || "",
    };
  });
  state.pot = 0;
  const parts = state.lastResults.map((r) => `${r.name} +${r.amount}${r.hand ? ` (${r.hand})` : ""}`);
  state.message = parts.length ? parts.join(" · ") : "本手结束";
}

function endHandByFold(state) {
  state.phase = "showdown";
  state.actionIndex = -1;
  state.actionDeadline = null;
  state.handOver = true;
  const winner = state.players.find((p) => !p.folded && !p.sittingOut);
  if (winner && state.pot > 0) {
    const gain = state.pot;
    winner.chips += gain;
    state.lastResults = [{ playerId: winner.id, name: winner.name, amount: gain, hand: "" }];
    state.message = `${winner.name} +${gain}（其他人弃牌）`;
    state.pot = 0;
  }
}

function showdown(state) {
  state.phase = "showdown";
  state.actionIndex = -1;
  state.actionDeadline = null;
  state.handOver = true;
  state.revealAll = true;
  dealRemainingBoard(state);
  awardPots(state);
}

function startNextPhase(state) {
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

  const idx = PHASES.indexOf(state.phase);
  if (idx < 0) {
    showdown(state);
    return "hand-end";
  }
  state.phase = PHASES[idx + 1];
  if (state.phase === "flop") {
    state.board.push(state.deck.pop(), state.deck.pop(), state.deck.pop());
  } else {
    state.board.push(state.deck.pop());
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
  state.actionDeadline = null;
  state.message = state.phase === "flop" ? "翻牌" : state.phase === "turn" ? "转牌" : "河牌";
  return "continue";
}

function advanceAction(state) {
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
  state.actionDeadline = null;
  return "continue";
}

function stepAfterAction(state) {
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

function startHand(state) {
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

function legalActionsFor(state, playerId) {
  const idx = state.players.findIndex((p) => p.id === playerId);
  if (idx < 0 || idx !== state.actionIndex) return null;
  return legalActions(state);
}

// Append-only: one log entry per bust episode (_bustLogged). History never cleared.
function noteBusted(state) {
  if (!state.busted) state.busted = [];
  const added = [];
  for (const p of state.players) {
    if (p.chips > 0) continue;
    if (p._bustLogged) continue;
    p._bustLogged = true;
    state.busted.push({ id: p.id, name: p.name });
    added.push({ id: p.id, name: p.name });
  }
  return added;
}

function playersWithChips(state) {
  return state.players.filter((p) => p.chips > 0);
}

// Borrow chips anytime (busted or not). Mid-hand busted seat stays out until next deal.
// Does NOT clear state.busted history.
function borrowChips(state, playerId, amount) {
  const chips = Math.floor(Number(amount));
  if (!Number.isFinite(chips) || chips <= 0) return { error: "非法金额" };
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { error: "你不在对局中" };

  const wasBusted = player.chips <= 0;
  player.chips += chips;
  player.debt = (player.debt || 0) + chips;
  player.debtHands = 0; // just borrowed — no interest on the next deal
  player._bustLogged = false;

  const midHand = !state.handOver && state.phase !== "idle";
  if (wasBusted && midHand) {
    player.sittingOut = true;
    player.folded = true;
    player.allIn = false;
    player.holeCards = [];
  } else if (wasBusted) {
    player.sittingOut = false;
    player.folded = false;
    player.allIn = false;
  }

  if (state.gameOver && playersWithChips(state).length >= 2) {
    state.gameOver = false;
    state.message = `${player.name} 重回战局`;
  }
  return {
    ok: true,
    action: "borrow",
    chips,
    wasBusted,
    debt: player.debt,
    midHand: wasBusted && midHand,
  };
}

// Each repay pays min(debt, REPAY_CHIPS); partial OK so compound debt can be cleared over clicks.
const REPAY_CHIPS = 500;

function repayDebt(state, playerId) {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { error: "你不在对局中" };
  const debt = player.debt || 0;
  if (debt <= 0) return { error: "无欠款" };
  const pay = Math.min(debt, REPAY_CHIPS);
  if (player.chips < pay) return { error: "余额不足" };
  player.chips -= pay;
  player.debt = debt - pay;
  if (player.debt === 0) player.debtHands = 0;
  return {
    ok: true,
    action: "repay",
    amount: pay,
    remaining: player.debt,
  };
}

module.exports = {
  STARTING_CHIPS,
  SMALL_BLIND,
  BIG_BLIND,
  MAX_PLAYERS,
  MIN_PLAYERS,
  createGameState,
  startHand,
  applyAction,
  stepAfterAction,
  legalActionsFor,
  legalActions,
  evaluate7,
  compareEval,
  describeHand,
  createDeck,
  shuffle,
  noteBusted,
  playersWithChips,
  borrowChips,
  repayDebt,
  REPAY_CHIPS,
};
