"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Brain,
  ChessPawn,
  CircleAlert,
  Crown,
  Frown,
  Hand,
  Radar,
  RotateCcw,
  Smile,
  Swords,
  ThumbsUp,
  User,
  type LucideIcon
} from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DISCONNECT_FORFEIT_MS,
  EMOTE_LIMIT,
  EMOTE_WINDOW_MS,
  MATCH_READY_MS,
  TURN_SECONDS,
  type Direction,
  type EmoteType,
  type GameEvent,
  type PlayerSlot,
  type Point
} from "@/lib/game/types";
import { ko } from "@/lib/i18n/ko";

type PublicGame = {
  id: string;
  status: string;
  players: Record<PlayerSlot, { position: Point; goal: Point; missedTurns: number; connectedAt: number }>;
  currentTurn?: PlayerSlot;
  coinTossStartsAt: number;
  coinRevealAt: number;
  gameStartsAt: number;
  turnStepsUsed: number;
  turnDeadlineAt: number;
  winner?: PlayerSlot;
  winReason?: string;
  rematch?: {
    requestedBy: PlayerSlot[];
    expiresAt: number;
    nextGameId?: string;
  };
  emotes: Record<PlayerSlot, { sentAt: number[]; blockedUntil?: number }>;
  revealedWalls: Array<{ key: string; expiresAt: number }>;
  mazeStats: {
    shortestPath: number;
    walls: number;
  };
  mazeWalls?: string[];
  wallHits?: Record<string, PlayerSlot[]>;
  events: GameEvent[];
  viewerSlot?: PlayerSlot;
  updatedAt: number;
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function pieceStyle(point: Point, slot: PlayerSlot, overlapped: boolean): CSSProperties {
  return {
    ...toBoard(point),
    "--piece-offset-x": overlapped ? (slot === "A" ? "-18%" : "18%") : "0%"
  } as CSSProperties;
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

function finishedWallClass(game: PublicGame, key: string) {
  const hits = game.wallHits?.[key] ?? [];
  if (hits.includes("A") && hits.includes("B")) return "both";
  if (hits.includes("A")) return "a";
  if (hits.includes("B")) return "b";
  return "unknown";
}

function eventText(event: GameEvent) {
  const teamName = (slot: unknown) => (slot === "A" ? "Red" : slot === "B" ? "Blue" : String(slot));
  if (event.type === "emote") return `${teamName(event.payload.player)} ${emoteLabel(event.payload.emote)}`;
  if (event.type === "rematch_requested") return `${teamName(event.payload.player)} 다시 플레이 요청`;
  if (event.type === "rematch_started") return "다시 플레이 시작";
  if (event.type === "wall_hit") return `${teamName(event.payload.player)} 충돌`;
  if (event.type === "move") return `${teamName(event.payload.player)} 이동`;
  if (event.type === "turn_skipped") return `${teamName(event.payload.player)} 시간 초과`;
  if (event.type === "surrender") return `${teamName(event.payload.loser)} 항복`;
  if (event.type === "win") return `${teamName(event.payload.winner)} 승리`;
  if (event.type === "coin_tossed") return `${teamName(event.payload.first)} 선공`;
  return event.type;
}

function emoteLabel(emote: unknown) {
  if (emote === "hello") return "인사";
  if (emote === "nice") return "좋아요";
  if (emote === "oops") return "아차";
  if (emote === "thinking") return "생각 중";
  if (emote === "smile") return "웃음";
  if (emote === "cry") return "울음";
  return String(emote);
}

function emoteEmoji(emote: unknown) {
  if (emote === "hello") return "👋";
  if (emote === "nice") return "👍";
  if (emote === "oops") return "!";
  if (emote === "thinking") return "💭";
  if (emote === "smile") return "😄";
  if (emote === "cry") return "😢";
  return "•";
}

function teamName(slot?: PlayerSlot) {
  if (slot === "A") return "Red";
  if (slot === "B") return "Blue";
  return "-";
}

function resultText(game: PublicGame) {
  if (game.status !== "finished") return "";
  return game.winner === game.viewerSlot ? "게임 승리" : "게임 패배";
}

const emoteOptions: Array<{ emote: EmoteType; label: string; Icon: LucideIcon }> = [
  { emote: "hello", label: "인사", Icon: Hand },
  { emote: "nice", label: "좋아요", Icon: ThumbsUp },
  { emote: "oops", label: "아차", Icon: CircleAlert },
  { emote: "thinking", label: "생각 중", Icon: Brain },
  { emote: "smile", label: "웃음", Icon: Smile },
  { emote: "cry", label: "울음", Icon: Frown }
];

const directionIcons: Record<Direction, LucideIcon> = {
  up: ArrowUp,
  right: ArrowRight,
  down: ArrowDown,
  left: ArrowLeft
};

export function GameClient({ gameId }: { gameId: string }) {
  const [game, setGame] = useState<PublicGame | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const [matchPending, setMatchPending] = useState(false);
  const [rematchPending, setRematchPending] = useState(false);
  const [emotePending, setEmotePending] = useState<EmoteType | null>(null);
  const [pingMs, setPingMs] = useState<number | null>(null);
  const [endNotice, setEndNotice] = useState("");
  const [endQueued, setEndQueued] = useState(false);
  const [boardEmotes, setBoardEmotes] = useState<
    Array<{ id: string; slot: PlayerSlot; point: Point; label: string; emoji: string; overlapped: boolean }>
  >([]);
  const seenEventIds = useRef<Set<string> | null>(null);
  const actionPendingRef = useRef(false);

  const showBoardEmote = useCallback((slot: PlayerSlot, point: Point, overlapped: boolean, emote: unknown) => {
    const id = crypto.randomUUID();
    setBoardEmotes((current) => [...current, { id, slot, point, overlapped, label: emoteLabel(emote), emoji: emoteEmoji(emote) }]);

    window.setTimeout(() => {
      setBoardEmotes((current) => current.filter((item) => item.id !== id));
    }, 2400);
  }, []);

  useEffect(() => {
    seenEventIds.current = null;
    setBoardEmotes([]);
  }, [gameId]);

  useEffect(() => {
    const source = new EventSource("/api/presence");
    source.onerror = () => undefined;
    return () => source.close();
  }, []);

  useEffect(() => {
    const source = new EventSource(`/api/game/${gameId}/events`);
    const clock = setInterval(() => setNow(Date.now()), 250);

    source.onmessage = (event) => {
      const data = JSON.parse(event.data) as PublicGame | { error: string };
      if ("error" in data && typeof data.error === "string") {
        setError(data.error ?? "게임 상태를 불러오지 못했습니다.");
        source.close();
        return;
      }

      const nextGame = data as PublicGame;
      setGame(nextGame);
    };

    source.onerror = () => undefined;

    return () => {
      source.close();
      clearInterval(clock);
    };
  }, [gameId]);

  useEffect(() => {
    let cancelled = false;

    async function measurePing() {
      const startedAt = performance.now();
      try {
        const response = await fetch(`/api/game/${gameId}/heartbeat`, {
          method: "POST",
          cache: "no-store"
        });
        if (!cancelled) setPingMs(response.ok ? Math.round(performance.now() - startedAt) : null);
      } catch {
        if (!cancelled) setPingMs(null);
      }
    }

    void measurePing();
    const timer = window.setInterval(measurePing, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [gameId]);

  const canAct = game?.status === "playing" && game.viewerSlot === game.currentTurn;
  const secondsLeft = Math.min(TURN_SECONDS, Math.max(0, Math.ceil(((game?.turnDeadlineAt ?? now) - now) / 1000)));
  const viewerPosition = game?.viewerSlot ? game.players[game.viewerSlot].position : undefined;
  const opponentSlot: PlayerSlot | undefined = game?.viewerSlot ? (game.viewerSlot === "A" ? "B" : "A") : undefined;
  const stepsLeft = Math.max(0, 3 - (game?.turnStepsUsed ?? 0));
  const playersOverlap = game ? samePoint(game.players.A.position, game.players.B.position) : false;
  const isWaitingPhase = game?.status === "waiting";
  const isCoinPhase = game?.status === "coin";
  const isMatchReady = Boolean(game && isCoinPhase && now < game.coinTossStartsAt);
  const coinRevealed = Boolean(game?.currentTurn);
  const startCountdown = Math.max(0, Math.ceil(((game?.gameStartsAt ?? now) - now) / 1000));
  const coinPhaseText = coinRevealed ? `${teamName(game?.currentTurn)} 선공` : "선공 결정 중";
  const viewerTeamText = game?.viewerSlot ? teamName(game.viewerSlot) : "-";
  const viewerTeamClass = game?.viewerSlot?.toLowerCase() ?? "";
  const coinProgress = game
    ? isMatchReady
      ? clamp(((now - (game.coinTossStartsAt - MATCH_READY_MS)) / MATCH_READY_MS) * 100, 0, 100)
      : clamp(((now - game.coinTossStartsAt) / (game.gameStartsAt - game.coinTossStartsAt)) * 100, 0, 100)
    : 0;
  const coinCardStyle = { "--coin-progress": `${coinProgress}%` } as CSSProperties;

  const moveToCell = useCallback(
    async (point: Point) => {
      if (!canAct || !viewerPosition || actionPendingRef.current) return;
      const direction = directionTo(viewerPosition, point);
      if (!direction) {
        setError("현재 위치와 맞닿은 칸만 선택할 수 있습니다.");
        return;
      }

      actionPendingRef.current = true;
      try {
        const response = await fetch(`/api/game/${gameId}/action`, {
          method: "POST",
          body: JSON.stringify({ steps: [direction] })
        });
        const data = await response.json();
        if (response.ok) {
          setGame(data);
          setError("");
        } else {
          setError(data.error === "out_of_bounds_move" ? "밖으로 움직일 수 없습니다." : data.error ?? "이동하지 못했습니다.");
        }
      } finally {
        actionPendingRef.current = false;
      }
    },
    [canAct, gameId, viewerPosition]
  );

  const startNewMatch = useCallback(async () => {
    if (matchPending) return;
    setMatchPending(true);
    setError("");
    setEndNotice("");

    const response = await fetch("/api/match/join", { method: "POST", body: JSON.stringify({}) });
    const data = await response.json();
    if (data.status === "matched") {
      location.href = `/game/${data.gameId}`;
      return;
    }

    if (data.error) {
      setEndNotice("새 매칭을 시작하지 못했습니다.");
    } else {
      setEndNotice("");
      setEndQueued(true);
    }
    setMatchPending(false);
  }, [matchPending]);

  const requestRematch = useCallback(async () => {
    if (rematchPending || game?.status !== "finished") return;
    setRematchPending(true);
    setEndNotice("");

    const response = await fetch(`/api/game/${gameId}/rematch`, { method: "POST" });
    const data = await response.json();
    if (response.ok) {
      if (data.nextGameId) {
        location.href = `/game/${data.nextGameId}`;
        return;
      }
      setGame(data.game);
    } else {
      setEndNotice(data.error ?? "다시 플레이를 요청하지 못했습니다.");
    }
    setRematchPending(false);
  }, [game?.status, gameId, rematchPending]);

  const cancelEndMatch = useCallback(async () => {
    if (matchPending) return;
    setMatchPending(true);
    const response = await fetch("/api/match/cancel", { method: "POST" });
    if (response.ok) {
      setEndQueued(false);
      setEndNotice("매칭을 취소했습니다.");
    } else {
      setEndNotice("매칭을 취소하지 못했습니다.");
    }
    setMatchPending(false);
  }, [matchPending]);

  const surrenderGame = useCallback(async () => {
    if (actionPendingRef.current || game?.status === "finished") return;
    if (!confirm("항복하시겠습니까?")) return;

    actionPendingRef.current = true;
    try {
      const response = await fetch(`/api/game/${gameId}/surrender`, { method: "POST" });
      const data = await response.json();
      if (response.ok) {
        setGame(data);
        setError("");
      } else {
        setError(data.error ?? "항복하지 못했습니다.");
      }
    } finally {
      actionPendingRef.current = false;
    }
  }, [game?.status, gameId]);

  const sendEmote = useCallback(
    async (emote: EmoteType) => {
      if (emotePending || !game?.viewerSlot) return;
      setEmotePending(emote);
      const response = await fetch(`/api/game/${gameId}/emote`, {
        method: "POST",
        body: JSON.stringify({ emote })
      });
      const data = await response.json();
      if (response.ok) {
        setGame(data);
      } else {
        if (data.error === "emote_blocked") {
          setError("잠시 기다려 주세요.");
        } else {
          setError(data.error ?? "감정 표현을 보내지 못했습니다.");
        }
      }
      setEmotePending(null);
    },
    [emotePending, game?.viewerSlot, gameId]
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

  useEffect(() => {
    if (game?.status !== "finished" || !endQueued) return;
    const timer = setInterval(async () => {
      const response = await fetch("/api/match/join", { method: "POST", body: JSON.stringify({}) });
      const data = await response.json();
      if (data.status === "matched") location.href = `/game/${data.gameId}`;
    }, 2000);
    return () => clearInterval(timer);
  }, [endQueued, game?.status]);

  useEffect(() => {
    if (game?.rematch?.nextGameId) location.href = `/game/${game.rematch.nextGameId}`;
  }, [game?.rematch?.nextGameId]);

  useEffect(() => {
    if (!game) return;

    if (!seenEventIds.current) {
      seenEventIds.current = new Set(game.events.map((event) => event.id));
      return;
    }

    for (const event of game.events) {
      if (seenEventIds.current.has(event.id)) continue;
      seenEventIds.current.add(event.id);

      if (event.type === "emote" && (event.payload.player === "A" || event.payload.player === "B")) {
        const slot = event.payload.player;
        showBoardEmote(slot, game.players[slot].position, playersOverlap, event.payload.emote);
      }
    }
  }, [game, playersOverlap, showBoardEmote]);

  const recentEvents = useMemo(() => [...(game?.events ?? [])].slice(-8).reverse(), [game?.events]);
  const rematchRequested = Boolean(game?.viewerSlot && game.rematch?.requestedBy.includes(game.viewerSlot));
  const opponentRematchRequested = Boolean(
    game?.viewerSlot && game.rematch?.requestedBy.some((slot) => slot !== game.viewerSlot)
  );
  const rematchSecondsLeft = Math.max(0, Math.ceil(((game?.rematch?.expiresAt ?? now) - now) / 1000));
  const rematchExpired = game?.status === "finished" && rematchSecondsLeft <= 0;
  const viewerEmotes = game?.viewerSlot ? game.emotes[game.viewerSlot] : undefined;
  const recentEmoteCount = viewerEmotes?.sentAt.filter((sentAt) => now - sentAt < EMOTE_WINDOW_MS).length ?? 0;
  const emoteBlocked = Boolean(viewerEmotes?.blockedUntil && now < viewerEmotes.blockedUntil);
  const emotesDisabled = emotePending !== null || emoteBlocked || recentEmoteCount >= EMOTE_LIMIT;
  const viewerMissedTurns = game?.viewerSlot ? game.players[game.viewerSlot].missedTurns : 0;
  const opponentMissedTurns = opponentSlot && game ? game.players[opponentSlot].missedTurns : 0;
  const opponentConnectedAt = opponentSlot && game ? game.players[opponentSlot].connectedAt : 0;
  const opponentDisconnectedFor = opponentConnectedAt > 0 ? now - opponentConnectedAt : 0;
  const opponentDisconnectSecondsLeft = Math.max(0, Math.ceil((DISCONNECT_FORFEIT_MS - opponentDisconnectedFor) / 1000));
  const opponentDisconnected =
    game?.status === "playing" &&
    Boolean(opponentSlot) &&
    opponentConnectedAt > 0 &&
    opponentDisconnectedFor > 5_000 &&
    opponentDisconnectedFor < DISCONNECT_FORFEIT_MS;
  const statusNotice =
    error || (isWaitingPhase ? "상대가 게임 화면에 들어오면 시작합니다." : isCoinPhase ? (coinRevealed ? "게임 시작을 준비하세요." : "선공을 결정하고 있습니다.") : "");

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
        <Link className="brand plain-home-link" href="/">
          <span className="brand-mark">
            <Swords size={18} />
          </span>
          {ko.appName}
        </Link>
      </nav>

      <section className="game-shell">
        <div className="game-panel">
          <div className="board-wrap">
            <div className="board-meta" aria-label="미로 정보">
              <span>
                최단 경로 <strong>{game.mazeStats.shortestPath}</strong>
              </span>
            </div>
            <div className="board" aria-label="Invisible Maze board">
              {Array.from({ length: 64 }, (_, index) => {
                const x = index % 8;
                const y = 7 - Math.floor(index / 8);
                const point = { x, y };
                const moveDirection = viewerPosition ? directionTo(viewerPosition, point) : undefined;
                const MoveIcon = moveDirection ? directionIcons[moveDirection] : undefined;
                return (
                  <button
                    aria-label={`(${x}, ${y})`}
                    className={`cell ${(x + y) % 2 === 0 ? "light" : "dark"} ${canAct && moveDirection ? "move-target" : ""}`}
                    disabled={!canAct}
                    key={index}
                    onClick={() => moveToCell(point)}
                    type="button"
                  >
                    {canAct && MoveIcon ? (
                      <span className={`move-arrow ${moveDirection}`} aria-hidden="true">
                        <MoveIcon size={24} strokeWidth={2.6} />
                      </span>
                    ) : null}
                  </button>
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
                    <Crown size={34} strokeWidth={2.45} />
                  </div>
                )
              )}

              {game.status === "finished" && game.mazeWalls
                ? game.mazeWalls.map((key) => (
                    <div className={`maze-wall ${finishedWallClass(game, key)}`} key={key} style={wallStyle(key)} />
                  ))
                : game.revealedWalls.map((wall) => <div className="wall-flash" key={wall.key} style={wallStyle(wall.key)} />)}

              {(["A", "B"] as PlayerSlot[]).map((slot) => (
                <div
                  aria-label={`${slot} 플레이어`}
                  className={`piece ${slot.toLowerCase()}`}
                  key={slot}
                  style={pieceStyle(game.players[slot].position, slot, playersOverlap)}
                >
                  <ChessPawn className="pawn-mark" size={42} strokeWidth={2.35} aria-hidden="true" />
                  {slot === game.viewerSlot ? <span className="me-label">me</span> : null}
                </div>
              ))}

              {boardEmotes.map((item) => (
                <div
                  aria-label={`${teamName(item.slot)} 감정 표현: ${item.label}`}
                  className={`board-emote-burst ${item.slot.toLowerCase()}`}
                  key={item.id}
                  style={pieceStyle(item.point, item.slot, item.overlapped)}
                >
                  {[0, 1, 2].map((index) => (
                    <span className={`board-emote-icon item-${index + 1}`} key={index}>
                      {item.emoji}
                    </span>
                  ))}
                  <span className="board-emote-label">{item.label}</span>
                </div>
              ))}

              {isCoinPhase ? (
                <div className="coin-overlay" aria-live="polite">
                  <div className="coin-card" style={coinCardStyle}>
                    {isMatchReady ? (
                      <>
                        <span className="coin-kicker">매칭 완료</span>
                        <span className="opponent-label">상대: Guest</span>
                        <span className={`viewer-team ${viewerTeamClass}`}>내 팀: {viewerTeamText}</span>
                      </>
                    ) : (
                      <>
                        <div className={`coin-token ${coinRevealed ? game.currentTurn?.toLowerCase() : "flipping"}`}>
                          {coinRevealed ? startCountdown : ""}
                        </div>
                        <strong>{coinPhaseText}</strong>
                        <span className={`viewer-team ${viewerTeamClass}`}>내 팀: {viewerTeamText}</span>
                      </>
                    )}
                    <div className="coin-progress" aria-hidden="true">
                      <span />
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            {game.status === "finished" ? (
              <div className="end-entry-panel">
                <div className="actions">
                  <div className="rematch-group">
                    <button
                      className="button primary-action rematch-action"
                      disabled={rematchPending || rematchRequested || rematchExpired}
                      onClick={requestRematch}
                      type="button"
                    >
                      <RotateCcw size={22} />
                      <span>
                        {rematchExpired
                          ? "다시 플레이 만료"
                          : rematchPending
                            ? "요청 중"
                            : rematchRequested && opponentRematchRequested
                              ? "다시 플레이 시작 중"
                              : opponentRematchRequested
                                ? "상대의 요청 도착"
                                : rematchRequested
                                  ? "상대 응답 대기 중"
                                  : "다시 플레이"}
                      </span>
                    </button>
                    <span className="end-action-subtext">
                      {rematchExpired
                        ? "새로운 게임 참가를 이용하세요"
                        : opponentRematchRequested && !rematchRequested
                          ? `수락하시겠습니까? · ${rematchSecondsLeft}초 남음`
                          : `${rematchSecondsLeft}초 남음`}
                    </span>
                  </div>
                  {endQueued ? (
                    <div className="new-match-group">
                      <div className="match-control is-queueing">
                        <button className="button primary-action match-status" disabled type="button">
                          <Radar size={22} />
                          <span>매칭 중</span>
                          <span className="queue-dots" aria-hidden="true">
                            <span />
                            <span />
                            <span />
                          </span>
                        </button>
                        <button className="button match-cancel" disabled={matchPending} onClick={cancelEndMatch} type="button">
                          매칭 취소
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="new-match-group">
                      <button className="button primary-action" disabled={matchPending} onClick={startNewMatch} type="button">
                        <Radar size={22} />
                        <span>{matchPending ? "매칭 대기 중" : "새로운 게임 참가"}</span>
                      </button>
                    </div>
                  )}
                </div>
                {endNotice ? <p className="notice strong-notice">{endNotice}</p> : null}
              </div>
            ) : null}
          </div>
        </div>

        <aside className="side-panel">
          <div className="opponent-profile">
            <User className="opponent-icon" size={30} aria-hidden="true" />
            <strong>Guest</strong>
            {/* <div className="opponent-meta" aria-label="상대 프로필 정보">
              <span>전적</span>
              <span>-</span>
            </div> */}
          </div>

          <div
            className={`turn-card ${
              game.status === "finished"
                ? game.winner === game.viewerSlot
                  ? "win"
                  : "loss"
                : isCoinPhase
                  ? "coin"
                  : game.currentTurn === "A"
                    ? "red"
                    : "blue"
            }`}
          >
            <span>{game.status === "finished" ? resultText(game) : isWaitingPhase ? "입장 대기" : isCoinPhase ? coinPhaseText : teamName(game.currentTurn)}</span>
            <strong>{game.status === "finished" ? "게임 종료" : isWaitingPhase ? "상대 입장 대기" : isCoinPhase ? "동전 던지기" : canAct ? "움직일 차례" : "상대 차례"}</strong>
          </div>

          <div className="round-stats">
            <div>
              <span>남은 이동</span>
              <strong>{game.status === "playing" ? stepsLeft : 0}</strong>
            </div>
            <div>
              <span>남은 시간</span>
              <strong>{game.status === "playing" ? secondsLeft : isCoinPhase && coinRevealed ? startCountdown : 0}</strong>
            </div>
            <div>
              <span>Ping</span>
              <strong>{pingMs === null ? "-" : `${pingMs}ms`}</strong>
            </div>
          </div>

          {game.status === "playing" ? (
            <div className="risk-panel" aria-label="패배 조건 상태">
              <div>
                <span>내 시간초과</span>
                <strong>{viewerMissedTurns}/3</strong>
              </div>
              <div>
                <span>상대 시간초과</span>
                <strong>{opponentMissedTurns}/3</strong>
              </div>
              <p>시간 초과 3번 시 패배합니다.</p>
            </div>
          ) : null}

          {opponentDisconnected ? (
            <div className="disconnect-alert" role="status">
              <strong>상대 연결이 끊겼습니다.</strong>
              <span>{opponentDisconnectSecondsLeft}초 안에 돌아오지 않으면 자동 승리합니다.</span>
            </div>
          ) : null}

          {statusNotice ? <p className="notice">{statusNotice}</p> : null}

          {game.status !== "finished" ? (
            <button className="button danger full-width" onClick={surrenderGame} type="button">
              항복
            </button>
          ) : null}

          <div className="emote-panel" aria-label="감정 표현">
            <div className="emote-header">
              <strong>감정 표현</strong>
            </div>
            {emoteOptions.map(({ emote, label, Icon }) => (
              <button className="emote-button" disabled={emotesDisabled} key={emote} onClick={() => sendEmote(emote)} type="button">
                <Icon size={18} />
                <span>{label}</span>
              </button>
            ))}
          </div>

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
