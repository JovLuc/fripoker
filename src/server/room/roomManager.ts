// Room registry: owns the room map. Replaces the old exported mutable global.

import { MAX_PLAYERS } from "../../shared/constants.js";
import type { RoomListItem } from "../../shared/protocol.js";
import { rid } from "../util/id.js";
import { Room } from "./room.js";

export class RoomRegistry {
  private readonly rooms = new Map<string, Room>();

  create(opts: { name?: string; hostId: string; hostName: string }): Room {
    const id = rid(6).toLowerCase();
    const room = new Room({
      id,
      name: opts.name || `${opts.hostName} 的房间`,
      hostId: opts.hostId,
      hostName: opts.hostName,
    });
    this.rooms.set(id, room);
    return room;
  }

  get(id: string): Room | null {
    return this.rooms.get(id) ?? null;
  }

  list(): Room[] {
    return [...this.rooms.values()];
  }

  remove(room: Room): void {
    room.clearTimers();
    this.rooms.delete(room.id);
  }

  publicRoomList(): RoomListItem[] {
    return this.list().map((room) => ({
      id: room.id,
      name: room.name,
      hostName: room.hostName,
      status: room.status,
      humanCount: room.humanPlayers.length,
      maxPlayers: MAX_PLAYERS,
      humanNames: room.humanPlayers.map((p) => p.name),
      createdAt: room.createdAt,
    }));
  }
}
