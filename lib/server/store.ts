import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { advanceClock, appendGameEvent, createGame, heartbeat } from "@/lib/game/engine";
import { shortestPath } from "@/lib/game/maze";
import { goalFor, startFor, type Direction, type EmoteType, type GameState, type GameStatus, type PlayerSlot } from "@/lib/game/types";

type Session = {
  id: string;
  createdAt: number;
  seenAt: number;
  linkedProvider?: "google";
};

type QueueEntry = {
  playerId: string;
  createdAt: number;
};

type PresenceConnection = {
  sessionId: string;
  connectedAt: number;
  seenAt: number;
};

type Room = {
  id?: string;
  code: string;
  hostId: string;
  guestId?: string;
  gameId?: string;
  createdAt: number;
};

type StoreState = {
  sessions: Map<string, Session>;
  presenceConnections: Map<string, PresenceConnection>;
  queue?: QueueEntry;
  rooms: Map<string, Room>;
  games: Map<string, GameState>;
};

type DbRoom = {
  id: string;
  code: string;
  host_id: string;
  guest_id: string | null;
  game_id: string | null;
  created_at: string;
};

type DbGame = {
  id: string;
  room_id: string | null;
  status: GameStatus;
  state: GameState;
};

const globalForStore = globalThis as unknown as {
  invisibleMazeStore?: StoreState;
  invisibleMazeSupabase?: SupabaseClient;
};

const initialStore: StoreState = {
  sessions: new Map(),
  presenceConnections: new Map(),
  rooms: new Map(),
  games: new Map()
};

const store: StoreState =
  globalForStore.invisibleMazeStore ??
  (globalForStore.invisibleMazeStore = initialStore);

const cookieName = "im_session";
const heartbeatSaveIntervalMs = 5_000;
const presenceWindowMs = 60_000;
const presenceStaleMs = 25_000;

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`;
}

function gameId(): string {
  return crypto.randomUUID();
}

function roomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

function supabaseAdmin(): SupabaseClient | undefined {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return undefined;

  return (
    globalForStore.invisibleMazeSupabase ??
    (globalForStore.invisibleMazeSupabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false }
    }))
  );
}

function dbRoom(row: DbRoom): Room {
  return {
    id: row.id,
    code: row.code,
    hostId: row.host_id,
    guestId: row.guest_id ?? undefined,
    gameId: row.game_id ?? undefined,
    createdAt: Date.parse(row.created_at)
  };
}

function iso(ms: number): string {
  return new Date(ms || 0).toISOString();
}

function gameUpsert(game: GameState, roomId?: string) {
  return {
    id: game.id,
    ...(roomId ? { room_id: roomId } : {}),
    status: game.status,
    state: game,
    maze: game.maze,
    current_turn: game.currentTurn,
    turn_started_at: iso(game.turnStartedAt),
    turn_deadline_at: iso(game.turnDeadlineAt),
    winner: game.winner ?? null,
    win_reason: game.winReason ?? null,
    revealed_walls: game.revealedWalls,
    created_at: iso(game.createdAt),
    updated_at: iso(game.updatedAt)
  };
}

async function dbSaveGame(admin: SupabaseClient, game: GameState, roomId?: string) {
  const { error } = await admin.from("games").upsert(gameUpsert(game, roomId), { onConflict: "id" });
  if (error) throw new Error(error.message);
}

async function dbSaveGamePlayers(admin: SupabaseClient, game: GameState) {
  const players = (["A", "B"] as PlayerSlot[]).map((slot) => ({
    game_id: game.id,
    profile_id: game.players[slot].id,
    slot,
    position: game.players[slot].position,
    goal: game.players[slot].goal,
    connected_at: iso(game.players[slot].connectedAt),
    missed_turns: game.players[slot].missedTurns
  }));
  const { error: playersError } = await admin.from("game_players").upsert(players, { onConflict: "game_id,slot" });
  if (playersError) throw new Error(playersError.message);
}

function shouldPersistReadHeartbeat(game: GameState, viewerId: string, previousUpdatedAt: number, previousConnectedAt: number) {
  if (game.updatedAt !== previousUpdatedAt) return true;
  const slot: PlayerSlot | undefined = game.players.A.id === viewerId ? "A" : game.players.B.id === viewerId ? "B" : undefined;
  if (!slot) return false;
  return game.players[slot].connectedAt - previousConnectedAt >= heartbeatSaveIntervalMs;
}

async function dbLoadGame(admin: SupabaseClient, gameId: string): Promise<GameState> {
  const { data, error } = await admin.from("games").select("id, room_id, status, state").eq("id", gameId).maybeSingle<DbGame>();
  if (error) throw new Error(error.message);
  if (!data?.state) throw new Error("game_not_found");
  return data.state;
}

async function dbCreateGame(admin: SupabaseClient, playerA: string, playerB: string, roomCodeValue?: string, roomId?: string) {
  const game = createGame(gameId(), playerA, playerB, roomCodeValue);
  await dbSaveGame(admin, game, roomId);
  await dbSaveGamePlayers(admin, game);
  await admin.from("match_queue").delete().in("profile_id", [playerA, playerB]);
  return game;
}

async function dbRequireSession(admin: SupabaseClient): Promise<Session> {
  const jar = await cookies();
  const token = jar.get(cookieName)?.value ?? id("anon");
  const seenAt = Date.now();
  const { data, error } = await admin
    .from("profiles")
    .upsert({ anonymous_token: token, updated_at: iso(seenAt) }, { onConflict: "anonymous_token" })
    .select("id, created_at")
    .single<{ id: string; created_at: string }>();

  if (error) throw new Error(error.message);
  jar.set(cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365
  });

  return { id: data.id, createdAt: Date.parse(data.created_at), seenAt };
}

async function dbFindActiveGameForPlayer(admin: SupabaseClient, playerId: string): Promise<string | undefined> {
  const { data: playerRows, error: playerError } = await admin.from("game_players").select("game_id").eq("profile_id", playerId);
  if (playerError) throw new Error(playerError.message);
  const ids = (playerRows ?? []).map((row) => row.game_id as string);
  if (ids.length === 0) return undefined;

  const { data, error } = await admin
    .from("games")
    .select("id")
    .in("id", ids)
    .neq("status", "finished")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (error) throw new Error(error.message);
  return data?.id;
}

async function dbCancelOpenRoomsForPlayer(admin: SupabaseClient, playerId: string) {
  const { error } = await admin.from("rooms").delete().eq("host_id", playerId).is("guest_id", null).is("game_id", null);
  if (error) throw new Error(error.message);
}

function isMissingPresenceTable(error: { code?: string; message?: string }) {
  return error.code === "42P01" || Boolean(error.message?.includes("presence_connections"));
}

async function dbLoadRecentlySeenProfileIds(admin: SupabaseClient) {
  const { data, error } = await admin
    .from("profiles")
    .select("id")
    .gte("updated_at", iso(Date.now() - presenceWindowMs));
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((profile) => profile.id as string));
}

async function dbLoadOnlineProfileIds(admin: SupabaseClient) {
  const activeSince = iso(Date.now() - presenceStaleMs);
  const { error: pruneError } = await admin.from("presence_connections").delete().lt("updated_at", activeSince);
  if (pruneError) {
    if (isMissingPresenceTable(pruneError)) return dbLoadRecentlySeenProfileIds(admin);
    throw new Error(pruneError.message);
  }

  const { data, error } = await admin.from("presence_connections").select("profile_id").gte("updated_at", activeSince);
  if (error) {
    if (isMissingPresenceTable(error)) return dbLoadRecentlySeenProfileIds(admin);
    throw new Error(error.message);
  }

  return new Set((data ?? []).map((connection) => connection.profile_id as string));
}

async function dbPruneStaleQueue(admin: SupabaseClient) {
  const [onlineProfileIds, { data, error }] = await Promise.all([
    dbLoadOnlineProfileIds(admin),
    admin.from("match_queue").select("profile_id")
  ]);
  if (error) throw new Error(error.message);
  const queuedProfileIds = (data ?? []).map((row) => row.profile_id as string);
  if (queuedProfileIds.length === 0) return;

  const staleProfileIds = queuedProfileIds.filter((profileId) => !onlineProfileIds.has(profileId));
  if (staleProfileIds.length === 0) return;

  const { error: deleteError } = await admin.from("match_queue").delete().in("profile_id", staleProfileIds);
  if (deleteError) throw new Error(deleteError.message);
}

export async function requireSession(): Promise<Session> {
  const admin = supabaseAdmin();
  if (admin) return dbRequireSession(admin);

  const jar = await cookies();
  const existing = jar.get(cookieName)?.value;
  const seenAt = Date.now();
  if (existing && store.sessions.has(existing)) {
    const session = store.sessions.get(existing)!;
    session.seenAt = seenAt;
    return session;
  }

  const session = { id: id("anon"), createdAt: seenAt, seenAt };
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

export async function openPresenceConnection() {
  const session = await requireSession();
  const connectionId = id("presence");
  await touchPresenceConnection(connectionId, session.id);
  return { session, connectionId };
}

export async function touchPresenceConnection(connectionId: string, sessionId: string) {
  const seenAt = Date.now();
  const admin = supabaseAdmin();
  if (admin) {
    const { error } = await admin.from("presence_connections").upsert(
      {
        id: connectionId,
        profile_id: sessionId,
        updated_at: iso(seenAt)
      },
      { onConflict: "id" }
    );
    if (error) {
      if (isMissingPresenceTable(error)) return;
      throw new Error(error.message);
    }
    return;
  }

  store.presenceConnections.set(connectionId, {
    sessionId,
    connectedAt: store.presenceConnections.get(connectionId)?.connectedAt ?? seenAt,
    seenAt
  });
}

export async function closePresenceConnection(connectionId: string) {
  const admin = supabaseAdmin();
  if (admin) {
    const { error } = await admin.from("presence_connections").delete().eq("id", connectionId);
    if (error && !isMissingPresenceTable(error)) throw new Error(error.message);
    return;
  }

  store.presenceConnections.delete(connectionId);
}

function localOnlineSessionIds() {
  const presenceActiveSince = Date.now() - presenceStaleMs;
  for (const [connectionId, connection] of store.presenceConnections) {
    if (connection.seenAt <= presenceActiveSince) store.presenceConnections.delete(connectionId);
  }

  return new Set(
    [...store.presenceConnections.values()]
      .filter((connection) => connection.seenAt > presenceActiveSince)
      .map((connection) => connection.sessionId)
  );
}

export async function publicStats() {
  const admin = supabaseAdmin();
  if (admin) {
    const [onlineProfileIds, { count: activeGames }, { data: queuedProfiles, error: queueError }] = await Promise.all([
      dbLoadOnlineProfileIds(admin),
      admin.from("games").select("id", { count: "exact", head: true }).neq("status", "finished"),
      admin.from("match_queue").select("profile_id")
    ]);
    if (queueError) throw new Error(queueError.message);

    const queuedProfileIds = (queuedProfiles ?? []).map((row) => row.profile_id as string);

    return {
      online: onlineProfileIds.size,
      waitingInQueue: queuedProfileIds.filter((profileId) => onlineProfileIds.has(profileId)).length,
      activeGames: activeGames ?? 0
    };
  }

  for (const game of store.games.values()) advanceClock(game);
  const onlineSessionIds = localOnlineSessionIds();

  return {
    online: onlineSessionIds.size,
    waitingInQueue: store.queue && onlineSessionIds.has(store.queue.playerId) ? 1 : 0,
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

function pruneStaleQueue() {
  if (store.queue && !localOnlineSessionIds().has(store.queue.playerId)) store.queue = undefined;
}

function cancelOpenRoomsForPlayer(playerId: string) {
  for (const [code, room] of store.rooms) {
    if (room.hostId === playerId && !room.guestId && !room.gameId) store.rooms.delete(code);
  }
}

export async function createRoom() {
  const admin = supabaseAdmin();
  if (admin) {
    const session = await dbRequireSession(admin);
    await admin.from("match_queue").delete().eq("profile_id", session.id);
    await dbCancelOpenRoomsForPlayer(admin, session.id);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { data, error } = await admin
        .from("rooms")
        .insert({ code: roomCode(), host_id: session.id })
        .select("id, code, host_id, guest_id, game_id, created_at")
        .single<DbRoom>();
      if (!error && data) return { session, room: dbRoom(data) };
      if (!error || error.code !== "23505") throw new Error(error.message);
    }
    throw new Error("room_code_generation_failed");
  }

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
  const admin = supabaseAdmin();
  if (admin) {
    const session = await dbRequireSession(admin);
    const normalized = code.toUpperCase();
    const { data: existing, error } = await admin
      .from("rooms")
      .select("id, code, host_id, guest_id, game_id, created_at")
      .eq("code", normalized)
      .maybeSingle<DbRoom>();
    if (error) throw new Error(error.message);
    if (!existing) throw new Error("room_not_found");
    if (existing.host_id === session.id) return { session, room: dbRoom(existing) };
    if (existing.guest_id && existing.guest_id !== session.id) throw new Error("room_full");

    let room = existing;
    if (!room.guest_id) {
      const { data: updated, error: updateError } = await admin
        .from("rooms")
        .update({ guest_id: session.id })
        .eq("id", room.id)
        .is("guest_id", null)
        .select("id, code, host_id, guest_id, game_id, created_at")
        .maybeSingle<DbRoom>();
      if (updateError) throw new Error(updateError.message);
      if (!updated) throw new Error("room_full");
      room = updated;
    }

    if (!room.game_id && room.guest_id) {
      const game = await dbCreateGame(admin, room.host_id, room.guest_id, room.code, room.id);
      const { data: updated, error: updateError } = await admin
        .from("rooms")
        .update({ game_id: game.id })
        .eq("id", room.id)
        .select("id, code, host_id, guest_id, game_id, created_at")
        .single<DbRoom>();
      if (updateError) throw new Error(updateError.message);
      room = updated;
    }

    return { session, room: dbRoom(room) };
  }

  const session = await requireSession();
  const room = store.rooms.get(code.toUpperCase());
  if (!room) throw new Error("room_not_found");
  if (room.hostId === session.id) return { session, room };
  if (room.guestId && room.guestId !== session.id) throw new Error("room_full");
  room.guestId = session.id;

  if (!room.gameId) {
    const nextGameId = id("game");
    const game = createGame(nextGameId, room.hostId, room.guestId, room.code);
    room.gameId = nextGameId;
    store.games.set(nextGameId, game);
  }

  return { session, room };
}

export async function getRoomStatus(code: string) {
  const admin = supabaseAdmin();
  if (admin) {
    const session = await dbRequireSession(admin);
    const { data, error } = await admin
      .from("rooms")
      .select("id, code, host_id, guest_id, game_id, created_at")
      .eq("code", code.toUpperCase())
      .maybeSingle<DbRoom>();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("room_not_found");
    if (data.host_id !== session.id && data.guest_id !== session.id) throw new Error("not_in_room");
    return { session, room: dbRoom(data) };
  }

  const session = await requireSession();
  const room = store.rooms.get(code.toUpperCase());
  if (!room) throw new Error("room_not_found");
  if (room.hostId !== session.id && room.guestId !== session.id) throw new Error("not_in_room");
  return { session, room };
}

export async function joinQueue() {
  const admin = supabaseAdmin();
  if (admin) {
    const session = await dbRequireSession(admin);
    const activeGameId = await dbFindActiveGameForPlayer(admin, session.id);
    if (activeGameId) {
      await admin.from("match_queue").delete().eq("profile_id", session.id);
      return { session, status: "matched" as const, gameId: activeGameId };
    }
    await dbCancelOpenRoomsForPlayer(admin, session.id);
    await dbPruneStaleQueue(admin);

    const { data, error } = await admin.rpc("dequeue_match", { requesting_profile: session.id });
    if (error) throw new Error(error.message);

    const opponentId = Array.isArray(data) ? (data[0]?.opponent_id as string | undefined) : undefined;
    if (opponentId) {
      const game = await dbCreateGame(admin, opponentId, session.id);
      return { session, status: "matched" as const, gameId: game.id };
    }

    return { session, status: "queued" as const };
  }

  const session = await requireSession();
  const activeGame = findActiveGameForPlayer(session.id);
  if (activeGame) return { session, status: "matched" as const, gameId: activeGame.id };
  cancelOpenRoomsForPlayer(session.id);
  pruneStaleQueue();

  const waiting = store.queue;
  if (waiting && waiting.playerId !== session.id) {
    const nextGameId = id("game");
    const game = createGame(nextGameId, waiting.playerId, session.id);
    store.games.set(nextGameId, game);
    store.queue = undefined;
    return { session, status: "matched" as const, gameId: nextGameId };
  }

  store.queue = { playerId: session.id, createdAt: Date.now() };
  return { session, status: "queued" as const };
}

export async function cancelQueue() {
  const admin = supabaseAdmin();
  if (admin) {
    const session = await dbRequireSession(admin);
    const { error } = await admin.from("match_queue").delete().eq("profile_id", session.id);
    if (error) throw new Error(error.message);
    return { session, status: "cancelled" as const };
  }

  const session = await requireSession();
  if (store.queue?.playerId === session.id) store.queue = undefined;
  return { session, status: "cancelled" as const };
}

export async function getMatchStatus() {
  const admin = supabaseAdmin();
  if (admin) {
    const session = await dbRequireSession(admin);
    const activeGameId = await dbFindActiveGameForPlayer(admin, session.id);
    if (activeGameId) {
      await admin.from("match_queue").delete().eq("profile_id", session.id);
      return { session, status: "matched" as const, gameId: activeGameId };
    }

    const { data, error } = await admin
      .from("match_queue")
      .select("id")
      .eq("profile_id", session.id)
      .maybeSingle<{ id: string }>();
    if (error) throw new Error(error.message);
    return { session, status: data ? ("queued" as const) : ("idle" as const) };
  }

  const session = await requireSession();
  const activeGame = findActiveGameForPlayer(session.id);
  if (activeGame) return { session, status: "matched" as const, gameId: activeGame.id };
  if (store.queue?.playerId === session.id) return { session, status: "queued" as const };
  pruneStaleQueue();
  return { session, status: "idle" as const };
}

export async function getGame(gameIdValue: string) {
  const admin = supabaseAdmin();
  if (admin) {
    const session = await dbRequireSession(admin);
    const game = await dbLoadGame(admin, gameIdValue);
    const slot: PlayerSlot | undefined = game.players.A.id === session.id ? "A" : game.players.B.id === session.id ? "B" : undefined;
    const previousConnectedAt = slot ? game.players[slot].connectedAt : 0;
    const previousUpdatedAt = game.updatedAt;
    heartbeat(game, session.id);
    advanceClock(game);
    if (shouldPersistReadHeartbeat(game, session.id, previousUpdatedAt, previousConnectedAt)) {
      await dbSaveGame(admin, game);
    }
    return { session, game };
  }

  const session = await requireSession();
  const game = store.games.get(gameIdValue);
  if (!game) throw new Error("game_not_found");
  heartbeat(game, session.id);
  return { session, game };
}

export async function submitGameAction(gameIdValue: string, steps: Direction[]) {
  const { session, game } = await getGame(gameIdValue);
  const { submitSteps } = await import("@/lib/game/engine");
  submitSteps(game, session.id, steps);

  const admin = supabaseAdmin();
  if (admin) await dbSaveGame(admin, game);
  return { session, game };
}

export async function surrenderGame(gameIdValue: string) {
  const { session, game } = await getGame(gameIdValue);
  const { surrender } = await import("@/lib/game/engine");
  surrender(game, session.id);

  const admin = supabaseAdmin();
  if (admin) await dbSaveGame(admin, game);
  return { session, game };
}

export async function sendGameEmote(gameIdValue: string, emote: EmoteType) {
  const { session, game } = await getGame(gameIdValue);
  const { sendEmote } = await import("@/lib/game/engine");
  sendEmote(game, session.id, emote);

  const admin = supabaseAdmin();
  if (admin) await dbSaveGame(admin, game);
  return { session, game };
}

export async function requestGameRematch(gameIdValue: string) {
  const { session, game } = await getGame(gameIdValue);
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
    const nextGameIdValue = supabaseAdmin() ? gameId() : id("game");
    const nextGame = createGame(nextGameIdValue, game.players.A.id, game.players.B.id, game.roomCode);
    game.rematch.nextGameId = nextGameIdValue;
    appendGameEvent(game, "rematch_started", { gameId: nextGameIdValue });

    const admin = supabaseAdmin();
    if (admin) {
      await dbSaveGame(admin, nextGame);
      await dbSaveGamePlayers(admin, nextGame);
    } else {
      store.games.set(nextGameIdValue, nextGame);
    }
  }

  const admin = supabaseAdmin();
  if (admin) await dbSaveGame(admin, game);
  return { session, game, nextGameId: game.rematch.nextGameId };
}

export async function heartbeatGame(gameIdValue: string) {
  const { session, game } = await getGame(gameIdValue);
  return { session, game };
}

export function sanitizeGame(game: GameState, viewerId: string) {
  const slot: PlayerSlot | undefined = game.players.A.id === viewerId ? "A" : game.players.B.id === viewerId ? "B" : undefined;
  const now = Date.now();
  const publicPlayer = (player: GameState["players"][PlayerSlot]) => ({
    position: player.position,
    goal: player.goal,
    missedTurns: player.missedTurns,
    connectedAt: player.connectedAt
  });
  const wallHits =
    game.status === "finished"
      ? game.events.reduce<Record<string, PlayerSlot[]>>((hits, event) => {
          if (event.type !== "wall_hit") return hits;
          const wall = event.payload.wall;
          const player = event.payload.player;
          if (typeof wall !== "string" || (player !== "A" && player !== "B")) return hits;
          const slots = hits[wall] ?? [];
          if (!slots.includes(player)) slots.push(player);
          hits[wall] = slots;
          return hits;
        }, {})
      : undefined;

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
    mazeStats: {
      shortestPath: shortestPath(game.maze, startFor("A"), goalFor("A")),
      walls: game.maze.walls.length
    },
    mazeWalls: game.status === "finished" ? game.maze.walls : undefined,
    wallHits,
    events: game.events.slice(-20),
    viewerSlot: slot,
    updatedAt: game.updatedAt
  };
}
