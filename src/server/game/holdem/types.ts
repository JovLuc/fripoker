// Hold'em engine types. Extends the shared core skeletons — everything
// game-specific (streets, blinds, positions) lives here. The engine boundary
// may import from shared/ and game/core/, nothing else.

import type { HoldemPhase } from "../../../shared/protocol.js";
import type { BaseGame, BasePlayer, Card } from "../core/types.js";

export type { Card, Rank, Suit } from "../core/types.js";
export type { HoldemPhase as GamePhase };

export interface Player extends BasePlayer {
  isDealer: boolean;
  isSB: boolean;
  isBB: boolean;
}

export interface GameState extends BaseGame {
  kind: "holdem";
  phase: HoldemPhase;
  players: Player[];
  board: Card[];
  /** Latest raise increment (min-raise baseline); starts at the big blind. */
  lastRaiseSize: number;
  sbIndex: number;
  bbIndex: number;
  smallBlind: number;
  bigBlind: number;
  /** Short deck (6+) rules: 36-card deck, straight>trips, flush>full house. */
  shortDeck: boolean;
}
