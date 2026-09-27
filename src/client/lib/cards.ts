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

/**
 * Seat badge text: departure / bust win over the button. Empty hides the badge.
 * `kind === "tp"` renders the button as 庄 instead of D.
 * Peek state lives in the turn-dot (「看」), not here; turn highlight is the
 * `.player.active` border.
 */
export function posText(p: PlayerView | null, kind?: string): string {
  if (!p) return "";
  if (p.left) return "离开";
  if (p.busted) return "破产";
  if (p.isDealer) return kind === "tp" ? "庄" : "D";
  if (p.isSB) return "SB";
  if (p.isBB) return "BB";
  return "";
}
