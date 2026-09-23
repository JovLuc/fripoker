<script setup lang="ts">
import { role, room } from "../stores/room.js";
import { startGame } from "../stores/session.js";
</script>

<template>
  <div class="waiting">
    <p class="label">座位</p>
    <div class="seat-grid">
      <div v-for="p in room.humanPlayers" :key="p.id" class="seat-box">
        <div class="seat-name">{{ p.name }}</div>
        <div class="dim small">{{ p.id === room.hostId ? '房主' : '玩家' }}</div>
      </div>
      <div
        v-for="i in Math.max(0, room.maxPlayers - room.humanPlayers.length)"
        :key="'e' + i"
        class="seat-box empty"
      >
        <div class="seat-name dim">空位</div>
        <div class="dim small">开局补机器人</div>
      </div>
    </div>
    <div class="waiting-ops">
      <button v-if="role === 'host'" class="btn primary" @click="startGame">开始对局</button>
      <p class="dim small">1–6 人可开局 · 固定盲注 10/20 · 起始 2000 币 · 破产者观战，剩余继续</p>
    </div>
  </div>
</template>
