import mazePool from "./maze-pool.json";
import { BOARD_SIZE, type Direction, type Maze, type Point } from "./types";

const directions: Direction[] = ["up", "right", "down", "left"];

const delta: Record<Direction, Point> = {
  up: { x: 0, y: 1 },
  right: { x: 1, y: 0 },
  down: { x: 0, y: -1 },
  left: { x: -1, y: 0 }
};

const opposite: Record<Direction, Direction> = {
  up: "down",
  right: "left",
  down: "up",
  left: "right"
};

export function wallKey(point: Point, direction: Direction): string {
  const next = movePoint(point, direction);
  if (next.x < point.x || next.y < point.y) {
    return `${next.x},${next.y}:${opposite[direction]}`;
  }
  return `${point.x},${point.y}:${direction}`;
}

export function movePoint(point: Point, direction: Direction): Point {
  return { x: point.x + delta[direction].x, y: point.y + delta[direction].y };
}

export function inBounds(point: Point, size = BOARD_SIZE): boolean {
  return point.x >= 0 && point.y >= 0 && point.x < size && point.y < size;
}

export function hasWall(maze: Maze, point: Point, direction: Direction): boolean {
  return !inBounds(movePoint(point, direction), maze.size) || maze.walls.includes(wallKey(point, direction));
}

export function shortestPath(maze: Maze, start: Point, goal: Point): number {
  const queue: Array<{ point: Point; distance: number }> = [{ point: start, distance: 0 }];
  const seen = new Set([`${start.x},${start.y}`]);

  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    if (current.point.x === goal.x && current.point.y === goal.y) return current.distance;

    for (const direction of directions) {
      if (hasWall(maze, current.point, direction)) continue;
      const next = movePoint(current.point, direction);
      const key = `${next.x},${next.y}`;
      if (!seen.has(key)) {
        seen.add(key);
        queue.push({ point: next, distance: current.distance + 1 });
      }
    }
  }

  return Number.POSITIVE_INFINITY;
}

function wallKeyFromEdgeId(edgeId: number): string {
  let current = 0;
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      if (x < BOARD_SIZE - 1) {
        if (current === edgeId) return wallKey({ x, y }, "right");
        current += 1;
      }
      if (y < BOARD_SIZE - 1) {
        if (current === edgeId) return wallKey({ x, y }, "up");
        current += 1;
      }
    }
  }
  throw new Error(`unknown_maze_edge:${edgeId}`);
}

export function generateMaze(seed = Date.now()): Maze {
  const templates = mazePool.mazes;
  const index = Math.abs(Math.floor(seed)) % templates.length;
  const template = templates[index];
  return {
    size: BOARD_SIZE,
    walls: template.walls.map(wallKeyFromEdgeId).sort(),
    seed: template.createdSeed
  };
}

export const directionsList = directions;
