// The wire contract between client and server — ONE source of truth.
// Both directions are `{ type, payload? }`; both sides ship together,
// so there is no compatibility layer between them.
//
// Server-internal types (Card, Player, GameState) live in server/game/types.ts;
// only what crosses the wire is defined here.

export type RoomStatus = "waiting" | "playing";

/** Values must match engine phases; duplicated here so the client never imports server code. */
export type GamePhase = "idle" | "preflop" | "flop" | "turn" | "river" | "showdown";

export type RoomRole = "host" | "player" | "spectator";

/** Player-chosen action names on the wire (raise amount is raise-TO, not a delta). */
export type PlayerActionName = "fold" | "check" | "call" | "raise" | "allin";

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
  needToCall: number;
  canCheck: boolean;
  canCall: boolean;
  minRaiseTo: number;
  maxRaiseTo: number;
  pot: number;
  currentBet: number;
  chips: number;
  roundBet: number;
  bigBlind: number;
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

export interface GameSnapshot {
  handId: number;
  phase: GamePhase;
  /** Card codes; length 0/3/4/5. */
  board: string[];
  pot: number;
  currentBet: number;
  smallBlind: number;
  bigBlind: number;
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
  /** Showdown happened — all hole cards revealed. */
  revealAll: boolean;
  dealerSeat: number;
  players: PlayerView[];
  myLegal: LegalActions | null;
  iAmInGame: boolean;
}

export interface RoomSnapshot {
  roomId: string;
  name: string;
  status: RoomStatus;
  hostId: string;
  hostName: string;
  /** Chat cheats on? Host toggles this on the room page; default on. */
  cheatEnabled: boolean;
  /** Short deck (6+, 36 cards) mode? Host toggles next to the cheat switch; default false = 长牌. */
  shortDeck: boolean;
  humanPlayers: { id: string; name: string }[];
  /** Host-added bots; they take seats like humans once the game starts. */
  botPlayers: { id: string; name: string }[];
  spectators: { id: string; name: string }[];
  maxPlayers: number;
  chat: ChatMessage[];
  chatTotal: number;
  game: GameSnapshot | null;
}

// ---------------------------------------------------------------------------
// client → server
// ---------------------------------------------------------------------------

export type ClientMessage =
  | { type: "setNickname"; payload: { nickname: string; playerId?: string } }
  | { type: "listRooms" }
  | { type: "createRoom"; payload: { name?: string } }
  | { type: "joinRoom"; payload: { roomId: string } }
  | { type: "leaveRoom" }
  | { type: "addBot" }
  | { type: "removeBot" }
  | { type: "startGame" }
  | { type: "ready" }
  | { type: "repay" }
  | { type: "setCheat"; payload: { enabled: boolean } }
  | { type: "setShortDeck"; payload: { enabled: boolean } }
  | { type: "action"; payload: { action: PlayerActionName; amount?: number } }
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
