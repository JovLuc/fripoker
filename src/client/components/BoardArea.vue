<script setup lang="ts">
import { computed } from "vue";
import { bustedList, room } from "../stores/room.js";
import { rankOf, suitClass, suitOf } from "../lib/cards.js";

const game = computed(() => room.game);

const messageText = computed(() => {
  const g = room.game;
  if (!g) return "";
  if (g.handOver && g.lastResults && g.lastResults.length) return "";
  return g.message;
});
</script>

<template>
  <div class="board-area">
    <div class="board-row">
      <div class="busted-log">
        <div v-if="bustedList.length" class="busted-title">破产</div>
        <div v-for="b in bustedList" :key="b.id" class="busted-line">{{ b.name }}已破产</div>
      </div>
      <div class="board">
        <div v-for="(c, i) in game?.board ?? []" :key="i" class="card face">
          <span class="rank">{{ rankOf(c) }}</span>
          <span class="suit" :class="suitClass(c)">{{ suitOf(c) }}</span>
        </div>
        <div
          v-for="i in Math.max(0, 5 - (game?.board.length ?? 0))"
          :key="'ph' + i"
          class="card slot"
        ></div>
      </div>
      <div class="board-side-pad" aria-hidden="true"></div>
    </div>
    <div class="message-slot">
      <div class="message">{{ messageText }}</div>
      <div class="results">
        <template v-if="game?.lastResults && game.handOver">
          <div v-for="r in game.lastResults" :key="r.playerId" class="result-line">
            {{ r.name }} +{{ r.amount }}<span v-if="r.hand"> · {{ r.hand }}</span>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
