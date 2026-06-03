import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const BOARD_SIZE = 8;
const WALL_COUNT = 28;
const TARGET_COUNT = Number(process.argv[2] ?? 2_000);
const OUT_FILE = resolve(process.argv[3] ?? "lib/game/maze-pool.json");

const START_A = pointId(0, 0);
const GOAL_A = pointId(7, 7);
const START_B = pointId(7, 0);
const GOAL_B = pointId(0, 7);
const ALLOWED_PATH_LENGTHS = new Set([14, 16]);

const STRICT_PROFILE = {
  name: "STRICT",
  minPathLength: 14,
  maxPathLength: 16,
  minHorizontalWalls: 12,
  maxHorizontalWalls: 16,
  minOuterCellWalls: 15,
  maxOuterCellWalls: 18,
  maxSectorRange: 2,
  maxRowBandRange: 3,
  maxColBandRange: 3,
  maxSymmetryRatio: 0.55,
  minStartGoalDegree: 2,
  randomAttempts: 45,
  repairSteps: 45,
  swapCandidatesPerStep: 35
};

const NORMAL_PROFILE = {
  name: "NORMAL",
  minPathLength: 14,
  maxPathLength: 16,
  minHorizontalWalls: 10,
  maxHorizontalWalls: 18,
  minOuterCellWalls: 14,
  maxOuterCellWalls: 19,
  maxSectorRange: 3,
  maxRowBandRange: 4,
  maxColBandRange: 4,
  maxSymmetryRatio: 0.7,
  minStartGoalDegree: 1,
  randomAttempts: 70,
  repairSteps: 60,
  swapCandidatesPerStep: 45
};

const LOOSE_PROFILE = {
  name: "LOOSE",
  minPathLength: 14,
  maxPathLength: 16,
  minHorizontalWalls: 8,
  maxHorizontalWalls: 20,
  minOuterCellWalls: 13,
  maxOuterCellWalls: 20,
  maxSectorRange: 5,
  maxRowBandRange: 6,
  maxColBandRange: 6,
  maxSymmetryRatio: 0.85,
  minStartGoalDegree: 1,
  randomAttempts: 110,
  repairSteps: 80,
  swapCandidatesPerStep: 55
};

const PROFILES = [STRICT_PROFILE, NORMAL_PROFILE, LOOSE_PROFILE];
const EDGES = precomputeAllEdges();
const EDGE_BY_ID = new Map(EDGES.map((edge) => [edge.id, edge]));
const EDGE_ID_BY_KEY = new Map(EDGES.map((edge) => [edge.key, edge.id]));
const MIRROR_EDGE_BY_ID = new Map(EDGES.map((edge) => [edge.id, mirrorEdgeId(edge)]));
const CELL_NEIGHBORS = precomputeCellNeighbors();

function pointId(x, y) {
  return y * BOARD_SIZE + x;
}

function pointFromId(id) {
  return { x: id % BOARD_SIZE, y: Math.floor(id / BOARD_SIZE) };
}

function edgeKey(x, y, direction) {
  return `${x},${y}:${direction}`;
}

function precomputeAllEdges() {
  const edges = [];
  let id = 0;
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      if (x < BOARD_SIZE - 1) {
        edges.push(makeEdge(id, x, y, "right"));
        id += 1;
      }
      if (y < BOARD_SIZE - 1) {
        edges.push(makeEdge(id, x, y, "up"));
        id += 1;
      }
    }
  }
  return edges;
}

function makeEdge(id, x, y, direction) {
  const to = direction === "right" ? { x: x + 1, y } : { x, y: y + 1 };
  const midX = direction === "right" ? x + 0.5 : x;
  const midY = direction === "up" ? y + 0.5 : y;
  return {
    id,
    x,
    y,
    direction,
    key: edgeKey(x, y, direction),
    orientation: direction === "up" ? "H" : "V",
    outerCell: isOuterCell(x, y) || isOuterCell(to.x, to.y),
    a: pointId(x, y),
    b: pointId(to.x, to.y),
    sector: Math.min(3, Math.floor(midX / 2)) + Math.min(3, Math.floor(midY / 2)) * 4,
    rowBand: Math.min(3, Math.floor(midY / 2)),
    colBand: Math.min(3, Math.floor(midX / 2))
  };
}

function isOuterCell(x, y) {
  return x === 0 || y === 0 || x === BOARD_SIZE - 1 || y === BOARD_SIZE - 1;
}

function mirrorEdgeId(edge) {
  const mirroredX = BOARD_SIZE - 1 - edge.x;
  if (edge.direction === "up") return edgeIdFor(mirroredX, edge.y, "up");
  return edgeIdFor(mirroredX - 1, edge.y, "right");
}

function edgeIdFor(x, y, direction) {
  const id = EDGE_ID_BY_KEY.get(edgeKey(x, y, direction));
  if (id === undefined) throw new Error(`missing edge ${x},${y}:${direction}`);
  return id;
}

function precomputeCellNeighbors() {
  return Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, cell) => {
    const { x, y } = pointFromId(cell);
    const result = [];
    if (x > 0) result.push({ cell: pointId(x - 1, y), edge: edgeIdFor(x - 1, y, "right") });
    if (x < BOARD_SIZE - 1) result.push({ cell: pointId(x + 1, y), edge: edgeIdFor(x, y, "right") });
    if (y > 0) result.push({ cell: pointId(x, y - 1), edge: edgeIdFor(x, y - 1, "up") });
    if (y < BOARD_SIZE - 1) result.push({ cell: pointId(x, y + 1), edge: edgeIdFor(x, y, "up") });
    return result;
  });
}

function mulberry32(seed) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Random {
  constructor(seed) {
    this.next = mulberry32(seed);
  }

  float() {
    return this.next();
  }

  int(min, max) {
    return Math.floor(this.float() * (max - min + 1)) + min;
  }
}

function shuffle(items, rng) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = rng.int(0, i);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function randomChoice(items, rng) {
  return items[rng.int(0, items.length - 1)];
}

function makeSectorQuota(totalWalls, rng) {
  const quota = Array(16).fill(1);
  let remaining = totalWalls - quota.length;
  while (remaining > 0) {
    const index = rng.int(0, quota.length - 1);
    if (quota[index] < 2) {
      quota[index] += 1;
      remaining -= 1;
    }
  }
  return quota;
}

function generateBalancedRandomWalls(profile, rng) {
  const walls = new Set();
  const sectorQuota = makeSectorQuota(WALL_COUNT, rng);
  const targetHorizontal = rng.int(profile.minHorizontalWalls, profile.maxHorizontalWalls);
  const targetOuterCellWalls = rng.int(profile.minOuterCellWalls, profile.maxOuterCellWalls);
  let horizontalCount = 0;
  let verticalCount = 0;
  let outerCellCount = 0;

  for (const edge of shuffle(EDGES, rng)) {
    if (walls.size >= WALL_COUNT) break;
    if (sectorQuota[edge.sector] <= 0) continue;
    if (edge.outerCell) {
      if (outerCellCount >= targetOuterCellWalls) continue;
    } else if (walls.size - outerCellCount >= WALL_COUNT - targetOuterCellWalls) {
      continue;
    }
    if (edge.orientation === "H") {
      if (horizontalCount >= targetHorizontal) continue;
      horizontalCount += 1;
    } else {
      const maxVertical = WALL_COUNT - profile.minHorizontalWalls;
      if (verticalCount >= maxVertical) continue;
      verticalCount += 1;
    }
    walls.add(edge.id);
    if (edge.outerCell) outerCellCount += 1;
    sectorQuota[edge.sector] -= 1;
  }

  while (walls.size < WALL_COUNT) {
    const candidates = EDGES.filter((edge) => {
      if (walls.has(edge.id)) return false;
      if (edge.outerCell) return outerCellCount < targetOuterCellWalls;
      return walls.size - outerCellCount < WALL_COUNT - targetOuterCellWalls;
    });
    const edge = randomChoice(candidates.length > 0 ? candidates : EDGES.filter((candidate) => !walls.has(candidate.id)), rng);
    walls.add(edge.id);
    if (edge.outerCell) outerCellCount += 1;
  }

  return walls;
}

function neighbors(cell, walls) {
  const result = [];
  for (const candidate of CELL_NEIGHBORS[cell]) {
    if (!walls.has(candidate.edge)) result.push(candidate.cell);
  }
  return result;
}

function bfsDistance(start, goal, walls) {
  const distance = Array(BOARD_SIZE * BOARD_SIZE).fill(Infinity);
  const queue = [start];
  distance[start] = 0;

  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    if (current === goal) return distance[current];
    for (const next of neighbors(current, walls)) {
      if (distance[next] !== Infinity) continue;
      distance[next] = distance[current] + 1;
      queue.push(next);
    }
  }

  return Infinity;
}

function isAllCellsConnected(walls) {
  const seen = new Set([0]);
  const queue = [0];
  for (let head = 0; head < queue.length; head += 1) {
    for (const next of neighbors(queue[head], walls)) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen.size === BOARD_SIZE * BOARD_SIZE;
}

function getDegree(cell, walls) {
  return neighbors(cell, walls).length;
}

function countHorizontalWalls(walls) {
  let count = 0;
  for (const id of walls) {
    if (EDGE_BY_ID.get(id).orientation === "H") count += 1;
  }
  return count;
}

function countOuterCellWalls(walls) {
  let count = 0;
  for (const id of walls) {
    if (EDGE_BY_ID.get(id).outerCell) count += 1;
  }
  return count;
}

function countsBy(walls, key) {
  const counts = Array(4).fill(0);
  for (const id of walls) counts[EDGE_BY_ID.get(id)[key]] += 1;
  return counts;
}

function sectorCounts(walls) {
  const counts = Array(16).fill(0);
  for (const id of walls) counts[EDGE_BY_ID.get(id).sector] += 1;
  return counts;
}

function range(values) {
  return Math.max(...values) - Math.min(...values);
}

function variance(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
}

function symmetryRatio(walls) {
  let mirrored = 0;
  for (const id of walls) {
    if (walls.has(MIRROR_EDGE_BY_ID.get(id))) mirrored += 1;
  }
  return mirrored / walls.size;
}

function localDensityPenalty(walls) {
  return sectorCounts(walls).reduce((sum, count) => sum + Math.max(0, count - 3) ** 2, 0);
}

function startGoalPenalty(walls, profile) {
  return [START_A, GOAL_A, START_B, GOAL_B].reduce(
    (sum, cell) => sum + Math.max(0, profile.minStartGoalDegree - getDegree(cell, walls)),
    0
  );
}

function evaluateMaze(walls, profile = NORMAL_PROFILE) {
  const distanceA = bfsDistance(START_A, GOAL_A, walls);
  const distanceB = bfsDistance(START_B, GOAL_B, walls);
  const horizontalWalls = countHorizontalWalls(walls);
  const outerCellWalls = countOuterCellWalls(walls);
  const sectors = sectorCounts(walls);
  const rowBands = countsBy(walls, "rowBand");
  const colBands = countsBy(walls, "colBand");
  const symmetry = symmetryRatio(walls);
  const distributionScore = variance(sectors);

  return {
    distanceA,
    distanceB,
    horizontalWalls,
    verticalWalls: walls.size - horizontalWalls,
    outerCellWalls,
    sectorCounts: sectors,
    rowBandCounts: rowBands,
    colBandCounts: colBands,
    sectorRange: range(sectors),
    rowBandRange: range(rowBands),
    colBandRange: range(colBands),
    symmetryRatio: symmetry,
    distributionScore,
    score: scoreMaze(walls, profile)
  };
}

function isEssentiallyValid(walls) {
  if (walls.size !== WALL_COUNT) return false;
  const distanceA = bfsDistance(START_A, GOAL_A, walls);
  const distanceB = bfsDistance(START_B, GOAL_B, walls);
  if (distanceA === Infinity || distanceB === Infinity) return false;
  if (distanceA !== distanceB) return false;
  if (!ALLOWED_PATH_LENGTHS.has(distanceA)) return false;
  return isAllCellsConnected(walls);
}

function isAcceptableMaze(walls, profile) {
  if (!isEssentiallyValid(walls)) return false;
  const evaluation = evaluateMaze(walls, profile);
  if (evaluation.distanceA < profile.minPathLength || evaluation.distanceA > profile.maxPathLength) return false;
  if (evaluation.horizontalWalls < profile.minHorizontalWalls || evaluation.horizontalWalls > profile.maxHorizontalWalls) return false;
  if (evaluation.outerCellWalls < profile.minOuterCellWalls || evaluation.outerCellWalls > profile.maxOuterCellWalls) return false;
  if (evaluation.sectorRange > profile.maxSectorRange) return false;
  if (evaluation.rowBandRange > profile.maxRowBandRange) return false;
  if (evaluation.colBandRange > profile.maxColBandRange) return false;
  if (evaluation.symmetryRatio > profile.maxSymmetryRatio) return false;
  if ([START_A, GOAL_A, START_B, GOAL_B].some((cell) => getDegree(cell, walls) < profile.minStartGoalDegree)) return false;
  return true;
}

function distributionPenalty(walls) {
  return range(sectorCounts(walls)) + variance(sectorCounts(walls));
}

function orientationPenalty(walls, profile) {
  const horizontal = countHorizontalWalls(walls);
  if (horizontal < profile.minHorizontalWalls) return profile.minHorizontalWalls - horizontal;
  if (horizontal > profile.maxHorizontalWalls) return horizontal - profile.maxHorizontalWalls;
  return 0;
}

function outerCellPenalty(walls, profile) {
  const count = countOuterCellWalls(walls);
  if (count < profile.minOuterCellWalls) return profile.minOuterCellWalls - count;
  if (count > profile.maxOuterCellWalls) return count - profile.maxOuterCellWalls;
  return 0;
}

function scoreMaze(walls, profile) {
  if (walls.size !== WALL_COUNT) return Infinity;
  const distanceA = bfsDistance(START_A, GOAL_A, walls);
  const distanceB = bfsDistance(START_B, GOAL_B, walls);
  if (distanceA === Infinity || distanceB === Infinity) return Infinity;

  const fairnessPenalty = Math.abs(distanceA - distanceB) * 100_000;
  const connectivityPenalty = isAllCellsConnected(walls) ? 0 : 1_000_000;
  const targetPath = Math.floor((profile.minPathLength + profile.maxPathLength) / 2);
  const pathLengthPenalty = (Math.abs(distanceA - targetPath) + Math.abs(distanceB - targetPath)) * 20;

  return (
    fairnessPenalty +
    connectivityPenalty +
    pathLengthPenalty +
    distributionPenalty(walls) * 10 +
    orientationPenalty(walls, profile) * 8 +
    outerCellPenalty(walls, profile) * 10 +
    symmetryRatio(walls) * 5 +
    localDensityPenalty(walls) * 12 +
    startGoalPenalty(walls, profile) * 30
  );
}

function randomWallSwap(edges, walls, rng) {
  const next = new Set(walls);
  const removedWall = randomChoice([...next], rng);
  next.delete(removedWall);
  const emptyEdges = edges.filter((edge) => !next.has(edge.id));
  next.add(randomChoice(emptyEdges, rng).id);
  return next.size === WALL_COUNT ? next : null;
}

function repairMaze(edges, walls, profile, rng) {
  let current = new Set(walls);
  let currentScore = scoreMaze(current, profile);

  for (let step = 0; step < profile.repairSteps; step += 1) {
    let bestCandidate = null;
    let bestCandidateScore = currentScore;

    for (let i = 0; i < profile.swapCandidatesPerStep; i += 1) {
      const candidate = randomWallSwap(edges, current, rng);
      if (!candidate) continue;
      const candidateScore = scoreMaze(candidate, profile);
      if (candidateScore < bestCandidateScore) {
        bestCandidate = candidate;
        bestCandidateScore = candidateScore;
      }
    }

    if (bestCandidate) {
      current = bestCandidate;
      currentScore = bestCandidateScore;
    } else if (rng.float() < 0.05) {
      const randomCandidate = randomWallSwap(edges, current, rng);
      if (randomCandidate) {
        current = randomCandidate;
        currentScore = scoreMaze(current, profile);
      }
    }

    if (isAcceptableMaze(current, profile)) return current;
  }

  return current;
}

function generateOneMaze(edges, profile, seed) {
  const rng = new Random(seed);
  let bestMaze = null;
  let bestScore = Infinity;

  for (let attempt = 0; attempt < profile.randomAttempts; attempt += 1) {
    const walls = generateBalancedRandomWalls(profile, rng);
    const evaluation = evaluateMaze(walls, profile);

    if (isEssentiallyValid(walls) && evaluation.score < bestScore) {
      bestScore = evaluation.score;
      bestMaze = { walls, evaluation };
    }

    if (isAcceptableMaze(walls, profile)) return { walls, evaluation };
  }

  return bestMaze && isAcceptableMaze(bestMaze.walls, profile) ? bestMaze : null;
}

function generateFallbackFairMaze(edges, seed) {
  const rng = new Random(seed);
  let best = null;
  let bestScore = Infinity;

  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    let walls = generateBalancedRandomWalls(LOOSE_PROFILE, rng);
    if (!isEssentiallyValid(walls)) continue;

    const score = scoreMaze(walls, LOOSE_PROFILE) + symmetryRatio(walls) * 100;
    if (score < bestScore) {
      best = { walls, evaluation: evaluateMaze(walls, LOOSE_PROFILE) };
      bestScore = score;
    }

    if (symmetryRatio(walls) <= 0.9) return { walls, evaluation: evaluateMaze(walls, LOOSE_PROFILE) };
  }

  if (best) return best;
  throw new Error(`No fair maze found for seed ${seed}`);
}

function hashWalls(walls) {
  return [...walls].sort((a, b) => a - b).join(",");
}

function formatTemplate(index, walls, evaluation, grade, seed) {
  return {
    id: `maze_${String(index + 1).padStart(5, "0")}`,
    walls: [...walls].sort((a, b) => a - b),
    distanceA: evaluation.distanceA,
    distanceB: evaluation.distanceB,
    grade,
    symmetryRatio: Number(evaluation.symmetryRatio.toFixed(4)),
    distributionScore: Number(evaluation.distributionScore.toFixed(4)),
    createdSeed: seed
  };
}

async function main() {
  const seen = new Set();
  const pool = [];
  let globalSeed = 1;

  while (pool.length < TARGET_COUNT) {
    let generated = null;
    let grade = "";
    let seed = globalSeed;

    for (const profile of PROFILES) {
      seed = globalSeed;
      generated = generateOneMaze(EDGES, profile, seed);
      globalSeed += 1;
      if (generated) {
        grade = profile.name;
        break;
      }
    }

    if (!generated) {
      seed = globalSeed;
      generated = generateFallbackFairMaze(EDGES, seed);
      globalSeed += 1;
      grade = "FALLBACK";
    }

    const hash = hashWalls(generated.walls);
    if (!seen.has(hash)) {
      seen.add(hash);
      pool.push(formatTemplate(pool.length, generated.walls, generated.evaluation, grade, seed));
    }

    if (pool.length > 0 && pool.length % 1000 === 0) {
      console.log(`generated ${pool.length}/${TARGET_COUNT}`);
    }
  }

  const output = {
    version: 1,
    boardSize: BOARD_SIZE,
    wallCount: WALL_COUNT,
    starts: { A: [0, 0], B: [7, 0] },
    goals: { A: [7, 7], B: [0, 7] },
    count: pool.length,
    mazes: pool
  };

  await mkdir(dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, `${JSON.stringify(output)}\n`);
  console.log(`saved ${pool.length} mazes to ${OUT_FILE}`);
}

await main();
