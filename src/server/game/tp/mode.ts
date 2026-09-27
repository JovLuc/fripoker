// Three-card GameMode adapter: binds the round engine to the room-facing
// GameMode interface. Snapshot visibility: own cards need a peek, compare
// losers are shown, the final showdown reveals every live hand.

import type { GameSnapshot, LegalActions } from "../../../shared/protocol.js";
import { TP_ANTE } from "../../../shared/constants.js";
import { basePlayerView, hiddenCards, requiredReadyList } from "../core/serialize.js";
import type { CreateOptions, GameMode } from "../core/mode.js";
import { narrow } from "../core/mode.js";
import type { ApplyResult, BaseGame, BotDecision, HandStep, SeatSeed } from "../core/types.js";
import { evaluate3 } from "./evaluator.js";
import {
  applyAction as engineApply,
  createTpGame,
  endByFold,
  legalActionsFor,
  startHand as engineStart,
  stepAfterAction as engineStep,
} from "./flow.js";
import { tpBotDecide } from "./bot.js";
import type { TpState } from "./types.js";

export const tpMode: GameMode = {
  kind: "tp",

  create(seats: SeatSeed[], _opts?: CreateOptions): BaseGame {
    return createTpGame(seats);
  },

  startHand(g: BaseGame): HandStep {
    return engineStart(narrow<TpState>(g, "tp"));
  },

  applyAction(g: BaseGame, action, amount, targetId): ApplyResult {
    return engineApply(narrow<TpState>(g, "tp"), action, amount, targetId);
  },

  stepAfterAction(g: BaseGame): HandStep {
    return engineStep(narrow<TpState>(g, "tp"));
  },

  legalActionsFor(g: BaseGame, playerId: string): LegalActions | null {
    return legalActionsFor(narrow<TpState>(g, "tp"), playerId);
  },

  botDecide(g: BaseGame, playerId: string): BotDecision | null {
    return tpBotDecide(narrow<TpState>(g, "tp"), playerId);
  },

  endHandByFold(g: BaseGame): void {
    endByFold(narrow<TpState>(g, "tp"));
  },

  serialize(g: BaseGame, viewerId: string, readyIds: ReadonlySet<string>): GameSnapshot {
    const state = narrow<TpState>(g, "tp");
    const actionActor = state.actionIndex >= 0 ? state.players[state.actionIndex] : null;

    const players = state.players.map((p) => {
      const isMe = p.id === viewerId;
      const reveal =
        p.revealed || (state.revealAll && !p.folded && !p.sittingOut) || (isMe && p.looked);
      const handLabel =
        reveal && p.holeCards.length === 3 ? evaluate3(p.holeCards).name : "";
      return basePlayerView(p, viewerId, readyIds, {
        holeCards:
          p.holeCards.length === 0 ? [] : reveal ? p.holeCards.map((c) => c.code) : hiddenCards(3),
        handLabel,
        extras: {
          looked: p.looked,
          revealed: p.revealed,
          isDealer: p.seat === state.dealerIndex,
          isSB: false,
          isBB: false,
        },
      });
    });

    return {
      kind: "tp",
      handId: state.handId,
      phase: state.phase,
      ante: TP_ANTE,
      pot: state.pot,
      currentBet: state.currentBet,
      message: state.message,
      handOver: state.handOver,
      gameOver: state.gameOver,
      readyIds: [...readyIds],
      requiredReady: requiredReadyList(state, readyIds),
      busted: state.busted.map((b) => ({ id: b.id, name: b.name })),
      actionPlayerId: actionActor ? actionActor.id : null,
      actionPlayerName: actionActor ? actionActor.name : null,
      lastResults: state.lastResults,
      revealAll: state.revealAll,
      dealerSeat: state.dealerIndex,
      players,
      myLegal: legalActionsFor(state, viewerId),
      iAmInGame: state.players.some((p) => p.id === viewerId),
    };
  },
};
