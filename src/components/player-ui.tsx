"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { audioInfo, fmtTime } from "@/lib/format";
import { useLocale, useT } from "@/i18n";
import type { Key } from "@/i18n/messages";
import { useCurrentTrack, usePlayer, usePlayerActions, useProgress, type PlayerError } from "./player";
import { Artwork, FavButton, NowBars, useFavorite } from "./ui";
import { LyricsView } from "./lyrics-view";
import { ILyrics } from "./icons";
import { IAlert, IChevronDown, IClose, IDown, INext, IPause, IPlay, IPrev, IQueue, IRepeat, IRepeatOne, IShuffle, ISpinner, IUp, IVolume } from "./icons";

export type PlayerTab = "now" | "lyrics" | "queue";
const ERR: Record<Exclude<PlayerError, null>, Key> = { network: "player.err.network", decode: "player.err.decode", unsupported: "player.err.unsupported", unavailable: "player.err.unavailable", preparing_failed: "player.err.preparing" };

function Seek({ compact }: { compact?: boolean }) {
  const t = useT();
  const { positionMs, durationMs } = useProgress();
  const actions = usePlayerActions();
  const [drag, setDrag] = useState<number | null>(null);
  const pos = drag ?? positionMs;
  const max = Math.max(1, durationMs);
  const commit = () => { if (drag != null) { actions.seek(drag); setDrag(null); } };
  return (
    <div className={compact ? "flex items-center gap-2" : ""}>
      {compact && <span className="w-10 text-right text-[0.7rem] tabular-nums text-faint">{fmtTime(pos)}</span>}
      <input type="range" className="range" min={0} max={max} step={1000} value={Math.min(pos, max)} aria-label={t("player.position")} aria-valuetext={`${fmtTime(pos)} / ${fmtTime(durationMs)}`}
        style={{ "--fill": `${(Math.min(pos, max) / max) * 100}%` } as React.CSSProperties} disabled={!durationMs}
        onChange={(e) => setDrag(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} />
      {compact ? <span className="w-10 text-[0.7rem] tabular-nums text-faint">{fmtTime(durationMs)}</span>
        : <div className="-mt-1 flex justify-between text-[0.72rem] tabular-nums text-faint"><span>{fmtTime(pos)}</span><span>−{fmtTime(Math.max(0, durationMs - pos))}</span></div>}
    </div>
  );
}

function PlayPause({ size = 22, big }: { size?: number; big?: boolean }) {
  const t = useT(); const s = usePlayer(); const a = usePlayerActions();
  const busy = s.loading || s.preparing;
  return (
    <button onClick={a.toggle} aria-label={t(s.playing ? "player.pause" : "player.play")} disabled={s.preparing}
      className={big ? "flex h-16 w-16 flex-none items-center justify-center rounded-full bg-ink text-bg transition-transform active:scale-95" : "icon-btn"}>
      {busy && !s.playing ? <ISpinner size={size} /> : s.playing ? <IPause size={size} /> : <IPlay size={size} />}
    </button>
  );
}

function ModeButtons() {
  const t = useT(); const s = usePlayer(); const a = usePlayerActions();
  return (<>
    <button className="icon-btn" aria-pressed={s.shuffle} aria-label={t("player.shuffleMode")} title={t("player.shuffleMode")} onClick={() => a.setShuffle(!s.shuffle)}><IShuffle size={20} /></button>
    <button className="icon-btn" aria-pressed={s.repeat !== "off"} aria-label={t(s.repeat === "one" ? "player.repeatOne" : s.repeat === "all" ? "player.repeatAll" : "player.repeatOff")} title={t("player.repeat")} onClick={a.cycleRepeat}>{s.repeat === "one" ? <IRepeatOne size={20} /> : <IRepeat size={20} />}</button>
  </>);
}

function Volume() {
  const t = useT(); const s = usePlayer(); const a = usePlayerActions();
  if (!s.canSetVolume) return null;
  return (
    <div className="flex items-center gap-2 text-muted">
      <IVolume size={18} />
      <input type="range" className="range w-24" min={0} max={1} step={0.02} value={s.volume} aria-label={t("player.volume")} style={{ "--fill": `${s.volume * 100}%` } as React.CSSProperties} onChange={(e) => a.setVolume(Number(e.target.value))} />
    </div>
  );
}

function ErrorLine() {
  const t = useT(); const s = usePlayer(); const a = usePlayerActions();
  if (s.preparing) return <p className="flex items-center justify-center gap-2 text-xs text-warn" role="status"><ISpinner size={14} />{t("player.preparing")}</p>;
  if (!s.error) return null;
  return (
    <p className="flex flex-wrap items-center justify-center gap-2 text-xs text-danger" role="alert">
      <IAlert size={14} /><span>{t(ERR[s.error])}</span>
      {s.error !== "unsupported" && <button className="font-bold underline" onClick={a.retry}>{t("common.retry")}</button>}
    </p>
  );
}

/** Compact bar: phone mini-player (above the tab bar) and desktop player bar (full width, bottom). */
export function PlayerBar({ onOpen }: { onOpen: (tab: PlayerTab) => void }) {
  const t = useT(); const locale = useLocale();
  const s = usePlayer(); const a = usePlayerActions(); const tr = useCurrentTrack();
  const { positionMs, durationMs } = useProgress();
  const fav = useFavorite();
  if (!tr) return null;
  const pct = durationMs ? Math.min(100, (positionMs / durationMs) * 100) : 0;
  return (
    <>
      {/* Phone */}
      <div className="glass fixed inset-x-2 z-40 overflow-hidden rounded-2xl border border-line shadow-2xl lg:hidden" style={{ bottom: "calc(var(--tabbar-h) + var(--safe-b) + 8px)", height: "var(--mini-h)" }} role="region" aria-label={t("player.region")}>
        <div className="flex h-full items-center gap-3 pl-2 pr-1">
          <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => onOpen("now")} aria-label={t("player.openNow")}>
            <Artwork artworkId={tr.album.artworkId} seed={tr.album.title} size={96} className="w-11 flex-none" rounded="rounded-lg" priority />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{tr.title}</span>
              <span className={`block truncate text-xs ${s.error ? "text-danger" : "text-muted"}`}>{s.preparing ? t("player.preparing") : s.error ? t(ERR[s.error]) : tr.artist.name}</span>
            </span>
          </button>
          <PlayPause />
          <button className="icon-btn" onClick={a.next} aria-label={t("player.next")}><INext size={20} /></button>
        </div>
        <div className="absolute inset-x-0 bottom-0 h-[2px] bg-line" aria-hidden><div className="h-full bg-accent" style={{ width: `${pct}%` }} /></div>
      </div>
      {/* Desktop */}
      <div className="glass fixed inset-x-0 bottom-0 z-40 hidden border-t border-line lg:block" style={{ height: "var(--playerbar-h)" }} role="region" aria-label={t("player.region")}>
        <div className="grid h-full grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)] items-center gap-4 px-5">
          <div className="flex min-w-0 items-center gap-3">
            <button onClick={() => onOpen("now")} aria-label={t("player.openNow")} className="flex-none"><Artwork artworkId={tr.album.artworkId} seed={tr.album.title} size={96} className="w-14" rounded="rounded-lg" priority /></button>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{tr.title}</div>
              <div className="truncate text-xs text-muted"><Link href={`/artiste/${tr.artist.id}`} className="hover:underline">{tr.artist.name}</Link> — <Link href={`/album/${tr.album.id}`} className="hover:underline">{tr.album.title}</Link></div>
              <div className="truncate text-[0.68rem] text-faint">{audioInfo(tr, locale)}{s.variant === "compat" ? ` → ${t("player.compat")}` : ""}</div>
            </div>
            <FavButton on={tr.favorite} size={18} label={t(tr.favorite ? "fav.remove" : "fav.add")} onToggle={async () => { const on = !tr.favorite; a.patchTrack(tr.id, { favorite: on }); if (!(await fav("track", tr.id, on))) a.patchTrack(tr.id, { favorite: !on }); }} />
          </div>
          <div>
            <div className="flex items-center justify-center gap-2">
              <ModeButtons />
              <button className="icon-btn" onClick={a.prev} aria-label={t("player.prev")}><IPrev size={20} /></button>
              <button onClick={a.toggle} disabled={s.preparing} aria-label={t(s.playing ? "player.pause" : "player.play")} className="flex h-10 w-10 items-center justify-center rounded-full bg-ink text-bg transition-transform active:scale-95">
                {(s.loading || s.preparing) && !s.playing ? <ISpinner size={18} /> : s.playing ? <IPause size={18} /> : <IPlay size={18} />}</button>
              <button className="icon-btn" onClick={a.next} aria-label={t("player.next")}><INext size={20} /></button>
            </div>
            {s.error || s.preparing ? <ErrorLine /> : <Seek compact />}
          </div>
          <div className="flex items-center justify-end gap-2">
            <Volume />
            <button className="icon-btn" onClick={() => onOpen("lyrics")} aria-label={t("lyrics.title")} title={t("lyrics.title")}><ILyrics size={20} /></button>
            <button className="icon-btn" onClick={() => onOpen("queue")} aria-label={t("queue.title")} title={t("queue.title")}><IQueue size={20} /></button>
          </div>
        </div>
      </div>
    </>
  );
}

function QueueList() {
  const t = useT(); const s = usePlayer(); const a = usePlayerActions();
  const upcoming = s.queue.length - s.index - 1;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wider text-faint">{t("queue.upNext")} · {upcoming}</h3>
        {upcoming > 0 && <button className="btn btn-sm" onClick={a.clearUpcoming}>{t("queue.clear")}</button>}
      </div>
      {s.queue.length === 0 ? <p className="py-6 text-center text-sm text-muted">{t("queue.empty")}</p> : (
        <ol>
          {s.queue.map((tr, i) => {
            const cur = i === s.index;
            return (
              <li key={`${tr.id}-${i}`} className={`flex items-center gap-2 rounded-xl px-1 py-1.5 ${cur ? "bg-raised" : i < s.index ? "opacity-50" : ""}`}>
                <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => (cur ? a.toggle() : a.jumpTo(i))} aria-current={cur ? "true" : undefined} aria-label={t("player.playTrack", { title: tr.title })}>
                  <span className="relative w-10 flex-none"><Artwork artworkId={tr.album.artworkId} seed={tr.album.title} size={96} rounded="rounded-md" />
                    {cur && <span className="absolute inset-0 flex items-center justify-center rounded-md bg-black/55"><NowBars paused={!s.playing} /></span>}</span>
                  <span className="min-w-0"><span className={`block truncate text-sm font-medium ${cur ? "text-accent" : ""}`}>{tr.title}</span><span className="block truncate text-xs text-muted">{tr.artist.name}</span></span>
                </button>
                {i > s.index && <>
                  <button className="icon-btn !h-8 !w-8 text-muted" disabled={i <= s.index + 1} onClick={() => a.move(i, i - 1)} aria-label={t("queue.moveUp", { title: tr.title })}><IUp size={16} /></button>
                  <button className="icon-btn !h-8 !w-8 text-muted" disabled={i >= s.queue.length - 1} onClick={() => a.move(i, i + 1)} aria-label={t("queue.moveDown", { title: tr.title })}><IDown size={16} /></button>
                </>}
                {!cur && <button className="icon-btn !h-8 !w-8 text-muted" onClick={() => a.removeAt(i)} aria-label={t("queue.remove", { title: tr.title })}><IClose size={16} /></button>}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/** Full-screen "now playing" with the queue as a second tab. */
export function NowPlaying({ open, tab, onTab, onClose }: { open: boolean; tab: PlayerTab; onTab: (t: PlayerTab) => void; onClose: () => void }) {
  const t = useT(); const locale = useLocale();
  const s = usePlayer(); const a = usePlayerActions(); const tr = useCurrentTrack();
  const fav = useFavorite();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const o = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = o; };
  }, [open, onClose]);
  if (!open || !tr) return null;
  return (
    <div className="sheet-up fixed inset-0 z-[60] flex flex-col bg-bg" role="dialog" aria-modal="true" aria-label={t("player.nowPlaying")}>
      <div className="pointer-events-none absolute inset-0 opacity-40" aria-hidden style={{ background: "radial-gradient(120% 70% at 50% 0%, color-mix(in srgb, var(--accent) 38%, transparent), transparent 70%)" }} />
      <div className="relative flex items-center justify-between px-3 pb-1" style={{ paddingTop: "calc(var(--safe-t) + 10px)" }}>
        <button className="icon-btn" onClick={onClose} aria-label={t("common.close")} autoFocus><IChevronDown size={24} /></button>
        <div className="flex rounded-full border border-line bg-surface p-1" role="tablist">
          {(["now", "lyrics", "queue"] as const).map((k) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => onTab(k)} className={`rounded-full px-3.5 py-1.5 text-xs font-bold ${tab === k ? "bg-ink text-bg" : "text-muted"}`}>{t(k === "now" ? "player.nowShort" : k === "lyrics" ? "lyrics.title" : "queue.title")}</button>)}
        </div>
        <span className="w-10" />
      </div>
      {tab === "queue" ? (
        <div className="relative mx-auto w-full max-w-xl flex-1 overflow-y-auto px-4 py-3" style={{ paddingBottom: "calc(1rem + var(--safe-b))" }}><QueueList /></div>
      ) : tab === "lyrics" ? (
        <div className="relative mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col px-4">
          <div className="min-h-0 flex-1"><LyricsView track={tr} /></div>
          {/* A compact transport stays under the lyrics. */}
          <div className="glass -mx-4 border-t border-line px-5 pt-2" style={{ paddingBottom: "calc(0.6rem + var(--safe-b))" }}>
            <p className="truncate text-center text-xs text-muted"><span className="font-semibold text-ink">{tr.title}</span> — {tr.artist.name}</p>
            <Seek compact />
            <div className="flex items-center justify-center gap-4">
              <button className="icon-btn" onClick={a.prev} aria-label={t("player.prev")}><IPrev size={22} /></button>
              <PlayPause size={24} />
              <button className="icon-btn" onClick={a.next} aria-label={t("player.next")}><INext size={22} /></button>
            </div>
          </div>
        </div>
      ) : (
        <div className="relative mx-auto flex w-full max-w-md flex-1 flex-col justify-between gap-4 overflow-y-auto px-7 pt-3" style={{ paddingBottom: "calc(1.25rem + var(--safe-b))" }}>
          <div className="mx-auto w-full max-w-[min(100%,44dvh)]"><Artwork artworkId={tr.album.artworkId} seed={tr.album.title} size={640} rounded="rounded-2xl" className="shadow-2xl shadow-black/60" priority /></div>
          <div>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-xl font-extrabold tracking-tight">{tr.title}</h2>
                <p className="truncate text-muted"><Link href={`/artiste/${tr.artist.id}`} onClick={onClose} className="hover:underline">{tr.artist.name}</Link> — <Link href={`/album/${tr.album.id}`} onClick={onClose} className="hover:underline">{tr.album.title}</Link></p>
              </div>
              <FavButton on={tr.favorite} size={24} label={t(tr.favorite ? "fav.remove" : "fav.add")} onToggle={async () => { const on = !tr.favorite; a.patchTrack(tr.id, { favorite: on }); if (!(await fav("track", tr.id, on))) a.patchTrack(tr.id, { favorite: !on }); }} />
            </div>
            <div className="mt-3"><Seek /></div>
            <div className="mt-1 min-h-5"><ErrorLine /></div>
            <div className="mt-2 flex items-center justify-between">
              <button className="icon-btn" aria-pressed={s.shuffle} aria-label={t("player.shuffleMode")} onClick={() => a.setShuffle(!s.shuffle)}><IShuffle size={22} /></button>
              <button className="icon-btn !h-14 !w-14" onClick={a.prev} aria-label={t("player.prev")}><IPrev size={30} /></button>
              <PlayPause big size={28} />
              <button className="icon-btn !h-14 !w-14" onClick={a.next} aria-label={t("player.next")}><INext size={30} /></button>
              <button className="icon-btn" aria-pressed={s.repeat !== "off"} aria-label={t(s.repeat === "one" ? "player.repeatOne" : s.repeat === "all" ? "player.repeatAll" : "player.repeatOff")} onClick={a.cycleRepeat}>{s.repeat === "one" ? <IRepeatOne size={22} /> : <IRepeat size={22} />}</button>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="chip">{audioInfo(tr, locale)}{s.variant === "compat" ? ` → ${t("player.compat")}` : ""}</span>
              <Volume />
              <span className="flex"><button className="icon-btn" onClick={() => onTab("lyrics")} aria-label={t("lyrics.title")}><ILyrics size={22} /></button>
              <button className="icon-btn" onClick={() => onTab("queue")} aria-label={t("queue.title")}><IQueue size={22} /></button></span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
