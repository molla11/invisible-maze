import { cookies } from "next/headers";
import { appendGameEvent, createGame, heartbeat } from "@/lib/game/engine";
import type { Direction, EmoteType, GameState, PlayerSlot } from "@/lib/game/types";

type Session = {
  id: string;
  createdAt: number;
  linkedProvider?: "google";
};

type QueueEntry = {
  playerId: string;
  createdAt: number;
};

type Room = {
  code: string;
  hostId: string;
  guestId?: string;
  gameId?: string;
  createdAt: number;
};

type StoreState = {
  sessions: Map<string, Session>;
  queue?: QueueEntry;
  rooms: Map<string, Room>;
  games: Map<string, GameState>;
};

const globalForStore = globalThis as unknown as { invisibleMazeStore?: StoreState };

const initialStore: StoreState = {
  sessions: new Map(),
  rooms: new Map(),
  games: new Map()
};

const store: StoreState =
  globalForStore.invisibleMazeStore ??
  (globalForStore.invisibleMazeStore = initialStore);

const cookieName = "im_session";

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`;
}

function roomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

export async function requireSession(): Promise<Session> {
  const jar = await cookies();
  const existing = jar.get(cookieName)?.value;
  if (existing && store.sessions.has(existing)) return store.sessions.get(existing)!;

  const session = { id: id("anon"), createdAt: Date.now() };
  store.sessions.set(session.id, session);
  jar.set(cookieName, session.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365
  });
  return session;
}

export function publicStats() {
  const activeSince = Date.now() - 60_000;
  const online = [...store.games.values()].reduce(
    (count, game) =>
      count +
      Number(game.players.A.connectedAt > activeSince) +
      Number(game.players.B.connectedAt > activeSince),
    0
  );

  return {
    online,
    waitingInQueue: store.queue ? 1 : 0,
    activeGames: [...store.games.values()].filter((game) => game.status !== "finished").length
  };
}

function findActiveGameForPlayer(playerId: string): GameState | undefined {
  return [...store.games.values()].find(
    (game) => game.status !== "finished" && (game.players.A.id === playerId || game.players.B.id === playerId)
  );
}

function cancelQueueForPlayer(playerId: string) {
  if (store.queue?.playerId === playerId) store.queue = undefined;
}

function cancelOpenRoomsForPlayer(playerId: string) {
  for (const [code, room] of store.rooms) {
    if (room.hostId === playerId && !room.guestId && !room.gameId) store.rooms.delete(code);
  }
}

export async function createRoom() {
  const session = await requireSession();
  cancelQueueForPlayer(session.id);
  cancelOpenRoomsForPlayer(session.id);
  let code = roomCode();
  while (store.rooms.has(code)) code = roomCode();
  const room: Room = { code, hostId: session.id, createdAt: Date.now() };
  store.rooms.set(code, room);
  return { session, room };
}

export async function joinRoom(code: string) {
  const session = await requireSession();
  const room = store.rooms.get(code.toUpperCase());
  if (!room) throw new Error("room_not_found");
  if (room.hostId === session.id) return { session, room };
  if (room.guestId && room.guestId !== session.id) throw new Error("room_full");
  room.guestId = session.id;

  if (!room.gameId) {
    const gameId = id("game");
    const game = createGame(gameId, room.hostId, room.guestId, room.code);
    room.gameId = gameId;
    store.games.set(gameId, game);
  }

  return { session, room };
}

export async function getRoomStatus(code: string) {
  const session = await requireSession();
  const room = store.rooms.get(code.toUpperCase());
  if (!room) throw new Error("room_not_found");
  if (room.hostId !== session.id && room.guestId !== session.id) throw new Error("not_in_room");
  return { session, room };
}

export async function joinQueue() {
  const session = await requireSession();
  const activeGame = findActiveGameForPlayer(session.id);
  if (activeGame) return { session, status: "matched" as const, gameId: activeGame.id };
  cancelOpenRoomsForPlayer(session.id);

  const waiting = store.queue;
  if (waiting && waiting.playerId !== session.id) {
    const gameId = id("game");
    const game = createGame(gameId, waiting.playerId, session.id);
    store.games.set(gameId, game);
    store.queue = undefined;
    return { session, status: "matched" as const, gameId };
  }

  store.queue = { playerId: session.id, createdAt: Date.now() };
  return { session, status: "queued" as const };
}

export async function cancelQueue() {
  const session = await requireSession();
  if (store.queue?.playerId === session.id) store.queue = undefined;
  return { session, status: "cancelled" as const };
}

export async function getGame(gameId: string) {
  const session = await requireSession();
  const game = store.games.get(gameId);
  if (!game) throw new Error("game_not_found");
  heartbeat(game, session.id);
  return { session, game };
}

export async function submitGameAction(gameId: string, steps: Direction[]) {
  const { session, game } = await getGame(gameId);
  const { submitSteps } = await import("@/lib/game/engine");
  submitSteps(game, session.id, steps);
  return { session, game };
}

export async function surrenderGame(gameId: string) {
  const { session, game } = await getGame(gameId);
  const { surrender } = await import("@/lib/game/engine");
  surrender(game, session.id);
  return { session, game };
}

export async function sendGameEmote(gameId: string, emote: EmoteType) {
  const { session, game } = await getGame(gameId);
  const { sendEmote } = await import("@/lib/game/engine");
  sendEmote(game, session.id, emote);
  return { session, game };
}

export async function requestGameRematch(gameId: string) {
  const { session, game } = await getGame(gameId);
  if (game.status !== "finished") throw new Error("game_not_finished");
  if (!game.rematch || Date.now() > game.rematch.expiresAt) throw new Error("rematch_expired");

  const slot = game.players.A.id === session.id ? "A" : game.players.B.id === session.id ? "B" : undefined;
  if (!slot) throw new Error("player_not_in_game");

  if (game.rematch.nextGameId) return { session, game, nextGameId: game.rematch.nextGameId };

  if (!game.rematch.requestedBy.includes(slot)) {
    game.rematch.requestedBy.push(slot);
    appendGameEvent(game, "rematch_requested", { player: slot });
  }

  if (game.rematch.requestedBy.length === 2) {
    const nextGameId = id("game");
    const nextGame = createGame(nextGameId, game.players.A.id, game.players.B.id, game.roomCode);
    store.games.set(nextGameId, nextGame);
    game.rematch.nextGameId = nextGameId;
    appendGameEvent(game, "rematch_started", { gameId: nextGameId });
  }

  return { session, game, nextGameId: game.rematch.nextGameId };
}

export async function heartbeatGame(gameId: string) {
  const { session, game } = await getGame(gameId);
  heartbeat(game, session.id);
  return { session, game };
}

export function sanitizeGame(game: GameState, viewerId: string) {
  const slot: PlayerSlot | undefined = game.players.A.id === viewerId ? "A" : game.players.B.id === viewerId ? "B" : undefined;
  const now = Date.now();
  const publicPlayer = (player: GameState["players"][PlayerSlot]) => ({
    position: player.position,
    goal: player.goal,
    missedTurns: player.missedTurns
  });

  return {
    id: game.id,
    status: game.status,
    players: {
      A: publicPlayer(game.players.A),
      B: publicPlayer(game.players.B)
    },
    currentTurn: game.status !== "waiting" && (game.status !== "coin" || now >= game.coinRevealAt) ? game.currentTurn : undefined,
    coinTossStartsAt: game.coinTossStartsAt,
    coinRevealAt: game.coinRevealAt,
    gameStartsAt: game.gameStartsAt,
    turnStepsUsed: game.turnStepsUsed,
    turnDeadlineAt: game.turnDeadlineAt,
    winner: game.winner,
    winReason: game.winReason,
    rematch: game.rematch,
    emotes: game.emotes,
    revealedWalls: game.revealedWalls,
    events: game.events.slice(-20),
    viewerSlot: slot,
    updatedAt: game.updatedAt
  };
}
