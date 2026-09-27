<script setup lang="ts">
import { computed } from "vue";
import { bustedList, room } from "../stores/room.js";
import { rankOf, suitClass, suitOf } from "../lib/cards.js";

const game = computed(() => room.game);

/** Result lines win over the message whenever the hand just ended. */
const resultLines = computed(() =>
  room.game?.handOver && room.game.lastResults ? room.game.lastResults : [],
);

/** Hold'em narrows to the street snapshot; three-card renders an empty board. */
const holdem = computed(() => (room.game?.kind === "holdem" ? room.game : null));
</script>

<template>
  <!-- two sibling bands of the locked column: board | msg -->
  <div class="board-area">
    <div class="board-row">
      <div class="busted-log">
        <div v-show="bustedList.length" class="busted-title">破产</div>
        <div v-for="b in bustedList" :key="b.id" class="busted-line">{{ b.name }}已破产</div>
      </div>
      <!-- hold'em: five community slots; three-card: nothing (band stays reserved) -->
      <div class="board">
        <template v-if="holdem">
          <div v-for="(c, i) in holdem.board" :key="i" class="card face">
            <span class="rank">{{ rankOf(c) }}</span>
            <span class="suit" :class="suitClass(c)">{{ suitOf(c) }}</span>
          </div>
          <div
            v-for="i in Math.max(0, 5 - holdem.board.length)"
            :key="'ph' + i"
            class="card slot"
          ></div>
        </template>
      </div>
      <div class="board-side-pad" aria-hidden="true"></div>
    </div>
  </div>

  <!-- one text box: results replace the message by switching its content -->
  <div class="message-slot">
    <div class="message">
      <template v-if="resultLines.length">
        <span v-for="r in resultLines" :key="r.playerId" class="result-line">
          {{ r.name }} +{{ r.amount }}<span v-show="r.hand"> · {{ r.hand }}</span>
        </span>
      </template>
      <template v-else>{{ game?.message }}</template>
    </div>
  </div>
</template>
