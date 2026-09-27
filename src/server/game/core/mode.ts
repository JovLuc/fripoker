// GameMode: the ruleset seam between room orchestration and one game's engine.
// GameHost / serializer only ever see this interface + BaseGame — no game
// imports leak upward. Each ruleset registers one implementation in mode.ts.

import type {
  GameKind,
  GameSnapshot,
  LegalActions,
  PlayerActionName,
} from "../../../shared/protocol.js";
import type { ApplyResult, BaseGame, BotDecision, HandStep, SeatSeed } from "./types.js";

export interface CreateOptions {
  /** Hold'em only (36-card deck); other modes ignore it. */
  shortDeck?: boolean;
}

export interface GameMode {
  readonly kind: GameKind;

  /** Build table state from seat seeds (chips, deck, empty round fields). */
  create(seats: SeatSeed[], opts?: CreateOptions): BaseGame;

  /** Deal a new hand; returns whether play continues this hand. */
  startHand(g: BaseGame): HandStep;

  /** Apply the current actor's action. `advance:false` = applied, turn unchanged (peek). */
  applyAction(g: BaseGame, action: PlayerActionName, amount?: number, targetId?: string): ApplyResult;

  /** Move the hand forward after an applied action. */
  stepAfterAction(g: BaseGame): HandStep;

  /** Legal actions for the viewer, or null when it isn't their turn. */
  legalActionsFor(g: BaseGame, playerId: string): LegalActions | null;

  /** Ruleset bot decision; null when the seat shouldn't act. */
  botDecide(g: BaseGame, playerId: string): BotDecision | null;

  /** Everyone folded but one — award without reveal. */
  endHandByFold(g: BaseGame): void;

  /** Viewer-aware game snapshot (hole-card visibility per ruleset). */
  serialize(g: BaseGame, viewerId: string, readyIds: ReadonlySet<string>): GameSnapshot;
}

/** Kind-guard cast: modes receive BaseGame from GameHost and narrow it once. */
export function narrow<G extends BaseGame>(g: BaseGame, kind: GameKind): G {
  if (g.kind !== kind) {
    throw new Error(`game mode mismatch: expected ${kind}, got ${g.kind}`);
  }
  return g as G;
}
