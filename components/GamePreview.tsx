"use client";

import { ChessPawn, Crown } from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";

const BOARD_SIZE = 8;
const STEP_MS = 920;
const HIT_CROSS_MS = 460;
const HIT_RETURN_MS = 980;
const TURN_PAUSE_MS = 760;

type Direction = "up" | "right" | "down" | "left";
type PlayerSlot = "A" | "B";
type Point = {
  x: number;
  y: number;
};

type PreviewEmote = {
  id: number;
  slot: PlayerSlot;
  point: Point;
  emoji: string;
};

type PreviewState = {
  positions: Record<PlayerSlot, Point>;
  activeSlot: PlayerSlot;
  stepsLeft: number;
  hitWall?: string;
  emote?: PreviewEmote;
};

const starts: Record<PlayerSlot, Point> = {
  A: { x: 0, y: 0 },
  B: { x: 7, y: 0 }
};

const goals: Record<PlayerSlot, Point> = {
  A: { x: 7, y: 7 },
  B: { x: 0, y: 7 }
};

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

const previewMazeEdgeIds = [
  4, 10, 15, 16, 22, 27, 30, 44, 47, 51, 52, 54, 58, 60, 62, 64, 71, 82, 84, 88, 89, 90, 95, 97, 98, 103, 106, 110
];

const previewTurns: Array<{ slot: PlayerSlot; steps: Direction[] }> = [
  { slot: "A", steps: ["right", "right", "right"] },
  { slot: "B", steps: ["left", "left"] },
  { slot: "A", steps: ["up", "right"] },
  { slot: "B", steps: ["up", "left"] },
  { slot: "A", steps: ["right", "up", "up"] },
  { slot: "B", steps: ["up", "up", "up"] },
  { slot: "A", steps: ["right", "right", "up"] },
  { slot: "B", steps: ["up", "up", "left"] },
  { slot: "A", steps: ["right"] },
  { slot: "B", steps: ["up", "up"] }
];

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
  throw new Error(`unknown_preview_maze_edge:${edgeId}`);
}

const previewWalls = previewMazeEdgeIds.map(wallKeyFromEdgeId).sort();
const previewWallSet = new Set(previewWalls);

function boardPointStyle(point: Point): CSSProperties {
  return {
    left: `${((point.x + 0.5) / BOARD_SIZE) * 100}%`,
    top: `${((BOARD_SIZE - 1 - point.y + 0.5) / BOARD_SIZE) * 100}%`
  };
}

function wallStyle(key: string): CSSProperties {
  const [rawPoint, direction] = key.split(":");
  const [x, y] = rawPoint.split(",").map(Number);
  const cell = 100 / BOARD_SIZE;
  const thickness = 5;

  if (direction === "right") {
    return {
      left: `calc(${(x + 1) * cell}% - ${thickness / 2}px)`,
      top: `${(BOARD_SIZE - 1 - y) * cell}%`,
      width: thickness,
      height: `${cell}%`
    };
  }

  return {
    left: `${x * cell}%`,
    top: `calc(${(BOARD_SIZE - 1 - y) * cell}% - ${thickness / 2}px)`,
    width: `${cell}%`,
    height: thickness
  };
}

function movePoint(point: Point, direction: Direction): Point {
  return {
    x: point.x + delta[direction].x,
    y: point.y + delta[direction].y
  };
}

function wallKey(point: Point, direction: Direction): string {
  const next = movePoint(point, direction);
  if (next.x < point.x || next.y < point.y) {
    return `${next.x},${next.y}:${opposite[direction]}`;
  }
  return `${point.x},${point.y}:${direction}`;
}

function teamName(slot: PlayerSlot) {
  return slot === "A" ? "Red" : "Blue";
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function emoteFor(slot: PlayerSlot, hit: boolean) {
  if (hit) return slot === "A" ? "😢" : "!";
  return slot === "A" ? "😄" : "👍";
}

export function GamePreview() {
  const [preview, setPreview] = useState<PreviewState>({
    positions: { A: starts.A, B: starts.B },
    activeSlot: "A",
    stepsLeft: 3
  });

  useEffect(() => {
    let stopped = false;
    let emoteId = 0;
    let positions: Record<PlayerSlot, Point> = {
      A: { ...starts.A },
      B: { ...starts.B }
    };

    const updatePosition = (slot: PlayerSlot, point: Point, rest: Partial<PreviewState> = {}) => {
      positions = {
        ...positions,
        [slot]: point
      };
      setPreview((current) => ({
        ...current,
        ...rest,
        positions
      }));
    };

    const run = async () => {
      while (!stopped) {
        for (const turn of previewTurns) {
          if (stopped) return;

          setPreview((current) => ({
            ...current,
            activeSlot: turn.slot,
            stepsLeft: 3,
            hitWall: undefined,
            emote: undefined
          }));
          await sleep(TURN_PAUSE_MS);

          let hit = false;
          for (let index = 0; index < turn.steps.length; index += 1) {
            if (stopped) return;

            const direction = turn.steps[index];
            const from = positions[turn.slot];
            const next = movePoint(from, direction);
            const key = wallKey(from, direction);
            const stepsLeft = Math.max(0, 3 - index - 1);

            if (previewWallSet.has(key)) {
              hit = true;
              updatePosition(turn.slot, next, {
                activeSlot: turn.slot,
                stepsLeft,
                hitWall: key,
                emote: { id: (emoteId += 1), slot: turn.slot, point: next, emoji: emoteFor(turn.slot, true) }
              });
              await sleep(HIT_CROSS_MS);
              updatePosition(turn.slot, starts[turn.slot], {
                activeSlot: turn.slot,
                stepsLeft: 0,
                hitWall: key
              });
              await sleep(HIT_RETURN_MS);
              setPreview((current) => ({
                ...current,
                hitWall: undefined,
                emote: undefined
              }));
              await sleep(TURN_PAUSE_MS);
              break;
            }

            updatePosition(turn.slot, next, {
              activeSlot: turn.slot,
              stepsLeft,
              hitWall: undefined
            });
            await sleep(STEP_MS);
          }

          if (!hit) {
            const point = positions[turn.slot];
            setPreview((current) => ({
              ...current,
              emote: { id: (emoteId += 1), slot: turn.slot, point, emoji: emoteFor(turn.slot, false) }
            }));
            await sleep(TURN_PAUSE_MS);
            setPreview((current) => ({ ...current, emote: undefined }));
          }
        }
      }
    };

    void run();
    return () => {
      stopped = true;
    };
  }, []);

  const activeTone = preview.activeSlot === "A" ? "red" : "blue";
  const previewStateText = preview.hitWall ? "벽 충돌" : `남은 이동 ${preview.stepsLeft}`;

  return (
    <section className="preview-panel" aria-label="게임 플레이 미리보기">
      <div className="preview-topline">
        <div className={`preview-status-pill ${activeTone}`} aria-live="polite">
          <span className="preview-turn">{teamName(preview.activeSlot)} 턴</span>
          <span className="preview-status-divider" aria-hidden="true" />
          <span className="preview-state">{previewStateText}</span>
        </div>
      </div>

      <div className="preview-board" aria-hidden="true">
        {Array.from({ length: 64 }, (_, index) => {
          const x = index % BOARD_SIZE;
          const y = BOARD_SIZE - 1 - Math.floor(index / BOARD_SIZE);
          return <span className={`preview-cell ${(x + y) % 2 === 0 ? "light" : "dark"}`} key={index} />;
        })}

        <span className="preview-goal a" style={boardPointStyle(goals.A)}>
          <Crown size={26} strokeWidth={2.5} />
        </span>
        <span className="preview-goal b" style={boardPointStyle(goals.B)}>
          <Crown size={26} strokeWidth={2.5} />
        </span>

        {previewWalls.map((wall) => (
          <span className="preview-wall" key={wall} style={wallStyle(wall)} />
        ))}

        {preview.hitWall ? <span className="preview-hit-wall" key={preview.hitWall} style={wallStyle(preview.hitWall)} /> : null}

        {(["A", "B"] as PlayerSlot[]).map((slot) => (
          <span className={`preview-piece ${slot.toLowerCase()}`} key={slot} style={boardPointStyle(preview.positions[slot])}>
            <ChessPawn size={36} strokeWidth={2.4} />
          </span>
        ))}

        {preview.emote ? (
          <span className={`preview-emote ${preview.emote.slot.toLowerCase()}`} key={preview.emote.id} style={boardPointStyle(preview.emote.point)}>
            {preview.emote.emoji}
          </span>
        ) : null}
      </div>
    </section>
  );
}
