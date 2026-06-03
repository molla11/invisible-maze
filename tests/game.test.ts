import { describe, expect, it } from "vitest";
import { advanceClock, createGame, heartbeat, sendEmote, submitSteps, surrender } from "@/lib/game/engine";
import { directionsList, generateMaze, hasWall, movePoint, shortestPath } from "@/lib/game/maze";
import { COIN_TOSS_MS, EMOTE_BLOCK_MS, EMOTE_LIMIT, EMOTE_WINDOW_MS, MATCH_READY_MS, REMATCH_WINDOW_MS, START_COUNTDOWN_MS, TURN_SECONDS, goalFor, startFor, type Maze, type Point } from "@/lib/game/types";

function reachableCellCount(maze: Maze, start: Point) {
  const queue = [start];
  const seen = new Set([`${start.x},${start.y}`]);

  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    for (const direction of directionsList) {
      if (hasWall(maze, current, direction)) continue;
      const next = movePoint(current, direction);
      const key = `${next.x},${next.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push(next);
    }
  }

  return seen.size;
}

function createPlayingGame(seed = 1) {
  const game = createGame("game", "a", "b", undefined, seed);
  const at = Date.now();
  game.status = "playing";
  game.players.A.connectedAt = at;
  game.players.B.connectedAt = at;
  game.turnStartedAt = at;
  game.turnDeadlineAt = at + TURN_SECONDS * 1000;
  return game;
}

describe("maze generation", () => {
  it("creates reachable goals with equal shortest paths of 14 or 16", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const maze = generateMaze(seed);
      const aDistance = shortestPath(maze, startFor("A"), goalFor("A"));
      const bDistance = shortestPath(maze, startFor("B"), goalFor("B"));

      expect(maze.walls).toHaveLength(28);
      expect(aDistance).toBe(bDistance);
      expect([14, 16]).toContain(aDistance);
      expect(reachableCellCount(maze, startFor("A"))).toBe(maze.size * maze.size);
    }
  });

  it("places walls on edge cells without adding outer border walls", () => {
    const maze = generateMaze(42);
    const isEdge = (point: { x: number; y: number }) =>
      point.x === 0 || point.y === 0 || point.x === maze.size - 1 || point.y === maze.size - 1;
    let hasEdgeCellWall = false;

    for (const wall of maze.walls) {
      const [rawPoint, direction] = wall.split(":") as [`${number},${number}`, "up" | "right" | "down" | "left"];
      const [x, y] = rawPoint.split(",").map(Number);
      const point = { x, y };
      const next = movePoint({ x, y }, direction);

      expect(next.x).toBeGreaterThanOrEqual(0);
      expect(next.y).toBeGreaterThanOrEqual(0);
      expect(next.x).toBeLessThan(maze.size);
      expect(next.y).toBeLessThan(maze.size);
      if (isEdge(point) || isEdge(next)) hasEdgeCellWall = true;
    }

    expect(hasEdgeCellWall).toBe(true);
  });
});

describe("game rules", () => {
  it("reveals the coin toss winner before starting the first turn", () => {
    const game = createGame("game", "a", "b", undefined, 1);
    const first = game.currentTurn;
    const readyAt = Date.now();

    expect(game.status).toBe("waiting");

    heartbeat(game, "a", readyAt);
    expect(game.status).toBe("waiting");

    heartbeat(game, "b", readyAt);
    expect(game.status).toBe("coin");
    expect(game.coinTossStartsAt).toBe(readyAt + MATCH_READY_MS);
    expect(game.coinRevealAt).toBe(game.coinTossStartsAt + COIN_TOSS_MS);
    expect(game.gameStartsAt).toBe(game.coinRevealAt + START_COUNTDOWN_MS);
    expect(game.events.some((event) => event.type === "coin_tossed")).toBe(false);

    advanceClock(game, game.coinRevealAt);

    expect(game.status).toBe("coin");
    expect(game.events.at(-1)).toMatchObject({ type: "coin_tossed", payload: { first } });

    advanceClock(game, game.gameStartsAt);

    expect(game.status).toBe("playing");
    expect(game.currentTurn).toBe(first);
    expect(game.turnDeadlineAt).toBe(game.gameStartsAt + TURN_SECONDS * 1000);
  });

  it("requires one to three steps", () => {
    const game = createPlayingGame();
    const playerId = game.players[game.currentTurn].id;

    expect(() => submitSteps(game, playerId, [])).toThrow("one_to_three_steps_required");
  });

  it("returns a player to the original start after hitting a wall", () => {
    const game = createPlayingGame();
    game.currentTurn = "A";
    game.turnStartPosition = { x: 2, y: 0 };
    game.players.A.position = { x: 2, y: 0 };
    game.maze = { size: 8, seed: 1, walls: ["2,0:right"] };

    submitSteps(game, "a", ["right", "up", "up"]);

    expect(game.players.A.position).toEqual(startFor("A"));
    expect(game.revealedWalls[0].key).toBe("2,0:right");
    expect(game.currentTurn).toBe("B");
  });

  it("keeps the turn after fewer than three successful moves", () => {
    const game = createPlayingGame();
    game.currentTurn = "A";
    game.turnStartPosition = { x: 0, y: 0 };
    game.players.A.position = { x: 0, y: 0 };
    game.maze = { size: 8, seed: 1, walls: [] };

    submitSteps(game, "a", ["right"]);

    expect(game.players.A.position).toEqual({ x: 1, y: 0 });
    expect(game.turnStepsUsed).toBe(1);
    expect(game.currentTurn).toBe("A");
  });

  it("passes the turn after three successful moves", () => {
    const game = createPlayingGame();
    game.currentTurn = "A";
    game.turnStartPosition = { x: 0, y: 0 };
    game.players.A.position = { x: 0, y: 0 };
    game.maze = { size: 8, seed: 1, walls: [] };

    submitSteps(game, "a", ["right"]);
    submitSteps(game, "a", ["right"]);
    submitSteps(game, "a", ["right"]);

    expect(game.players.A.position).toEqual({ x: 3, y: 0 });
    expect(game.turnStepsUsed).toBe(0);
    expect(game.currentTurn).toBe("B");
  });

  it("only keeps the last hit wall visible", () => {
    const game = createPlayingGame();
    game.currentTurn = "A";
    game.turnStartPosition = { x: 0, y: 0 };
    game.players.A.position = { x: 0, y: 0 };
    game.maze = { size: 8, seed: 1, walls: ["0,0:right", "6,0:right"] };

    submitSteps(game, "a", ["right"]);
    game.currentTurn = "B";
    game.turnStartPosition = { x: 7, y: 0 };
    submitSteps(game, "b", ["left"]);

    expect(game.revealedWalls).toHaveLength(1);
    expect(game.revealedWalls[0].key).toBe("6,0:right");
  });

  it("wins immediately on reaching the goal", () => {
    const game = createPlayingGame();
    game.currentTurn = "A";
    game.players.A.position = { x: 1, y: 0 };
    game.maze = { size: 8, seed: 1, walls: [] };

    submitSteps(game, "a", ["left", "right", "left"]);

    expect(game.status).toBe("finished");
    expect(game.winner).toBe("A");
  });

  it("finishes immediately when a player surrenders", () => {
    const game = createPlayingGame();
    const at = Date.now();

    surrender(game, "a", at);

    expect(game.status).toBe("finished");
    expect(game.winner).toBe("B");
    expect(game.winReason).toBe("surrender");
    expect(game.rematch).toMatchObject({ requestedBy: [], expiresAt: at + REMATCH_WINDOW_MS });
    expect(game.events.at(-2)).toMatchObject({ type: "surrender", payload: { loser: "A", winner: "B" } });
  });

  it("records emotes as public game events", () => {
    const game = createPlayingGame();

    sendEmote(game, "a", "nice");

    expect(game.events.at(-1)).toMatchObject({ type: "emote", payload: { player: "A", emote: "nice" } });
  });

  it("blocks emotes for two seconds after seven sends in three seconds", () => {
    const game = createPlayingGame();
    const at = Date.now();

    for (let index = 0; index < EMOTE_LIMIT; index += 1) {
      sendEmote(game, "a", "nice", at + index);
    }

    expect(() => sendEmote(game, "a", "nice", at + EMOTE_LIMIT)).toThrow("emote_blocked");
    expect(() => sendEmote(game, "a", "nice", at + EMOTE_LIMIT + EMOTE_BLOCK_MS - 1)).toThrow("emote_blocked");

    sendEmote(game, "a", "nice", at + EMOTE_WINDOW_MS);

    expect(game.events.at(-1)).toMatchObject({ type: "emote", payload: { player: "A", emote: "nice" } });
  });

  it("treats board edges as walls", () => {
    const game = createPlayingGame();
    expect(hasWall(game.maze, { x: 0, y: 0 }, "left")).toBe(true);
  });

  it("rejects moving out of bounds without ending the turn", () => {
    const game = createPlayingGame();
    game.currentTurn = "A";
    game.players.A.position = { x: 0, y: 0 };
    game.turnStepsUsed = 0;
    game.maze = { size: 8, seed: 1, walls: [] };

    expect(() => submitSteps(game, "a", ["left"])).toThrow("out_of_bounds_move");
    expect(game.players.A.position).toEqual({ x: 0, y: 0 });
    expect(game.currentTurn).toBe("A");
    expect(game.turnStepsUsed).toBe(0);
    expect(game.revealedWalls).toHaveLength(0);
  });
});
