<script setup lang="ts">
import { computed } from "vue";
import ActionBar from "./ActionBar.vue";
import BoardArea from "./BoardArea.vue";
import PlayerCard from "./PlayerCard.vue";
import { room } from "../stores/room.js";

/** Grid columns for the seat row: 3–5 per row, rows split at 5. */
const seatCols = computed(() => {
  const n = room.game?.players.length ?? 0;
  const rows = Math.max(1, Math.ceil(n / 5));
  return Math.min(5, Math.max(3, Math.ceil(n / rows)));
});
</script>

<template>
  <!-- always mounted (v-show at GameView) — every binding must be null-safe -->
  <div class="game-layout">
    <BoardArea />

    <div class="players-row" :style="{ gridTemplateColumns: `repeat(${seatCols}, 17%)` }">
      <PlayerCard
        v-for="p in room.game?.players ?? []"
        :key="p.id"
        :p="p"
        :action-player-id="room.game?.actionPlayerId ?? null"
      />
    </div>

    <ActionBar />
  </div>
</template>
