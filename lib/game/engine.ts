import {
  COIN_TOSS_MS,
  DISCONNECT_FORFEIT_MS,
  EMOTE_BLOCK_MS,
  EMOTE_LIMIT,
  EMOTE_WINDOW_MS,
  MATCH_READY_MS,
  REMATCH_WINDOW_MS,
  START_COUNTDOWN_MS,
  TURN_SECONDS,
  WALL_REVEAL_MS,
  goalFor,
  oppositeSlot,
  startFor,
  type Direction,
  type EmoteType,
  type GameEvent,
  type GameState,
  type PlayerSlot
} from "./types";
import { generateMaze, hasWall, inBounds, movePoint, wallKey } from "./maze";

const nowId = () => crypto.randomUUID();

function event(type: GameEvent["type"], payload: Record<string, unknown>, at = Date.now()): GameEvent {
  return { id: nowId(), at, type, payload };
}

export function appendGameEvent(game: GameState, type: GameEvent["type"], payload: Record<string, unknown>, at = Date.now()): GameEvent {
  const nextEvent = event(type, payload, at);
  game.events.push(nextEvent);
  game.updatedAt = at;
  return nextEvent;
}

export function createGame(id: string, playerA: string, playerB: string, roomCode?: string, seed = Date.now()): GameState {
  const at = Date.now();
  const first: PlayerSlot = Math.random() > 0.5 ? "A" : "B";
  return {
    id,
    roomCode,
    status: "waiting",
    maze: generateMaze(seed),
    players: {
      A: {
        id: playerA,
        name: "Player A",
        slot: "A",
        position: startFor("A"),
        goal: goalFor("A"),
        connectedAt: 0,
        missedTurns: 0
      },
      B: {
        id: playerB,
        name: "Player B",
        slot: "B",
        position: startFor("B"),
        goal: goalFor("B"),
        connectedAt: 0,
        missedTurns: 0
      }
    },
    currentTurn: first,
    coinTossStartsAt: 0,
    coinRevealAt: 0,
    gameStartsAt: 0,
    turnStepsUsed: 0,
    turnStartPosition: startFor(first),
    turnStartedAt: 0,
    turnDeadlineAt: 0,
    emotes: {
      A: { sentAt: [] },
      B: { sentAt: [] }
    },
    revealedWalls: [],
    events: [event("game_created", { playerA, playerB, roomCode }, at)],
    createdAt: at,
    updatedAt: at
  };
}

export function playerSlotById(game: GameState, playerId: string): PlayerSlot | undefined {
  return game.players.A.id === playerId ? "A" : game.players.B.id === playerId ? "B" : undefined;
}

function startNextTurn(game: GameState, next: PlayerSlot, at: number): void {
  game.currentTurn = next;
  game.turnStepsUsed = 0;
  game.turnStartPosition = { ...game.players[next].position };
  game.turnStartedAt = at;
  game.turnDeadlineAt = at + TURN_SECONDS * 1000;
}

function finish(game: GameState, winner: PlayerSlot, reason: string, at: number): void {
  game.status = "finished";
  game.winner = winner;
  game.winReason = reason;
  game.rematch = { requestedBy: [], expiresAt: at + REMATCH_WINDOW_MS };
  game.updatedAt = at;
  game.events.push(event("win", { winner, reason }, at));
}

export function advanceClock(game: GameState, at = Date.now()): GameState {
  if (game.status === "coin" && at >= game.coinRevealAt && !game.events.some((item) => item.type === "coin_tossed")) {
    game.events.push(event("coin_tossed", { first: game.currentTurn }, game.coinRevealAt));
    game.updatedAt = at;
  }

  if (game.status === "coin" && at >= game.gameStartsAt) {
    game.status = "playing";
    startNextTurn(game, game.currentTurn, game.gameStartsAt);
    game.updatedAt = at;
  }

  if (game.status !== "playing") return game;

  const activeWalls = game.revealedWalls.filter((wall) => wall.expiresAt > at);
  if (activeWalls.length !== game.revealedWalls.length) {
    game.revealedWalls = activeWalls;
    game.updatedAt = at;
  }

  for (const slot of ["A", "B"] as PlayerSlot[]) {
    if (at - game.players[slot].connectedAt > DISCONNECT_FORFEIT_MS) {
      const winner = oppositeSlot(slot);
      appendGameEvent(game, "disconnect_forfeit", { loser: slot, winner }, at);
      finish(game, winner, "opponent_disconnected", at);
      return game;
    }
  }

  if (at > game.turnDeadlineAt) {
    const loser = game.currentTurn;
    game.players[loser].missedTurns += 1;
    appendGameEvent(game, "turn_skipped", { player: loser, missedTurns: game.players[loser].missedTurns }, at);
    if (game.players[loser].missedTurns >= 3) {
      const winner = oppositeSlot(loser);
      appendGameEvent(game, "timeout_forfeit", { loser, winner }, at);
      finish(game, winner, "three_timeouts", at);
      return game;
    }
    startNextTurn(game, oppositeSlot(loser), at);
    game.updatedAt = at;
  }

  return game;
}

export function submitSteps(game: GameState, playerId: string, steps: Direction[], at = Date.now()): GameState {
  advanceClock(game, at);
  if (game.status !== "playing") return game;
  if (steps.length < 1 || steps.length > 3) throw new Error("one_to_three_steps_required");

  const slot = playerSlotById(game, playerId);
  if (!slot) throw new Error("player_not_in_game");
  if (slot !== game.currentTurn) throw new Error("not_your_turn");

  const player = game.players[slot];
  player.missedTurns = 0;

  for (const step of steps) {
    if (game.turnStepsUsed >= 3) throw new Error("turn_steps_exhausted");
    const next = movePoint(player.position, step);

    if (!inBounds(next, game.maze.size)) throw new Error("out_of_bounds_move");

    if (hasWall(game.maze, player.position, step)) {
      const key = wallKey(player.position, step);
      game.revealedWalls = [{ key, expiresAt: at + WALL_REVEAL_MS }];
      const returnedTo = startFor(slot);
      player.position = returnedTo;
      appendGameEvent(game, "wall_hit", { player: slot, wall: key, returnedTo }, at);
      startNextTurn(game, oppositeSlot(slot), at);
      game.updatedAt = at;
      return game;
    }

    player.position = next;
    game.turnStepsUsed += 1;
    appendGameEvent(game, "move", { player: slot, step, to: player.position }, at);

    if (player.position.x === player.goal.x && player.position.y === player.goal.y) {
      finish(game, slot, "goal_reached", at);
      return game;
    }

    if (game.turnStepsUsed >= 3) {
      startNextTurn(game, oppositeSlot(slot), at);
      game.updatedAt = at;
      return game;
    }
  }

  game.updatedAt = at;
  return game;
}

export function surrender(game: GameState, playerId: string, at = Date.now()): GameState {
  advanceClock(game, at);
  if (game.status === "finished") return game;

  const loser = playerSlotById(game, playerId);
  if (!loser) throw new Error("player_not_in_game");

  const winner = oppositeSlot(loser);
  appendGameEvent(game, "surrender", { loser, winner }, at);
  finish(game, winner, "surrender", at);
  return game;
}

export function sendEmote(game: GameState, playerId: string, emote: EmoteType, at = Date.now()): GameState {
  const slot = playerSlotById(game, playerId);
  if (!slot) throw new Error("player_not_in_game");
  const state = game.emotes[slot];
  if (state.blockedUntil && at < state.blockedUntil) throw new Error("emote_blocked");
  state.sentAt = state.sentAt.filter((sentAt) => at - sentAt < EMOTE_WINDOW_MS);
  if (state.sentAt.length >= EMOTE_LIMIT) {
    state.blockedUntil = at + EMOTE_BLOCK_MS;
    throw new Error("emote_blocked");
  }
  state.sentAt.push(at);
  appendGameEvent(game, "emote", { player: slot, emote }, at);
  return game;
}

export function heartbeat(game: GameState, playerId: string, at = Date.now()): GameState {
  const slot = playerSlotById(game, playerId);
  if (slot) {
    game.players[slot].connectedAt = at;
  }
  if (game.status === "waiting" && game.players.A.connectedAt > 0 && game.players.B.connectedAt > 0) {
    game.status = "coin";
    game.coinTossStartsAt = at + MATCH_READY_MS;
    game.coinRevealAt = game.coinTossStartsAt + COIN_TOSS_MS;
    game.gameStartsAt = game.coinRevealAt + START_COUNTDOWN_MS;
    game.turnStartPosition = startFor(game.currentTurn);
    game.turnStartedAt = game.gameStartsAt;
    game.turnDeadlineAt = game.gameStartsAt + TURN_SECONDS * 1000;
    game.updatedAt = at;
  }
  return game;
}
