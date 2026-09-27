// Cross-game core: card representation, player/state skeletons shared by
// every ruleset, and the result types GameHost relies on. Pure — no I/O,
// no rooms, no timers (same contract the old game/ had).

import type { HandResultLine, PlayerActionName } from "../../../shared/protocol.js";

export type Suit = "s" | "h" | "d" | "c";
export type Rank =
  | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "T" | "J" | "Q" | "K" | "A";

export interface Card {
  rank: Rank;
  suit: Suit;
  /** Wire form like "As" (rank + upper-case suit letter). */
  code: string;
}

/** One seat seed at table creation; bots are decided by the room, not the engine. */
export interface SeatSeed {
  id: string;
  name: string;
  isBot: boolean;
}

/**
 * Player fields every game needs. Ruleset-specific extras (blind positions,
 * peeked flag) live on the concrete player types.
 */
export interface BasePlayer {
  id: string;
  name: string;
  isBot: boolean;
  /** 0..9 — the players-array index IS the seat. */
  seat: number;
  chips: number;
  holeCards: Card[];
  /** Committed on the current street/round. */
  roundBet: number;
  /** Committed this whole hand (side-pot layering key). */
  totalBet: number;
  folded: boolean;
  allIn: boolean;
  /** Acted on the current street/round; reset on others by a full raise. */
  acted: boolean;
  lastAction: PlayerActionName | null;
  /** Busted, or rebought mid-hand — sits out until the next deal. */
  sittingOut: boolean;
  /** Human left the room; sits out every future hand and cannot act. */
  left: boolean;
  debt: number;
  /** Hands since last borrow: 0 = just borrowed, next deal charges no interest. */
  debtHands: number;
  /** One bust-log entry per bust episode; cleared on borrow. */
  bustLogged: boolean;
}

/**
 * State fields GameHost / economy / serializers share across games.
 * Ruleset state extends this (streets, rounds, blinds …).
 */
export interface BaseGame {
  kind: "holdem" | "tp";
  handId: number;
  /** Ruleset-specific phase; narrow via `kind` before switching on values. */
  phase: string;
  players: BasePlayer[];
  /** Shuffled; dealt from the end via pop(). */
  deck: Card[];
  pot: number;
  currentBet: number;
  /** Button seat; -1 before the first deal. */
  dealerIndex: number;
  actionIndex: number;
  handOver: boolean;
  gameOver: boolean;
  /** Showdown happened — every in-play hole pair is revealed. */
  revealAll: boolean;
  lastResults: HandResultLine[] | null;
  message: string;
  /** Append-only bust history; never cleared on rebuy/borrow. */
  busted: { id: string; name: string }[];
}

export type HandStep = "continue" | "hand-end";

/**
 * `advance: false` = action applied but the turn does NOT move (three-card
 * peek). Undefined counts as true — hold'em actions always advance.
 */
export type ApplyResult = { ok: true; advance?: boolean } | { ok: false; error: string };

/** Shared bot decision shape; rulesets return subsets. */
export interface BotDecision {
  action: PlayerActionName;
  /** raise-TO face total, present only for action === "raise". */
  amount?: number;
  /** Compare target, present only for action === "compare". */
  targetId?: string;
}
