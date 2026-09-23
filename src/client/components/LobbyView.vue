<script setup lang="ts">
import { ref } from "vue";
import { error } from "../stores/error.js";
import { rooms } from "../stores/lobby.js";
import { profile } from "../stores/profile.js";
import { clearNickname } from "../stores/profile.js";
import { createRoom, joinRoomById } from "../stores/session.js";

const roomName = ref("");

async function onCreateRoom(): Promise<void> {
  await createRoom(roomName.value.trim());
  roomName.value = "";
}
</script>

<template>
  <div class="lobby">
    <header class="top">
      <div class="brand">fripoker</div>
      <div class="me">
        <span class="dim">{{ profile.nickname }}</span>
        <button class="btn ghost" @click="clearNickname">改昵称</button>
      </div>
    </header>

    <main class="lobby-main">
      <div class="lobby-actions">
        <input v-model="roomName" class="input room-name" maxlength="20" placeholder="房间名（可选）" />
        <button class="btn primary" @click="onCreateRoom">创建房间</button>
      </div>

      <p class="label">房间列表</p>
      <div v-if="rooms.length" class="room-list">
        <div v-for="r in rooms" :key="r.id" class="room-card">
          <div class="room-meta">
            <div class="room-title">{{ r.name }}</div>
            <div class="room-sub">
              <span>{{ r.status === 'playing' ? '对局中' : '等待中' }}</span>
              <span class="sep">·</span>
              <span>{{ r.humanCount }}/{{ r.maxPlayers }} 人</span>
              <span class="sep">·</span>
              <span>{{ (r.humanNames || []).join('、') || '—' }}</span>
            </div>
          </div>
          <div class="room-ops">
            <button
              v-if="r.status === 'waiting' && r.humanCount < r.maxPlayers"
              class="btn"
              @click="joinRoomById(r.id)"
            >加入</button>
            <button
              v-if="r.status === 'playing'"
              class="btn"
              @click="joinRoomById(r.id)"
            >观战</button>
            <button
              v-if="r.status === 'waiting' && r.humanCount >= r.maxPlayers"
              class="btn"
              @click="joinRoomById(r.id)"
            >观战</button>
          </div>
        </div>
      </div>
      <div v-else class="empty">
        <p>暂无房间</p>
        <p class="dim">创建一个房间，不足 6 人时会自动补机器人</p>
      </div>
    </main>

    <p v-if="error" class="error fixed">{{ error }}</p>
  </div>
</template>
