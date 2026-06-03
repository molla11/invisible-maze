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

function isEdgePoint(point: Point, size = BOARD_SIZE): boolean {
  return point.x === 0 || point.y === 0 || point.x === size - 1 || point.y === size - 1;
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

function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], random: () => number): T[] {
  return [...items].sort(() => random() - 0.5);
}

export function generateMaze(seed = Date.now()): Maze {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const random = mulberry32(seed + attempt * 9973);
    const walls = new Set<string>();

    const candidates: Array<{ point: Point; direction: Direction }> = [];
    for (let y = 0; y < BOARD_SIZE; y += 1) {
      for (let x = 0; x < BOARD_SIZE; x += 1) {
        const point = { x, y };
        const right = movePoint(point, "right");
        const up = movePoint(point, "up");
        if (inBounds(right) && !isEdgePoint(point) && !isEdgePoint(right)) candidates.push({ point, direction: "right" });
        if (inBounds(up) && !isEdgePoint(point) && !isEdgePoint(up)) candidates.push({ point, direction: "up" });
      }
    }

    for (const candidate of shuffled(candidates, random)) {
      if (random() > 0.42) continue;
      walls.add(wallKey(candidate.point, candidate.direction));
    }

    const maze = { size: BOARD_SIZE, walls: [...walls].sort(), seed: seed + attempt * 9973 };
    const aDistance = shortestPath(maze, { x: 0, y: 0 }, { x: 7, y: 7 });
    const bDistance = shortestPath(maze, { x: 7, y: 0 }, { x: 0, y: 7 });
    if (Number.isFinite(aDistance) && aDistance === bDistance && aDistance >= 14) return maze;
  }

  return { size: BOARD_SIZE, walls: [], seed };
}

export const directionsList = directions;
