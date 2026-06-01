import { describe, expect, it } from "vitest";
import { createGame, submitSteps } from "@/lib/game/engine";
import { generateMaze, hasWall, shortestPath } from "@/lib/game/maze";

describe("maze generation", () => {
  it("creates reachable goals with equal shortest paths", () => {
    const maze = generateMaze(42);

    expect(shortestPath(maze, { x: 0, y: 0 }, { x: 7, y: 7 })).toBe(
      shortestPath(maze, { x: 7, y: 0 }, { x: 0, y: 7 })
    );
    expect(shortestPath(maze, { x: 0, y: 0 }, { x: 7, y: 7 })).toBeGreaterThanOrEqual(14);
  });
});

describe("game rules", () => {
  it("requires one to three steps", () => {
    const game = createGame("game", "a", "b", undefined, 1);
    const playerId = game.players[game.currentTurn].id;

    expect(() => submitSteps(game, playerId, [])).toThrow("one_to_three_steps_required");
  });

  it("returns a player to the original start after hitting a wall", () => {
    const game = createGame("game", "a", "b", undefined, 1);
    game.currentTurn = "A";
    game.turnStartPosition = { x: 2, y: 0 };
    game.players.A.position = { x: 2, y: 0 };
    game.maze = { size: 8, seed: 1, walls: ["2,0:right"] };

    submitSteps(game, "a", ["right", "up", "up"]);

    expect(game.players.A.position).toEqual({ x: 0, y: 0 });
    expect(game.revealedWalls[0].key).toBe("2,0:right");
    expect(game.currentTurn).toBe("B");
  });

  it("keeps the turn after fewer than three successful moves", () => {
    const game = createGame("game", "a", "b", undefined, 1);
    game.currentTurn = "A";
    game.turnStartPosition = { x: 0, y: 0 };
    game.maze = { size: 8, seed: 1, walls: [] };

    submitSteps(game, "a", ["right"]);

    expect(game.players.A.position).toEqual({ x: 1, y: 0 });
    expect(game.turnStepsUsed).toBe(1);
    expect(game.currentTurn).toBe("A");
  });

  it("passes the turn after three successful moves", () => {
    const game = createGame("game", "a", "b", undefined, 1);
    game.currentTurn = "A";
    game.turnStartPosition = { x: 0, y: 0 };
    game.maze = { size: 8, seed: 1, walls: [] };

    submitSteps(game, "a", ["right"]);
    submitSteps(game, "a", ["right"]);
    submitSteps(game, "a", ["right"]);

    expect(game.players.A.position).toEqual({ x: 3, y: 0 });
    expect(game.turnStepsUsed).toBe(0);
    expect(game.currentTurn).toBe("B");
  });

  it("only keeps the last hit wall visible", () => {
    const game = createGame("game", "a", "b", undefined, 1);
    game.currentTurn = "A";
    game.turnStartPosition = { x: 0, y: 0 };
    game.maze = { size: 8, seed: 1, walls: ["0,0:right", "6,0:right"] };

    submitSteps(game, "a", ["right"]);
    game.currentTurn = "B";
    game.turnStartPosition = { x: 7, y: 0 };
    submitSteps(game, "b", ["left"]);

    expect(game.revealedWalls).toHaveLength(1);
    expect(game.revealedWalls[0].key).toBe("6,0:right");
  });

  it("wins immediately on reaching the goal", () => {
    const game = createGame("game", "a", "b", undefined, 1);
    game.currentTurn = "A";
    game.players.A.position = { x: 6, y: 7 };
    game.maze = { size: 8, seed: 1, walls: [] };

    submitSteps(game, "a", ["right", "left", "right"]);

    expect(game.status).toBe("finished");
    expect(game.winner).toBe("A");
  });

  it("treats board edges as walls", () => {
    const game = createGame("game", "a", "b", undefined, 1);
    expect(hasWall(game.maze, { x: 0, y: 0 }, "left")).toBe(true);
  });
});
