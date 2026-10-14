// The wire contract between client and server — ONE source of truth.
// Both directions are `{ type, payload? }`; both sides ship together,
// so there is no compatibility layer between them.
//
// Server-internal types (Card, player/state shapes) live under server/game/;
// only what crosses the wire is defined here.
//
// Multi-game model: a room picks its GameKind at creation and never changes.
// GameSnapshot is a discriminated union on `kind` — narrow with
// `snap.kind === "holdem"` before touching game-specific fields.

/** Playable rulesets. "holdem" = Texas Hold'em, "tp" = three-card (三张牌). */
export type GameKind = "holdem" | "tp";

export type RoomStatus = "waiting" | "playing";

/** Hold'em street. Values must match the engine's phases. */
export type HoldemPhase = "idle" | "preflop" | "flop" | "turn" | "river" | "showdown";

/** Three-card phases. */
export type TpPhase = "idle" | "betting" | "showdown";

export type RoomRole = "host" | "player" | "spectator";

/**
 * Player-chosen action names on the wire (raise amount is raise-TO, not a delta).
 * `look`/`compare` are three-card only — the hold'em engine rejects them.
 * `look` never consumes the turn (advance: false in the engine result).
 */
export type PlayerActionName =
  | "fold" | "check" | "call" | "raise" | "allin"
  | "look" | "compare";

export interface ChatMessage {
  id: string;
  playerId: string;
  name: string;
  text: string;
  ts: number;
}

export interface RoomListItem {
  id: string;
  name: string;
  /** Which ruleset this room plays; fixed at creation. */
  kind: GameKind;
  hostName: string;
  status: RoomStatus;
  humanCount: number;
  /** Bots the host added on the room page (waiting status only). */
  botCount: number;
  maxPlayers: number;
  humanNames: string[];
  createdAt: number;
}

/** Legal actions for the viewer at this instant; null when not their turn. */
export interface LegalActions {
  /** Hold'em: chips to match this street. Three-card: minimum actual payment this action (N blind / 2N peeked). */
  needToCall: number;
  canCheck: boolean;
  canCall: boolean;
  /** Hold'em raise-to face level. Three-card: min/max ACTUAL payment for this action. */
  minRaiseTo: number;
  maxRaiseTo: number;
  pot: number;
  /** Current street level (hold'em) / current bet base N (three-card). */
  currentBet: number;
  chips: number;
  roundBet: number;
  /** Hold'em big blind; three-card fills its bet unit. */
  bigBlind: number;
  // --- three-card extras (undefined in hold'em snapshots) ---
  /** Viewer hasn't peeked yet this hand and may still look (their turn only). */
  canLook?: boolean;
  /** A rival with the SAME peek state exists and the fee is affordable. */
  canCompare?: boolean;
  /** Chips a `compare` action costs: 2 × max(currentBet, unit). */
  compareFee?: number;
}

export interface HandResultLine {
  playerId: string;
  name: string;
  amount: number;
  /** Chinese hand-category name, empty for fold wins. */
  hand: string;
}

export interface PlayerView {
  id: string;
  name: string;
  seat: number;
  isBot: boolean;
  chips: number;
  roundBet: number;
  folded: boolean;
  allIn: boolean;
  sittingOut: boolean;
  /** Seat's human left the room mid-game; sits out from now on. */
  left: boolean;
  debt: number;
  ready: boolean;
  /** Seat badge only (chips<=0 && !allIn); full history is GameSnapshot.busted. */
  busted: boolean;
  isDealer: boolean;
  isSB: boolean;
  isBB: boolean;
  lastAction: PlayerActionName | null;
  inHand: boolean;
  /** Card codes like "As", or ["back","back"] when hidden. */
  holeCards: string[];
  handLabel: string;
  isMe: boolean;
  /** Three-card: player has peeked this hand — public, and they bet at 2×. */
  looked?: boolean;
  /** Three-card: cards were shown to everyone (compare loss or showdown). */
  revealed?: boolean;
}

export interface RequiredReadyPlayer {
  id: string;
  name: string;
  isBot: boolean;
  ready: boolean;
}

export interface BustRecord {
  id: string;
  name: string;
}

/** Fields every game snapshot carries. */
export interface GameSnapshotBase {
  handId: number;
  pot: number;
  /** Current street/round bet level (face value; three-card looked players owe 2×). */
  currentBet: number;
  message: string;
  handOver: boolean;
  gameOver: boolean;
  readyIds: string[];
  /** Seats that must ready to deal (chips > 0); bots report ready: true. */
  requiredReady: RequiredReadyPlayer[];
  /** Append-only bust history; borrowing does not clear it. */
  busted: BustRecord[];
  actionPlayerId: string | null;
  actionPlayerName: string | null;
  lastResults: HandResultLine[] | null;
  /** Showdown happened — all in-play hole cards revealed. */
  revealAll: boolean;
  /** Button seat (hold'em D / three-card first-to-act rotation anchor). */
  dealerSeat: number;
  players: PlayerView[];
  myLegal: LegalActions | null;
  iAmInGame: boolean;
}

export interface HoldemGameSnapshot extends GameSnapshotBase {
  kind: "holdem";
  phase: HoldemPhase;
  /** Card codes; length 0/3/4/5. */
  board: string[];
  smallBlind: number;
  bigBlind: number;
}

export interface TpGameSnapshot extends GameSnapshotBase {
  kind: "tp";
  phase: TpPhase;
  /** Forced entry chips every dealt player paid. */
  ante: number;
}

export type GameSnapshot = HoldemGameSnapshot | TpGameSnapshot;

export interface RoomSnapshot {
  roomId: string;
  name: string;
  /** Ruleset chosen at creation; drives snapshot narrowing. */
  kind: GameKind;
  status: RoomStatus;
  hostId: string;
  hostName: string;
  /** Chat cheats on? Host toggles this on the room page; default on. */
  cheatEnabled: boolean;
  /** Hold'em only: short deck (6+) mode? Host toggles next to the cheat switch; default false = 长牌. */
  shortDeck: boolean;
  humanPlayers: { id: string; name: string }[];
  /** Host-added bots; they take seats like humans once the game starts. */
  botPlayers: { id: string; name: string }[];
  spectators: { id: string; name: string }[];
  maxPlayers: number;
  chat: ChatMessage[];
  chatTotal: number;
  borrowRequests: { id: string; fromId: string; fromName: string; toId: string; amount: number }[];
  game: GameSnapshot | null;
}

// ---------------------------------------------------------------------------
// client → server
// ---------------------------------------------------------------------------

export type ClientMessage =
  | { type: "setNickname"; payload: { nickname: string; playerId?: string } }
  | { type: "listRooms" }
  | { type: "createRoom"; payload: { name?: string; kind?: GameKind } }
  | { type: "joinRoom"; payload: { roomId: string } }
  | { type: "leaveRoom" }
  | { type: "addBot" }
  | { type: "removeBot" }
  | { type: "startGame" }
  | { type: "ready" }
  | { type: "repay" }
  | { type: "borrowRequest"; payload: { targetId: string; amount: number } }
  | { type: "borrowRespond"; payload: { requestId: string; accept: boolean } }
  | { type: "setCheat"; payload: { enabled: boolean } }
  | { type: "setShortDeck"; payload: { enabled: boolean } }
  | { type: "action"; payload: { action: PlayerActionName; amount?: number; targetId?: string } }
  | { type: "chat"; payload: { text: string } }
  | { type: "sync" };

export type ClientMessageType = ClientMessage["type"];

// ---------------------------------------------------------------------------
// server → client
// ---------------------------------------------------------------------------

export type ServerMessage =
  | { type: "rooms"; payload: RoomListItem[] }
  | { type: "profile"; payload: ProfilePayload }
  | { type: "joined"; payload: JoinedPayload }
  | { type: "room"; payload: RoomSnapshot }
  | { type: "error"; payload: { message: string } }
  | { type: "left" };

export interface ProfilePayload {
  playerId: string;
  nickname: string;
}

export interface JoinedPayload {
  roomId: string;
  role: RoomRole;
  playerId: string;
  nickname: string;
  /** Absent on the createRoom path (role is already "host"). */
  isHost?: boolean;
}
