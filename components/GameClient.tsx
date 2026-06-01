"use client";

import { ChessPawn, Flag } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Direction, GameEvent, PlayerSlot, Point } from "@/lib/game/types";
import { ko } from "@/lib/i18n/ko";

type PublicGame = {
  id: string;
  status: string;
  players: Record<PlayerSlot, { position: Point; goal: Point; missedTurns: number }>;
  currentTurn: PlayerSlot;
  turnStepsUsed: number;
  turnDeadlineAt: number;
  winner?: PlayerSlot;
  winReason?: string;
  revealedWalls: Array<{ key: string; expiresAt: number }>;
  events: GameEvent[];
  viewerSlot?: PlayerSlot;
};

function toBoard(point: Point) {
  return {
    left: `${((point.x + 0.5) / 8) * 100}%`,
    top: `${((7 - point.y + 0.5) / 8) * 100}%`
  };
}

function stepPoint(point: Point, direction: Direction): Point {
  if (direction === "up") return { x: point.x, y: point.y + 1 };
  if (direction === "right") return { x: point.x + 1, y: point.y };
  if (direction === "down") return { x: point.x, y: point.y - 1 };
  return { x: point.x - 1, y: point.y };
}

function directionTo(from: Point, to: Point): Direction | undefined {
  if (to.x === from.x && to.y === from.y + 1) return "up";
  if (to.x === from.x + 1 && to.y === from.y) return "right";
  if (to.x === from.x && to.y === from.y - 1) return "down";
  if (to.x === from.x - 1 && to.y === from.y) return "left";
  return undefined;
}

function samePoint(a: Point, b: Point) {
  return a.x === b.x && a.y === b.y;
}

function wallStyle(key: string) {
  const [rawPoint, direction] = key.split(":");
  const [x, y] = rawPoint.split(",").map(Number);
  const cell = 100 / 8;
  const thickness = 6;
  if (direction === "right") {
    return {
      left: `calc(${(x + 1) * cell}% - ${thickness / 2}px)`,
      top: `${(7 - y) * cell}%`,
      width: thickness,
      height: `${cell}%`
    };
  }
  return {
    left: `${x * cell}%`,
    top: `calc(${(7 - y) * cell}% - ${thickness / 2}px)`,
    width: `${cell}%`,
    height: thickness
  };
}

function eventText(event: GameEvent) {
  const teamName = (slot: unknown) => (slot === "A" ? "Red" : slot === "B" ? "Blue" : String(slot));
  if (event.type === "wall_hit") return `${teamName(event.payload.player)} 충돌`;
  if (event.type === "move") return `${teamName(event.payload.player)} 이동`;
  if (event.type === "turn_skipped") return `${teamName(event.payload.player)} 시간 초과`;
  if (event.type === "win") return `${teamName(event.payload.winner)} 승리`;
  if (event.type === "coin_tossed") return `${teamName(event.payload.first)} 선공`;
  return event.type;
}

function teamName(slot?: PlayerSlot) {
  if (slot === "A") return "Red";
  if (slot === "B") return "Blue";
  return "-";
}

export function GameClient({ gameId }: { gameId: string }) {
  const [game, setGame] = useState<PublicGame | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const [pending, setPending] = useState(false);

  const fetchGame = useCallback(async () => {
    const response = await fetch(`/api/game/${gameId}`, { cache: "no-store" });
    if (response.ok) setGame(await response.json());
  }, [gameId]);

  useEffect(() => {
    fetchGame();
    const poll = setInterval(fetchGame, 1000);
    const clock = setInterval(() => setNow(Date.now()), 250);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [fetchGame]);

  const canAct = game?.status === "playing" && game.viewerSlot === game.currentTurn;
  const secondsLeft = Math.max(0, Math.ceil(((game?.turnDeadlineAt ?? now) - now) / 1000));
  const viewerPosition = game?.viewerSlot ? game.players[game.viewerSlot].position : undefined;
  const stepsLeft = Math.max(0, 3 - (game?.turnStepsUsed ?? 0));

  const moveToCell = useCallback(
    async (point: Point) => {
      if (!canAct || !viewerPosition || pending) return;
      const direction = directionTo(viewerPosition, point);
      if (!direction) {
        setError("현재 위치와 맞닿은 칸만 선택할 수 있습니다.");
        return;
      }

      setPending(true);
      const response = await fetch(`/api/game/${gameId}/action`, {
        method: "POST",
        body: JSON.stringify({ steps: [direction] })
      });
      const data = await response.json();
      if (response.ok) {
        setGame(data);
        setError("");
      } else {
        setError(data.error ?? "이동하지 못했습니다.");
      }
      setPending(false);
    },
    [canAct, gameId, pending, viewerPosition]
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const map: Record<string, Direction | undefined> = {
        ArrowUp: "up",
        ArrowRight: "right",
        ArrowDown: "down",
        ArrowLeft: "left"
      };
      const direction = map[event.key];
      if (direction) {
        event.preventDefault();
        if (!viewerPosition) return;
        moveToCell(stepPoint(viewerPosition, direction));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [moveToCell, viewerPosition]);

  useEffect(() => {
    setError("");
  }, [game?.currentTurn, game?.status]);

  const recentEvents = useMemo(() => [...(game?.events ?? [])].slice(-8).reverse(), [game?.events]);

  if (!game) {
    return (
      <main className="shell">
        <div className="entry-panel">게임을 불러오는 중입니다.</div>
      </main>
    );
  }

  return (
    <main className="shell">
      <nav className="topbar">
        <Link className="brand" href="/">
          <span className="brand-mark">IM</span>
          {ko.appName}
        </Link>
        <div className="stats">
          <span>{teamName(game.viewerSlot)} 팀</span>
        </div>
      </nav>

      <section className="game-shell">
        <div className="game-panel">
          <div className="board-wrap">
            <div className="board" aria-label="Invisible Maze board">
              {Array.from({ length: 64 }, (_, index) => {
                const x = index % 8;
                const y = 7 - Math.floor(index / 8);
                const point = { x, y };
                return (
                  <button
                    aria-label={`(${x}, ${y})`}
                    className={`cell ${(x + y) % 2 === 0 ? "light" : "dark"}`}
                    disabled={!canAct || pending}
                    key={index}
                    onClick={() => moveToCell(point)}
                    type="button"
                  />
                );
              })}

              {(["A", "B"] as PlayerSlot[]).map((slot) =>
                samePoint(game.players[slot].position, game.players[slot].goal) ? null : (
                  <div
                    aria-label={`${slot} 목표`}
                    className={`goal ${slot.toLowerCase()}`}
                    key={`goal-${slot}`}
                    style={toBoard(game.players[slot].goal)}
                  >
                    <Flag size={32} strokeWidth={2.55} />
                  </div>
                )
              )}

              {game.revealedWalls.map((wall) => (
                <div className="wall-flash" key={wall.key} style={wallStyle(wall.key)} />
              ))}

              {(["A", "B"] as PlayerSlot[]).map((slot) => (
                <div aria-label={`${slot} 플레이어`} className={`piece ${slot.toLowerCase()}`} key={slot} style={toBoard(game.players[slot].position)}>
                  <ChessPawn className="pawn-mark" size={42} strokeWidth={2.35} aria-hidden="true" />
                </div>
              ))}
            </div>
          </div>
        </div>

        <aside className="side-panel">
          <div className={`turn-card ${game.currentTurn === "A" ? "red" : "blue"}`}>
            <span>{game.status === "finished" ? "게임 종료" : canAct ? "움직일 차례" : "상대 차례"}</span>
            <strong>{game.status === "finished" ? `${teamName(game.winner)} 승리` : teamName(game.currentTurn)}</strong>
          </div>

          <div className="round-stats">
            <div>
              <span>남은 이동</span>
              <strong>{game.status === "playing" ? stepsLeft : 0}</strong>
            </div>
            <div>
              <span>남은 시간</span>
              <strong>{game.status === "playing" ? secondsLeft : 0}</strong>
            </div>
          </div>

          <p className="notice">{error || (canAct ? "인접한 칸을 클릭하세요." : "대기 중")}</p>

          <div className="log">
            <strong>기록</strong>
            {recentEvents.map((item) => (
              <span key={item.id}>{eventText(item)}</span>
            ))}
          </div>
        </aside>
      </section>
    </main>
  );
}
