// Pure card-code helpers for templates ("As" → rank/suit/glyph).

import type { PlayerView } from "../../shared/protocol.js";

export function rankOf(code: string): string {
  if (!code || code === "back") return "";
  return code[0] === "T" ? "10" : code[0];
}

export function suitOf(code: string): string {
  if (!code || code === "back") return "";
  const s = code[1];
  if (s === "H") return "♥";
  if (s === "D") return "♦";
  if (s === "C") return "♣";
  return "♠";
}

/** Monochrome theme: red suits differ by class only. */
export function suitClass(code: string): string {
  if (!code || code === "back") return "";
  const s = code[1];
  return s === "H" || s === "D" ? "red" : "black";
}

export function posLabel(p: PlayerView | null): string {
  if (!p) return "";
  if (p.isDealer) return "D";
  if (p.isSB) return "SB";
  if (p.isBB) return "BB";
  return "";
}
