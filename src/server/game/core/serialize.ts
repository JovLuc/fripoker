// Snapshot building blocks shared by every mode's serialize(): the common
// PlayerView fields and required-ready list. Hole-card visibility stays in
// each mode (rulesets reveal differently).

import type { PlayerView, RequiredReadyPlayer } from "../../../shared/protocol.js";
import type { BaseGame, BasePlayer } from "./types.js";

export interface PlayerViewParts {
  /** Codes to send; empty = no cards yet. */
  holeCards: string[];
  handLabel: string;
  /** Extra mode fields (dealer badges, peeked, revealed …). */
  extras?: Partial<PlayerView>;
}

export function basePlayerView(
  p: BasePlayer,
  viewerId: string,
  readyIds: ReadonlySet<string>,
  parts: PlayerViewParts,
): PlayerView {
  return {
    id: p.id,
    name: p.name,
    seat: p.seat,
    isBot: p.isBot,
    chips: p.chips,
    roundBet: p.roundBet,
    folded: p.folded,
    allIn: p.allIn,
    sittingOut: p.sittingOut,
    left: p.left,
    debt: p.debt,
    ready: readyIds.has(p.id),
    busted: p.chips <= 0 && !p.allIn,
    isDealer: false,
    isSB: false,
    isBB: false,
    lastAction: p.lastAction,
    inHand: !p.folded && !p.sittingOut && p.holeCards.length > 0,
    holeCards: parts.holeCards,
    handLabel: parts.handLabel,
    isMe: p.id === viewerId,
    ...parts.extras,
  };
}

export function requiredReadyList(
  g: BaseGame,
  readyIds: ReadonlySet<string>,
): RequiredReadyPlayer[] {
  return g.players
    .filter((p) => p.chips > 0 && !p.left)
    .map((p) => ({ id: p.id, name: p.name, isBot: p.isBot, ready: p.isBot || readyIds.has(p.id) }));
}

/** Back-fill `n` face-down codes (["back","back"] for hold'em, 3 for tp). */
export function hiddenCards(n: number): string[] {
  return Array.from({ length: n }, () => "back");
}
