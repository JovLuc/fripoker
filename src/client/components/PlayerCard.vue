<script setup lang="ts">
import type { PlayerView } from "../../shared/protocol.js";
import { computed } from "vue";
import { posText, rankOf, suitClass, suitOf } from "../lib/cards.js";
import { room } from "../stores/room.js";
import { requestBorrow, respondBorrow } from "../stores/session.js";
import { profile } from "../stores/profile.js";

defineProps<{
  p: PlayerView;
  actionPlayerId: string | null;
}>();

const topLenderIds = computed(() => new Set(
  [...(room.game?.players ?? [])].filter((x) => x.chips > 0).sort((a, b) => b.chips - a.chips).slice(0, 2).map((x) => x.id),
));

function borrowFrom(lender: PlayerView): void {
  const borrower = room.game?.players.find((x) => x.isMe);
  if (!borrower || borrower.chips !== 0 || !topLenderIds.value.has(lender.id)) return;
  const amount = Number(prompt(`向 ${lender.name} 借多少？最多 ${lender.chips}`, String(Math.max(1, Math.floor(lender.chips / 2)))));
  if (Number.isSafeInteger(amount) && amount > 0 && amount <= lender.chips) requestBorrow(lender.id, amount);
}

/** One bet slot: amount wins, then the last action's word. Empty hides the text.
 *  All-in is NOT shown here — the player-top badge owns it (no duplication). */
function betView(p: PlayerView): { text: string; dim: boolean } {
  if (p.roundBet > 0) return { text: String(p.roundBet), dim: false };
  if (p.lastAction === "check") return { text: "过牌", dim: false };
  if (p.lastAction === "fold") return { text: "弃牌", dim: true };
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
      <span v-show="posText(p, room.kind)" class="pos on" :class="{ 'bust-tag': p.left || p.busted }">{{ posText(p, room.kind) }}</span>
      <!-- one badge: allin / peeked (turn is the .active border, not a badge) -->
      <span
        v-show="p.allIn || p.looked"
        class="turn-dot"
        :class="{ allin: p.allIn }"
      >{{ p.allIn ? "allin" : "看" }}</span>
    </div>
    <!-- chip balance and available player-to-player borrowing -->
    <div class="chips-row">
      <span class="chips">{{ p.chips }}</span>
      <button v-show="!p.isMe && topLenderIds.has(p.id) && room.game?.players.some(x => x.isMe && x.chips === 0) && room.game?.handOver && !room.game?.gameOver" class="repay-btn" type="button" @click="borrowFrom(p)">向我借</button>
      <template v-for="req in (p.isMe && room.game?.handOver && !room.game?.gameOver ? room.borrowRequests.filter(r => r.toId === profile.playerId) : [])" :key="req.id">
        <span class="small">{{ req.fromName }}申请借 {{ req.amount }}</span>
        <button class="repay-btn" type="button" @click="respondBorrow(req.id, true)">同意</button>
        <button class="repay-btn" type="button" @click="respondBorrow(req.id, false)">拒绝</button>
      </template>
    </div>
    <!-- cards always fan out: hidden = backs, peeked(own)/revealed = faces -->
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
