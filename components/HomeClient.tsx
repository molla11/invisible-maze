"use client";

import { DoorOpen, Radar, Swords } from "lucide-react";
import { useEffect, useState } from "react";
import { ko } from "@/lib/i18n/ko";

type Stats = {
  online: number;
  waitingInQueue: number;
  activeGames: number;
};

export function HomeClient({ initialStats }: { initialStats: Stats }) {
  const [stats, setStats] = useState(initialStats);
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(false);

  useEffect(() => {
    fetch("/api/session", { method: "POST" }).catch(() => undefined);
    const timer = setInterval(async () => {
      const response = await fetch("/api/health");
      if (response.ok) setStats(await response.json());
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!queued) return;
    const timer = setInterval(async () => {
      const response = await fetch("/api/match/join", { method: "POST", body: JSON.stringify({}) });
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
    setBusy(true);
    setNotice("매칭 대기 중입니다.");
    const response = await fetch("/api/match/join", { method: "POST", body: JSON.stringify({}) });
    const data = await response.json();
    if (data.status === "matched") {
      location.href = `/game/${data.gameId}`;
      return;
    }
    setNotice(ko.queueWaiting);
    setQueued(true);
    setBusy(false);
  }

  async function createInvite() {
    setBusy(true);
    const response = await fetch("/api/room", { method: "POST", body: JSON.stringify({}) });
    const data = await response.json();
    if (data.code) {
      setCode(data.code);
      setNotice(`초대 코드 ${data.code}`);
    } else {
      setNotice("방을 만들지 못했습니다.");
    }
    setBusy(false);
  }

  async function joinInvite() {
    const normalized = code.trim().toUpperCase();
    if (!normalized) return;
    setBusy(true);
    const response = await fetch(`/api/room/${normalized}`, { method: "POST", body: JSON.stringify({}) });
    const data = await response.json();
    if (data.gameId) {
      location.href = `/game/${data.gameId}`;
      return;
    }
    setNotice(data.error === "room_not_found" ? "방 코드를 찾지 못했습니다." : "입장할 수 없는 방입니다.");
    setBusy(false);
  }

  return (
    <main className="shell">
      <nav className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <Swords size={18} />
          </span>
          {ko.appName}
        </div>
      </nav>

      <section className="hero">
        <div className="hero-copy">
          <div className="metric-grid" aria-label="서비스 상태">
            <div className="metric-card">
              <span>접속자</span>
              <strong>{stats.online}</strong>
            </div>
            <div className="metric-card">
              <span>큐 대기</span>
              <strong>{stats.waitingInQueue}</strong>
            </div>
            <div className="metric-card">
              <span>진행 게임</span>
              <strong>{stats.activeGames}</strong>
            </div>
          </div>
        </div>

        <div className="entry-panel">
          <div className="actions">
            <button className={`button primary-action ${queued ? "is-queueing" : ""}`} disabled={busy} onClick={autoMatch}>
              <Radar size={22} />
              <span>{queued ? "매칭 대기 중" : ko.autoMatch}</span>
              {queued ? (
                <span className="queue-dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
              ) : null}
            </button>
            <div className="invite-row">
              <button className="button secondary" disabled={busy} onClick={createInvite}>
                <DoorOpen size={18} />
                {ko.createRoom}
              </button>
              <div className="input-row">
                <input
                  className="input"
                  maxLength={5}
                  placeholder={ko.roomCode}
                  value={code}
                  onChange={(event) => setCode(event.target.value.toUpperCase())}
                />
                <button className="button" disabled={busy || !code.trim()} onClick={joinInvite}>
                  {ko.joinRoom}
                </button>
              </div>
            </div>
          </div>
          {notice ? <p className="notice strong-notice">{notice}</p> : null}
        </div>
      </section>
    </main>
  );
}
