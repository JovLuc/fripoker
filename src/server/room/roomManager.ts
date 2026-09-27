// Room registry: owns the room map. Replaces the old exported mutable global.

import { MAX_PLAYERS } from "../../shared/constants.js";
import type { GameKind, RoomListItem } from "../../shared/protocol.js";
import { rid } from "../util/id.js";
import { Room } from "./room.js";

export class RoomRegistry {
  private readonly rooms = new Map<string, Room>();

  create(opts: { name?: string; kind?: GameKind; hostId: string; hostName: string }): Room {
    const id = rid(6).toLowerCase();
    const room = new Room({
      id,
      name: opts.name || `${opts.hostName} 的房间`,
      kind: opts.kind ?? "holdem",
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
    return this.list().map((room) => {
      // 离开者在对局中保留座位供断线重连（快照 humanPlayers 不动），
      // 但大厅人数不再把他们算进去——以引擎 append-only 的 Player.left 为准。
      const leftIds = new Set(
        (room.game?.players ?? []).filter((p) => p.left).map((p) => p.id),
      );
      const humans = room.humanPlayers.filter((p) => !leftIds.has(p.id));
      return {
        id: room.id,
        name: room.name,
        kind: room.kind,
        hostName: room.hostName,
        status: room.status,
        humanCount: humans.length,
        botCount: room.botPlayers.length,
        maxPlayers: MAX_PLAYERS,
        humanNames: humans.map((p) => p.name),
        createdAt: room.createdAt,
      };
    });
  }
}
