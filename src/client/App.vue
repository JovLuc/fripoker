<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import GameView from "./components/GameView.vue";
import LobbyView from "./components/LobbyView.vue";
import NicknameOverlay from "./components/NicknameOverlay.vue";
import { isEditable } from "./lib/dom.js";
import { profile } from "./stores/profile.js";
import { screen } from "./stores/room.js";
import { initSession } from "./stores/session.js";

// Global right-click / selection block (inputs stay selectable).
const onContextMenu = (e: MouseEvent) => e.preventDefault();
const onSelectStart = (e: Event) => {
  if (isEditable(e.target as Node)) return;
  e.preventDefault();
};

let disposeSession: (() => void) | null = null;

onMounted(() => {
  document.addEventListener("contextmenu", onContextMenu);
  document.addEventListener("selectstart", onSelectStart);
  disposeSession = initSession();
});

onUnmounted(() => {
  document.removeEventListener("contextmenu", onContextMenu);
  document.removeEventListener("selectstart", onSelectStart);
  disposeSession?.();
});
</script>

<template>
  <NicknameOverlay v-if="!profile.nickname" />
  <LobbyView v-else-if="screen === 'lobby'" />
  <GameView v-else />
</template>
