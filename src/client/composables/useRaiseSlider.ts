// Raise slider state: raise-to semantics (amount includes chips already in
// this street), kept legal across hand/action/myLegal changes.

import { computed, ref, watch } from "vue";
import { clearError, showError } from "../stores/error.js";
import { myActionState, room } from "../stores/room.js";
import { sendAction, sendAllIn, sendRaiseTo } from "../stores/session.js";

export function useRaiseSlider() {
  const raiseTo = ref(0);
  let lastHandId = 0;

  // New hand → start at min-raise; otherwise keep the value inside legal range.
  // Fires on every snapshot (myLegal is a fresh object) — idempotent and cheap.
  watch(
    () => [room.game?.handId ?? 0, room.game?.actionPlayerId, room.game?.myLegal],
    () => {
      const handId = room.game?.handId ?? 0;
      const st = myActionState.value;
      if (!st) return;
      const min = Math.min(st.minRaiseTo, st.maxRaiseTo);
      if (handId !== lastHandId) {
        lastHandId = handId;
        raiseTo.value = min;
      } else if (raiseTo.value < min || raiseTo.value > st.maxRaiseTo) {
        raiseTo.value = min;
      }
    },
  );

  const raiseMin = computed(() => {
    if (!myActionState.value) return 0;
    return Math.min(myActionState.value.minRaiseTo, myActionState.value.maxRaiseTo);
  });

  const raiseMax = computed(() => {
    if (!myActionState.value) return 0;
    return myActionState.value.maxRaiseTo;
  });

  const raiseLabel = computed(() => {
    if (!myActionState.value) return "加注";
    if (raiseTo.value >= raiseMax.value) return `全下 ${raiseMax.value}`;
    if (myActionState.value.currentBet === 0) return `下注 ${raiseTo.value}`;
    return `加注到 ${raiseTo.value}`;
  });

  function setRaisePreset(frac: number): void {
    if (!myActionState.value) return;
    const st = myActionState.value;
    const potPart = Math.floor(st.pot * frac);
    let to: number;
    if (st.currentBet === 0) {
      to = st.roundBet + Math.max(st.minRaiseTo - st.roundBet, potPart);
    } else {
      to = st.currentBet + Math.max(st.minRaiseTo - st.currentBet, potPart);
    }
    raiseTo.value = Math.max(st.minRaiseTo, Math.min(st.maxRaiseTo, to));
  }

  function stepRaise(delta: number): void {
    if (!myActionState.value) return;
    const st = myActionState.value;
    const min = Math.min(st.minRaiseTo, st.maxRaiseTo);
    const max = st.maxRaiseTo;
    raiseTo.value = Math.max(min, Math.min(max, Number(raiseTo.value) + delta));
  }

  function sendRaise(): void {
    if (!myActionState.value) return;
    const to = Number(raiseTo.value);
    if (to > raiseMax.value || (to < myActionState.value.minRaiseTo && to < raiseMax.value)) {
      showError("非法加注");
      return;
    }
    if (to >= myActionState.value.maxRaiseTo) {
      sendAllIn();
    } else {
      sendRaiseTo(to);
    }
    clearError();
  }

  return {
    raiseTo,
    raiseMin,
    raiseMax,
    raiseLabel,
    setRaisePreset,
    stepRaise,
    sendRaise,
  };
}
