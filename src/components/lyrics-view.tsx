/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Music SP
 * File             : src/components/lyrics-view.tsx
 * Module           : components
 * Repository       : https://git.spboucher.ai/sp-music
 * Project Website  : https://music.spboucher.ai
 * Created          : 2026-11-17
 * Last Modified    : 2026-11-17
 *
 * Author           : Simon-Pierre Boucher
 * Position         : Professor of Finance
 * Institution      : Université du Québec en Outaouais (UQO)
 * Organization     : SP Boucher
 * Website          : https://spboucher.ai
 * Git              : https://git.spboucher.ai
 *
 * Preferred Contact: support@spboucher.ai
 * Development      : dev@spboucher.ai
 * Support          : support@spboucher.ai
 * Security/Admin   : admin@spboucher.ai
 *
 * Copyright (c) 2026
 * Simon-Pierre Boucher
 * All rights reserved where applicable. This file is governed by the
 * applicable project license, copyright notices and relevant law.
 * Existing third-party rights and notices remain unaffected.
 *
 * License          : None specified (no license file in this repository)
 *
 * Do not embed credentials, private keys, access tokens,
 * certificates or confidential personal information.
 *
 * =============================================================================
 * END OF SP BOUCHER SOURCE HEADER
 * =============================================================================
 */

"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client-api";
import type { LyricLine, Lyrics, Track } from "@/lib/types";
import { useT } from "@/i18n";
import { usePlayer, usePlayerActions } from "./player";
import { ISpinner } from "./icons";

/**
 * Karaoke view: the line being sung is brought to the centre and its words light up one by one.
 * Timing is read straight from the <audio> clock on every animation frame (the 4 Hz timeupdate event is too coarse
 * for word-level highlighting). Tapping a line seeks to it.
 */
function activeIndex(lines: LyricLine[], ms: number): number {
  let lo = 0, hi = lines.length - 1, ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (lines[mid].t <= ms + 120) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans;
}

export function LyricsView({ track }: { track: Track }) {
  const t = useT();
  const player = usePlayer(); const actions = usePlayerActions();
  const [data, setData] = useState<{ id: string; lyrics: Lyrics } | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const userScrollAt = useRef(0);
  const lyrics = data?.id === track.id ? data.lyrics : null;

  // Load, and keep polling while a transcription is on its way.
  useEffect(() => {
    let alive = true, timer: ReturnType<typeof setTimeout> | undefined;
    setFailed(false);
    const load = () => api<Lyrics>(`/api/v1/library/tracks/${track.id}/lyrics`).then((l) => {
      if (!alive) return;
      setData({ id: track.id, lyrics: l });
      if (l.state === "queued" || l.state === "working") timer = setTimeout(load, 3000);
    }).catch(() => { if (alive) setFailed(true); });
    load();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [track.id]);

  // Animation clock.
  const ready = lyrics?.state === "ready";
  useEffect(() => {
    if (!ready) return;
    let raf = 0;
    const tick = () => { setNow(actions.positionMs()); if (player.playing) raf = requestAnimationFrame(tick); };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [ready, player.playing, actions, track.id]);

  const lines = useMemo(() => lyrics?.lines ?? [], [lyrics]);
  const idx = ready ? activeIndex(lines, now) : -1;

  // Follow the song, unless the listener scrolled by hand a moment ago.
  useEffect(() => {
    if (idx < 0 || Date.now() - userScrollAt.current < 4000) return;
    box.current?.querySelector<HTMLElement>(`[data-line="${idx}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [idx]);

  if (failed) return <p className="py-10 text-center text-sm text-danger" role="alert">{t("lyrics.loadFailed")}</p>;
  if (!lyrics) return <div className="flex justify-center py-10 text-muted"><ISpinner /></div>;
  if (lyrics.state === "queued" || lyrics.state === "working") return <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted" role="status"><ISpinner size={16} />{t("lyrics.working")}</p>;
  if (lyrics.state !== "ready") return (
    <div className="mx-auto max-w-sm py-10 text-center">
      <p className="text-base font-bold">{t(lyrics.state === "empty" ? "lyrics.emptyTitle" : lyrics.state === "error" ? "lyrics.errorTitle" : "lyrics.noneTitle")}</p>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">{t(lyrics.state === "empty" ? "lyrics.emptyBody" : lyrics.enabled ? "lyrics.noneBody" : "lyrics.disabledBody")}</p>
    </div>
  );
  return (
    <div ref={box} className="h-full overflow-y-auto px-1 pb-[40vh] pt-[18vh]" onWheel={() => { userScrollAt.current = Date.now(); }} onTouchMove={() => { userScrollAt.current = Date.now(); }}>
      <ol aria-label={t("lyrics.title")}>
        {lines.map((l, i) => {
          const state = i === idx ? "now" : i < idx ? "past" : "next";
          return (
            <li key={`${l.t}-${i}`} data-line={i}>
              <button onClick={() => { userScrollAt.current = 0; actions.seek(l.t); if (!player.playing) actions.toggle(); }} aria-current={state === "now" ? "true" : undefined}
                className={`block w-full rounded-xl px-3 py-2 text-left text-[1.45rem] font-extrabold leading-snug tracking-tight transition-[color,opacity,transform] duration-300 sm:text-[1.7rem] ${state === "now" ? "origin-left scale-[1.03] text-ink" : state === "past" ? "text-ink/35" : "text-ink/55"}`}>
                {state === "now" && l.w ? l.w.map((w, k) => {
                  // The word being sung fills from left to right; sung words are fully lit.
                  const p = now >= w[1] ? 1 : now <= w[0] ? 0 : (now - w[0]) / Math.max(1, w[1] - w[0]);
                  return <span key={k} style={{ backgroundImage: `linear-gradient(90deg, var(--accent) ${p * 100}%, color-mix(in srgb, var(--color-ink) 45%, transparent) ${p * 100}%)`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>{w[2]}</span>;
                }) : l.text}
              </button>
            </li>
          );
        })}
      </ol>
      <p className="mt-8 px-3 text-xs leading-relaxed text-faint">{t(lyrics.edited ? "lyrics.noteEdited" : "lyrics.noteAuto")}</p>
    </div>
  );
}
