// Typed WebSocket client: auto-reconnect, message dispatch, and a
// promise-based awaitType() that replaces the old temporary-listener race
// around setNickname → profile.

import type { ClientMessage, ServerMessage } from "../../shared/protocol.js";

type MessageListener = (msg: ServerMessage) => void;

interface TypeWaiter {
  test: (msg: ServerMessage) => boolean;
  resolve: (msg: ServerMessage) => void;
  timer: number;
}

function wsUrl(): string {
  // Under `vite` dev the page is served from the dev server; the WS always
  // belongs to the node server on :3000 (override with VITE_DEV_WS_URL).
  if (import.meta.env.DEV) {
    return (import.meta.env.VITE_DEV_WS_URL as string | undefined) ?? `ws://${location.hostname}:3000/`;
  }
  const proto = location.protocol === "https:" ? "wss" : "ws";
  // Directory prefix for reverse proxy (e.g. /fpk) — nginx location /fpk/
  // needs the trailing slash.
  let base = location.pathname.replace(/\/index\.html?$/i, "");
  base = base.replace(/\/+$/, "");
  if (!base || base === ".") {
    return `${proto}://${location.host}/`;
  }
  return `${proto}://${location.host}${base}/`;
}

export class WsClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private stopped = false;
  private readonly listeners = new Set<MessageListener>();
  private readonly openListeners = new Set<() => void>();
  private readonly typeWaiters: TypeWaiter[] = [];

  connect(): void {
    this.stopped = false;
    this.clearReconnect();
    const ws = new WebSocket(wsUrl());
    this.ws = ws;
    ws.onopen = () => {
      for (const fn of this.openListeners) fn();
    };
    ws.onmessage = (ev: MessageEvent) => {
      let msg: ServerMessage | null = null;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      if (!msg || typeof msg.type !== "string") return;
      for (const p of this.pending(msg)) p.resolve(msg);
      for (const fn of this.listeners) fn(msg);
    };
    ws.onclose = () => {
      if (!this.stopped) this.reconnectTimer = window.setTimeout(() => this.connect(), 1500);
    };
  }

  /** Stop reconnecting and drop the socket (used on unmount / tests). */
  disconnect(): void {
    this.stopped = true;
    this.clearReconnect();
    this.ws?.close();
    this.ws = null;
  }

  get connected(): boolean {
    return this.ws != null && this.ws.readyState === WebSocket.OPEN;
  }

  send(msg: ClientMessage): void {
    if (this.connected) this.ws!.send(JSON.stringify(msg));
  }

  onMessage(fn: MessageListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onOpen(fn: () => void): () => void {
    this.openListeners.add(fn);
    return () => this.openListeners.delete(fn);
  }

  /** Resolve on the next message matching `test` (first match wins). */
  awaitType<T extends ServerMessage["type"]>(
    type: T,
    timeoutMs = 3000,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    return new Promise((resolve, reject) => {
      const waiter: TypeWaiter = {
        test: (m) => m.type === type,
        resolve: (m) => {
          window.clearTimeout(waiter.timer);
          resolve(m as Extract<ServerMessage, { type: T }>);
        },
        timer: 0,
      };
      waiter.timer = window.setTimeout(() => {
        const i = this.typeWaiters.indexOf(waiter);
        if (i >= 0) this.typeWaiters.splice(i, 1);
        reject(new Error(`waiting for "${type}" timed out`));
      }, timeoutMs);
      this.typeWaiters.push(waiter);
    });
  }

  private *pending(msg: ServerMessage) {
    for (let i = this.typeWaiters.length - 1; i >= 0; i--) {
      if (this.typeWaiters[i].test(msg)) yield this.typeWaiters.splice(i, 1)[0];
    }
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

export const ws = new WsClient();
