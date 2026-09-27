// Shared e2e harness: server config factory, wait helper, and a scripted
// WebSocket client with typed message queues. Used by every e2e suite.

import type { ServerMessage, RoomSnapshot, ClientMessage } from "../../shared/protocol.js";
import type { ServerConfig } from "../config.js";
import WebSocket from "ws";

export function testConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    port: 0,
    basePath: "",
    staticRoot: null,
    botDelay: { min: 2, max: 8 },
    ...overrides,
  };
}

export const until = async (
  pred: () => boolean,
  timeoutMs = 8000,
  what = "condition",
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`timeout waiting for ${what}`);
};

export class TestClient {
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
