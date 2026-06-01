import {
  DISCONNECT_FORFEIT_MS,
  TURN_SECONDS,
  WALL_REVEAL_MS,
  goalFor,
  oppositeSlot,
  startFor,
  type Direction,
  type GameEvent,
  type GameState,
  type PlayerSlot
} from "./types";
import { generateMaze, hasWall, movePoint, wallKey } from "./maze";

const nowId = () => crypto.randomUUID();

function event(type: GameEvent["type"], payload: Record<string, unknown>, at = Date.now()): GameEvent {
  return { id: nowId(), at, type, payload };
}

export function createGame(id: string, playerA: string, playerB: string, roomCode?: string, seed = Date.now()): GameState {
  const at = Date.now();
  const first: PlayerSlot = Math.random() > 0.5 ? "A" : "B";
  return {
    id,
    roomCode,
    status: "playing",
    maze: generateMaze(seed),
    players: {
      A: {
        id: playerA,
        name: "Player A",
        slot: "A",
        position: startFor("A"),
        goal: goalFor("A"),
        connectedAt: at,
        missedTurns: 0
      },
      B: {
        id: playerB,
        name: "Player B",
        slot: "B",
        position: startFor("B"),
        goal: goalFor("B"),
        connectedAt: at,
        missedTurns: 0
      }
    },
    currentTurn: first,
    turnStepsUsed: 0,
    turnStartPosition: startFor(first),
    turnStartedAt: at,
    turnDeadlineAt: at + TURN_SECONDS * 1000,
    revealedWalls: [],
    events: [
      event("game_created", { playerA, playerB, roomCode }, at),
      event("coin_tossed", { first }, at)
    ],
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
  game.updatedAt = at;
  game.events.push(event("win", { winner, reason }, at));
}

export function advanceClock(game: GameState, at = Date.now()): GameState {
  if (game.status !== "playing") return game;

  game.revealedWalls = game.revealedWalls.filter((wall) => wall.expiresAt > at);

  for (const slot of ["A", "B"] as PlayerSlot[]) {
    if (at - game.players[slot].connectedAt > DISCONNECT_FORFEIT_MS) {
      const winner = oppositeSlot(slot);
      game.events.push(event("disconnect_forfeit", { loser: slot, winner }, at));
      finish(game, winner, "opponent_disconnected", at);
      return game;
    }
  }

  if (at > game.turnDeadlineAt) {
    const loser = game.currentTurn;
    game.players[loser].missedTurns += 1;
    game.events.push(event("turn_skipped", { player: loser, missedTurns: game.players[loser].missedTurns }, at));
    if (game.players[loser].missedTurns >= 3) {
      const winner = oppositeSlot(loser);
      game.events.push(event("timeout_forfeit", { loser, winner }, at));
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

    if (hasWall(game.maze, player.position, step)) {
      const key = wallKey(player.position, step);
      game.revealedWalls = [{ key, expiresAt: at + WALL_REVEAL_MS }];
      const returnedTo = startFor(slot);
      player.position = returnedTo;
      game.events.push(event("wall_hit", { player: slot, wall: key, returnedTo }, at));
      startNextTurn(game, oppositeSlot(slot), at);
      game.updatedAt = at;
      return game;
    }

    player.position = movePoint(player.position, step);
    game.turnStepsUsed += 1;
    game.events.push(event("move", { player: slot, step, to: player.position }, at));

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

export function heartbeat(game: GameState, playerId: string, at = Date.now()): GameState {
  const slot = playerSlotById(game, playerId);
  if (slot) {
    game.players[slot].connectedAt = at;
    game.updatedAt = at;
  }
  return game;
}
