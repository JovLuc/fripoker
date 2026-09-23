import { randomBytes } from "node:crypto";

/** Short url-safe random id (room ids, chat ids, spectator view ids). */
export function rid(len = 6): string {
  return randomBytes(8).toString("base64url").slice(0, len);
}
