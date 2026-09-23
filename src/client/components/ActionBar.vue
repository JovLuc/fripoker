<script setup lang="ts">
import { computed } from "vue";
import { myActionState, mySeat, readyStatusText, role, room, waitingLabel } from "../stores/room.js";
import { leaveRoom, sendAction, toggleReady } from "../stores/session.js";
import { useRaiseSlider } from "../composables/useRaiseSlider.js";

const { raiseTo, raiseMin, raiseMax, raiseLabel, setRaisePreset, stepRaise, sendRaise } = useRaiseSlider();

// One fixed band, three states (v-show only — DOM never re-mounts).
// myLegal is only non-null for the current actor, so it alone decides "my turn".
const mode = computed(() =>
  myActionState.value ? "turn" : room.game?.handOver ? "ready" : "muted",
);

const callLabel = computed(() =>
  myActionState.value?.canCheck ? "过牌" : `跟注${myActionState.value?.needToCall ?? ""}`,
);
const raiseDisabled = computed(() => {
  const st = myActionState.value;
  if (!st) return true;
  return (raiseTo.value < st.minRaiseTo && raiseTo.value < st.maxRaiseTo) || raiseTo.value > st.maxRaiseTo;
});
const readyHint = computed(() =>
  role.value === "spectator" ? "观战中"
  : mySeat.value && mySeat.value.ready ? ""
  : mySeat.value && mySeat.value.chips <= 0 ? "余额为0 · 聊天借钱后可准备"
  : "",
);
const canReady = computed(() =>
  !!mySeat.value && !mySeat.value.ready && mySeat.value.chips > 0 && role.value !== "spectator",
);
</script>

<template>
  <div class="action-slot">
    <div v-show="mode === 'turn'" class="action-bar interact">
      <div class="action-row">
        <button class="btn action" @click="sendAction('fold')">弃牌</button>
        <button class="btn action" @click="sendAction(myActionState?.canCheck ? 'check' : 'call')">{{ callLabel }}</button>
        <button class="btn action" :disabled="raiseDisabled" @click="sendRaise">{{ raiseLabel }}</button>
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
        </div>
      </div>
    </div>

    <div v-show="mode === 'ready'" class="action-bar ready">
      <span class="dim">{{ readyStatusText }}</span>
      <div class="action-row ready-row">
        <span v-show="readyHint" class="dim">{{ readyHint }}</span>
        <button v-show="!!mySeat && mySeat.ready" class="btn" type="button" disabled>已准备</button>
        <button v-show="canReady" class="btn primary" type="button" @click="toggleReady">准备</button>
      </div>
      <div v-show="room.game?.gameOver" class="action-row">
        <button class="btn" @click="leaveRoom">返回大厅</button>
      </div>
    </div>

    <div v-show="mode === 'muted'" class="action-bar muted">
      <span class="dim">{{ waitingLabel }}</span>
    </div>
  </div>
</template>
