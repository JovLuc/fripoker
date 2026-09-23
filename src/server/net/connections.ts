// Connection context: per-socket identity (playerId / nickname / roomId) used
// to live as dynamic properties on the ws object — now a first-class wrapper
// with typed send helpers.

import type { WebSocket } from "ws";
import type { ServerMessage } from "../../shared/protocol.js";
import { rid } from "../util/id.js";

export class ClientConn {
  playerId: string | null = null;
  nickname: string | null = null;
  roomId: string | null = null;
  /** Stable viewer identity for spectator snapshots (was random per broadcast). */
  readonly spectatorViewId = `spectator_${rid(4)}`;

  constructor(private readonly ws: WebSocket) {}

  get open(): boolean {
    return this.ws.readyState === this.ws.OPEN;
  }

  send(msg: ServerMessage): void {
    if (this.open) this.ws.send(JSON.stringify(msg));
  }

  sendError(message: string): void {
    this.send({ type: "error", payload: { message } });
  }

  close(): void {
    this.ws.close();
  }
}
