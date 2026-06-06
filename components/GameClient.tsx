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
import { LanguageSwitch } from "@/components/LanguageSwitch";
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
import { useI18n } from "@/lib/i18n/client";
import type { Messages } from "@/lib/i18n";

const DISCONNECT_WARNING_MS = 15_000;

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

function eventText(event: GameEvent, t: Messages) {
  const eventTeamName = (slot: unknown) => (slot === "A" || slot === "B" ? teamName(slot, t) : String(slot));
  if (event.type === "emote") return `${eventTeamName(event.payload.player)} ${emoteLabel(event.payload.emote, t)}`;
  if (event.type === "rematch_requested") return `${eventTeamName(event.payload.player)} ${t.rematchRequestedEvent}`;
  if (event.type === "rematch_started") return t.rematchStartedEvent;
  if (event.type === "wall_hit") return `${eventTeamName(event.payload.player)} ${t.collisionEvent}`;
  if (event.type === "move") return `${eventTeamName(event.payload.player)} ${t.moveEvent}`;
  if (event.type === "turn_skipped") return `${eventTeamName(event.payload.player)} ${t.turnSkippedEvent}`;
  if (event.type === "surrender") return `${eventTeamName(event.payload.loser)} ${t.surrenderEvent}`;
  if (event.type === "win") return `${eventTeamName(event.payload.winner)} ${t.winEvent}`;
  if (event.type === "coin_tossed") return `${eventTeamName(event.payload.first)} ${t.firstMoveEvent}`;
  return event.type;
}

function emoteLabel(emote: unknown, t: Messages) {
  if (emote === "hello") return t.emoteHello;
  if (emote === "nice") return t.emoteNice;
  if (emote === "oops") return t.emoteOops;
  if (emote === "thinking") return t.emoteThinking;
  if (emote === "smile") return t.emoteSmile;
  if (emote === "cry") return t.emoteCry;
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

function teamName(slot: PlayerSlot | undefined, t: Messages) {
  if (slot === "A") return t.teamRed;
  if (slot === "B") return t.teamBlue;
  return "-";
}

function resultText(game: PublicGame, t: Messages) {
  if (game.status !== "finished") return "";
  return game.winner === game.viewerSlot ? t.gameWin : t.gameLoss;
}

function isRematchWindowExpired(game: PublicGame | null, at: number) {
  return game?.status === "finished" && (!game.rematch || at >= game.rematch.expiresAt);
}

type EmoteLabelKey = "emoteHello" | "emoteNice" | "emoteOops" | "emoteThinking" | "emoteSmile" | "emoteCry";

const emoteOptions: Array<{ emote: EmoteType; labelKey: EmoteLabelKey; Icon: LucideIcon }> = [
  { emote: "hello", labelKey: "emoteHello", Icon: Hand },
  { emote: "nice", labelKey: "emoteNice", Icon: ThumbsUp },
  { emote: "oops", labelKey: "emoteOops", Icon: CircleAlert },
  { emote: "thinking", labelKey: "emoteThinking", Icon: Brain },
  { emote: "smile", labelKey: "emoteSmile", Icon: Smile },
  { emote: "cry", labelKey: "emoteCry", Icon: Frown }
];

const directionIcons: Record<Direction, LucideIcon> = {
  up: ArrowUp,
  right: ArrowRight,
  down: ArrowDown,
  left: ArrowLeft
};

export function GameClient({ gameId }: { gameId: string }) {
  const { locale, setLocale, t } = useI18n();
  const [game, setGame] = useState<PublicGame | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const [matchPending, setMatchPending] = useState(false);
  const [rematchPending, setRematchPending] = useState(false);
  const [emotePending, setEmotePending] = useState<EmoteType | null>(null);
  const [pingMs, setPingMs] = useState<number | null>(null);
  const [endNotice, setEndNotice] = useState("");
  const [endQueued, setEndQueued] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [boardEmotes, setBoardEmotes] = useState<
    Array<{ id: string; slot: PlayerSlot; point: Point; label: string; emoji: string; overlapped: boolean }>
  >([]);
  const seenEventIds = useRef<Set<string> | null>(null);
  const actionPendingRef = useRef(false);
  const rematchWindowExpired = isRematchWindowExpired(game, now);

  const showBoardEmote = useCallback((slot: PlayerSlot, point: Point, overlapped: boolean, emote: unknown) => {
    const id = crypto.randomUUID();
    setBoardEmotes((current) => [...current, { id, slot, point, overlapped, label: emoteLabel(emote, t), emoji: emoteEmoji(emote) }]);

    window.setTimeout(() => {
      setBoardEmotes((current) => current.filter((item) => item.id !== id));
    }, 2400);
  }, [t]);

  useEffect(() => {
    seenEventIds.current = null;
    setBoardEmotes([]);
  }, [gameId]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/session", { method: "POST" })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setSessionReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!sessionReady) return;
    const source = new EventSource("/api/presence");
    source.onerror = () => undefined;
    return () => source.close();
  }, [sessionReady]);

  useEffect(() => {
    if (!sessionReady) return;
    const source = new EventSource(`/api/game/${gameId}/events`);
    const clock = setInterval(() => setNow(Date.now()), 250);

    source.onmessage = (event) => {
      const data = JSON.parse(event.data) as PublicGame | { error: string };
      if ("error" in data && typeof data.error === "string") {
        setError(data.error ?? t.gameLoadFailed);
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
  }, [gameId, sessionReady, t]);

  useEffect(() => {
    let cancelled = false;

    if (!sessionReady) return;

    if (rematchWindowExpired) {
      setPingMs(null);
      return;
    }

    async function measurePing() {
      const startedAt = performance.now();
      try {
        const response = await fetch("/api/ping", {
          method: "HEAD",
          cache: "no-store"
        });
        if (!cancelled) setPingMs(response.ok ? Math.round(performance.now() - startedAt) : null);
      } catch {
        if (!cancelled) setPingMs(null);
      }
    }

    void measurePing();
    const timer = window.setInterval(measurePing, 1_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [gameId, rematchWindowExpired, sessionReady]);

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
  const coinPhaseText = coinRevealed ? `${teamName(game?.currentTurn, t)} ${t.firstMover}` : t.firstMoverDeciding;
  const viewerTeamText = game?.viewerSlot ? teamName(game.viewerSlot, t) : "-";
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
        setError(t.adjacentOnly);
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
          setError(data.error === "out_of_bounds_move" ? t.outOfBounds : data.error ?? t.moveFailed);
        }
      } finally {
        actionPendingRef.current = false;
      }
    },
    [canAct, gameId, t, viewerPosition]
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
      setEndNotice(t.newMatchFailed);
    } else {
      setEndNotice("");
      setEndQueued(true);
    }
    setMatchPending(false);
  }, [matchPending, t]);

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
      setEndNotice(data.error ?? t.rematchRequestFailed);
    }
    setRematchPending(false);
  }, [game?.status, gameId, rematchPending, t]);

  const cancelEndMatch = useCallback(async () => {
    if (matchPending) return;
    setMatchPending(true);
    const response = await fetch("/api/match/cancel", { method: "POST" });
    if (response.ok) {
      setEndQueued(false);
      setEndNotice(t.matchCanceled);
    } else {
      setEndNotice(t.matchCancelFailed);
    }
    setMatchPending(false);
  }, [matchPending, t]);

  const surrenderGame = useCallback(async () => {
    if (actionPendingRef.current || game?.status === "finished") return;
    if (!confirm(t.surrenderConfirm)) return;

    actionPendingRef.current = true;
    try {
      const response = await fetch(`/api/game/${gameId}/surrender`, { method: "POST" });
      const data = await response.json();
      if (response.ok) {
        setGame(data);
        setError("");
      } else {
        setError(data.error ?? t.surrenderFailed);
      }
    } finally {
      actionPendingRef.current = false;
    }
  }, [game?.status, gameId, t]);

  const sendEmote = useCallback(
    async (emote: EmoteType) => {
      if (emotePending || !game?.viewerSlot || isRematchWindowExpired(game, Date.now())) return;
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
          setError(t.waitMoment);
        } else {
          setError(data.error ?? t.emoteSendFailed);
        }
      }
      setEmotePending(null);
    },
    [emotePending, game, gameId, t]
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
  const rematchExpired = rematchWindowExpired;
  const viewerEmotes = game?.viewerSlot ? game.emotes[game.viewerSlot] : undefined;
  const recentEmoteCount = viewerEmotes?.sentAt.filter((sentAt) => now - sentAt < EMOTE_WINDOW_MS).length ?? 0;
  const emoteBlocked = Boolean(viewerEmotes?.blockedUntil && now < viewerEmotes.blockedUntil);
  const emotesDisabled = rematchExpired || emotePending !== null || emoteBlocked || recentEmoteCount >= EMOTE_LIMIT;
  const viewerMissedTurns = game?.viewerSlot ? game.players[game.viewerSlot].missedTurns : 0;
  const opponentMissedTurns = opponentSlot && game ? game.players[opponentSlot].missedTurns : 0;
  const opponentConnectedAt = opponentSlot && game ? game.players[opponentSlot].connectedAt : 0;
  const opponentDisconnectedFor = opponentConnectedAt > 0 ? now - opponentConnectedAt : 0;
  const opponentDisconnectSecondsLeft = Math.max(0, Math.ceil((DISCONNECT_FORFEIT_MS - opponentDisconnectedFor) / 1000));
  const opponentDisconnected =
    game?.status === "playing" &&
    Boolean(opponentSlot) &&
    opponentConnectedAt > 0 &&
    opponentDisconnectedFor > DISCONNECT_WARNING_MS &&
    opponentDisconnectedFor < DISCONNECT_FORFEIT_MS;
  const statusNotice =
    error || (isWaitingPhase ? t.waitingForOpponentScreen : isCoinPhase ? (coinRevealed ? t.prepareGameStart : t.decidingFirstMover) : "");

  if (!game) {
    return (
      <main className="shell">
        <div className="entry-panel">{t.gameLoading}</div>
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
          {t.appName}
        </Link>
        <LanguageSwitch currentLabel={t.languageCurrent} label={t.languageToggleLabel} locale={locale} onChange={setLocale} />
      </nav>

      <section className="game-shell">
        <div className="game-panel">
          <div className="board-wrap">
            <div className="board-meta" aria-label={t.mazeInfo}>
              <span>
                {t.shortestPath} <strong>{game.mazeStats.shortestPath}</strong>
              </span>
            </div>
            <div className="board" aria-label={t.boardLabel}>
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
                    aria-label={`${slot} ${t.goalLabel}`}
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
                  aria-label={`${slot} ${t.playerLabel}`}
                  className={`piece ${slot.toLowerCase()}`}
                  key={slot}
                  style={pieceStyle(game.players[slot].position, slot, playersOverlap)}
                >
                  <ChessPawn className="pawn-mark" size={42} strokeWidth={2.35} aria-hidden="true" />
                  {slot === game.viewerSlot ? <span className="me-label">{t.me}</span> : null}
                </div>
              ))}

              {boardEmotes.map((item) => (
                <div
                  aria-label={`${teamName(item.slot, t)} ${t.emoteA11y}: ${item.label}`}
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
                        <span className="coin-kicker">{t.matchComplete}</span>
                        <span className="opponent-label">{t.opponent}: Guest</span>
                        <span className={`viewer-team ${viewerTeamClass}`}>{t.myTeam}: {viewerTeamText}</span>
                      </>
                    ) : (
                      <>
                        <div className={`coin-token ${coinRevealed ? game.currentTurn?.toLowerCase() : "flipping"}`}>
                          {coinRevealed ? startCountdown : ""}
                        </div>
                        <strong>{coinPhaseText}</strong>
                        <span className={`viewer-team ${viewerTeamClass}`}>{t.myTeam}: {viewerTeamText}</span>
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
                          ? t.rematchExpired
                          : rematchPending
                            ? t.requesting
                            : rematchRequested && opponentRematchRequested
                              ? t.rematchStarting
                              : opponentRematchRequested
                                ? t.opponentRequestArrived
                                : rematchRequested
                                  ? t.waitingOpponentResponse
                                  : t.rematch}
                      </span>
                    </button>
                    <span className="end-action-subtext">
                      {rematchExpired
                        ? t.useNewMatch
                        : opponentRematchRequested && !rematchRequested
                          ? `${t.acceptPrompt} · ${rematchSecondsLeft}${t.secondsLeftSuffix}`
                          : `${rematchSecondsLeft}${t.secondsLeftSuffix}`}
                    </span>
                  </div>
                  {endQueued ? (
                    <div className="new-match-group">
                      <div className="match-control is-queueing">
                        <button className="button primary-action match-status" disabled type="button">
                          <Radar size={22} />
                          <span>{t.matching}</span>
                          <span className="queue-dots" aria-hidden="true">
                            <span />
                            <span />
                            <span />
                          </span>
                        </button>
                        <button className="button match-cancel" disabled={matchPending} onClick={cancelEndMatch} type="button">
                          {t.cancelMatch}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="new-match-group">
                      <button className="button primary-action" disabled={matchPending} onClick={startNewMatch} type="button">
                        <Radar size={22} />
                        <span>{matchPending ? t.queueWaiting : t.newGameJoin}</span>
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
            <span>{game.status === "finished" ? resultText(game, t) : isWaitingPhase ? t.waitingEntry : isCoinPhase ? coinPhaseText : teamName(game.currentTurn, t)}</span>
            <strong>{game.status === "finished" ? t.gameEnded : isWaitingPhase ? t.waitingOpponentEntry : isCoinPhase ? t.coinToss : canAct ? t.moveTurn : t.opponentTurn}</strong>
          </div>

          <div className="round-stats">
            <div>
              <span>{t.stepsLeft}</span>
              <strong>{game.status === "playing" ? stepsLeft : 0}</strong>
            </div>
            <div>
              <span>{t.timeLeft}</span>
              <strong>{game.status === "playing" ? secondsLeft : isCoinPhase && coinRevealed ? startCountdown : 0}</strong>
            </div>
            <div>
              <span>Ping</span>
              <strong>{pingMs === null ? "-" : `${pingMs}ms`}</strong>
            </div>
          </div>

          {game.status === "playing" ? (
            <div className="risk-panel" aria-label={t.defeatStatus}>
              <div>
                <span>{t.myTimeouts}</span>
                <strong>{viewerMissedTurns}/3</strong>
              </div>
              <div>
                <span>{t.opponentTimeouts}</span>
                <strong>{opponentMissedTurns}/3</strong>
              </div>
              <p>{t.timeoutLossNote}</p>
            </div>
          ) : null}

          {opponentDisconnected ? (
            <div className="disconnect-alert" role="status">
              <strong>{t.opponentDisconnectedTitle}</strong>
              <span>{opponentDisconnectSecondsLeft}{t.opponentDisconnectWin}</span>
            </div>
          ) : null}

          {statusNotice ? <p className="notice">{statusNotice}</p> : null}

          {game.status !== "finished" ? (
            <button className="button danger full-width" onClick={surrenderGame} type="button">
              {t.surrender}
            </button>
          ) : null}

          <div className="emote-panel" aria-label={t.emotes}>
            <div className="emote-header">
              <strong>{t.emotes}</strong>
            </div>
            {emoteOptions.map(({ emote, labelKey, Icon }) => (
              <button className="emote-button" disabled={emotesDisabled} key={emote} onClick={() => sendEmote(emote)} type="button">
                <Icon size={18} />
                <span>{t[labelKey]}</span>
              </button>
            ))}
          </div>

          <div className="log">
            <strong>{t.log}</strong>
            {recentEvents.map((item) => (
              <span key={item.id}>{eventText(item, t)}</span>
            ))}
          </div>

        </aside>
      </section>
    </main>
  );
}
