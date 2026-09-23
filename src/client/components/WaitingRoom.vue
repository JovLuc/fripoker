<script setup lang="ts">
import { computed } from "vue";
import { role, room } from "../stores/room.js";
import { addRoomBot, removeRoomBot, startGame } from "../stores/session.js";

const seatTotal = computed(() => room.humanPlayers.length + room.botPlayers.length);
const emptySeats = computed(() => Math.max(0, room.maxPlayers - seatTotal.value));
</script>

<template>
  <div class="waiting">
    <p class="label">座位</p>
    <div class="seat-grid">
      <div v-for="p in room.humanPlayers" :key="p.id" class="seat-box">
        <div class="seat-name">{{ p.name }}</div>
        <div class="dim small">{{ p.id === room.hostId ? '房主' : '玩家' }}</div>
      </div>
      <div v-for="b in room.botPlayers" :key="b.id" class="seat-box bot">
        <div class="seat-name">{{ b.name }}</div>
        <div class="dim small">机器人</div>
      </div>
      <div v-for="i in emptySeats" :key="'e' + i" class="seat-box empty">
        <div class="seat-name dim">空位</div>
        <div class="dim small">等待加入</div>
      </div>
    </div>
    <div class="waiting-ops">
      <div v-if="role === 'host'" class="bot-ops">
        <button class="btn" type="button" :disabled="seatTotal >= room.maxPlayers" @click="addRoomBot">+ 机器人</button>
        <button class="btn" type="button" :disabled="!room.botPlayers.length" @click="removeRoomBot">− 机器人</button>
      </div>
      <button v-if="role === 'host'" class="btn primary" @click="startGame">开始对局</button>
      <p class="dim small">2–{{ room.maxPlayers }} 人可开局 · 固定盲注 10/20 · 起始 2000 币 · 破产者观战，剩余继续</p>
    </div>
  </div>
</template>
