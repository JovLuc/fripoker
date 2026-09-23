<script setup lang="ts">
import { profile } from "../stores/profile.js";
import { isBusted, myActionState, mySeat, readyStatusText, role, room, waitingLabel, watchLabel } from "../stores/room.js";
import { leaveRoom, sendAction, toggleReady } from "../stores/session.js";
import { useRaiseSlider } from "../composables/useRaiseSlider.js";

const { raiseTo, raiseMin, raiseMax, raiseLabel, raiseHint, setRaisePreset, stepRaise, sendRaise } = useRaiseSlider();
</script>

<template>
  <!-- one slot, fixed height, content swaps -->
  <div class="action-slot">
    <div v-if="myActionState && room.game!.actionPlayerId === profile.playerId" class="action-bar">
      <div class="action-row">
        <button class="btn action" @click="sendAction('fold')">弃牌</button>
        <button class="btn action" @click="sendAction(myActionState.canCheck ? 'check' : 'call')">
          {{ myActionState.canCheck ? '过牌' : '跟注' + myActionState.needToCall }}
        </button>
        <button
          class="btn action primary"
          :disabled="raiseTo < myActionState.minRaiseTo && raiseTo < myActionState.maxRaiseTo || raiseTo > myActionState.maxRaiseTo"
          @click="sendRaise"
        >
          {{ raiseLabel }}
        </button>
      </div>
      <div class="slider-row">
        <div class="slider-row-inner">
          <button class="step-btn" type="button" aria-label="减10" @click="stepRaise(-10)">−</button>
          <input
            v-model.number="raiseTo"
            type="range"
            class="slider"
            :min="raiseMin"
            :max="raiseMax"
            :step="1"
          />
          <button class="step-btn" type="button" aria-label="加10" @click="stepRaise(10)">+</button>
        </div>
        <div class="slider-marks">
          <button class="chip" type="button" @click="setRaisePreset(0.5)">1/2池</button>
          <button class="chip" type="button" @click="setRaisePreset(0.66)">2/3池</button>
          <button class="chip" type="button" @click="setRaisePreset(1)">满池</button>
          <button class="chip" type="button" @click="raiseTo = raiseMax">全下</button>
          <span class="raise-val">{{ raiseTo }}</span>
        </div>
      </div>
      <div class="hint-slot">{{ raiseHint || ' ' }}</div>
    </div>

    <div v-else-if="room.game!.handOver" class="action-bar">
      <span class="dim">{{ readyStatusText }}</span>
      <div class="action-row ready-row">
        <template v-if="role === 'spectator'">
          <span class="dim">观战中</span>
        </template>
        <template v-else-if="mySeat && mySeat.chips <= 0">
          <span class="dim">余额为0 · 聊天借钱后可准备</span>
        </template>
        <template v-else-if="mySeat && mySeat.ready">
          <button class="btn" type="button" disabled>已准备</button>
        </template>
        <template v-else-if="mySeat && mySeat.chips > 0">
          <button class="btn primary" type="button" @click="toggleReady">准备</button>
        </template>
      </div>
      <div v-if="room.game!.gameOver" class="action-row">
        <button class="btn" @click="leaveRoom">返回大厅</button>
      </div>
    </div>

    <div v-else-if="isBusted && room.status === 'playing'" class="action-bar muted">
      <span class="dim">{{ watchLabel }}</span>
    </div>
    <div v-else-if="room.status === 'playing' && !room.game!.handOver" class="action-bar muted">
      <span class="dim">{{ waitingLabel }}</span>
    </div>
  </div>
</template>
