// End-to-end smoke: a real server app + real WebSocket clients playing a
// scripted flow — create/join/start, fold through hand 1, ready → auto deal,
// reconnect a seat, chat cheats, and static serving under the /fpk alias.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { STARTING_CHIPS, SMALL_BLIND, BIG_BLIND } from "../../shared/constants.js";
import { TestClient, testConfig, until } from "./harness.js";
import { createServerApp } from "../app.js";
import type { ServerApp } from "../app.js";

/** Status code of a raw HTTP request (fetch would normalize the URL first). */
function rawRequest(port: number, path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode ?? 0));
    });
    req.once("error", reject);
    req.end();
  });
}

describe("e2e: full room flow", () => {
  let app: ServerApp;
  let port: number;
  let alice: TestClient;
  let bob: TestClient;
  let roomId = "";

  beforeAll(async () => {
    app = createServerApp(testConfig());
    ({ port } = await app.listen());
  });

  afterAll(async () => {
    const safeClose = (c: TestClient | undefined) =>
      c && c.ws.readyState !== WebSocket.CLOSED ? c.close() : Promise.resolve();
    await safeClose(alice);
    await safeClose(bob);
    await app?.close();
  });

  it("nickname → create → join → start", async () => {
    alice = await TestClient.connect(port);
    alice.send({ type: "setNickname", payload: { nickname: "Alice", playerId: "p_alice" } });
    const profile = await alice.next("profile");
    expect(profile.payload.playerId).toBe("p_alice");

    alice.send({ type: "createRoom", payload: { name: "测试房" } });
    const joinedA = await alice.next("joined");
    expect(joinedA.payload.role).toBe("host");
    roomId = joinedA.payload.roomId;
    const snapA = await alice.next("room");
    expect(snapA.payload.status).toBe("waiting");
    expect(snapA.payload.humanPlayers).toHaveLength(1);

    bob = await TestClient.connect(port);
    bob.send({ type: "setNickname", payload: { nickname: "Bob", playerId: "p_bob" } });
    await bob.next("profile");
    bob.send({ type: "joinRoom", payload: { roomId } });
    const joinedB = await bob.next("joined");
    expect(joinedB.payload.role).toBe("player");

    // lobby list shows the room
    const lobbyWatcher = await TestClient.connect(port);
    lobbyWatcher.send({ type: "listRooms" });
    const rooms = await lobbyWatcher.next("rooms");
    expect(rooms.payload.find((r) => r.id === roomId)).toMatchObject({
      name: "测试房",
      status: "waiting",
      humanCount: 2,
      botCount: 0,
    });
    await lobbyWatcher.close();

    // bot seats: host-only, and remove-before-add errors
    bob.send({ type: "addBot" });
    const botErr = await bob.next("error");
    expect(botErr.payload.message).toBe("只有房主可以调整机器人");
    alice.send({ type: "removeBot" });
    const emptyErr = await alice.next("error");
    expect(emptyErr.payload.message).toBe("没有机器人");

    // host fills 4 bot seats, reflected in the snapshot and the lobby
    for (let i = 0; i < 4; i++) alice.send({ type: "addBot" });
    await alice.roomWhere((s) => s.botPlayers.length === 4, 5000, "4 bots seated");
    expect(alice.lastRoom!.botPlayers.map((b) => b.name)).toEqual(["东", "西", "南", "北"]);

    // non-host cannot start
    bob.send({ type: "startGame" });
    const err = await bob.next("error");
    expect(err.payload.message).toBe("只有房主可以开局");

    alice.send({ type: "startGame" });
    const snap = await alice.roomWhere((s) => s.game != null, 8000, "game start");
    expect(snap.status).toBe("playing");
    expect(snap.game!.players).toHaveLength(6); // 2 humans + 4 bots
    expect(snap.game!.phase).toBe("preflop");
    expect(snap.game!.message).toBe(`第 1 手 · ${SMALL_BLIND}/${BIG_BLIND}`);
    // holes visible only to their owner
    const me = snap.game!.players.find((p) => p.isMe)!;
    expect(me.holeCards).toHaveLength(2);
    expect(me.holeCards[0]).not.toBe("back");
    const other = snap.game!.players.find((p) => !p.isMe && !p.isBot)!;
    expect(other.holeCards).toEqual(["back", "back"]);

    // bot seats are frozen once the game runs
    alice.send({ type: "addBot" });
    const playingErr = await alice.next("error");
    expect(playingErr.payload.message).toBe("对局中不能调整机器人");
  });

  it("humans fold, bots finish hand 1, chips conserved", async () => {
    // Whichever human's turn it is, fold; bots battle it out to the end.
    let aliceFolded = false;
    let bobFolded = false;
    await until(() => {
      const g = alice.lastRoom?.game;
      if (!g || g.handId !== 1) return false;
      if (!g.handOver) {
        if (!aliceFolded && g.actionPlayerId === "p_alice") {
          aliceFolded = true;
          alice.send({ type: "action", payload: { action: "fold" } });
        }
        if (!bobFolded && g.actionPlayerId === "p_bob") {
          bobFolded = true;
          bob.send({ type: "action", payload: { action: "fold" } });
        }
      }
      return g.handOver;
    }, 15000, "hand 1 end");
    expect(aliceFolded).toBe(true);
    expect(bobFolded).toBe(true);
    const g = alice.lastRoom!.game!;
    expect(g.pot).toBe(0);
    expect(g.handOver).toBe(true);
    const total = g.players.reduce((sum, p) => sum + p.chips, 0);
    expect(total).toBe(STARTING_CHIPS * 6);

    // ready flow: alice readies and waits, bob readies → auto next hand
    alice.send({ type: "ready" });
    await alice.roomWhere((s) => s.game!.requiredReady.some((r) => r.id === "p_alice" && r.ready), 5000, "alice ready flag");
    bob.send({ type: "ready" });
    await bob.roomWhere((s) => s.game!.handId === 2, 8000, "hand 2 deal");
    expect(bob.lastRoom!.game!.handOver).toBe(false);
  });

  it("legacy chat loan phrases remain plain chat", async () => {
    const before = alice.lastRoom!.chatTotal;
    alice.send({ type: "chat", payload: { text: "爸爸" } });
    await alice.roomWhere((s) => s.chatTotal > before, 5000, "loan phrase chat received");
    let snap = alice.lastRoom!;
    expect(snap.chat.some((m) => m.playerId === "p_alice" && m.text === "爸爸")).toBe(true);
    expect(snap.game!.players.find((p) => p.id === "p_alice")!.debt).toBe(0);
    expect(snap.chat.some((m) => m.playerId === "system" && m.text.includes("借款"))).toBe(false);

    const afterBorrowPhrase = snap.chatTotal;
    alice.send({ type: "chat", payload: { text: "还钱" } });
    await alice.roomWhere((s) => s.chatTotal > afterBorrowPhrase, 5000, "repay phrase chat received");
    snap = alice.lastRoom!;
    expect(snap.chat.some((m) => m.playerId === "p_alice" && m.text === "还钱")).toBe(true);
    expect(snap.game!.players.find((p) => p.id === "p_alice")!.debt).toBe(0);
  });

  it("host toggles room cheats from the room page", async () => {
    // non-host cannot toggle
    bob.send({ type: "setCheat", payload: { enabled: false } });
    const err = await bob.next("error");
    expect(err.payload.message).toBe("只有房主可以切换作弊");

    // host switches off → snapshot reflects, chat cheats stop working
    alice.send({ type: "setCheat", payload: { enabled: false } });
    await alice.roomWhere((s) => !s.cheatEnabled, 5000, "cheat off");
    alice.send({ type: "chat", payload: { text: "爷爷" } });
    await alice.roomWhere(
      (s) => s.game!.players.find((p) => p.id === "p_alice")!.debt === 0,
      5000,
      "no borrow while off",
    );

    // back on
    alice.send({ type: "setCheat", payload: { enabled: true } });
    await alice.roomWhere((s) => s.cheatEnabled, 5000, "cheat on");
  });

  it("reconnect reclaims the seat via saved playerId", async () => {
    bob.terminate();
    await until(() => alice.lastRoom != null, 2000, "snapshot after bob drops");
    // seat kept while playing
    const seatKept = alice.lastRoom!.humanPlayers.some((p) => p.id === "p_bob");
    expect(seatKept).toBe(true);

    const bob2 = await TestClient.connect(port);
    bob2.send({ type: "setNickname", payload: { nickname: "Bob", playerId: "p_bob" } });
    await bob2.next("profile");
    bob2.send({ type: "joinRoom", payload: { roomId } });
    const joined = await bob2.next("joined");
    expect(joined.payload.role).toBe("player");
    const snap = await bob2.next("room");
    expect(snap.payload.game!.iAmInGame).toBe(true);
    expect(snap.payload.game!.players.find((p) => p.id === "p_bob")!.left).toBe(false);
    await bob2.close();
  });

  it("a lone host must add a bot before starting", async () => {
    const carol = await TestClient.connect(port);
    try {
      carol.send({ type: "setNickname", payload: { nickname: "Carol", playerId: "p_carol" } });
      await carol.next("profile");
      carol.send({ type: "createRoom", payload: {} });
      await carol.next("joined");

      carol.send({ type: "startGame" });
      const err = await carol.next("error");
      expect(err.payload.message).toBe("人数不足 · 至少 2 名玩家，可先添加机器人");

      carol.send({ type: "addBot" });
      await carol.roomWhere((s) => s.botPlayers.length === 1, 5000, "bot seated");
      carol.send({ type: "startGame" });
      const snap = await carol.roomWhere(
        (s) => s.game != null && s.game!.players.length === 2,
        8000,
        "1v1 deal",
      );
      expect(snap.game!.players.filter((p) => p.isBot)).toHaveLength(1);
      carol.send({ type: "leaveRoom" });
    } finally {
      await carol.close();
    }
  });

  it("leaving mid-game folds the leaver at once and sits them out", async () => {
    const app2 = createServerApp(testConfig());
    const { port: p2 } = await app2.listen();
    let h1: TestClient | undefined;
    let h2: TestClient | undefined;
    try {
      h1 = await TestClient.connect(p2);
      h1.send({ type: "setNickname", payload: { nickname: "H1", playerId: "p_h1" } });
      await h1.next("profile");
      h1.send({ type: "createRoom", payload: {} });
      await h1.next("joined");

      h2 = await TestClient.connect(p2);
      h2.send({ type: "setNickname", payload: { nickname: "H2", playerId: "p_h2" } });
      await h2.next("profile");
      h2.send({ type: "joinRoom", payload: { roomId: h1.lastRoom!.roomId } });
      await h2.next("joined");

      h1.send({ type: "startGame" });
      await h2.roomWhere((s) => s.game != null, 5000, "game start");

      h1.send({ type: "leaveRoom" });
      await h2.roomWhere(
        (s) => {
          const p1 = s.game!.players.find((p) => p.id === "p_h1")!;
          return p1.left && p1.folded;
        },
        5000,
        "h1 marked left+folded",
      );
      const snap = h2.lastRoom!;
      expect(snap.game!.players.find((p) => p.id === "p_h1")!.left).toBe(true);
      // departed seat is not required to ready the next hand
      expect(snap.game!.requiredReady.some((r) => r.id === "p_h1")).toBe(false);
      // seat is kept for reconnect (snapshot), but the lobby count drops them
      expect(snap.humanPlayers.some((p) => p.id === "p_h1")).toBe(true);
      const watcher = await TestClient.connect(p2);
      watcher.send({ type: "listRooms" });
      const rooms = await watcher.next("rooms");
      expect(rooms.payload.find((r) => r.id === snap.roomId)).toMatchObject({
        status: "playing",
        humanCount: 1,
        humanNames: ["H2"],
      });
      await watcher.close();
    } finally {
      const safeClose = (c: TestClient | undefined) =>
        c && c.ws.readyState !== WebSocket.CLOSED ? c.close() : Promise.resolve();
      await safeClose(h1);
      await safeClose(h2);
      await app2.close();
    }
  });

  it("short deck: default off, host toggle, mid-hand switch rejected, 36-card deal", async () => {
    const app3 = createServerApp(testConfig());
    const { port: p3 } = await app3.listen();
    let closer: TestClient | undefined;
    try {
      const host = await TestClient.connect(p3);
      closer = host;
      host.send({ type: "setNickname", payload: { nickname: "S1", playerId: "p_s1" } });
      await host.next("profile");
      host.send({ type: "createRoom", payload: {} });
      await host.next("joined");
      const fresh = await host.next("room");
      expect(fresh.payload.shortDeck).toBe(false);

      host.send({ type: "addBot" });
      await host.roomWhere((s) => s.botPlayers.length === 1, 5000, "bot seated");

      host.send({ type: "setShortDeck", payload: { enabled: true } });
      await host.roomWhere((s) => s.shortDeck, 5000, "short deck on");
      host.send({ type: "startGame" });
      await host.roomWhere((s) => s.game != null, 5000, "short-deck game start");

      // the idle host never acts, so the hand is guaranteed mid-flight here
      host.send({ type: "setShortDeck", payload: { enabled: false } });
      const err = await host.next("error");
      expect(err.payload.message).toBe("本手进行中，结束后才能切换牌型");

      // dealt cards carry no rank below 6
      const dealt = host.lastRoom!.game!.players.find((p) => p.id === "p_s1")!.holeCards;
      expect(dealt).toHaveLength(2);
      expect(dealt.every((c) => /^[6-9TJQKA]/.test(c))).toBe(true);

      // host folds when their turn comes; the bot takes the hand to the end
      let hostFolded = false;
      await until(() => {
        const g = host.lastRoom?.game;
        if (!g) return false;
        if (!g.handOver && !hostFolded && g.actionPlayerId === "p_s1") {
          hostFolded = true;
          host.send({ type: "action", payload: { action: "fold" } });
        }
        return g.handOver;
      }, 15000, "short-deck hand end");
      expect(hostFolded).toBe(true);
      const g = host.lastRoom!.game!;
      const total = g.players.reduce((sum, p) => sum + p.chips, 0);
      expect(total).toBe(STARTING_CHIPS * 2);

      // hand over: switching back (long deck) now goes through
      host.send({ type: "setShortDeck", payload: { enabled: false } });
      await host.roomWhere((s) => !s.shortDeck, 5000, "back to long deck");
    } finally {
      if (closer && closer.ws.readyState !== WebSocket.CLOSED) await closer.close();
      await app3.close();
    }
  });

  it("empty room is destroyed when everyone leaves", async () => {
    await alice.close();
    await until(() => app.registry.get(roomId) == null, 5000, "room destroyed");
    expect(app.registry.list()).toHaveLength(0);
  });
});

describe("e2e: static serving under prefixes", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "fripoker-static-"));
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "index.html"), "<!doctype html><title>fpk</title>");
    writeFileSync(join(dir, "assets", "app.js"), "console.log(1)");
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("serves at root by default", async () => {
    const app = createServerApp(testConfig({ staticRoot: dir }));
    const { port } = await app.listen();
    try {
      const index = await fetch(`http://127.0.0.1:${port}/`);
      expect(index.status).toBe(200);
      expect(index.headers.get("content-type")).toContain("text/html");
      expect(index.headers.get("cache-control")).toBe("no-cache");
      const js = await fetch(`http://127.0.0.1:${port}/assets/app.js`);
      expect(js.status).toBe(200);
      expect(js.headers.get("content-type")).toContain("text/javascript");
      // SPA fallback for unknown paths
      const spa = await fetch(`http://127.0.0.1:${port}/whatever`);
      expect(spa.status).toBe(200);
      expect(await spa.text()).toContain("fpk");
      // path traversal is blocked (raw socket — fetch would normalize ".." away)
      const evil = await rawRequest(port, "/%2e%2e/package.json");
      expect(evil).toBe(403);
    } finally {
      await app.close();
    }
  });

  it("serves under BASE_PATH", async () => {
    const app = createServerApp(testConfig({ staticRoot: dir, basePath: "/game" }));
    const { port } = await app.listen();
    try {
      const base = `http://127.0.0.1:${port}`;
      // bare prefix redirects to trailing slash
      const redirect = await fetch(`${base}/game`, { redirect: "manual" });
      expect(redirect.status).toBe(302);
      expect(redirect.headers.get("location")).toBe("/game/");
      const index = await fetch(`${base}/game/`);
      expect(index.status).toBe(200);
      const asset = await fetch(`${base}/game/assets/app.js`);
      expect(asset.status).toBe(200);
      // SPA fallback under prefix
      const spa = await fetch(`${base}/game/deep/link`);
      expect(spa.status).toBe(200);
    } finally {
      await app.close();
    }
  });
});
