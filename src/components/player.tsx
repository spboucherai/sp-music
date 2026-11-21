/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Music SP
 * File             : src/components/player.tsx
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
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/client-api";
import type { Track } from "@/lib/types";

/**
 * The player: one <audio> element that lives in the app layout (so it survives navigation), a queue, and the
 * account's playback state saved to the server. Playback always starts from a user gesture (iOS requirement):
 * a restored session shows the track paused at its saved position and waits for a tap.
 */

export type Repeat = "off" | "all" | "one";
export type PlayerError = null | "network" | "decode" | "unsupported" | "unavailable" | "preparing_failed";
type Variant = "original" | "compat";

interface State {
  queue: Track[]; index: number; playing: boolean; loading: boolean; preparing: boolean;
  shuffle: boolean; repeat: Repeat; volume: number; canSetVolume: boolean; error: PlayerError; variant: Variant;
}
interface Actions {
  playTracks(tracks: Track[], startIndex?: number, opts?: { shuffle?: boolean }): void;
  toggle(): void; next(): void; prev(): void; seek(ms: number): void; jumpTo(index: number): void;
  playNext(tracks: Track[]): void; addToQueue(tracks: Track[]): void; removeAt(index: number): void; move(from: number, to: number): void; clearUpcoming(): void;
  setShuffle(on: boolean): void; cycleRepeat(): void; setVolume(v: number): void; retry(): void;
  patchTrack(id: string, patch: Partial<Track>): void;
  /** Current position read from the audio clock (for frame-accurate displays such as lyrics). */
  positionMs(): number;
}
export interface Progress { positionMs: number; durationMs: number; bufferedMs: number }

const StateCtx = createContext<State | null>(null);
const ActionsCtx = createContext<Actions | null>(null);
const ProgressCtx = createContext<Progress>({ positionMs: 0, durationMs: 0, bufferedMs: 0 });
export const usePlayer = () => useContext(StateCtx)!;
export const usePlayerActions = () => useContext(ActionsCtx)!;
export const useProgress = () => useContext(ProgressCtx);
export function useCurrentTrack(): Track | null { const s = usePlayer(); return s.queue[s.index] ?? null; }

const streamUrl = (t: Track, v: Variant) => `/api/v1/stream/${t.id}${v === "compat" ? "?v=compat" : ""}`;
const MIME: Record<string, string> = { flac: "audio/flac", mp3: "audio/mpeg", aac: "audio/mp4", alac: 'audio/mp4; codecs="alac"', vorbis: 'audio/ogg; codecs="vorbis"', opus: 'audio/ogg; codecs="opus"' };

/** Which file this browser should be given for a track: the original when it can decode it, the AAC rendition otherwise. */
function pickVariant(t: Track, audio: HTMLAudioElement): Variant | "none" {
  if (t.webPlayable === "yes") return "original";
  if (t.webPlayable === "some") {
    const mime = t.container === "aiff" ? "audio/aiff" : MIME[t.codec];
    if (mime && audio.canPlayType(mime) !== "") return "original";
  }
  return "compat";
}

function shuffled<T>(a: T[]): T[] { const r = a.slice(); for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; }

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<State>({ queue: [], index: 0, playing: false, loading: false, preparing: false, shuffle: false, repeat: "off", volume: 1, canSetVolume: true, error: null, variant: "original" });
  const [progress, setProgress] = useState<Progress>({ positionMs: 0, durationMs: 0, bufferedMs: 0 });
  const ref = useRef(state); ref.current = state;
  const unshuffled = useRef<Track[] | null>(null);      // queue order before shuffle was switched on
  const pendingSeek = useRef<number | null>(null);      // position to restore once metadata is known
  const loadedKey = useRef<string>("");                 // `${trackId}:${variant}` currently in the <audio>
  const wantPlay = useRef(false);
  const consecutiveErrors = useRef(0);
  const restored = useRef(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const set = useCallback((p: Partial<State> | ((s: State) => Partial<State>)) => setState((s) => ({ ...s, ...(typeof p === "function" ? p(s) : p) })), []);

  // ── Loading a track into the element ──────────────────────────────────────────────────────────────
  const load = useCallback((t: Track | undefined, opts: { play: boolean; atMs?: number; variant?: Variant }) => {
    const a = audioRef.current;
    if (pollTimer.current) { clearTimeout(pollTimer.current); pollTimer.current = null; }
    if (!a) return;
    if (!t) { a.removeAttribute("src"); a.load(); loadedKey.current = ""; set({ playing: false, loading: false, preparing: false, error: null }); setProgress({ positionMs: 0, durationMs: 0, bufferedMs: 0 }); return; }
    wantPlay.current = opts.play;
    let variant: Variant | "none" = opts.variant ?? pickVariant(t, a);
    if (variant === "compat" && t.compatState !== "ready") {
      // No rendition yet: ask the server for one and wait for it (bounded), unless it is switched off.
      if (t.compatState === "disabled" && t.webPlayable === "no") variant = "none";
      else return void prepareCompat(t, opts);
    }
    if (variant === "none") { a.removeAttribute("src"); a.load(); loadedKey.current = ""; set({ playing: false, loading: false, preparing: false, error: "unsupported" }); setProgress({ positionMs: 0, durationMs: t.durationMs, bufferedMs: 0 }); return; }
    pendingSeek.current = opts.atMs && opts.atMs > 0 ? opts.atMs : null;
    loadedKey.current = `${t.id}:${variant}`;
    a.src = streamUrl(t, variant);
    a.load();
    set({ error: null, loading: opts.play, preparing: false, variant });
    setProgress({ positionMs: opts.atMs ?? 0, durationMs: t.durationMs, bufferedMs: 0 });
    if (opts.play) a.play().catch(() => { /* surfaced by the error / pause events */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set]);

  const prepareCompat = useCallback((t: Track, opts: { play: boolean; atMs?: number }) => {
    const a = audioRef.current;
    if (a) { a.removeAttribute("src"); a.load(); }
    loadedKey.current = "";
    set({ preparing: true, loading: false, playing: false, error: null });
    setProgress({ positionMs: opts.atMs ?? 0, durationMs: t.durationMs, bufferedMs: 0 });
    const started = Date.now();
    const tick = async () => {
      if (ref.current.queue[ref.current.index]?.id !== t.id) return;           // the listener moved on
      try {
        const cur = await api<Track>(`/api/v1/library/tracks/${t.id}`);
        if (cur.compatState === "ready") {
          set((s) => ({ queue: s.queue.map((q) => (q.id === t.id ? { ...q, compatState: "ready" } : q)) }));
          return load({ ...t, compatState: "ready" }, { ...opts, variant: "compat" });
        }
        if (cur.compatState === "error" || Date.now() - started > 4 * 60_000) return set({ preparing: false, error: "preparing_failed" });
      } catch { /* transient: keep polling */ }
      pollTimer.current = setTimeout(tick, 2000);
    };
    api(`/api/v1/library/tracks/${t.id}/compat`, { method: "POST" }).then(tick).catch(() => set({ preparing: false, error: t.webPlayable === "no" ? "unsupported" : "preparing_failed" }));
  }, [load, set]);

  // ── Queue navigation ──────────────────────────────────────────────────────────────────────────────
  const goTo = useCallback((index: number, play: boolean) => {
    const s = ref.current;
    if (index < 0 || index >= s.queue.length) return;
    set({ index });
    load(s.queue[index], { play });
  }, [load, set]);

  const advance = useCallback((auto: boolean) => {
    const s = ref.current;
    if (s.queue.length === 0) return;
    if (auto && s.repeat === "one") { const a = audioRef.current; if (a) { a.currentTime = 0; a.play().catch(() => {}); } return; }
    if (s.index + 1 < s.queue.length) return goTo(s.index + 1, true);
    if (s.repeat === "all") return goTo(0, true);
    if (auto) { set({ playing: false }); wantPlay.current = false; }           // end of the queue
  }, [goTo, set]);

  const actions = useMemo<Actions>(() => ({
    playTracks(tracks, startIndex = 0, opts) {
      if (tracks.length === 0) return;
      consecutiveErrors.current = 0;
      let queue = tracks, index = Math.min(Math.max(0, startIndex), tracks.length - 1);
      const shuffle = opts?.shuffle ?? ref.current.shuffle;
      if (shuffle) {
        unshuffled.current = tracks;
        const first = opts?.shuffle ? tracks[Math.floor(Math.random() * tracks.length)] : tracks[index];
        queue = [first, ...shuffled(tracks.filter((t) => t !== first))]; index = 0;
      } else unshuffled.current = null;
      set({ queue, index, shuffle });
      load(queue[index], { play: true });
    },
    toggle() {
      const a = audioRef.current, s = ref.current, t = s.queue[s.index];
      if (!a || !t) return;
      if (!loadedKey.current.startsWith(t.id)) return load(t, { play: true, atMs: pendingSeek.current ?? progressRef.current.positionMs });
      if (a.paused) { wantPlay.current = true; a.play().catch(() => {}); } else { wantPlay.current = false; a.pause(); }
    },
    next() { consecutiveErrors.current = 0; advance(false); },
    prev() {
      const a = audioRef.current, s = ref.current;
      if (a && a.currentTime > 3) { a.currentTime = 0; return; }
      if (s.index > 0) goTo(s.index - 1, true); else if (s.repeat === "all" && s.queue.length) goTo(s.queue.length - 1, true); else if (a) a.currentTime = 0;
    },
    seek(ms) {
      const a = audioRef.current;
      if (!a) return;
      if (loadedKey.current && a.readyState >= 1) a.currentTime = ms / 1000; else pendingSeek.current = ms;
      setProgress((p) => ({ ...p, positionMs: ms }));
    },
    jumpTo(index) { consecutiveErrors.current = 0; goTo(index, true); },
    playNext(tracks) {
      const s = ref.current;
      if (s.queue.length === 0) return actions.playTracks(tracks, 0, { shuffle: false });
      const queue = [...s.queue.slice(0, s.index + 1), ...tracks, ...s.queue.slice(s.index + 1)];
      set({ queue });
    },
    addToQueue(tracks) {
      const s = ref.current;
      if (s.queue.length === 0) { set({ queue: tracks, index: 0 }); load(tracks[0], { play: false }); return; }
      set({ queue: [...s.queue, ...tracks] });
    },
    removeAt(i) {
      const s = ref.current;
      if (i < 0 || i >= s.queue.length) return;
      const queue = s.queue.filter((_, k) => k !== i);
      if (i === s.index) { const index = Math.min(i, queue.length - 1); set({ queue, index: Math.max(0, index) }); load(queue[index], { play: s.playing }); }
      else set({ queue, index: i < s.index ? s.index - 1 : s.index });
    },
    move(from, to) {
      const s = ref.current;
      if (from === to || from < 0 || to < 0 || from >= s.queue.length || to >= s.queue.length) return;
      const queue = s.queue.slice(); const [x] = queue.splice(from, 1); queue.splice(to, 0, x);
      const cur = s.queue[s.index];
      set({ queue, index: queue.indexOf(cur) });
    },
    clearUpcoming() { const s = ref.current; set({ queue: s.queue.slice(0, s.index + 1) }); },
    setShuffle(on) {
      const s = ref.current, cur = s.queue[s.index];
      if (on) { unshuffled.current = s.queue; set({ shuffle: true, queue: cur ? [...s.queue.slice(0, s.index + 1), ...shuffled(s.queue.slice(s.index + 1))] : s.queue }); }
      else {
        const byId = new Map(s.queue.map((t) => [t.id, t]));
        const orig = unshuffled.current?.map((t) => byId.get(t.id)).filter((t): t is Track => !!t); unshuffled.current = null;
        if (orig && cur && orig.length === s.queue.length) set({ shuffle: false, queue: orig, index: Math.max(0, orig.findIndex((t) => t.id === cur.id)) }); else set({ shuffle: false });
      }
    },
    cycleRepeat() { set((s) => ({ repeat: s.repeat === "off" ? "all" : s.repeat === "all" ? "one" : "off" })); },
    setVolume(v) { const a = audioRef.current; const vol = Math.min(1, Math.max(0, v)); if (a) a.volume = vol; set({ volume: vol }); },
    retry() { const s = ref.current, t = s.queue[s.index]; if (t) { consecutiveErrors.current = 0; load(t, { play: true, atMs: progressRef.current.positionMs }); } },
    patchTrack(id, patch) { set((s) => ({ queue: s.queue.map((q) => (q.id === id ? { ...q, ...patch } : q)) })); },
    positionMs() { const a = audioRef.current; return a && loadedKey.current ? a.currentTime * 1000 : progressRef.current.positionMs; },
  }), [advance, goTo, load, set]);

  const progressRef = useRef(progress); progressRef.current = progress;

  // ── <audio> events ────────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    // iOS ignores script volume (hardware buttons only): detect it and hide the slider there.
    const before = a.volume; a.volume = 0.5; const canSetVolume = a.volume === 0.5; a.volume = before;
    set({ canSetVolume });

    const onTime = () => setProgress((p) => ({ ...p, positionMs: a.currentTime * 1000 }));
    const onMeta = () => {
      if (pendingSeek.current != null) { try { a.currentTime = pendingSeek.current / 1000; } catch { /* not seekable yet */ } pendingSeek.current = null; }
      const d = Number.isFinite(a.duration) ? a.duration * 1000 : ref.current.queue[ref.current.index]?.durationMs ?? 0;
      setProgress((p) => ({ ...p, durationMs: d }));
    };
    const onProgress = () => { try { const b = a.buffered; if (b.length) setProgress((p) => ({ ...p, bufferedMs: b.end(b.length - 1) * 1000 })); } catch { /* ignore */ } };
    const onPlaying = () => { consecutiveErrors.current = 0; set({ playing: true, loading: false, error: null }); };
    const onPause = () => set({ playing: false });
    const onWaiting = () => set({ loading: true });
    const onCanPlay = () => set({ loading: false });
    const onEnded = () => advance(true);
    const onError = () => {
      const s = ref.current, t = s.queue[s.index];
      if (!t || !a.error || !loadedKey.current) return;
      const code = a.error.code;
      const at = a.currentTime * 1000 || progressRef.current.positionMs;
      set({ playing: false, loading: false });
      if (code === MediaError.MEDIA_ERR_NETWORK || !navigator.onLine) return set({ error: "network" });
      // The original could not be decoded by this browser → fall back to the AAC rendition once.
      if (s.variant === "original" && (code === MediaError.MEDIA_ERR_DECODE || code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED)) {
        fetch(streamUrl(t, "original"), { method: "HEAD", credentials: "same-origin" }).then((r) => {
          if (r.status === 401) { window.location.assign("/login"); return; }
          if (!r.ok) return set({ error: "unavailable" });
          if (t.compatState === "ready") load(t, { play: wantPlay.current, atMs: at, variant: "compat" }); else prepareCompat(t, { play: wantPlay.current, atMs: at });
        }).catch(() => set({ error: "network" }));
        return;
      }
      set({ error: code === MediaError.MEDIA_ERR_DECODE ? "decode" : "unavailable" });
      // Unattended playback moves on past a broken track, but never loops through a broken queue.
      if (wantPlay.current && ++consecutiveErrors.current <= 2 && s.index + 1 < s.queue.length) setTimeout(() => { if (ref.current.queue[ref.current.index]?.id === t.id) goTo(ref.current.index + 1, true); }, 1500);
    };
    const onOnline = () => { if (ref.current.error === "network") actions.retry(); };
    const ev: [string, () => void][] = [["timeupdate", onTime], ["loadedmetadata", onMeta], ["durationchange", onMeta], ["progress", onProgress], ["playing", onPlaying], ["pause", onPause], ["waiting", onWaiting], ["canplay", onCanPlay], ["ended", onEnded], ["error", onError]];
    for (const [n, f] of ev) a.addEventListener(n, f);
    window.addEventListener("online", onOnline);
    return () => { for (const [n, f] of ev) a.removeEventListener(n, f); window.removeEventListener("online", onOnline); };
  }, [actions, advance, goTo, load, prepareCompat, set]);

  // ── Restore the account's last session (paused) ──────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    api<{ queue: Track[]; index: number; positionMs: number; shuffle: boolean; repeat: Repeat; volume: number }>("/api/v1/library/playback").then((p) => {
      if (!alive) return;
      restored.current = true;
      if (ref.current.queue.length > 0) return;                         // the listener already started something
      const a = audioRef.current; if (a) a.volume = p.volume;
      set({ queue: p.queue, index: p.index, shuffle: false, repeat: p.repeat, volume: p.volume });
      const t = p.queue[p.index];
      if (t) { pendingSeek.current = p.positionMs; setProgress({ positionMs: p.positionMs, durationMs: t.durationMs, bufferedMs: 0 }); }
    }).catch(() => { restored.current = true; });
    return () => { alive = false; };
  }, [set]);

  // ── Save the playback state (debounced; flushed when the page is hidden) ─────────────────────────
  const lastSaved = useRef("");
  const save = useCallback((keepalive = false) => {
    if (!restored.current) return;
    const s = ref.current;
    const bodyObj = { queue: s.queue.slice(0, 2000).map((t) => t.id), index: Math.min(s.index, 1999), positionMs: Math.max(0, Math.round(progressRef.current.positionMs)), shuffle: s.shuffle, repeat: s.repeat, volume: s.volume };
    const key = JSON.stringify({ ...bodyObj, positionMs: Math.round(bodyObj.positionMs / 5000) });
    if (key === lastSaved.current) return;
    lastSaved.current = key;
    api("/api/v1/library/playback", { method: "PUT", body: bodyObj, keepalive }).catch(() => { lastSaved.current = ""; });
  }, []);
  useEffect(() => { const t = setTimeout(() => save(), 800); return () => clearTimeout(t); }, [state.queue, state.index, state.shuffle, state.repeat, state.volume, state.playing, save]);
  useEffect(() => {
    const iv = setInterval(() => { if (ref.current.playing) save(); }, 10_000);
    const flush = () => { if (document.visibilityState === "hidden") save(true); };
    document.addEventListener("visibilitychange", flush); window.addEventListener("pagehide", flush);
    return () => { clearInterval(iv); document.removeEventListener("visibilitychange", flush); window.removeEventListener("pagehide", flush); };
  }, [save]);

  // ── System media controls (lock screen, headphones, keyboard media keys) ─────────────────────────
  const current = state.queue[state.index];
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    if (!current) { navigator.mediaSession.metadata = null; return; }
    const art = current.album.artworkId;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title, artist: current.artist.name, album: current.album.title,
      artwork: art ? [96, 320, 640].map((s) => ({ src: `/api/v1/art/${art}?s=${s}`, sizes: `${s}x${s}`, type: "image/jpeg" })) : [{ src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" }],
    });
  }, [current]);
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    const h: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => actions.toggle()], ["pause", () => actions.toggle()], ["previoustrack", () => actions.prev()], ["nexttrack", () => actions.next()],
      ["seekto", (d) => { if (d.seekTime != null) actions.seek(d.seekTime * 1000); }],
      ["seekbackward", (d) => actions.seek(Math.max(0, progressRef.current.positionMs - (d.seekOffset ?? 10) * 1000))],
      ["seekforward", (d) => actions.seek(progressRef.current.positionMs + (d.seekOffset ?? 10) * 1000)],
    ];
    for (const [n, f] of h) { try { ms.setActionHandler(n, f); } catch { /* action not supported here */ } }
    return () => { for (const [n] of h) { try { ms.setActionHandler(n, null); } catch { /* ignore */ } } };
  }, [actions]);
  useEffect(() => { if ("mediaSession" in navigator) navigator.mediaSession.playbackState = state.playing ? "playing" : current ? "paused" : "none"; }, [state.playing, current]);
  const posBucket = Math.floor(progress.positionMs / 5000);
  useEffect(() => {
    if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState) return;
    const d = progress.durationMs / 1000, p = progressRef.current.positionMs / 1000;
    if (d > 0 && p <= d) { try { navigator.mediaSession.setPositionState({ duration: d, position: p, playbackRate: 1 }); } catch { /* ignore */ } }
  }, [posBucket, progress.durationMs, state.playing]);

  return (
    <StateCtx.Provider value={state}>
      <ActionsCtx.Provider value={actions}>
        <ProgressCtx.Provider value={progress}>
          {children}
          {/* No src until the listener presses play: a restored, paused session downloads nothing. */}
          <audio ref={audioRef} preload="auto" playsInline />
        </ProgressCtx.Provider>
      </ActionsCtx.Provider>
    </StateCtx.Provider>
  );
}
