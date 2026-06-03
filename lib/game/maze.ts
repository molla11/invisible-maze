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

function internalWallKeys(): string[] {
  const keys: string[] = [];
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      const point = { x, y };
      const right = movePoint(point, "right");
      const up = movePoint(point, "up");
      if (inBounds(right)) keys.push(wallKey(point, "right"));
      if (inBounds(up)) keys.push(wallKey(point, "up"));
    }
  }
  return keys;
}

function mazeFromWalls(walls: Set<string>, seed: number): Maze {
  return { size: BOARD_SIZE, walls: [...walls].sort(), seed };
}

function routeDistances(maze: Maze) {
  return {
    a: shortestPath(maze, { x: 0, y: 0 }, { x: BOARD_SIZE - 1, y: BOARD_SIZE - 1 }),
    b: shortestPath(maze, { x: BOARD_SIZE - 1, y: 0 }, { x: 0, y: BOARD_SIZE - 1 })
  };
}

function hasExactTargetDistance(walls: Set<string>, seed: number, targetDistance: number): boolean {
  const { a, b } = routeDistances(mazeFromWalls(walls, seed));
  return a === targetDistance && b === targetDistance;
}

function staysWithinTargetDistance(walls: Set<string>, seed: number, targetDistance: number): boolean {
  const { a, b } = routeDistances(mazeFromWalls(walls, seed));
  return Number.isFinite(a) && Number.isFinite(b) && a <= targetDistance && b <= targetDistance;
}

function addWallIf(walls: Set<string>, key: string, predicate: () => boolean): boolean {
  walls.add(key);
  if (predicate()) return true;
  walls.delete(key);
  return false;
}

function trimExtraWalls(walls: Set<string>, candidates: string[], seed: number, targetDistance: number, desiredWallCount: number): void {
  for (const key of candidates) {
    if (walls.size <= desiredWallCount) return;
    walls.delete(key);
    if (!hasExactTargetDistance(walls, seed, targetDistance)) walls.add(key);
  }
}

export function generateMaze(seed = Date.now()): Maze {
  const random = mulberry32(seed);
  let targetDistance = random() > 0.5 ? 16 : 14;
  let desiredWallCount = targetDistance === 16 ? 28 : 22;
  const walls = new Set<string>();
  const candidates = shuffled(internalWallKeys(), random);
  let cursor = 0;

  while (targetDistance === 16 && cursor < candidates.length && !hasExactTargetDistance(walls, seed, targetDistance)) {
    const key = candidates[cursor];
    cursor += 1;
    addWallIf(walls, key, () => staysWithinTargetDistance(walls, seed, targetDistance));
  }

  if (!hasExactTargetDistance(walls, seed, targetDistance)) {
    targetDistance = 14;
    desiredWallCount = 22;
    walls.clear();
    cursor = 0;
  }

  trimExtraWalls(walls, shuffled([...walls], random), seed, targetDistance, desiredWallCount);

  while (cursor < candidates.length && walls.size < desiredWallCount) {
    const key = candidates[cursor];
    cursor += 1;
    if (walls.has(key)) continue;
    addWallIf(walls, key, () => hasExactTargetDistance(walls, seed, targetDistance));
  }

  return mazeFromWalls(walls, seed);
}

export const directionsList = directions;
