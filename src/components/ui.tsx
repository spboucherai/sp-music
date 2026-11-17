"use client";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiClientError } from "@/lib/client-api";
import type { Album, Artist, Me, Playlist, Track } from "@/lib/types";
import { fmtTime } from "@/lib/format";
import { useT } from "@/i18n";
import type { Key } from "@/i18n/messages";
import { useCurrentTrack, usePlayer, usePlayerActions } from "./player";
import { IAlert, ICheck, IClose, IDisc, IHeart, IMore, IPlay, IPlus, ISpinner } from "./icons";

// ── Session context ─────────────────────────────────────────────────────────────────────────────────
const MeCtx = createContext<Me | null>(null);
export const MeProvider = MeCtx.Provider;
export const useMe = () => useContext(MeCtx)!;

// ── Data loading ────────────────────────────────────────────────────────────────────────────────────
export interface Loaded<T> { data: T | null; error: ApiClientError | null; loading: boolean; reload: () => void; setData: (fn: (d: T) => T) => void }
/** GET a JSON resource. `path = null` skips. Keeps the previous data visible while reloading. */
export function useApi<T>(path: string | null): Loaded<T> {
  const [state, setState] = useState<{ data: T | null; error: ApiClientError | null; loading: boolean; path: string | null }>({ data: null, error: null, loading: !!path, path });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) { setState({ data: null, error: null, loading: false, path }); return; }
    let alive = true;
    setState((s) => ({ data: s.path === path ? s.data : null, error: null, loading: true, path }));
    api<T>(path).then((data) => { if (alive) setState({ data, error: null, loading: false, path }); })
      .catch((e) => { if (alive) setState((s) => ({ ...s, error: e instanceof ApiClientError ? e : new ApiClientError(0, "network", "Network error"), loading: false })); });
    return () => { alive = false; };
  }, [path, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const setData = useCallback((fn: (d: T) => T) => setState((s) => (s.data ? { ...s, data: fn(s.data) } : s)), []);
  return { data: state.data, error: state.error, loading: state.loading, reload, setData };
}

/** Message for an API error: a known code gets its translated sentence, anything else a generic one. */
export function useErrorText() {
  const t = useT();
  return useCallback((e: unknown): string => {
    const code = e instanceof ApiClientError ? e.code : "";
    const key = `err.${code}` as Key;
    const known = t(key);
    if (known !== key && code) return known;
    return code === "network" ? t("err.network") : t("err.generic");
  }, [t]);
}

// ── Toasts ──────────────────────────────────────────────────────────────────────────────────────────
interface Toast { id: number; text: string; kind: "info" | "error" }
const ToastCtx = createContext<(text: string, kind?: "info" | "error") => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: "info" | "error" = "info") => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-2), { id, text, kind }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), kind === "error" ? 6000 : 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 z-[80] flex flex-col items-center gap-2 px-4" style={{ bottom: "calc(var(--toast-b, 150px) + var(--safe-b))" }} role="status" aria-live="polite">
        {items.map((i) => (
          <div key={i.id} className={`fade-up pointer-events-auto flex max-w-md items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium shadow-xl ${i.kind === "error" ? "border-[#6b2428] bg-[#2a1214] text-[#ffb4b4]" : "border-line bg-raised text-ink"}`}>
            {i.kind === "error" ? <IAlert size={16} /> : <ICheck size={16} />}<span>{i.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ── Overlays ────────────────────────────────────────────────────────────────────────────────────────
/** Modal dialog: bottom sheet on phones, centred card on larger screens. Escape and backdrop close it; focus is trapped. */
export function Sheet({ open, onClose, title, children, wide, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const t = useT();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const focusables = () => Array.from(el?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])') ?? []);
    (el?.querySelector<HTMLElement>("[data-autofocus]") ?? focusables()[1] ?? focusables()[0])?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
      if (e.key === "Tab") {
        const f = focusables(); if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey, true);
    const overflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey, true); document.body.style.overflow = overflow; prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-6">
      <div className="absolute inset-0 bg-black/65" onClick={onClose} aria-hidden />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className={`sheet-up relative flex max-h-[92dvh] w-full flex-col rounded-t-3xl border border-line bg-surface shadow-2xl sm:rounded-3xl ${wide ? "sm:max-w-3xl" : "sm:max-w-md"}`}>
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 id={titleId} className="truncate text-base font-bold">{title}</h2>
          <button className="icon-btn -mr-2" onClick={onClose} aria-label={t("common.close")}><IClose size={20} /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4" style={{ paddingBottom: footer ? undefined : "calc(1rem + var(--safe-b))" }}>{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3" style={{ paddingBottom: "calc(0.75rem + var(--safe-b))" }}>{footer}</div>}
      </div>
    </div>
  );
}

export function Confirm({ open, onClose, onConfirm, title, body, confirmLabel, danger, busy }: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; body: ReactNode; confirmLabel: string; danger?: boolean; busy?: boolean }) {
  const t = useT();
  return (
    <Sheet open={open} onClose={onClose} title={title} footer={<>
      <button className="btn" onClick={onClose} data-autofocus>{t("common.cancel")}</button>
      <button className={`btn ${danger ? "btn-danger" : "btn-primary"}`} onClick={onConfirm} disabled={busy}>{busy && <ISpinner size={16} />}{confirmLabel}</button>
    </>}>
      <div className="text-sm leading-relaxed text-muted">{body}</div>
    </Sheet>
  );
}

// ── Artwork ─────────────────────────────────────────────────────────────────────────────────────────
function hue(seed: string): number { let h = 0; for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0; return h % 360; }

/** Square cover with a loading state; without artwork, an original generated placeholder (never a stock image). */
export function Artwork({ artworkId, seed, size = 320, className = "", rounded = "rounded-xl", priority }: { artworkId: string | null | undefined; seed: string; size?: 96 | 320 | 640; className?: string; rounded?: string; priority?: boolean }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const h = hue(seed || "music");
  useEffect(() => { setLoaded(false); setFailed(false); }, [artworkId]);
  return (
    <div className={`relative aspect-square overflow-hidden bg-raised ${rounded} ${className}`}>
      {artworkId && !failed ? (
        <>
          {!loaded && <div className="skeleton absolute inset-0" />}
          <img src={`/api/v1/art/${artworkId}?s=${size}`} alt="" loading={priority ? "eager" : "lazy"} decoding="async" draggable={false}
            ref={(el) => { if (el?.complete && el.naturalWidth > 0) setLoaded(true); }}
            onLoad={() => setLoaded(true)} onError={() => setFailed(true)}
            className={`h-full w-full object-cover transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`} />
        </>
      ) : (
        <div className="flex h-full w-full items-center justify-center" style={{ background: `linear-gradient(140deg, hsl(${h} 45% 24%), hsl(${(h + 50) % 360} 55% 13%))` }}>
          <IDisc size={0} style={{ width: "42%", height: "42%", color: `hsl(${h} 60% 72% / 0.55)` }} />
        </div>
      )}
    </div>
  );
}

/** 2×2 mosaic for a playlist. */
export function Mosaic({ artworkIds, seed, className = "" }: { artworkIds: string[]; seed: string; className?: string }) {
  if (artworkIds.length < 4) return <Artwork artworkId={artworkIds[0] ?? null} seed={seed} className={className} />;
  return <div className={`grid aspect-square grid-cols-2 overflow-hidden rounded-xl ${className}`}>{artworkIds.slice(0, 4).map((a) => <Artwork key={a} artworkId={a} seed={seed} size={320} rounded="" />)}</div>;
}

// ── States ──────────────────────────────────────────────────────────────────────────────────────────
export function Empty({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="fade-up mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-14 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-raised text-accent">{icon ?? <IDisc size={30} />}</div>
      <h2 className="text-lg font-bold">{title}</h2>
      {body && <p className="text-sm leading-relaxed text-muted">{body}</p>}
      {action}
    </div>
  );
}
export function LoadError({ error, retry }: { error: ApiClientError; retry: () => void }) {
  const t = useT(); const text = useErrorText();
  return <Empty icon={<IAlert size={30} />} title={error.status === 404 ? t("state.notFound") : t("state.loadFailed")} body={text(error)} action={error.status === 404 ? undefined : <button className="btn" onClick={retry}>{t("common.retry")}</button>} />;
}
export function GridSkeleton({ n = 6 }: { n?: number }) {
  return <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6" aria-hidden>{Array.from({ length: n }, (_, i) => <div key={i}><div className="skeleton aspect-square rounded-xl" /><div className="skeleton mt-2 h-3 w-3/4 rounded" /><div className="skeleton mt-1.5 h-3 w-1/2 rounded" /></div>)}</div>;
}
export function RowsSkeleton({ n = 8 }: { n?: number }) {
  return <div aria-hidden>{Array.from({ length: n }, (_, i) => <div key={i} className="flex items-center gap-3 py-2"><div className="skeleton h-11 w-11 rounded-lg" /><div className="flex-1"><div className="skeleton h-3 w-1/2 rounded" /><div className="skeleton mt-2 h-3 w-1/3 rounded" /></div></div>)}</div>;
}
/** Wraps a loader: skeleton first, error with retry, then the content. */
export function Async<T>({ res, skeleton, children }: { res: Loaded<T>; skeleton?: ReactNode; children: (data: T) => ReactNode }) {
  if (res.data) return <>{children(res.data)}</>;
  if (res.error) return <LoadError error={res.error} retry={res.reload} />;
  return <>{skeleton ?? <RowsSkeleton />}</>;
}

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><h1 className="h-page">{title}</h1>{children}</div>;
}
export function Section({ title, href, children }: { title: string; href?: string; children: ReactNode }) {
  const t = useT();
  return (
    <section className="mb-9">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="h-section">{title}</h2>
        {href && <Link href={href} className="text-sm font-semibold text-accent hover:underline">{t("common.seeAll")}</Link>}
      </div>
      {children}
    </section>
  );
}

// ── Cards ───────────────────────────────────────────────────────────────────────────────────────────
export function AlbumCard({ album, className = "" }: { album: Album; className?: string }) {
  return (
    <Link href={`/album/${album.id}`} className={`group block ${className}`}>
      <Artwork artworkId={album.artworkId} seed={album.title} className="shadow-lg shadow-black/40 transition-transform duration-200 group-hover:scale-[1.02]" />
      <div className="mt-2 truncate text-sm font-semibold">{album.title}</div>
      <div className="truncate text-xs text-muted">{album.artist.name}{album.year ? ` · ${album.year}` : ""}</div>
    </Link>
  );
}
export function ArtistCard({ artist, className = "" }: { artist: Artist; className?: string }) {
  const t = useT();
  return (
    <Link href={`/artiste/${artist.id}`} className={`group block text-center ${className}`}>
      <Artwork artworkId={artist.artworkId} seed={artist.name} rounded="rounded-full" className="shadow-lg shadow-black/40 transition-transform duration-200 group-hover:scale-[1.02]" />
      <div className="mt-2 truncate text-sm font-semibold">{artist.name}</div>
      <div className="truncate text-xs text-muted">{t(artist.albumCount === 1 ? "count.album" : "count.albums", { n: artist.albumCount })}</div>
    </Link>
  );
}
export function PlaylistCard({ playlist, className = "" }: { playlist: Playlist; className?: string }) {
  const t = useT();
  return (
    <Link href={`/listes/${playlist.id}`} className={`group block ${className}`}>
      <Mosaic artworkIds={playlist.artworkIds} seed={playlist.name} className="shadow-lg shadow-black/40 transition-transform duration-200 group-hover:scale-[1.02]" />
      <div className="mt-2 truncate text-sm font-semibold">{playlist.name}</div>
      <div className="truncate text-xs text-muted">{t(playlist.trackCount === 1 ? "count.track" : "count.tracks", { n: playlist.trackCount })}</div>
    </Link>
  );
}
export const Grid = ({ children }: { children: ReactNode }) => <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">{children}</div>;

// ── Favourites ──────────────────────────────────────────────────────────────────────────────────────
export function useFavorite() {
  const toast = useToast(); const text = useErrorText();
  return useCallback(async (kind: "track" | "album", id: string, on: boolean): Promise<boolean> => {
    try { await api(`/api/v1/library/favorites/${kind}/${id}`, { method: on ? "PUT" : "DELETE" }); return true; }
    catch (e) { toast(text(e), "error"); return false; }
  }, [toast, text]);
}
export function FavButton({ on, onToggle, label, size = 20, className = "" }: { on: boolean; onToggle: () => void; label: string; size?: number; className?: string }) {
  return <button className={`icon-btn ${className}`} aria-pressed={on} aria-label={label} title={label} onClick={(e) => { e.stopPropagation(); onToggle(); }}><IHeart size={size} filled={on} /></button>;
}

// ── Track actions menu ──────────────────────────────────────────────────────────────────────────────
interface MenuCtxValue { open: (track: Track, extra?: { label: string; onSelect: () => void; danger?: boolean }[]) => void }
const MenuCtx = createContext<MenuCtxValue>({ open: () => {} });
export const useTrackMenu = () => useContext(MenuCtx);

export function TrackMenuProvider({ children, onChanged }: { children: ReactNode; onChanged?: () => void }) {
  const t = useT(); const toast = useToast(); const text = useErrorText();
  const actions = usePlayerActions();
  const [target, setTarget] = useState<{ track: Track; extra: { label: string; onSelect: () => void; danger?: boolean }[] } | null>(null);
  const [picking, setPicking] = useState(false);
  const lists = useApi<{ items: Playlist[] }>(picking ? "/api/v1/library/playlists" : null);
  const [newName, setNewName] = useState("");
  const close = useCallback(() => { setTarget(null); setPicking(false); setNewName(""); }, []);
  const value = useMemo(() => ({ open: (track: Track, extra: { label: string; onSelect: () => void; danger?: boolean }[] = []) => setTarget({ track, extra }) }), []);
  const track = target?.track;
  const addTo = async (playlistId: string, name: string) => {
    if (!track) return;
    try { await api(`/api/v1/library/playlists/${playlistId}/tracks`, { body: { trackIds: [track.id] } }); toast(t("playlist.added", { name })); onChanged?.(); close(); }
    catch (e) { toast(text(e), "error"); }
  };
  const createAndAdd = async () => {
    if (!track || !newName.trim()) return;
    try { await api("/api/v1/library/playlists", { body: { name: newName.trim(), trackIds: [track.id] } }); toast(t("playlist.added", { name: newName.trim() })); onChanged?.(); close(); }
    catch (e) { toast(text(e), "error"); }
  };
  const item = "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[0.95rem] font-medium hover:bg-hover";
  return (
    <MenuCtx.Provider value={value}>
      {children}
      <Sheet open={!!track} onClose={close} title={picking ? t("menu.addToPlaylist") : track?.title ?? ""}>
        {track && !picking && (
          <div className="-mx-2">
            <div className="mb-2 flex items-center gap-3 px-3">
              <Artwork artworkId={track.album.artworkId} seed={track.album.title} size={96} className="w-12" rounded="rounded-lg" />
              <div className="min-w-0"><div className="truncate text-sm font-semibold">{track.title}</div><div className="truncate text-xs text-muted">{track.artist.name} — {track.album.title}</div></div>
            </div>
            <button className={item} onClick={() => { actions.playNext([track]); toast(t("menu.playNextDone")); close(); }}>{t("menu.playNext")}</button>
            <button className={item} onClick={() => { actions.addToQueue([track]); toast(t("menu.addToQueueDone")); close(); }}>{t("menu.addToQueue")}</button>
            <button className={item} onClick={() => setPicking(true)}>{t("menu.addToPlaylist")}</button>
            <Link className={item} href={`/album/${track.album.id}`} onClick={close}>{t("menu.goToAlbum")}</Link>
            <Link className={item} href={`/artiste/${track.artist.id}`} onClick={close}>{t("menu.goToArtist")}</Link>
            {target!.extra.map((x) => <button key={x.label} className={`${item} ${x.danger ? "text-danger" : ""}`} onClick={() => { close(); x.onSelect(); }}>{x.label}</button>)}
          </div>
        )}
        {track && picking && (
          <div>
            <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); void createAndAdd(); }}>
              <label className="sr-only" htmlFor="new-pl">{t("playlist.newName")}</label>
              <input id="new-pl" className="input" placeholder={t("playlist.newName")} value={newName} maxLength={120} onChange={(e) => setNewName(e.target.value)} />
              <button className="btn btn-primary" disabled={!newName.trim()}><IPlus size={16} />{t("common.create")}</button>
            </form>
            <Async res={lists}>{(d) => d.items.length === 0 ? <p className="py-4 text-center text-sm text-muted">{t("playlist.noneYet")}</p> : (
              <div className="-mx-2">{d.items.map((p) => (
                <button key={p.id} className={item} onClick={() => void addTo(p.id, p.name)}>
                  <Mosaic artworkIds={p.artworkIds} seed={p.name} className="w-10" /><span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <span className="text-xs text-muted">{p.trackCount}</span>
                </button>))}</div>)}</Async>
          </div>
        )}
      </Sheet>
    </MenuCtx.Provider>
  );
}

// ── Track rows ──────────────────────────────────────────────────────────────────────────────────────
export function NowBars({ paused }: { paused: boolean }) {
  return <span className={`flex h-4 items-end gap-[2px] ${paused ? "eq-paused" : ""}`} aria-hidden><span className="eq-bar" /><span className="eq-bar" style={{ animationDelay: "0.25s" }} /><span className="eq-bar" style={{ animationDelay: "0.5s" }} /></span>;
}

export interface TrackListProps {
  tracks: Track[];
  /** album: track number in front, no cover. list: cover in front. */
  variant?: "album" | "list";
  onFavorite?: (track: Track, on: boolean) => void;
  extraMenu?: (track: Track, index: number) => { label: string; onSelect: () => void; danger?: boolean }[];
  showDisc?: boolean;
}
export function TrackList({ tracks, variant = "list", onFavorite, extraMenu, showDisc }: TrackListProps) {
  const t = useT();
  const actions = usePlayerActions();
  const player = usePlayer();
  const current = useCurrentTrack();
  const menu = useTrackMenu();
  const fav = useFavorite();
  const [local, setLocal] = useState<Record<string, boolean>>({});
  useEffect(() => setLocal({}), [tracks]);
  const discs = showDisc ? new Set(tracks.map((x) => x.discNo)).size > 1 : false;
  return (
    <ol className="divide-y divide-line/60">
      {tracks.map((tr, i) => {
        const isCur = current?.id === tr.id;
        const isFav = local[tr.id] ?? tr.favorite;
        const unplayable = tr.webPlayable === "no" && tr.compatState !== "ready";
        return (
          <li key={tr.entryId ?? `${tr.id}-${i}`}>
            {discs && (i === 0 || tracks[i - 1].discNo !== tr.discNo) && <div className="px-1 pb-1 pt-4 text-xs font-bold uppercase tracking-wider text-faint">{t("album.disc", { n: tr.discNo })}</div>}
            <div className={`group flex items-center gap-3 rounded-lg px-1 py-1.5 ${isCur ? "text-accent" : ""}`}>
              <button className="flex min-w-0 flex-1 items-center gap-3 rounded-lg py-1 text-left" onClick={() => (isCur ? actions.toggle() : actions.playTracks(tracks, i, { shuffle: false }))}
                aria-label={t(isCur && player.playing ? "player.pauseTrack" : "player.playTrack", { title: tr.title })} aria-current={isCur ? "true" : undefined}>
                {variant === "album" ? (
                  <span className="flex w-7 flex-none justify-center text-sm tabular-nums text-faint">{isCur ? <NowBars paused={!player.playing} /> : (tr.trackNo ?? "–")}</span>
                ) : (
                  <span className="relative w-11 flex-none">
                    <Artwork artworkId={tr.album.artworkId} seed={tr.album.title} size={96} rounded="rounded-lg" />
                    {isCur && <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/55"><NowBars paused={!player.playing} /></span>}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-[0.95rem] font-medium ${isCur ? "" : "text-ink"}`}>{tr.title}</span>
                  <span className="flex items-center gap-1.5 truncate text-xs text-muted">
                    {unplayable && <span className="chip chip-warn !py-0">{t("track.noBrowser")}</span>}
                    <span className="truncate">{variant === "album" ? tr.artist.name : `${tr.artist.name} — ${tr.album.title}`}</span>
                  </span>
                </span>
              </button>
              <span className="hidden text-xs tabular-nums text-faint sm:block">{fmtTime(tr.durationMs)}</span>
              <FavButton on={isFav} className="hidden sm:inline-flex" size={18} label={t(isFav ? "fav.remove" : "fav.add")} onToggle={async () => {
                setLocal((l) => ({ ...l, [tr.id]: !isFav }));
                if (await fav("track", tr.id, !isFav)) { actions.patchTrack(tr.id, { favorite: !isFav }); onFavorite?.(tr, !isFav); } else setLocal((l) => ({ ...l, [tr.id]: isFav }));
              }} />
              <button className="icon-btn text-muted" aria-label={t("menu.more", { title: tr.title })} onClick={() => menu.open(tr, [
                { label: t(isFav ? "fav.remove" : "fav.add"), onSelect: async () => { setLocal((l) => ({ ...l, [tr.id]: !isFav })); if (await fav("track", tr.id, !isFav)) { actions.patchTrack(tr.id, { favorite: !isFav }); onFavorite?.(tr, !isFav); } else setLocal((l) => ({ ...l, [tr.id]: isFav })); } },
                ...(extraMenu?.(tr, i) ?? []),
              ])}><IMore size={20} /></button>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function PlayButtons({ tracks, className = "" }: { tracks: Track[]; className?: string }) {
  const t = useT(); const actions = usePlayerActions();
  return (
    <div className={`flex gap-2.5 ${className}`}>
      <button className="btn btn-primary min-w-28 flex-1 sm:flex-none" disabled={!tracks.length} onClick={() => actions.playTracks(tracks, 0, { shuffle: false })}><IPlay size={16} />{t("player.play")}</button>
      <button className="btn min-w-28 flex-1 sm:flex-none" disabled={tracks.length < 2} onClick={() => actions.playTracks(tracks, 0, { shuffle: true })}>{t("player.shuffle")}</button>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) { return <div className="flex items-center justify-center gap-2 py-10 text-muted"><ISpinner />{label && <span className="text-sm">{label}</span>}</div>; }
