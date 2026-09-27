// Three-card (tp) engine types. Extends the shared core skeletons.

import type { TpPhase } from "../../../shared/protocol.js";
import type { BaseGame, BasePlayer } from "../core/types.js";

export interface TpPlayer extends BasePlayer {
  /** Peeked this hand — public, and every bet costs 2× face value. */
  looked: boolean;
  /** Cards were shown to everyone (compare resolution). */
  revealed: boolean;
}

export interface TpState extends BaseGame {
  kind: "tp";
  phase: TpPhase;
  players: TpPlayer[];
  /** Bet base N (currentBet): blind pays N per action, peeked pays 2N. */
  /** Winner of the previous hand — they take the button (庄) next hand. */
  lastWinnerId: string | null;
}
