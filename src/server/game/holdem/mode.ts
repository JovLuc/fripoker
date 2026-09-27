// Hold'em GameMode adapter: binds the street engine to the room-facing
// GameMode interface. Snapshot building lives here because hole-card
// visibility and street fields are ruleset-specific.

import type { GameSnapshot, LegalActions } from "../../../shared/protocol.js";
import {
  createGameState,
  applyAction as engineApply,
  legalActionsFor,
  startHand as engineStart,
  stepAfterAction as engineStep,
} from "./handFlow.js";
import { botDecide } from "./bot.js";
import { describeHand } from "./evaluator.js";
import { endHandByFold as foldWin } from "./showdown.js";
import type { GameMode, CreateOptions } from "../core/mode.js";
import { basePlayerView, hiddenCards, requiredReadyList } from "../core/serialize.js";
import type { ApplyResult, BaseGame, BotDecision, HandStep, SeatSeed } from "../core/types.js";
import { narrow } from "../core/mode.js";
import type { GameState, Player } from "./types.js";

export const holdemMode: GameMode = {
  kind: "holdem",

  create(seats: SeatSeed[], opts?: CreateOptions): BaseGame {
    return createGameState(seats, { shortDeck: opts?.shortDeck });
  },

  startHand(g: BaseGame): HandStep {
    return engineStart(narrow<GameState>(g, "holdem"));
  },

  applyAction(g: BaseGame, action, amount): ApplyResult {
    return engineApply(narrow<GameState>(g, "holdem"), action, amount);
  },

  stepAfterAction(g: BaseGame): HandStep {
    return engineStep(narrow<GameState>(g, "holdem"));
  },

  legalActionsFor(g: BaseGame, playerId: string): LegalActions | null {
    return legalActionsFor(narrow<GameState>(g, "holdem"), playerId);
  },

  botDecide(g: BaseGame, playerId: string): BotDecision | null {
    return botDecide(narrow<GameState>(g, "holdem"), playerId);
  },

  endHandByFold(g: BaseGame): void {
    foldWin(narrow<GameState>(g, "holdem"));
  },

  serialize(g: BaseGame, viewerId: string, readyIds: ReadonlySet<string>): GameSnapshot {
    const state = narrow<GameState>(g, "holdem");
    const actionActor = state.actionIndex >= 0 ? state.players[state.actionIndex] : null;

    const players = state.players.map((p: Player) => {
      const isMe = p.id === viewerId;
      const revealHole = p.holeCards.length > 0 && (isMe || state.revealAll);
      let handLabel = "";
      if (revealHole && p.holeCards.length === 2 && !p.folded && !p.sittingOut) {
        handLabel = describeHand(p.holeCards, state.board, state.shortDeck);
      }
      return basePlayerView(p, viewerId, readyIds, {
        holeCards: revealHole
          ? p.holeCards.map((c) => c.code)
          : p.holeCards.length > 0
            ? hiddenCards(2)
            : [],
        handLabel,
        extras: { isDealer: p.isDealer, isSB: p.isSB, isBB: p.isBB },
      });
    });

    return {
      kind: "holdem",
      handId: state.handId,
      phase: state.phase,
      board: state.board.map((c) => c.code),
      pot: state.pot,
      currentBet: state.currentBet,
      smallBlind: state.smallBlind,
      bigBlind: state.bigBlind,
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
