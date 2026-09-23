// End-to-end smoke: a real server app + real WebSocket clients playing a
// scripted flow — create/join/start, fold through hand 1, ready → auto deal,
// reconnect a seat, chat cheats, and static serving under the /fpk alias.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { ClientMessage, RoomSnapshot, ServerMessage } from "../../shared/protocol.js";
import { createServerApp } from "../app.js";
import type { ServerApp } from "../app.js";
import type { ServerConfig } from "../config.js";

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

function testConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    port: 0,
    basePath: "",
    staticRoot: null,
    botDelay: { min: 2, max: 8 },
    ...overrides,
  };
}

const until = async (pred: () => boolean, timeoutMs = 8000, what = "condition"): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`timeout waiting for ${what}`);
};

class TestClient {
  readonly ws: WebSocket;
  private readonly queue: ServerMessage[] = [];
  private readonly waiters: { test: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];
  lastRoom: RoomSnapshot | null = null;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on("message", (raw) => {
      let msg: ServerMessage | null = null;
      try {
        msg = JSON.parse(raw.toString()) as ServerMessage;
      } catch {
        return;
      }
      if (!msg) return;
      if (msg.type === "room") this.lastRoom = msg.payload;
      const idx = this.waiters.findIndex((w) => w.test(msg!));
      if (idx >= 0) this.waiters.splice(idx, 1)[0].resolve(msg);
      else this.queue.push(msg);
    });
  }

  static connect(port: number): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
      ws.once("open", () => resolve(new TestClient(ws)));
      ws.once("error", reject);
    });
  }

  send(msg: ClientMessage): void {
    this.ws.send(JSON.stringify(msg));
  }

  /** Wait for the next message of a type (scanning already-queued ones). */
  next<T extends ServerMessage["type"]>(type: T, timeoutMs = 5000): Promise<Extract<ServerMessage, { type: T }>> {
    const queued = this.queue.findIndex((m) => m.type === type);
    if (queued >= 0) {
      return Promise.resolve(this.queue.splice(queued, 1)[0] as Extract<ServerMessage, { type: T }>);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.waiters.indexOf(waiter);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new Error(`timeout waiting for "${type}"`));
      }, timeoutMs);
      const waiter = {
        test: (m: ServerMessage) => m.type === type,
        resolve: (m: ServerMessage) => {
          clearTimeout(timer);
          resolve(m as Extract<ServerMessage, { type: T }>);
        },
      };
      this.waiters.push(waiter);
    });
  }

  async roomWhere(pred: (snap: RoomSnapshot) => boolean, timeoutMs = 8000, what = "snapshot"): Promise<RoomSnapshot> {
    await until(() => this.lastRoom != null && pred(this.lastRoom), timeoutMs, what);
    return this.lastRoom!;
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.ws.once("close", resolve);
      this.ws.close();
    });
  }

  terminate(): void {
    this.ws.terminate();
  }
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
    });
    await lobbyWatcher.close();

    // non-host cannot start
    bob.send({ type: "startGame" });
    const err = await bob.next("error");
    expect(err.payload.message).toBe("只有房主可以开局");

    alice.send({ type: "startGame" });
    const snap = await alice.roomWhere((s) => s.game != null, 8000, "game start");
    expect(snap.status).toBe("playing");
    expect(snap.game!.players).toHaveLength(6); // 2 humans + 4 bots
    expect(snap.game!.phase).toBe("preflop");
    expect(snap.game!.message).toBe("第 1 手 · 10/20");
    // holes visible only to their owner
    const me = snap.game!.players.find((p) => p.isMe)!;
    expect(me.holeCards).toHaveLength(2);
    expect(me.holeCards[0]).not.toBe("back");
    const other = snap.game!.players.find((p) => !p.isMe && !p.isBot)!;
    expect(other.holeCards).toEqual(["back", "back"]);
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
    expect(total).toBe(2000 * 6);

    // ready flow: alice readies and waits, bob readies → auto next hand
    alice.send({ type: "ready" });
    await alice.roomWhere((s) => s.game!.requiredReady.some((r) => r.id === "p_alice" && r.ready), 5000, "alice ready flag");
    bob.send({ type: "ready" });
    await bob.roomWhere((s) => s.game!.handId === 2, 8000, "hand 2 deal");
    expect(bob.lastRoom!.game!.handOver).toBe(false);
  });

  it("chat cheat borrows and repays", async () => {
    alice.send({ type: "chat", payload: { text: "爸爸" } });
    await alice.roomWhere(
      (s) => s.game!.players.find((p) => p.id === "p_alice")!.debt === 200,
      5000,
      "borrow reflected",
    );
    const snap = alice.lastRoom!;
    const me = snap.game!.players.find((p) => p.id === "p_alice")!;
    expect(me.chips).toBeGreaterThan(0);
    expect(snap.chatTotal).toBeGreaterThan(0);
    expect(snap.chat.some((m) => m.playerId === "system" && m.text.includes("借款"))).toBe(true);

    alice.send({ type: "chat", payload: { text: "还钱" } });
    await alice.roomWhere(
      (s) => s.game!.players.find((p) => p.id === "p_alice")!.debt === 0,
      5000,
      "repay reflected",
    );
  });

  it("host toggles room cheats from the room page", async () => {
    // non-host cannot toggle
    bob.send({ type: "setCheat", payload: { enabled: false } });
    const err = await bob.next("error");
    expect(err.payload.message).toBe("只有房主可以切换作弊");

    // host switches off → snapshot reflects, chat cheats stop working
    alice.send({ type: "setCheat", payload: { enabled: false } });
    await alice.roomWhere((s) => s.cheatEnabled === false, 5000, "cheat off");
    alice.send({ type: "chat", payload: { text: "爷爷" } });
    await alice.roomWhere(
      (s) => s.game!.players.find((p) => p.id === "p_alice")!.debt === 0,
      5000,
      "no borrow while off",
    );

    // back on
    alice.send({ type: "setCheat", payload: { enabled: true } });
    await alice.roomWhere((s) => s.cheatEnabled === true, 5000, "cheat on");
  });

  it("reconnect reclaims the seat via saved playerId", async () => {
    await bob.terminate();
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
    await bob2.close();
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
