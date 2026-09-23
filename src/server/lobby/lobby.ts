// Lobby: sockets currently watching the room list.

import type { RoomListItem, ServerMessage } from "../../shared/protocol.js";
import type { ClientConn } from "../net/connections.js";

export class LobbyHub {
  private readonly watchers = new Set<ClientConn>();

  add(conn: ClientConn): void {
    this.watchers.add(conn);
  }

  remove(conn: ClientConn): void {
    this.watchers.delete(conn);
  }

  broadcastRooms(list: RoomListItem[]): void {
    const msg: ServerMessage = { type: "rooms", payload: list };
    for (const conn of this.watchers) conn.send(msg);
  }
}
