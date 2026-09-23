// Floating chat dock: draggable toggle button, panel opens toward the
// viewport center, position persisted in localStorage.

import { ref } from "vue";
import { LS_KEYS } from "../../shared/constants.js";
import { toggleChat } from "../stores/chat.js";

export type Quadrant = "tr" | "tl" | "br" | "bl";

/** null = default dock position (top-right); {x,y} = dragged pixel position. */
export const chatPos = ref<{ x: number; y: number } | null>(loadChatPos());
export const chatDragging = ref(false);
export const chatQuadrant = ref<Quadrant>("tr");

function loadChatPos(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(LS_KEYS.chatPos);
    if (!raw) return null;
    const p = JSON.parse(raw) as { x?: unknown; y?: unknown };
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return p as { x: number; y: number };
  } catch {
    /* ignore */
  }
  return null;
}

function saveChatPos(p: { x: number; y: number } | null): void {
  try {
    if (p) localStorage.setItem(LS_KEYS.chatPos, JSON.stringify(p));
    else localStorage.removeItem(LS_KEYS.chatPos);
  } catch {
    /* ignore */
  }
}

export function updateChatQuadrant(): void {
  const dock = document.querySelector(".chat-dock");
  if (!dock) return;
  const r = dock.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const right = cx >= window.innerWidth / 2;
  const bottom = cy >= window.innerHeight / 2;
  chatQuadrant.value = ((bottom ? "b" : "t") + (right ? "r" : "l")) as Quadrant;
}

/** Suppress the click that follows a drag (mousedown → move → up → click). */
let dragMoved = false;

export function onChatToggleClick(): void {
  if (dragMoved) {
    dragMoved = false;
    return;
  }
  updateChatQuadrant();
  toggleChat();
}

export function onChatDragStart(e: MouseEvent): void {
  if (e.button != null && e.button !== 0) return;
  const target = e.currentTarget as HTMLElement;
  const dock = target.closest(".chat-dock") || target.parentElement!;
  const rect = target.getBoundingClientRect();
  dragMoved = false;
  const start = {
    mx: e.clientX,
    my: e.clientY,
    x: dock.getBoundingClientRect().left,
    y: dock.getBoundingClientRect().top,
    // dock is button-sized when the panel is absolute
    w: rect.width,
    h: rect.height,
  };

  const onMove = (ev: MouseEvent) => {
    const dx = ev.clientX - start.mx;
    const dy = ev.clientY - start.my;
    if (!dragMoved && Math.hypot(dx, dy) < 4) return;
    dragMoved = true;
    chatDragging.value = true;
    const maxX = Math.max(0, window.innerWidth - start.w);
    const maxY = Math.max(0, window.innerHeight - start.h);
    const x = Math.min(maxX, Math.max(0, start.x + dx));
    const y = Math.min(maxY, Math.max(0, start.y + dy));
    chatPos.value = { x: Math.round(x), y: Math.round(y) };
    updateChatQuadrant();
  };

  const onUp = () => {
    if (dragMoved && chatPos.value) saveChatPos(chatPos.value);
    chatDragging.value = false;
    updateChatQuadrant();
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };

  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  e.preventDefault();
}
