"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, getCsrf } from "@/lib/client-api";
import type { Album, LyricLine, Lyrics, Paged, Track } from "@/lib/types";
import { audioInfo, fmtTime } from "@/lib/format";
import { useLocale, useT } from "@/i18n";
import { Artwork, Async, Confirm, Empty, Sheet, useApi, useErrorText, useToast } from "@/components/ui";
import { IChevronDown, IChevronRight, IDown, IEdit, ILyrics, IRefresh, ISpinner, ITrash, IUp } from "@/components/icons";
import type { Key } from "@/i18n/messages";

type Fields = { title: string; artist: string; album: string; albumArtist: string; trackNo: string; discNo: string; year: string; genre: string };
const EMPTY: Fields = { title: "", artist: "", album: "", albumArtist: "", trackNo: "", discNo: "", year: "", genre: "" };
const num = (s: string) => (s.trim() === "" ? null : Number(s));

function Field({ id, label, value, onChange, type = "text", placeholder }: { id: string; label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return <div><label className="label" htmlFor={id}>{label}</label><input id={id} className="input" type={type} inputMode={type === "number" ? "numeric" : undefined} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} /></div>;
}

/** Edit one track, or several at once (only the fields that were filled in are applied to the selection). */
function TrackEditor({ tracks, onClose, onSaved }: { tracks: Track[]; onClose: () => void; onSaved: () => void }) {
  const t = useT(); const toast = useToast(); const text = useErrorText();
  const single = tracks.length === 1 ? tracks[0] : null;
  const [f, setF] = useState<Fields>(EMPTY);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setF(single ? { title: single.title, artist: single.artist.name, album: single.album.title, albumArtist: single.album.artistName, trackNo: single.trackNo?.toString() ?? "", discNo: String(single.discNo), year: single.year?.toString() ?? "", genre: single.genre ?? "" } : EMPTY);
  }, [single, tracks.length]);
  const set = (k: keyof Fields) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    const patch: Record<string, unknown> = {};
    if (single) {
      if (f.title.trim() !== single.title) patch.title = f.title.trim();
      if (f.artist.trim() !== single.artist.name) patch.artist = f.artist.trim();
      if (f.album.trim() !== single.album.title) patch.album = f.album.trim();
      if (f.albumArtist.trim() !== single.album.artistName) patch.albumArtist = f.albumArtist.trim();
      if (num(f.trackNo) !== single.trackNo) patch.trackNo = num(f.trackNo);
      if (f.discNo.trim() && Number(f.discNo) !== single.discNo) patch.discNo = Number(f.discNo);
      if (num(f.year) !== single.year) patch.year = num(f.year);
      if (f.genre.trim() !== (single.genre ?? "")) patch.genre = f.genre.trim();
    } else {
      for (const k of ["artist", "album", "albumArtist", "genre"] as const) if (f[k].trim()) patch[k] = f[k].trim();
      if (f.discNo.trim()) patch.discNo = Number(f.discNo);
      if (f.year.trim()) patch.year = Number(f.year);
    }
    if (Object.keys(patch).length === 0) return onClose();
    setBusy(true);
    try { await api("/api/v1/admin/tracks", { method: "PATCH", body: { ids: tracks.map((x) => x.id), patch } }); toast(t("admin.saved")); onSaved(); onClose(); }
    catch (e) { toast(text(e), "error"); } finally { setBusy(false); }
  };
  return (
    <Sheet open onClose={onClose} wide title={single ? t("admin.editTrack") : t("admin.editN", { n: tracks.length })}
      footer={<><button className="btn" onClick={onClose}>{t("common.cancel")}</button><button className="btn btn-primary" onClick={save} disabled={busy || (!!single && !f.title.trim())}>{busy && <ISpinner size={16} />}{t("common.save")}</button></>}>
      {!single && <p className="mb-4 text-sm leading-relaxed text-muted">{t("admin.batchHelp")}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {single && <div className="sm:col-span-2"><Field id="e-title" label={t("f.title")} value={f.title} onChange={set("title")} /></div>}
        <Field id="e-artist" label={t("f.artist")} value={f.artist} onChange={set("artist")} placeholder={single ? "" : t("admin.unchanged")} />
        <Field id="e-aa" label={t("f.albumArtist")} value={f.albumArtist} onChange={set("albumArtist")} placeholder={single ? "" : t("admin.unchanged")} />
        <div className="sm:col-span-2"><Field id="e-album" label={t("f.album")} value={f.album} onChange={set("album")} placeholder={single ? "" : t("admin.unchanged")} /></div>
        {single && <Field id="e-no" label={t("f.trackNo")} type="number" value={f.trackNo} onChange={set("trackNo")} />}
        <Field id="e-disc" label={t("f.discNo")} type="number" value={f.discNo} onChange={set("discNo")} placeholder={single ? "" : t("admin.unchanged")} />
        <Field id="e-year" label={t("f.year")} type="number" value={f.year} onChange={set("year")} placeholder={single ? "" : t("admin.unchanged")} />
        <Field id="e-genre" label={t("f.genre")} value={f.genre} onChange={set("genre")} placeholder={single ? "" : t("admin.unchanged")} />
      </div>
      {single && <p className="mt-4 text-xs text-faint">{t("admin.moveHelp")}</p>}
    </Sheet>
  );
}

function AlbumEditor({ album, onClose, onSaved }: { album: Album; onClose: () => void; onSaved: () => void }) {
  const t = useT(); const toast = useToast(); const text = useErrorText();
  const [f, setF] = useState({ title: album.title, artist: album.artist.name, year: album.year?.toString() ?? "", genre: album.genre ?? "" });
  const [busy, setBusy] = useState(false);
  const [art, setArt] = useState(album.artworkId);
  const file = useRef<HTMLInputElement>(null);
  const save = async () => {
    const patch: Record<string, unknown> = {};
    if (f.title.trim() !== album.title) patch.title = f.title.trim();
    if (f.artist.trim() !== album.artist.name) patch.artist = f.artist.trim();
    if (num(f.year) !== album.year) patch.year = num(f.year);
    if (f.genre.trim() !== (album.genre ?? "")) patch.genre = f.genre.trim();
    if (Object.keys(patch).length === 0) return onClose();
    setBusy(true);
    try { const r = await api<{ merged: boolean }>(`/api/v1/admin/albums/${album.id}`, { method: "PATCH", body: patch }); toast(t(r.merged ? "admin.merged" : "admin.saved")); onSaved(); onClose(); }
    catch (e) { toast(text(e), "error"); } finally { setBusy(false); }
  };
  const upload = async (img: File) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/admin/albums/${album.id}/artwork`, { method: "PUT", body: img, headers: { "Content-Type": "application/octet-stream", "X-CSRF-Token": getCsrf() ?? "" }, credentials: "same-origin" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new (await import("@/lib/client-api")).ApiClientError(res.status, data?.error?.code ?? "http", data?.error?.message ?? "");
      setArt(data.artworkId); toast(t("admin.coverSaved")); onSaved();
    } catch (e) { toast(text(e), "error"); } finally { setBusy(false); }
  };
  return (
    <Sheet open onClose={onClose} wide title={t("admin.editAlbum")}
      footer={<><button className="btn" onClick={onClose}>{t("common.cancel")}</button><button className="btn btn-primary" onClick={save} disabled={busy || !f.title.trim() || !f.artist.trim()}>{busy && <ISpinner size={16} />}{t("common.save")}</button></>}>
      <div className="flex flex-col gap-5 sm:flex-row">
        <div className="mx-auto w-40 flex-none text-center sm:mx-0">
          <Artwork artworkId={art} seed={album.title} />
          <button className="btn btn-sm mt-2 w-full" onClick={() => file.current?.click()} disabled={busy}>{t("admin.changeCover")}</button>
          <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { const x = e.target.files?.[0]; if (x) void upload(x); e.target.value = ""; }} />
          <p className="mt-1.5 text-[0.7rem] leading-snug text-faint">{t("admin.coverHelp")}</p>
        </div>
        <div className="grid flex-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Field id="a-title" label={t("f.album")} value={f.title} onChange={(v) => setF((x) => ({ ...x, title: v }))} /></div>
          <div className="sm:col-span-2"><Field id="a-artist" label={t("f.albumArtist")} value={f.artist} onChange={(v) => setF((x) => ({ ...x, artist: v }))} /></div>
          <Field id="a-year" label={t("f.year")} type="number" value={f.year} onChange={(v) => setF((x) => ({ ...x, year: v }))} />
          <Field id="a-genre" label={t("f.genre")} value={f.genre} onChange={(v) => setF((x) => ({ ...x, genre: v }))} />
        </div>
      </div>
    </Sheet>
  );
}


const LANGS = ["fr", "en", "es", "it", "de", "pt"] as const;

/** Asks the worker to transcribe the selected tracks. */
function LyricsRequest({ tracks, onClose, onDone }: { tracks: Track[]; onClose: () => void; onDone: () => void }) {
  const t = useT(); const toast = useToast(); const text = useErrorText();
  const [language, setLanguage] = useState(""); const [overwrite, setOverwrite] = useState(false); const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { const r = await api<{ queued: number; skipped: number }>("/api/v1/admin/lyrics/generate", { body: { ids: tracks.map((x) => x.id), language: language || null, overwrite } }); toast(t("lyrics.queuedN", { n: r.queued, skipped: r.skipped })); onDone(); onClose(); }
    catch (e) { toast(text(e), "error"); } finally { setBusy(false); }
  };
  return (
    <Sheet open onClose={onClose} title={t("lyrics.generateTitle", { n: tracks.length })} footer={<><button className="btn" onClick={onClose}>{t("common.cancel")}</button><button className="btn btn-primary" onClick={go} disabled={busy}>{busy && <ISpinner size={16} />}{t("lyrics.generate")}</button></>}>
      <p className="mb-4 text-sm leading-relaxed text-muted">{t("lyrics.generateBody")}</p>
      <label className="label" htmlFor="ly-lang">{t("lyrics.language")}</label>
      <select id="ly-lang" className="input" value={language} onChange={(e) => setLanguage(e.target.value)}>
        <option value="">{t("lyrics.langAuto")}</option>{LANGS.map((l) => <option key={l} value={l}>{t(`lang.${l}` as Key)}</option>)}</select>
      <label className="mt-4 flex items-start gap-2.5 text-sm"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--accent)]" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} /><span>{t("lyrics.overwrite")}</span></label>
    </Sheet>
  );
}

/** Line-by-line correction of the transcribed text. Timings are kept. */
function LyricsEditor({ track, onClose, onSaved }: { track: Track; onClose: () => void; onSaved: () => void }) {
  const t = useT(); const toast = useToast(); const text = useErrorText();
  const res = useApi<Lyrics>(`/api/v1/library/tracks/${track.id}/lyrics`);
  const [lines, setLines] = useState<LyricLine[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (res.data && lines === null) setLines(res.data.lines); }, [res.data, lines]);
  const save = async () => {
    setBusy(true);
    try { await api(`/api/v1/admin/tracks/${track.id}/lyrics`, { method: "PUT", body: { language: res.data?.language && (LANGS as readonly string[]).includes(res.data.language) ? res.data.language : null, lines: (lines ?? []).map((l) => ({ t: l.t, e: l.e, text: l.text })) } }); toast(t("admin.saved")); onSaved(); onClose(); }
    catch (e) { toast(text(e), "error"); } finally { setBusy(false); }
  };
  const remove = async () => { setBusy(true); try { await api(`/api/v1/admin/tracks/${track.id}/lyrics`, { method: "DELETE" }); onSaved(); onClose(); } catch (e) { toast(text(e), "error"); } finally { setBusy(false); } };
  return (
    <Sheet open onClose={onClose} wide title={`${t("lyrics.editTitle")} — ${track.title}`}
      footer={<><button className="btn btn-danger mr-auto" onClick={remove} disabled={busy || res.data?.state === "none"}>{t("lyrics.deleteAll")}</button><button className="btn" onClick={onClose}>{t("common.cancel")}</button><button className="btn btn-primary" onClick={save} disabled={busy || lines === null}>{busy && <ISpinner size={16} />}{t("common.save")}</button></>}>
      <p className="mb-3 text-sm leading-relaxed text-muted">{t("lyrics.editHelp")}</p>
      <Async res={res}>{() => (lines ?? []).length === 0 ? <p className="py-6 text-center text-sm text-muted">{t("lyrics.noneTitle")}</p> : (
        <ol className="space-y-1.5">{(lines ?? []).map((l, i) => (
          <li key={`${l.t}-${i}`} className="flex items-center gap-2">
            <span className="w-12 flex-none text-right text-xs tabular-nums text-faint">{fmtTime(l.t)}</span>
            <input className="input !min-h-9 !text-sm" aria-label={t("lyrics.lineAt", { time: fmtTime(l.t) })} value={l.text} maxLength={300} onChange={(e) => setLines((x) => x!.map((y, k) => (k === i ? { ...y, text: e.target.value } : y)))} />
            <button className="icon-btn !h-8 !w-8 text-muted" onClick={() => setLines((x) => x!.filter((_, k) => k !== i))} aria-label={t("lyrics.removeLine", { time: fmtTime(l.t) })}><ITrash size={15} /></button>
          </li>))}</ol>)}</Async>
    </Sheet>
  );
}

function AlbumRow({ album, open, onToggle, onChanged }: { album: Album; open: boolean; onToggle: () => void; onChanged: () => void }) {
  const t = useT(); const locale = useLocale(); const toast = useToast(); const text = useErrorText();
  const res = useApi<{ album: Album; tracks: Track[] }>(open ? `/api/v1/library/albums/${album.id}` : null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<Track[] | null>(null);
  const [editAlbum, setEditAlbum] = useState(false);
  const [del, setDel] = useState<{ kind: "album" } | { kind: "tracks"; tracks: Track[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [lyReq, setLyReq] = useState<Track[] | null>(null);
  const [lyEdit, setLyEdit] = useState<Track | null>(null);
  const tracks = res.data?.tracks ?? [];
  // While a transcription is in progress, refresh the album so its status chips move on their own.
  const transcribing = tracks.some((x) => x.lyricsState === "queued" || x.lyricsState === "working");
  useEffect(() => { if (!transcribing) return; const iv = setInterval(res.reload, 3000); return () => clearInterval(iv); }, [transcribing, res.reload]);
  const selected = useMemo(() => tracks.filter((x) => sel.has(x.id)), [tracks, sel]);
  const changed = () => { setSel(new Set()); res.reload(); onChanged(); };
  const move = async (i: number, d: -1 | 1) => {
    const order = tracks.slice(); [order[i], order[i + d]] = [order[i + d], order[i]];
    res.setData((x) => ({ ...x, tracks: order }));
    try { await api(`/api/v1/admin/albums/${album.id}/order`, { method: "PUT", body: { trackIds: order.map((x) => x.id) } }); res.reload(); }
    catch (e) { toast(text(e), "error"); res.reload(); }
  };
  const doDelete = async () => {
    if (!del) return;
    setBusy(true);
    try {
      const r = del.kind === "album" ? await api<{ deleted: number; fileErrors: number }>(`/api/v1/admin/albums/${album.id}/delete`, { body: { confirm: true } })
        : await api<{ deleted: number; fileErrors: number }>("/api/v1/admin/tracks/delete", { body: { ids: del.tracks.map((x) => x.id), confirm: true } });
      toast(t(r.fileErrors ? "admin.deletedWithErrors" : "admin.deletedN", { n: r.deleted }), r.fileErrors ? "error" : "info"); setDel(null); changed();
    } catch (e) { toast(text(e), "error"); } finally { setBusy(false); }
  };
  const reanalyse = async (ids: string[]) => { try { await api("/api/v1/admin/tracks/reanalyse", { body: { ids } }); toast(t("admin.reanalyseQueued", { n: ids.length })); } catch (e) { toast(text(e), "error"); } };
  return (
    <li id={`adm-album-${album.id}`}>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={onToggle} aria-expanded={open}>
          {open ? <IChevronDown size={18} className="flex-none text-muted" /> : <IChevronRight size={18} className="flex-none text-muted" />}
          <Artwork artworkId={album.artworkId} seed={album.title} size={96} className="w-11 flex-none" rounded="rounded-lg" />
          <span className="min-w-0"><span className="block truncate text-sm font-semibold">{album.title}</span><span className="block truncate text-xs text-muted">{album.artist.name}{album.year ? ` · ${album.year}` : ""} · {t(album.trackCount === 1 ? "count.track" : "count.tracks", { n: album.trackCount })}</span></span>
        </button>
        <button className="icon-btn text-muted" onClick={() => setEditAlbum(true)} aria-label={`${t("admin.editAlbum")} : ${album.title}`}><IEdit size={18} /></button>
        <button className="icon-btn text-muted" onClick={() => setDel({ kind: "album" })} aria-label={`${t("admin.deleteAlbum")} : ${album.title}`}><ITrash size={18} /></button>
      </div>
      {open && (
        <div className="border-t border-line bg-bg/40 px-3 pb-3 pt-2">
          <Async res={res}>{() => (<>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-xs font-semibold text-muted"><input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={tracks.length > 0 && sel.size === tracks.length} onChange={(e) => setSel(e.target.checked ? new Set(tracks.map((x) => x.id)) : new Set())} />{t("admin.selectAll")}</label>
              <span className="text-xs text-faint">{t("admin.nSelected", { n: sel.size })}</span>
              <span className="flex-1" />
              <button className="btn btn-sm" disabled={!sel.size} onClick={() => setEdit(selected)}><IEdit size={14} />{t("admin.editSel")}</button>
              <button className="btn btn-sm" disabled={!sel.size} onClick={() => void reanalyse(selected.map((x) => x.id))}><IRefresh size={14} />{t("admin.reanalyse")}</button>
              <button className="btn btn-sm" disabled={!sel.size} onClick={() => setLyReq(selected)}><ILyrics size={14} />{t("lyrics.title")}</button>
              <button className="btn btn-sm btn-danger" disabled={!sel.size} onClick={() => setDel({ kind: "tracks", tracks: selected })}><ITrash size={14} />{t("common.delete")}</button>
            </div>
            <ol className="divide-y divide-line/60">{tracks.map((tr, i) => (
              <li key={tr.id} className="flex items-center gap-2 py-1.5">
                <input type="checkbox" className="h-4 w-4 flex-none accent-[var(--accent)]" checked={sel.has(tr.id)} aria-label={t("admin.selectTrack", { title: tr.title })} onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(tr.id); else n.delete(tr.id); return n; })} />
                <span className="w-9 flex-none text-center text-xs tabular-nums text-faint">{tr.discNo > 1 ? `${tr.discNo}-` : ""}{tr.trackNo ?? "–"}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{tr.title}</p>
                  <p className="truncate text-xs text-muted">{tr.artist.name} · {audioInfo(tr, locale)} · {fmtTime(tr.durationMs)}
                    {tr.webPlayable !== "yes" && <span className={`chip ml-1.5 !py-0 ${tr.compatState === "ready" ? "chip-ok" : tr.compatState === "error" ? "chip-err" : "chip-warn"}`}>{t(tr.compatState === "ready" ? "admin.compatReady" : tr.compatState === "disabled" ? "admin.compatOff" : tr.compatState === "error" ? "admin.compatError" : "admin.compatPending")}</span>}
                    {tr.lyricsState && <span className={`chip ml-1.5 !py-0 ${tr.lyricsState === "ready" ? "chip-ok" : tr.lyricsState === "error" ? "chip-err" : tr.lyricsState === "empty" ? "" : "chip-accent"}`}>{t(`lyrics.s.${tr.lyricsState}` as Key)}</span>}</p>
                </div>
                <button className="icon-btn !h-8 !w-8 text-muted" disabled={i === 0 || tracks[i - 1].discNo !== tr.discNo} onClick={() => void move(i, -1)} aria-label={t("queue.moveUp", { title: tr.title })}><IUp size={16} /></button>
                <button className="icon-btn !h-8 !w-8 text-muted" disabled={i === tracks.length - 1 || tracks[i + 1].discNo !== tr.discNo} onClick={() => void move(i, 1)} aria-label={t("queue.moveDown", { title: tr.title })}><IDown size={16} /></button>
                <button className="icon-btn !h-8 !w-8 text-muted" onClick={() => setLyEdit(tr)} aria-label={`${t("lyrics.editTitle")} : ${tr.title}`}><ILyrics size={16} /></button>
                <button className="icon-btn !h-8 !w-8 text-muted" onClick={() => setEdit([tr])} aria-label={`${t("admin.editTrack")} : ${tr.title}`}><IEdit size={16} /></button>
              </li>))}</ol>
          </>)}</Async>
        </div>
      )}
      {edit && <TrackEditor tracks={edit} onClose={() => setEdit(null)} onSaved={changed} />}
      {lyReq && <LyricsRequest tracks={lyReq} onClose={() => setLyReq(null)} onDone={res.reload} />}
      {lyEdit && <LyricsEditor track={lyEdit} onClose={() => setLyEdit(null)} onSaved={res.reload} />}
      {editAlbum && <AlbumEditor album={album} onClose={() => setEditAlbum(false)} onSaved={changed} />}
      <Confirm open={!!del} onClose={() => setDel(null)} onConfirm={doDelete} busy={busy} danger title={t(del?.kind === "album" ? "admin.deleteAlbum" : "admin.deleteTracks")} confirmLabel={t("admin.deleteForever")}
        body={<>
          <p>{del?.kind === "album" ? t("admin.deleteAlbumBody", { title: album.title, n: album.trackCount }) : t("admin.deleteTracksBody", { n: del?.kind === "tracks" ? del.tracks.length : 0 })}</p>
          {del?.kind === "tracks" && <ul className="mt-2 max-h-40 list-disc overflow-y-auto pl-5 text-ink">{del.tracks.map((x) => <li key={x.id}>{x.title}</li>)}</ul>}
          <p className="mt-3 font-semibold text-danger">{t("admin.deleteWarning")}</p>
        </>} />
    </li>
  );
}

export function LibraryPanel({ focusAlbum }: { focusAlbum: string | null }) {
  const t = useT();
  const res = useApi<Paged<Album>>("/api/v1/library/albums?sort=artist&limit=100");
  const [open, setOpen] = useState<string | null>(focusAlbum);
  const [q, setQ] = useState("");
  useEffect(() => { if (focusAlbum && res.data) document.getElementById(`adm-album-${focusAlbum}`)?.scrollIntoView({ block: "center" }); }, [focusAlbum, res.data]);
  return (
    <div className="max-w-4xl">
      <div className="mb-3"><label htmlFor="adm-q" className="sr-only">{t("admin.filterAlbums")}</label><input id="adm-q" type="search" className="input max-w-sm" placeholder={t("admin.filterAlbums")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <Async res={res}>{(d) => {
        const n = q.trim().toLowerCase();
        const items = n ? d.items.filter((a) => `${a.title} ${a.artist.name}`.toLowerCase().includes(n)) : d.items;
        return items.length === 0 ? <Empty title={t(d.items.length ? "admin.noMatch" : "lib.empty")} /> : (<>
          <ul className="card divide-y divide-line">{items.map((a) => <AlbumRow key={a.id} album={a} open={open === a.id} onToggle={() => setOpen(open === a.id ? null : a.id)} onChanged={res.reload} />)}</ul>
          {d.total > d.items.length && <p className="mt-3 text-center text-xs text-muted">{t("fav.more", { shown: d.items.length, total: d.total })}</p>}
        </>);
      }}</Async>
    </div>
  );
}
