// Mode registry: the single place that knows every ruleset. GameHost and
// serializer resolve modes through getMode() and never import a concrete
// engine — this is where the decoupling lands.

import type { GameKind } from "../../shared/protocol.js";
import type { GameMode } from "./core/mode.js";
import { holdemMode } from "./holdem/mode.js";
import { tpMode } from "./tp/mode.js";

const MODES: Record<GameKind, GameMode> = {
  holdem: holdemMode,
  tp: tpMode,
};

export function getMode(kind: GameKind): GameMode {
  const mode = MODES[kind];
  if (!mode) throw new Error(`unknown game mode: ${kind}`);
  return mode;
}
