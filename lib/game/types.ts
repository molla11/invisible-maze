export const BOARD_SIZE = 8;
export const TURN_SECONDS = 30;
export const WALL_REVEAL_MS = 10_000;
export const DISCONNECT_FORFEIT_MS = 60_000;

export type PlayerSlot = "A" | "B";
export type Direction = "up" | "right" | "down" | "left";
export type GameStatus = "waiting" | "coin" | "playing" | "finished";
export type GameEventType =
  | "game_created"
  | "coin_tossed"
  | "move"
  | "wall_hit"
  | "turn_skipped"
  | "timeout_forfeit"
  | "disconnect_forfeit"
  | "win";

export type Point = {
  x: number;
  y: number;
};

export type PlayerState = {
  id: string;
  name: string;
  slot: PlayerSlot;
  position: Point;
  goal: Point;
  connectedAt: number;
  missedTurns: number;
};

export type RevealedWall = {
  key: string;
  expiresAt: number;
};

export type GameEvent = {
  id: string;
  at: number;
  type: GameEventType;
  payload: Record<string, unknown>;
};

export type Maze = {
  size: number;
  walls: string[];
  seed: number;
};

export type GameState = {
  id: string;
  roomCode?: string;
  status: GameStatus;
  maze: Maze;
  players: Record<PlayerSlot, PlayerState>;
  currentTurn: PlayerSlot;
  turnStepsUsed: number;
  turnStartPosition: Point;
  turnStartedAt: number;
  turnDeadlineAt: number;
  winner?: PlayerSlot;
  winReason?: string;
  revealedWalls: RevealedWall[];
  events: GameEvent[];
  createdAt: number;
  updatedAt: number;
};

export const startFor = (slot: PlayerSlot): Point =>
  slot === "A" ? { x: 0, y: 0 } : { x: BOARD_SIZE - 1, y: 0 };

export const goalFor = (slot: PlayerSlot): Point =>
  slot === "A" ? { x: BOARD_SIZE - 1, y: BOARD_SIZE - 1 } : { x: 0, y: BOARD_SIZE - 1 };

export const oppositeSlot = (slot: PlayerSlot): PlayerSlot => (slot === "A" ? "B" : "A");
