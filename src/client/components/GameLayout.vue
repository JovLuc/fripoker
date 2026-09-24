<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import ActionBar from "./ActionBar.vue";
import BoardArea from "./BoardArea.vue";
import PlayerCard from "./PlayerCard.vue";
import { room } from "../stores/room.js";

// One layout for both orientations; only the seat-column count differs so
// portrait cards stay wide enough (CSS owns width via --seat-cols).
const portrait = ref(
  typeof window !== "undefined" && window.matchMedia("(orientation: portrait)").matches,
);
let mq: MediaQueryList | null = null;
const onMq = (e: MediaQueryListEvent | MediaQueryList): void => {
  portrait.value = e.matches;
};
onMounted(() => {
  mq = window.matchMedia("(orientation: portrait)");
  onMq(mq);
  mq.addEventListener("change", onMq);
});
onUnmounted(() => {
  mq?.removeEventListener("change", onMq);
});

/** Seat columns: landscape 3–5/row (≤2 rows); portrait 2–3 for wider cards.
 *  Rows beyond 2 scroll inside the band (Y). */
const seatCols = computed(() => {
  const n = room.game?.players.length ?? 0;
  if (portrait.value) {
    if (n <= 4) return Math.max(1, Math.min(2, n));
    return Math.min(3, n);
  }
  const rows = Math.max(1, Math.ceil(n / 5));
  return Math.min(5, Math.max(3, Math.ceil(n / rows)));
});

/** More than 2 rows => the band gets a fixed 2-row window and scrolls. */
const playersScroll = computed(() => {
  const n = room.game?.players.length ?? 0;
  return Math.ceil(n / seatCols.value) > 2;
});
</script>

<template>
  <!-- always mounted (v-show at GameView) — every binding must be null-safe -->
  <div class="game-layout">
    <BoardArea />

    <div
      class="players-row"
      :class="{ multi: playersScroll }"
      :style="{ '--seat-cols': String(seatCols) }"
    >
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
