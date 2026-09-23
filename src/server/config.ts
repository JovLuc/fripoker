// Typed env parsing — the single place process.env is read for server setup.
// Deliberately tiny: only PORT and BASE_PATH are configurable. HOST is fixed
// to 0.0.0.0 (LAN game), and the static root always sits next to the build.

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface BotDelay {
  min: number;
  max: number;
}

export interface ServerConfig {
  port: number;
  /** "" or "/xxx" (normalized); nginx reverse-proxy prefix. */
  basePath: string;
  /**
   * Client build output, derived from the compiled file location. Internal
   * field (tests inject a temp dir) — not env-configurable.
   */
  staticRoot: string | null;
  /** Bot action delay window in ms (tests shrink it). */
  botDelay: BotDelay;
}

/** "" | "/xxx" — accept "frp", "/frp/", "/" etc. */
export function normalizeBase(raw: string): string {
  if (!raw) return "";
  let p = String(raw).trim();
  if (!p || p === "/") return "";
  if (!p.startsWith("/")) p = `/${p}`;
  return p.replace(/\/+$/, "");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  // Unset → /frp (the fixed nginx prefix); BASE_PATH="" opts back to root.
  const rawBase = env.BASE_PATH === undefined ? "/frp" : env.BASE_PATH;
  return {
    port: Number(env.PORT || 3000),
    basePath: normalizeBase(rawBase),
    staticRoot: defaultStaticRoot(),
    botDelay: { min: 700, max: 1300 },
  };
}

/** dist/server/config.js → dist/public. Under tsx dev this path won't exist — fine. */
function defaultStaticRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "../public");
}
