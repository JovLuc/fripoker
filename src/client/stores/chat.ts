// Chat log (server keeps the last 80; chatTotal counts everything ever)
// plus the floating dock's open/input state.

import { nextTick, ref } from "vue";
import type { ChatMessage } from "../../shared/protocol.js";

export const chat = ref<ChatMessage[]>([]);
export const chatTotal = ref(0);
export const chatOpen = ref(false);
export const chatInput = ref("");

export function applyChat(list: ChatMessage[], total: number | undefined): void {
  chat.value = list || [];
  chatTotal.value = total != null ? total : chat.value.length;
  if (chatOpen.value) scrollChatToBottom();
}

export function toggleChat(): void {
  chatOpen.value = !chatOpen.value;
  if (chatOpen.value) scrollChatToBottom();
}

export function scrollChatToBottom(): void {
  void nextTick(() => {
    const el = document.getElementById("chat-log");
    if (el) el.scrollTop = el.scrollHeight;
  });
}
