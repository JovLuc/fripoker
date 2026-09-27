// GameHost: room ↔ engine orchestration — start the game, route player
// actions, run the ready→deal flow, schedule bots, and broadcast after every
// step. All ruleset knowledge flows through getMode(room.kind); this file
// never imports a concrete engine. Owns the room's single timer (bot delay).

import type { PlayerActionName } from "../../shared/protocol.js";
import type { BotDelay } from "../config.js";
import { endGameIfBusted, noteBusted, playersWithChips } from "../game/core/economy.js";
import type { BaseGame, HandStep } from "../game/core/types.js";
import { getMode } from "../game/registry.js";
import type { Room } from "./room.js";
import type { RoomRegistry } from "./roomManager.js";

export interface RoomEvents {
  /** Snapshot broadcast to everyone in the room. */
  broadcastRoom(room: Room): void;
  /** Lobby room-list refresh. */
  roomsChanged(): void;
}

export type HostResult = { ok: true; waiting?: true } | { ok: false; error: string };

export class GameHost {
  constructor(
    private readonly registry: RoomRegistry,
    private readonly events: RoomEvents,
    private readonly botDelay: BotDelay,
  ) {}

  startGame(room: Room): HostResult {
    if (room.status === "playing") return { ok: false, error: "已开局" };
    const mode = getMode(room.kind);
    const seats = [
      ...room.humanPlayers.map((p) => ({ id: p.id, name: p.name, isBot: false })),
      ...room.botPlayers.map((p) => ({ id: p.id, name: p.name, isBot: true })),
    ];
    if (seats.length < 2) return { ok: false, error: "人数不足 · 至少 2 名玩家，可先添加机器人" };
    room.game = mode.create(seats, { shortDeck: room.shortDeck });
    room.status = "playing";
    room.readyIds = new Set();
    const result = mode.startHand(room.game);
    this.events.broadcastRoom(room);
    this.afterStep(room, result);
    return { ok: true };
  }

  /** Mark ready; when every funded seat is ready, deal the next hand. */
  playerReady(room: Room, playerId: string): HostResult {
    if (room.status !== "playing" || !room.game) return { ok: false, error: "对局未开始" };
    const g = room.game;
    if (!g.handOver) return { ok: false, error: "本手尚未结束" };
    const player = g.players.find((p) => p.id === playerId);
    if (!player) return { ok: false, error: "你不在对局中" };
    if (player.chips <= 0) return { ok: false, error: "余额为0，先借钱才能准备" };

    room.readyIds.add(playerId);
    this.events.broadcastRoom(room);
    if (allRequiredReady(room)) {
      return this.startNextHand(room);
    }
    return { ok: true, waiting: true };
  }

  playerAction(
    room: Room,
    playerId: string,
    action: PlayerActionName,
    amount?: number,
    targetId?: string,
  ): HostResult {
    if (room.status !== "playing" || !room.game) return { ok: false, error: "对局未开始" };
    const g = room.game;
    if (g.handOver) return { ok: false, error: "本手已结束" };
    const idx = g.players.findIndex((p) => p.id === playerId);
    if (idx < 0) return { ok: false, error: "你不在对局中" };
    if (g.actionIndex !== idx) return { ok: false, error: "还没轮到你" };

    const mode = getMode(g.kind);
    const res = mode.applyAction(g, action, amount, targetId);
    if (!res.ok) return res;
    if (res.advance === false) {
      // applied without consuming the turn (three-card peek) — just publish
      this.events.broadcastRoom(room);
      return { ok: true };
    }
    const result = mode.stepAfterAction(g);
    this.events.broadcastRoom(room);
    this.afterStep(room, result);
    return { ok: true };
  }

  /**
   * A seated human left a playing room. There is no action timeout, so the
   * hand must not wait on them: fold them at once (engine-routed when it is
   * their turn), mark `left` so every future deal sits them out.
   */
  handleDeparture(room: Room, playerId: string): void {
    const g = room.game;
    if (!g) return;
    const player = g.players.find((p) => p.id === playerId);
    if (!player || player.left) return;
    player.left = true;
    const mode = getMode(g.kind);

    if (g.handOver || player.folded) {
      this.events.broadcastRoom(room);
      return;
    }

    player.folded = true;
    player.acted = true;
    player.lastAction = "fold";

    // their turn: route through the engine so the action advances / hand ends
    if (g.actionIndex >= 0 && g.players[g.actionIndex].id === playerId) {
      const result = mode.stepAfterAction(g);
      this.events.broadcastRoom(room);
      this.afterStep(room, result);
      return;
    }

    // not their turn: a silent fold can leave a single contender — end by fold
    const stillIn = g.players.filter((p) => !p.folded && !p.sittingOut);
    if (stillIn.length <= 1) {
      mode.endHandByFold(g);
      this.events.broadcastRoom(room);
      this.afterStep(room, "hand-end");
      return;
    }
    this.events.broadcastRoom(room);
  }

  private startNextHand(room: Room): HostResult {
    if (room.status !== "playing" || !room.game) return { ok: false, error: "对局未开始" };
    if (room.game.gameOver) return { ok: false, error: "对局已结束" };
    if (!room.game.handOver) return { ok: false, error: "本手尚未结束" };
    if (playersWithChips(room.game).length < 2) return { ok: false, error: "可继续的玩家不足" };
    if (!allRequiredReady(room)) return { ok: false, error: "还有人未准备" };
    const mode = getMode(room.game.kind);
    const result = mode.startHand(room.game);
    room.readyIds = new Set();
    if (room.game.gameOver) {
      this.events.broadcastRoom(room);
      return { ok: true };
    }
    this.events.broadcastRoom(room);
    this.afterStep(room, result);
    return { ok: true };
  }

  /** Post-step hook: bust bookkeeping on hand end, bot scheduling on continue. */
  private afterStep(room: Room, result: HandStep): void {
    if (!room.game) return;
    if (result === "hand-end") {
      // Busts sit out; match continues while ≥2 seats still have chips.
      const added = noteBusted(room.game);
      room.readyIds = new Set();
      if (endGameIfBusted(room.game)) {
        this.events.broadcastRoom(room);
        return;
      }
      if (added.length) {
        const names = added.map((p) => p.name).join("、");
        room.game.message = `${names} 已破产 · 剩余玩家准备下一局`;
      }
      // wait until all chips>0 players ready — then auto-deal
      this.events.broadcastRoom(room);
      return;
    }
    this.scheduleBot(room, this.botDelay.min + Math.floor(Math.random() * (this.botDelay.max - this.botDelay.min)));
  }

  private scheduleBot(room: Room, delay: number): void {
    if (room.botTimer) {
      clearTimeout(room.botTimer);
      room.botTimer = null;
    }
    room.botTimer = setTimeout(() => {
      room.botTimer = null;
      this.runBotIfNeeded(room);
    }, delay);
  }

  private runBotIfNeeded(room: Room): void {
    if (room.status !== "playing" || !room.game) return;
    const g: BaseGame = room.game;
    if (g.handOver || g.actionIndex < 0) return;
    const actor = g.players[g.actionIndex];
    if (!actor || !actor.isBot) return;

    const mode = getMode(g.kind);
    const decision = mode.botDecide(g, actor.id) ?? { action: "check" as const };
    const res = mode.applyAction(g, decision.action, decision.amount, decision.targetId);
    if (!res.ok) return; // invariant: bot decisions are legal (tested)
    if (res.advance === false) {
      // peeked — publish, then let the bot take its real action next tick
      this.events.broadcastRoom(room);
      this.scheduleBot(room, this.botDelay.min + Math.floor(Math.random() * (this.botDelay.max - this.botDelay.min)));
      return;
    }
    const result = mode.stepAfterAction(g);
    this.events.broadcastRoom(room);
    this.afterStep(room, result);
  }
}

function allRequiredReady(room: Room): boolean {
  if (!room.game) return false;
  const req = room.game.players.filter((p) => p.chips > 0 && !p.left);
  if (req.length < 2) return false;
  return req.every((p) => p.isBot || room.readyIds.has(p.id));
}
