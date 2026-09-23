<script setup lang="ts">
import ActionBar from "./ActionBar.vue";
import BoardArea from "./BoardArea.vue";
import PlayerCard from "./PlayerCard.vue";
import { room } from "../stores/room.js";
</script>

<template>
  <div class="game-layout">
    <BoardArea />

    <div class="players-row">
      <PlayerCard
        v-for="p in room.game!.players"
        :key="p.id"
        :p="p"
        :action-player-id="room.game!.actionPlayerId"
      />
    </div>

    <ActionBar />
  </div>
</template>
