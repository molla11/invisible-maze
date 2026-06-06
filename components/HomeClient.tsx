"use client";

import { BookOpen, Copy, DoorOpen, Eye, EyeOff, Radar, Swords } from "lucide-react";
import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
import { GamePreview } from "@/components/GamePreview";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { useI18n } from "@/lib/i18n/client";

declare global {
  interface Window {
    turnstile?: {
      render(container: HTMLElement, options: {
        sitekey: string;
        size?: "normal" | "flexible" | "compact";
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
  const [rulesOpen, setRulesOpen] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const turnstileContainerRef = useRef<HTMLDivElement | null>(null);
  const turnstileWidgetRef = useRef<string | undefined>(undefined);
  const rulesTooltipRef = useRef<HTMLDivElement | null>(null);
  const actionInFlight = useRef(false);
  const { locale, setLocale, t } = useI18n();

  const refreshStats = useCallback(async () => {
    try {
      const response = await fetch("/api/health");
      if (response.ok) setStats(await response.json());
    } catch {
      // Stats are best-effort presence UI; retry on the next tick.
    }
  }, []);

  const renderTurnstile = useCallback(() => {
    if (!turnstileSiteKey || turnstileVerified || !turnstileContainerRef.current || turnstileWidgetRef.current) return;
    turnstileWidgetRef.current = window.turnstile?.render(turnstileContainerRef.current, {
      sitekey: turnstileSiteKey,
      size: "flexible",
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
      setNotice(t.securityRequired);
      throw new Error("turnstile_token_required");
    }
    return JSON.stringify({ turnstileToken });
  }

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
    void refreshStats();
    const timer = setInterval(() => void refreshStats(), 2000);
    return () => clearInterval(timer);
  }, [refreshStats]);

  useEffect(() => {
    if (!sessionReady) return;
    const source = new EventSource("/api/presence");
    source.onopen = () => void refreshStats();
    source.onerror = () => undefined;
    return () => source.close();
  }, [refreshStats, sessionReady]);

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

  useEffect(() => {
    if (!rulesOpen) return;

    function onPointerDown(event: PointerEvent) {
      if (!rulesTooltipRef.current?.contains(event.target as Node)) setRulesOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setRulesOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [rulesOpen]);

  async function autoMatch() {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setBusy(true);
    setQueued(false);
    setCode("");
    setInviteCodeCreated(false);
    setCodeMasked(false);
    setNotice(t.queueStarting);
    try {
      const response = await fetch("/api/match/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: verifiedBody()
      });
      const data = await response.json();
      if (!response.ok) {
        setNotice(data.error === "turnstile_failed" ? t.securityFailed : t.matchStartFailed);
        if (data.error === "turnstile_failed") resetTurnstile();
        return;
      }
      setTurnstileVerified(true);
      setTurnstileToken("");
      if (data.status === "matched") {
        location.href = `/game/${data.gameId}`;
        return;
      }
      setNotice(t.queueWaiting);
      setQueued(true);
    } catch (error) {
      if (error instanceof Error && error.message === "turnstile_token_required") return;
      setNotice(t.matchStartFailed);
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
        setNotice(t.matchCanceled);
      } else {
        setNotice(t.matchCancelFailed);
      }
    } catch {
      setNotice(t.matchCancelFailed);
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
        setNotice(data.error === "turnstile_failed" ? t.securityFailed : t.roomCreateFailed);
        if (data.error === "turnstile_failed") resetTurnstile();
        return;
      }
      setTurnstileVerified(true);
      setTurnstileToken("");
      if (data.code) {
        setCode(data.code);
        setInviteCodeCreated(true);
        setCodeMasked(true);
        setNotice(t.inviteCreated);
      } else {
        setNotice(t.roomCreateFailed);
      }
    } catch (error) {
      if (error instanceof Error && error.message === "turnstile_token_required") return;
      setNotice(t.roomCreateFailed);
    } finally {
      setBusy(false);
      actionInFlight.current = false;
    }
  }

  async function copyInviteCode() {
    if (!code.trim()) return;
    try {
      await navigator.clipboard.writeText(code.trim().toUpperCase());
      setNotice(t.inviteCopied);
    } catch {
      setNotice(t.inviteCopyFailed);
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
          ? t.securityFailed
          : data.error === "room_not_found"
            ? t.roomNotFound
            : t.roomJoinFailed
      );
      if (data.error === "turnstile_failed") resetTurnstile();
    } catch (error) {
      if (error instanceof Error && error.message === "turnstile_token_required") return;
      setNotice(t.roomJoinFailed);
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
          {t.appName}
        </div>
        <LanguageSwitch currentLabel={t.languageCurrent} label={t.languageToggleLabel} locale={locale} onChange={setLocale} />
      </nav>

      <section className="hero">
        <GamePreview />
        <div className="entry-column">
          <div className="entry-panel">
            <section className="entry-hero" aria-label={t.gameIntroLabel}>
              <span>{t.heroEyebrow}</span>
              <h1>{t.heroTitle}</h1>
              <p>{t.heroDescription}</p>
            </section>
            <div className="actions">
              <div className="match-wrapper">
                {queued ? (
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
                    <button className="button match-cancel" disabled={busy} onClick={cancelMatch} type="button">
                      {t.cancelMatch}
                    </button>
                  </div>
                ) : (
                  <button className="button primary-action" disabled={busy} onClick={autoMatch}>
                    <Radar size={22} />
                    <span>{t.autoMatch}</span>
                  </button>
                )}
              </div>
              <div className="invite-row">
                <button className="button secondary" disabled={busy} onClick={createInvite}>
                  <DoorOpen size={18} />
                  {t.createRoom}
                </button>
                <div className="input-row">
                  <div className="code-field">
                    <input
                      className="input"
                      maxLength={5}
                      placeholder={t.roomCode}
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
                        aria-label={codeMasked ? t.showInviteCode : t.hideInviteCode}
                        className="code-visibility-button"
                        onClick={() => setCodeMasked((masked) => !masked)}
                        title={codeMasked ? t.showInviteCode : t.hideInviteCode}
                        type="button"
                      >
                        {codeMasked ? <Eye size={18} /> : <EyeOff size={18} />}
                      </button>
                    ) : null}
                  </div>
                  <button
                    aria-label={inviteCodeCreated ? t.copyInviteCode : undefined}
                    className={`button ${inviteCodeCreated ? "icon-action" : ""}`}
                    disabled={busy || !code.trim()}
                    onClick={inviteCodeCreated ? copyInviteCode : joinInvite}
                    title={inviteCodeCreated ? t.copyInviteCode : undefined}
                    type="button"
                  >
                    {inviteCodeCreated ? <Copy size={18} /> : t.joinRoom}
                  </button>
                </div>
              </div>
            </div>
            {notice ? <p className="notice strong-notice">{notice}</p> : null}
            <div className="home-status-row">
              <div className="rule-tooltip-wrap" ref={rulesTooltipRef}>
                <button
                  aria-controls="rules-tooltip"
                  aria-expanded={rulesOpen}
                  className={`rule-button ${rulesOpen ? "is-open" : ""}`}
                  onClick={() => setRulesOpen((open) => !open)}
                  type="button"
                >
                  <BookOpen size={17} />
                  <span>{t.rules}</span>
                </button>
                {rulesOpen ? (
                  <div className="rule-tooltip" id="rules-tooltip" role="tooltip">
                    <strong className="rule-tooltip-title">{t.rulesTitle}</strong>
                    <ul className="rule-tooltip-list">
                      {t.rulesList.map((rule) => (
                        <li key={rule}>{rule}</li>
                      ))}
                    </ul>
                    <p className="rule-tooltip-footnote">{t.rulesFootnote}</p>
                  </div>
                ) : null}
              </div>
              <div className="compact-stats" aria-label={t.serviceStatus}>
                <div>
                  <span>{t.onlineUsers}</span>
                  <strong>{stats.online}</strong>
                </div>
                <div>
                  <span>{t.waitingQueue}</span>
                  <strong>{stats.waitingInQueue}</strong>
                </div>
                <div>
                  <span>{t.activeGames}</span>
                  <strong>{stats.activeGames}</strong>
                </div>
              </div>
            </div>
          </div>
          {turnstileSiteKey ? (
            !turnstileVerified ? <div ref={turnstileContainerRef} className="turnstile-box" /> : null
          ) : (
            <div className="turnstile-box" aria-hidden="true">
              <div className="mock-turnstile-widget">
                <span className="mock-turnstile-checkbox" />
                <span className="mock-turnstile-label">{t.mockVerification}</span>
                <span className="mock-turnstile-brand">Turnstile</span>
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
