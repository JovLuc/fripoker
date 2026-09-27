// End-to-end for the three-card room: create with kind → lobby shows it →
// start → both seats play to a showdown → ready → next hand → peek+fold.
// Also guards hold'em-only options (short deck) on tp rooms.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { RoomSnapshot, TpGameSnapshot } from "../../shared/protocol.js";
import { createServerApp } from "../app.js";
import type { ServerApp } from "../app.js";
import { TestClient, testConfig, until } from "./harness.js";

function tpGame(snap: RoomSnapshot): TpGameSnapshot {
  expect(snap.kind).toBe("tp");
  expect(snap.game).toBeTruthy();
  return snap.game as TpGameSnapshot;
}

/**
 * Peek once, then OPEN (compare) whenever legal, else pay the minimum —
 * hands converge via an open or a table-wide all-in, never via rounds.
 */
async function playHandToEnd(client: TestClient, peek = false): Promise<void> {
  let guard = 0;
  while (guard++ < 200) {
    const g = tpGame(client.lastRoom!);
    if (g.handOver) return;
    if (g.myLegal == null) {
      await until(
        () => tpGame(client.lastRoom!).handOver || tpGame(client.lastRoom!).myLegal != null,
        5000,
        "our turn",
      );
      continue;
    }
    const legal = g.myLegal!;
    const before = client.lastRoom;
    if (peek && legal.canLook) {
      client.send({ type: "action", payload: { action: "look" } });
      await until(() => tpGame(client.lastRoom!).myLegal?.canLook === false, 3000, "peeked");
      continue;
    }
    if (legal.canCompare) {
      const cur = tpGame(client.lastRoom!);
      const me = cur.players.find((p) => p.isMe)!;
      const target = cur.players.find(
        (p) => p.id !== me.id && p.inHand && !p.folded && p.looked === me.looked,
      );
      expect(target, "canCompare implies a same-state target").toBeTruthy();
      client.send({ type: "action", payload: { action: "compare", targetId: target!.id } });
    } else {
      client.send({ type: "action", payload: { action: "call" } });
    }
    await until(
      () => client.lastRoom !== before || tpGame(client.lastRoom!).handOver,
      5000,
      "action accepted",
    );
  }
  throw new Error("hand did not end within the action budget");
}

describe("e2e: three-card room", () => {
  let app: ServerApp;
  let port: number;
  let host: TestClient;
  let foe: TestClient;
  let roomId = "";

  beforeAll(async () => {
    app = createServerApp(testConfig());
    ({ port } = await app.listen());
  });

  afterAll(async () => {
    const safeClose = (c: TestClient | undefined) =>
      c && c.ws.readyState !== WebSocket.CLOSED ? c.close() : Promise.resolve();
    await safeClose(host);
    await safeClose(foe);
    await app?.close();
  });

  it("creates a tp room, surfaces kind in the lobby, and rejects hold'em toggles", async () => {
    host = await TestClient.connect(port);
    host.send({ type: "setNickname", payload: { nickname: "庄家", playerId: "p_host" } });
    await host.next("profile");
    host.send({ type: "createRoom", payload: { name: "三张房", kind: "tp" } });
    const joined = await host.next("joined");
    roomId = joined.payload.roomId;
    const snap = await host.next("room");
    expect(snap.payload.kind).toBe("tp");

    const watcher = await TestClient.connect(port);
    watcher.send({ type: "listRooms" });
    const rooms = await watcher.next("rooms");
    expect(rooms.payload.find((r) => r.id === roomId)).toMatchObject({ kind: "tp" });
    await watcher.close();

    // short deck is a hold'em-only option
    host.send({ type: "setShortDeck", payload: { enabled: true } });
    const err = await host.next("error");
    expect(err.payload.message).toBe("该玩法不支持切换牌型");

    foe = await TestClient.connect(port);
    foe.send({ type: "setNickname", payload: { nickname: "对手", playerId: "p_foe" } });
    await foe.next("profile");
    foe.send({ type: "joinRoom", payload: { roomId } });
    await foe.next("joined");
  });

  it("deals hidden three-card hands and both seats play to a showdown", async () => {
    host.send({ type: "startGame" });
    await host.roomWhere((s) => s.game != null && s.status === "playing", 5000, "game started");
    await foe.roomWhere((s) => s.game != null, 5000, "foe sees the game");

    const g0 = tpGame(host.lastRoom!);
    expect(g0.kind).toBe("tp");
    expect(g0.ante).toBeGreaterThan(0);
    for (const p of g0.players) expect(p.holeCards).toHaveLength(3);
    const me = g0.players.find((p) => p.id === "p_host")!;
    expect(me.holeCards).toEqual(["back", "back", "back"]);

    // concurrent play: exactly one seat has myLegal at any time
    await Promise.all([playHandToEnd(host, true), playHandToEnd(foe, true)]);

    const g = tpGame(host.lastRoom!);
    expect(g.handOver).toBe(true);
    expect(g.phase).toBe("showdown");
    expect(g.pot).toBe(0);
    expect(g.lastResults!.length).toBeGreaterThanOrEqual(1);
    const hostView = g.players.find((p) => p.id === "p_host")!;
    expect(hostView.looked).toBe(true);
    expect(hostView.holeCards[0]).not.toBe("back");
    // ended by an open → loser revealed; ended by a table-wide all-in → table revealed
    if (!g.revealAll) expect(g.players.some((p) => p.revealed)).toBe(true);
  });

  it("both ready → deals hand 2; the button acts first and a fold ends it blind", async () => {
    host.send({ type: "ready" });
    foe.send({ type: "ready" });
    await host.roomWhere(
      (s) => s.game != null && (s.game as TpGameSnapshot).handId === 2 && !s.game.handOver,
      6000,
      "hand 2 deal",
    );
    const g = tpGame(host.lastRoom!);
    expect(g.handId).toBe(2);

    // Whoever holds the button (hand 1's winner) acts first — race both seats:
    // each peeks (host) / simply folds the moment it is its turn.
    const actWhenTurn = async (client: TestClient, fold: "peek-then-fold" | "fold"): Promise<void> => {
      await until(
        () =>
          client.lastRoom != null &&
          (tpGame(client.lastRoom).handOver || tpGame(client.lastRoom).myLegal != null),
        6000,
        "turn or hand end",
      );
      const cur = tpGame(client.lastRoom!);
      if (cur.handOver) return;
      if (fold === "peek-then-fold" && cur.myLegal!.canLook) {
        client.send({ type: "action", payload: { action: "look" } });
        await until(() => tpGame(client.lastRoom!).myLegal?.canLook === false, 3000, "peeked");
      }
      const before = client.lastRoom;
      client.send({ type: "action", payload: { action: "fold" } });
      await until(
        () => client.lastRoom !== before || tpGame(client.lastRoom!).handOver,
        4000,
        "fold accepted",
      );
    };
    await Promise.all([actWhenTurn(host, "peek-then-fold"), actWhenTurn(foe, "fold")]);

    await until(() => tpGame(host.lastRoom!).handOver, 4000, "hand 2 ends");
    const done = tpGame(host.lastRoom!);
    expect(done.handOver).toBe(true);
    expect(done.revealAll).toBe(false); // fold win: no table reveal
    expect(done.lastResults).toHaveLength(1);
  });
});
