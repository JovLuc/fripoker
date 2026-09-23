<script setup lang="ts">
import ChatDock from "./ChatDock.vue";
import GameLayout from "./GameLayout.vue";
import WaitingRoom from "./WaitingRoom.vue";
import { error } from "../stores/error.js";
import { phaseLabel, role, room } from "../stores/room.js";
import { leaveRoom, setRoomCheat, setRoomShortDeck } from "../stores/session.js";
</script>

<template>
  <div class="table-screen" :class="{ playing: room.status === 'playing' }">
    <header class="top">
      <button class="btn ghost" @click="leaveRoom">离开</button>
      <div class="brand">{{ room.name }}</div>
      <div class="dim">#{{ room.id }}</div>
    </header>

    <div class="status-bar">
      <span v-if="room.status === 'waiting'">等待开局</span>
      <span v-else>{{ phaseLabel }} · 底池 {{ room.game ? room.game.pot : 0 }}</span>
      <span v-if="role === 'spectator'" class="tag">观战</span>
      <span v-else-if="role === 'host'" class="tag">房主</span>
      <button
        v-if="role === 'host'"
        class="tag-btn"
        type="button"
        @click="setRoomCheat(!room.cheatEnabled)"
      >借钱:{{ room.cheatEnabled ? '开' : '关' }}</button>
      <span v-else-if="room.cheatEnabled" class="tag">借钱</span>
      <button
        v-if="role === 'host'"
        class="tag-btn"
        type="button"
        :disabled="!!room.game && !room.game.handOver"
        title="短牌 6+：36 张（≥6），三条>顺子、同花>葫芦；本手结束后生效"
        @click="setRoomShortDeck(!room.shortDeck)"
      >牌型:{{ room.shortDeck ? '短牌' : '长牌' }}</button>
      <span v-else-if="room.shortDeck" class="tag">短牌</span>
    </div>

    <!-- both stay mounted; only visibility toggles (no re-mount reflow) -->
    <WaitingRoom v-show="room.status === 'waiting'" />
    <GameLayout v-show="!!room.game" />

    <ChatDock />

    <p v-if="error" class="error fixed">{{ error }}</p>
  </div>
</template>
