<script setup lang="ts">
import type { PlayerView } from "../../shared/protocol.js";
import { REPAY_CHIPS } from "../../shared/constants.js";
import { posLabel, rankOf, suitClass, suitOf } from "../lib/cards.js";
import { toggleRepay } from "../stores/session.js";

defineProps<{
  p: PlayerView;
  actionPlayerId: string | null;
}>();
</script>

<template>
  <div
    class="player"
    :class="{
      me: p.isMe,
      active: actionPlayerId === p.id,
      folded: p.folded,
      out: p.sittingOut,
    }"
  >
    <div class="player-top">
      <span class="name">{{ p.name }}<template v-if="p.isBot"> ·机</template></span>
      <span v-if="p.busted" class="pos on bust-tag">破产</span>
      <span v-else class="pos" :class="{ on: p.isDealer || p.isSB || p.isBB }">{{ posLabel(p) }}</span>
    </div>
    <div class="chips-row">
      <span class="chips">{{ p.chips }}</span>
      <span v-if="p.debt > 0" class="debt-amt">-{{ p.debt }}</span>
      <button
        v-if="p.isMe && p.debt > 0"
        class="repay-btn"
        type="button"
        :disabled="p.chips < Math.min(REPAY_CHIPS, p.debt)"
        @click="toggleRepay"
      >还钱</button>
    </div>
    <div class="cards">
      <div
        v-for="(c, i) in p.holeCards"
        :key="i"
        class="card mini"
        :class="c === 'back' ? 'back' : 'face'"
        :data-code="c === 'back' ? '' : c"
      >
        <template v-if="c !== 'back'">
          <span class="rank">{{ rankOf(c) }}</span>
          <span class="suit" :class="suitClass(c)">{{ suitOf(c) }}</span>
        </template>
        <template v-else>
          <span class="back-mark">·</span>
        </template>
      </div>
    </div>
    <div class="bet">
      <span v-if="p.roundBet > 0">{{ p.roundBet }}</span>
      <span v-else-if="p.lastAction === 'check'">过牌</span>
      <span v-else-if="p.lastAction === 'fold'" class="dim">弃牌</span>
      <span v-else-if="p.allIn" class="dim">全下</span>
      <span v-else-if="p.lastAction">…</span>
    </div>
    <div class="hand-label" :class="{ empty: !p.handLabel }">{{ p.handLabel }}</div>
    <div class="turn-slot" :class="{ on: actionPlayerId === p.id || p.allIn }">
      <span v-if="p.allIn" class="turn-dot allin">allin</span>
      <span v-else-if="actionPlayerId === p.id" class="turn-dot">轮到</span>
    </div>
  </div>
</template>
