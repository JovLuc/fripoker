// Raise slider state: raise-to semantics (amount includes chips already in
// this street), kept legal across hand/action/myLegal changes.

import { computed, ref, watch } from "vue";
import { clearError, showError } from "../stores/error.js";
import { myActionState, room } from "../stores/room.js";
import { sendAction, sendAllIn, sendRaiseTo } from "../stores/session.js";

export function useRaiseSlider() {
  const raiseTo = ref(0);
  let lastHandId = 0;

  function syncRaise(): void {
    if (!myActionState.value) return;
    const st = myActionState.value;
    const min = Math.min(st.minRaiseTo, st.maxRaiseTo);
    const handId = room.game ? room.game.handId : 0;
    if (handId !== lastHandId) {
      lastHandId = handId;
      raiseTo.value = min;
      return;
    }
    if (raiseTo.value < min || raiseTo.value > st.maxRaiseTo) {
      raiseTo.value = st.canCheck
        ? Math.min(st.maxRaiseTo, Math.max(min, st.roundBet + Math.max(st.bigBlind || 20, Math.floor(st.pot * 0.5))))
        : min;
      if (raiseTo.value < min) raiseTo.value = min;
      if (raiseTo.value > st.maxRaiseTo) raiseTo.value = st.maxRaiseTo;
    }
  }

  watch(
    () => room.game?.handId,
    () => {
      lastHandId = room.game ? room.game.handId : 0;
      raiseTo.value = 0;
      syncRaise();
    },
  );
  watch(() => room.game?.actionPlayerId, () => syncRaise());
  watch(
    () => room.game?.myLegal,
    () => syncRaise(),
    { deep: true },
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

  const raiseHint = computed(() => {
    if (!myActionState.value) return "";
    if (raiseTo.value > raiseMax.value) return "超出可加注上限";
    if (raiseTo.value < myActionState.value.minRaiseTo && raiseTo.value < raiseMax.value) {
      return `最小加注到 ${myActionState.value.minRaiseTo}`;
    }
    return "";
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
      showError(raiseHint.value || "非法加注");
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
    raiseHint,
    setRaisePreset,
    stepRaise,
    sendRaise,
  };
}
