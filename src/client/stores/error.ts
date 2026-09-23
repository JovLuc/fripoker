// Bottom toast error with a 4s auto-clear.

import { ref } from "vue";

export const error = ref("");
let timer: number | null = null;

export function showError(message: string): void {
  error.value = message;
  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    if (error.value === message) error.value = "";
    timer = null;
  }, 4000);
}

export function clearError(): void {
  error.value = "";
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
}
