<script setup lang="ts">
import type { PlayerView } from "../../shared/protocol.js";
import { REPAY_CHIPS } from "../../shared/constants.js";
import { posText, rankOf, suitClass, suitOf } from "../lib/cards.js";
import { toggleRepay } from "../stores/session.js";

defineProps<{
  p: PlayerView;
  actionPlayerId: string | null;
}>();

/** One bet slot: amount wins, then the last action's word. Empty hides the text.
 *  All-in is NOT shown here — the player-top badge owns it (no duplication). */
function betView(p: PlayerView): { text: string; dim: boolean } {
  if (p.roundBet > 0) return { text: String(p.roundBet), dim: false };
  if (p.lastAction === "check") return { text: "过牌", dim: false };
  if (p.lastAction === "fold") return { text: "弃牌", dim: true };
  if (p.lastAction) return { text: "…", dim: false };
  return { text: "", dim: false };
}
</script>

<template>
  <!-- every conditional child is v-show: visibility toggles, boxes stay -->
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
      <!-- one badge: 离开 / 破产 / position; hidden entirely when empty -->
      <span v-show="posText(p)" class="pos on" :class="{ 'bust-tag': p.left || p.busted }">{{ posText(p) }}</span>
      <!-- allin / turn share ONE badge (mutually exclusive; allin wins) -->
      <span
        v-show="p.allIn || actionPlayerId === p.id"
        class="turn-dot"
        :class="{ allin: p.allIn }"
      >{{ p.allIn ? "allin" : "轮到" }}</span>
    </div>
    <!-- fixed zones: chips / debt / repay each reserve their box, hidden or not -->
    <div class="chips-row">
      <span class="chips">{{ p.chips }}</span>
      <span class="debt-slot">
        <span v-show="p.debt > 0" class="debt-amt">-{{ p.debt }}</span>
      </span>
      <span class="repay-slot">
        <button
          v-show="p.isMe && p.debt > 0"
          class="repay-btn"
          type="button"
          :disabled="p.chips < Math.min(REPAY_CHIPS, p.debt)"
          @click="toggleRepay"
        >还钱</button>
      </span>
    </div>
    <div class="cards">
      <!-- backs render empty rank/suit by contract, no extra condition needed -->
      <div
        v-for="(c, i) in p.holeCards"
        :key="i"
        class="card mini"
        :class="c === 'back' ? 'back' : 'face'"
        :data-code="c === 'back' ? '' : c"
      >
        <span class="rank">{{ rankOf(c) }}</span>
        <span class="suit" :class="suitClass(c)">{{ suitOf(c) }}</span>
      </div>
    </div>
    <div class="bet">
      <span v-show="betView(p).text" :class="{ dim: betView(p).dim }">{{ betView(p).text }}</span>
    </div>
    <div class="hand-label" :class="{ empty: !p.handLabel }">{{ p.handLabel }}</div>
  </div>
</template>
