<script setup lang="ts">
import { computed } from "vue";
import ChatDock from "./ChatDock.vue";
import GameLayout from "./GameLayout.vue";
import WaitingRoom from "./WaitingRoom.vue";
import { error } from "../stores/error.js";
import { phaseLabel, role, room } from "../stores/room.js";
import { leaveRoom, setRoomShortDeck } from "../stores/session.js";

const isHoldem = computed(() => room.kind === "holdem");
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
      <!-- three-card: the bet base lives in the status bar now that .board is empty -->
      <span v-else-if="room.kind === 'tp'">注 {{ room.game?.currentBet ?? 0 }} · 底池 {{ room.game?.pot ?? 0 }}</span>
      <span v-else>{{ phaseLabel }} · 底池 {{ room.game ? room.game.pot : 0 }}</span>
      <span v-if="room.kind === 'tp'" class="tag">三张牌</span>
      <span v-if="role === 'spectator'" class="tag">观战</span>
      <span v-else-if="role === 'host'" class="tag">房主</span>
      <template v-if="isHoldem">
        <button
          v-if="role === 'host'"
          class="tag-btn"
          type="button"
          :disabled="!!room.game && !room.game.handOver"
          title="短牌 6+：36 张（≥6），三条>顺子、同花>葫芦；本手结束后生效"
          @click="setRoomShortDeck(!room.shortDeck)"
        >牌型:{{ room.shortDeck ? '短牌' : '长牌' }}</button>
        <span v-else-if="room.shortDeck" class="tag">短牌</span>
      </template>
      <ChatDock />
    </div>

    <!-- both stay mounted; only visibility toggles (no re-mount reflow) -->
    <WaitingRoom v-show="room.status === 'waiting'" />
    <GameLayout v-show="!!room.game" />

    <p v-if="error" class="error fixed">{{ error }}</p>
  </div>
</template>
