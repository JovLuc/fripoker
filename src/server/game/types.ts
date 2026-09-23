// Pure Hold'em engine types. This module is the engine's boundary:
// it may import from shared/ (wire types) but nothing else outside game/.
// No I/O, no rooms, no timers, no action timeout — by design.

import type { HandResultLine, PlayerActionName } from "../../shared/protocol.js";

export type Suit = "s" | "h" | "d" | "c";
export type Rank =
  | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "T" | "J" | "Q" | "K" | "A";

export interface Card {
  rank: Rank;
  suit: Suit;
  /** Wire form like "As" (rank + upper-case suit letter). */
  code: string;
}

export type LastAction = PlayerActionName;

export interface Player {
  id: string;
  name: string;
  isBot: boolean;
  /** 0..5 — the players-array index IS the seat. */
  seat: number;
  chips: number;
  holeCards: Card[];
  /** Committed on the current street. */
  roundBet: number;
  /** Committed this whole hand (side-pot layering key). */
  totalBet: number;
  folded: boolean;
  allIn: boolean;
  /** Acted on the current street; reset on others by a full raise. */
  acted: boolean;
  isDealer: boolean;
  isSB: boolean;
  isBB: boolean;
  lastAction: LastAction | null;
  /** Busted, or rebought mid-hand — sits out until the next deal. */
  sittingOut: boolean;
  debt: number;
  /** Hands since last borrow: 0 = just borrowed, next deal charges no interest. */
  debtHands: number;
  /** One bust-log entry per bust episode; cleared on borrow. */
  bustLogged: boolean;
}

export type GamePhase = "idle" | "preflop" | "flop" | "turn" | "river" | "showdown";

export interface GameState {
  handId: number;
  phase: GamePhase;
  /** Fixed 6 seats (humans + bots); array index is the seat number. */
  players: Player[];
  board: Card[];
  /** Shuffled; dealt from the end via pop(). */
  deck: Card[];
  pot: number;
  currentBet: number;
  /** Latest raise increment (min-raise baseline); starts at the big blind. */
  lastRaiseSize: number;
  dealerIndex: number;
  sbIndex: number;
  bbIndex: number;
  actionIndex: number;
  handOver: boolean;
  gameOver: boolean;
  /** Showdown happened — every hole pair is revealed in snapshots. */
  revealAll: boolean;
  lastResults: HandResultLine[] | null;
  message: string;
  smallBlind: number;
  bigBlind: number;
  /** Append-only bust history; never cleared on rebuy/borrow. */
  busted: { id: string; name: string }[];
}

export type HandStep = "continue" | "hand-end";

export type ApplyResult = { ok: true } | { ok: false; error: string };
