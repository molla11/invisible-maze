"use client";

import { Copy, DoorOpen, Eye, EyeOff, Radar, Swords } from "lucide-react";
import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
import { ko } from "@/lib/i18n/ko";

declare global {
  interface Window {
    turnstile?: {
      render(container: HTMLElement, options: {
        sitekey: string;
        callback(token: string): void;
        "expired-callback"(): void;
        "error-callback"(): void;
      }): string;
      reset(widgetId?: string): void;
    };
  }
}

type Stats = {
  online: number;
  waitingInQueue: number;
  activeGames: number;
};

const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

export function HomeClient({ initialStats }: { initialStats: Stats }) {
  const [stats, setStats] = useState(initialStats);
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(false);
  const [inviteCodeCreated, setInviteCodeCreated] = useState(false);
  const [codeMasked, setCodeMasked] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileVerified, setTurnstileVerified] = useState(false);
  const turnstileContainerRef = useRef<HTMLDivElement | null>(null);
  const turnstileWidgetRef = useRef<string | undefined>(undefined);
  const actionInFlight = useRef(false);

  const renderTurnstile = useCallback(() => {
    if (!turnstileSiteKey || turnstileVerified || !turnstileContainerRef.current || turnstileWidgetRef.current) return;
    turnstileWidgetRef.current = window.turnstile?.render(turnstileContainerRef.current, {
      sitekey: turnstileSiteKey,
      callback: setTurnstileToken,
      "expired-callback": () => setTurnstileToken(""),
      "error-callback": () => setTurnstileToken("")
    });
  }, [turnstileVerified]);

  function resetTurnstile() {
    setTurnstileToken("");
    if (turnstileWidgetRef.current) window.turnstile?.reset(turnstileWidgetRef.current);
  }

  function verifiedBody() {
    if (!turnstileSiteKey || turnstileVerified) return JSON.stringify({});
    if (!turnstileToken) {
      setNotice("보안 확인을 완료해 주세요.");
      throw new Error("turnstile_token_required");
    }
    return JSON.stringify({ turnstileToken });
  }

  useEffect(() => {
    fetch("/api/session", { method: "POST" }).catch(() => undefined);
    const timer = setInterval(async () => {
      const response = await fetch("/api/health");
      if (response.ok) setStats(await response.json());
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    renderTurnstile();
  }, [renderTurnstile]);

  useEffect(() => {
    if (!queued) return;
    const timer = setInterval(async () => {
      const response = await fetch("/api/match/status");
      const data = await response.json();
      if (data.status === "matched") location.href = `/game/${data.gameId}`;
    }, 2000);
    return () => clearInterval(timer);
  }, [queued]);

  useEffect(() => {
    if (!code || queued) return;
    const timer = setInterval(async () => {
      const response = await fetch(`/api/room/${code}`);
      if (!response.ok) return;
      const data = await response.json();
      if (data.gameId) location.href = `/game/${data.gameId}`;
    }, 1500);
    return () => clearInterval(timer);
  }, [code, queued]);

  async function autoMatch() {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setBusy(true);
    setQueued(false);
    setCode("");
    setInviteCodeCreated(false);
    setCodeMasked(false);
    setNotice("매칭 대기 중입니다.");
    try {
      const response = await fetch("/api/match/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: verifiedBody()
      });
      const data = await response.json();
      if (!response.ok) {
        setNotice(data.error === "turnstile_failed" ? "보안 확인에 실패했습니다." : "매칭을 시작하지 못했습니다.");
        if (data.error === "turnstile_failed") resetTurnstile();
        return;
      }
      setTurnstileVerified(true);
      setTurnstileToken("");
      if (data.status === "matched") {
        location.href = `/game/${data.gameId}`;
        return;
      }
      setNotice(ko.queueWaiting);
      setQueued(true);
    } catch (error) {
      if (error instanceof Error && error.message === "turnstile_token_required") return;
      setNotice("매칭을 시작하지 못했습니다.");
    } finally {
      setBusy(false);
      actionInFlight.current = false;
    }
  }

  async function cancelMatch() {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setBusy(true);
    try {
      const response = await fetch("/api/match/cancel", { method: "POST" });
      if (response.ok) {
        setQueued(false);
        setNotice("매칭을 취소했습니다.");
      } else {
        setNotice("매칭을 취소하지 못했습니다.");
      }
    } catch {
      setNotice("매칭을 취소하지 못했습니다.");
    } finally {
      setBusy(false);
      actionInFlight.current = false;
    }
  }

  async function createInvite() {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setBusy(true);
    setQueued(false);
    setInviteCodeCreated(false);
    setCodeMasked(false);
    try {
      const response = await fetch("/api/room", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: verifiedBody()
      });
      const data = await response.json();
      if (!response.ok) {
        setNotice(data.error === "turnstile_failed" ? "보안 확인에 실패했습니다." : "방을 만들지 못했습니다.");
        if (data.error === "turnstile_failed") resetTurnstile();
        return;
      }
      setTurnstileVerified(true);
      setTurnstileToken("");
      if (data.code) {
        setCode(data.code);
        setInviteCodeCreated(true);
        setCodeMasked(true);
        setNotice("초대 코드가 생성되었습니다.");
      } else {
        setNotice("방을 만들지 못했습니다.");
      }
    } catch (error) {
      if (error instanceof Error && error.message === "turnstile_token_required") return;
      setNotice("방을 만들지 못했습니다.");
    } finally {
      setBusy(false);
      actionInFlight.current = false;
    }
  }

  async function copyInviteCode() {
    if (!code.trim()) return;
    try {
      await navigator.clipboard.writeText(code.trim().toUpperCase());
      setNotice("초대 코드를 복사했습니다.");
    } catch {
      setNotice("초대 코드를 복사하지 못했습니다.");
    }
  }

  async function joinInvite() {
    if (actionInFlight.current) return;
    const normalized = code.trim().toUpperCase();
    if (!normalized) return;
    actionInFlight.current = true;
    setBusy(true);
    try {
      const response = await fetch(`/api/room/${normalized}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: verifiedBody()
      });
      const data = await response.json();
      if (data.gameId) {
        setTurnstileVerified(true);
        setTurnstileToken("");
        location.href = `/game/${data.gameId}`;
        return;
      }
      if (response.ok) {
        setTurnstileVerified(true);
        setTurnstileToken("");
      }
      setNotice(
        data.error === "turnstile_failed"
          ? "보안 확인에 실패했습니다."
          : data.error === "room_not_found"
            ? "방 코드를 찾지 못했습니다."
            : "입장할 수 없는 방입니다."
      );
      if (data.error === "turnstile_failed") resetTurnstile();
    } catch (error) {
      if (error instanceof Error && error.message === "turnstile_token_required") return;
      setNotice("입장할 수 없는 방입니다.");
    } finally {
      setBusy(false);
      actionInFlight.current = false;
    }
  }

  const displayedCode = inviteCodeCreated && codeMasked ? "*".repeat(code.length) : code;

  return (
    <main className="shell">
      {turnstileSiteKey ? (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          strategy="afterInteractive"
          onLoad={renderTurnstile}
        />
      ) : null}
      <nav className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <Swords size={18} />
          </span>
          {ko.appName}
        </div>
      </nav>

      <section className="hero">
        <div className="entry-panel">
          <div className="actions">
            {queued ? (
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
                <button className="button match-cancel" disabled={busy} onClick={cancelMatch} type="button">
                  매칭 취소
                </button>
              </div>
            ) : (
              <button className="button primary-action" disabled={busy} onClick={autoMatch}>
                <Radar size={22} />
                <span>{ko.autoMatch}</span>
              </button>
            )}
            <div className="invite-row">
              <button className="button secondary" disabled={busy} onClick={createInvite}>
                <DoorOpen size={18} />
                {ko.createRoom}
              </button>
              <div className="input-row">
                <div className="code-field">
                  <input
                    className="input"
                    maxLength={5}
                    placeholder={ko.roomCode}
                    readOnly={inviteCodeCreated}
                    value={displayedCode}
                    onChange={(event) => {
                      setInviteCodeCreated(false);
                      setCodeMasked(false);
                      setCode(event.target.value.toUpperCase());
                    }}
                  />
                  {inviteCodeCreated ? (
                    <button
                      aria-label={codeMasked ? "초대 코드 보기" : "초대 코드 숨기기"}
                      className="code-visibility-button"
                      onClick={() => setCodeMasked((masked) => !masked)}
                      title={codeMasked ? "초대 코드 보기" : "초대 코드 숨기기"}
                      type="button"
                    >
                      {codeMasked ? <Eye size={18} /> : <EyeOff size={18} />}
                    </button>
                  ) : null}
                </div>
                <button
                  aria-label={inviteCodeCreated ? "초대 코드 복사" : undefined}
                  className={`button ${inviteCodeCreated ? "icon-action" : ""}`}
                  disabled={busy || !code.trim()}
                  onClick={inviteCodeCreated ? copyInviteCode : joinInvite}
                  title={inviteCodeCreated ? "초대 코드 복사" : undefined}
                  type="button"
                >
                  {inviteCodeCreated ? <Copy size={18} /> : ko.joinRoom}
                </button>
              </div>
            </div>
          </div>
          {turnstileSiteKey && !turnstileVerified ? <div ref={turnstileContainerRef} className="turnstile-box" /> : null}
          {notice ? <p className="notice strong-notice">{notice}</p> : null}
          <div className="compact-stats" aria-label="서비스 상태">
            <div>
              <span>접속자</span>
              <strong>{stats.online}</strong>
            </div>
            <div>
              <span>매칭 중</span>
              <strong>{stats.waitingInQueue}</strong>
            </div>
            <div>
              <span>진행 중인 게임</span>
              <strong>{stats.activeGames}</strong>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
