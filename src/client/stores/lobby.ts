// Lobby room list.

import { ref } from "vue";
import type { RoomListItem } from "../../shared/protocol.js";

export const rooms = ref<RoomListItem[]>([]);
