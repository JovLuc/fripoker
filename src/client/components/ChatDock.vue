<script setup lang="ts">
import {
  chatDragging,
  chatPos,
  chatQuadrant,
  onChatDragStart,
  onChatToggleClick,
} from "../composables/useChatDock.js";
import { chat, chatInput, chatOpen, chatTotal } from "../stores/chat.js";
import { sendChatText } from "../stores/session.js";
</script>

<template>
  <!-- floating chat: default top-right, draggable button, panel hangs off the button -->
  <div
    class="chat-dock"
    :class="{
      open: chatOpen,
      placed: chatPos != null,
      dragging: chatDragging,
      ['q-' + chatQuadrant]: true,
    }"
    :style="chatPos ? { top: chatPos.y + 'px', left: chatPos.x + 'px' } : undefined"
  >
    <button
      class="chat-toggle"
      type="button"
      @pointerdown="onChatDragStart"
      @click="onChatToggleClick"
    >
      聊天<span class="chat-count" aria-hidden="true"> {{ chatTotal }}</span>
    </button>
    <div v-if="chatOpen" class="chat-panel">
      <div id="chat-log" class="chat-log">
        <div v-for="m in chat" :key="m.id" class="chat-line">
          <span class="chat-name">{{ m.name }}</span>
          <span class="chat-text">{{ m.text }}</span>
        </div>
        <div v-if="!chat.length" class="chat-empty">暂无消息</div>
      </div>
      <div class="chat-input-row">
        <input
          v-model="chatInput"
          class="chat-input"
          maxlength="200"
          placeholder="说点什么…"
          @keyup.enter="sendChatText"
        />
        <button class="btn chat-send" type="button" @click="sendChatText">发送</button>
      </div>
    </div>
  </div>
</template>
