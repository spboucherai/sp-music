"use client";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import type { Track } from "@/lib/types";
import { fmtDuration } from "@/lib/format";
import { useLocale, useT } from "@/i18n";
import { Async, Confirm, Empty, Mosaic, PlayButtons, Sheet, TrackList, useApi, useErrorText, useToast } from "@/components/ui";
import { IEdit, IList, ITrash } from "@/components/icons";

export default function PlaylistPage() {
  const { id } = useParams<{ id: string }>();
  const t = useT(); const locale = useLocale(); const router = useRouter(); const toast = useToast(); const text = useErrorText();
  const res = useApi<{ playlist: { id: string; name: string }; tracks: (Track & { entryId: string })[] }>(`/api/v1/library/playlists/${id}`);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState("");
  const plName = res.data?.playlist.name;
  useEffect(() => { if (plName) { document.title = `${plName} · Music SP`; setName(plName); } }, [plName]);

  const reorder = async (tracks: (Track & { entryId: string })[]) => {
    const before = res.data!.tracks;
    res.setData((d) => ({ ...d, tracks }));
    try { await api(`/api/v1/library/playlists/${id}/order`, { method: "PUT", body: { entryIds: tracks.map((x) => x.entryId) } }); }
    catch (e) { res.setData((d) => ({ ...d, tracks: before })); toast(text(e), "error"); }
  };
  const rename = async () => {
    try { await api(`/api/v1/library/playlists/${id}`, { method: "PATCH", body: { name: name.trim() } }); res.setData((d) => ({ ...d, playlist: { ...d.playlist, name: name.trim() } })); setRenaming(false); }
    catch (e) { toast(text(e), "error"); }
  };
  const remove = async () => {
    try { await api(`/api/v1/library/playlists/${id}`, { method: "DELETE" }); router.replace("/listes"); }
    catch (e) { toast(text(e), "error"); }
  };
  return (
    <Async res={res}>{({ playlist, tracks }) => {
      const arts = Array.from(new Set(tracks.map((x) => x.album.artworkId).filter((x): x is string => !!x)));
      return (
        <article>
          <header className="mb-6 flex flex-col items-center gap-5 text-center sm:flex-row sm:items-end sm:text-left">
            <Mosaic artworkIds={arts} seed={playlist.name} className="w-52 flex-none shadow-2xl shadow-black/60" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold uppercase tracking-widest text-faint">{t("playlist.label")}</p>
              <h1 className="h-page mt-1 break-words">{playlist.name}</h1>
              <p className="mt-1 text-sm text-muted">{t(tracks.length === 1 ? "count.track" : "count.tracks", { n: tracks.length })}{tracks.length ? ` · ${fmtDuration(tracks.reduce((s, x) => s + x.durationMs, 0), locale)}` : ""}</p>
              <div className="mt-4 flex items-center justify-center gap-2 sm:justify-start">
                <PlayButtons tracks={tracks} className="flex-1 sm:flex-none" />
                <button className="icon-btn" onClick={() => setRenaming(true)} aria-label={t("playlist.rename")} title={t("playlist.rename")}><IEdit size={20} /></button>
                <button className="icon-btn" onClick={() => setDeleting(true)} aria-label={t("playlist.delete")} title={t("playlist.delete")}><ITrash size={20} /></button>
              </div>
            </div>
          </header>
          {tracks.length === 0 ? <Empty icon={<IList size={28} />} title={t("playlist.noTracksTitle")} body={t("playlist.noTracksBody")} /> : (
            <TrackList tracks={tracks} extraMenu={(_tr, i) => [
              ...(i > 0 ? [{ label: t("playlist.moveUp"), onSelect: () => { const x = tracks.slice(); [x[i - 1], x[i]] = [x[i], x[i - 1]]; void reorder(x); } }] : []),
              ...(i < tracks.length - 1 ? [{ label: t("playlist.moveDown"), onSelect: () => { const x = tracks.slice(); [x[i + 1], x[i]] = [x[i], x[i + 1]]; void reorder(x); } }] : []),
              { label: t("playlist.removeTrack"), danger: true, onSelect: () => void reorder(tracks.filter((_, k) => k !== i)) },
            ]} />
          )}
          <Sheet open={renaming} onClose={() => setRenaming(false)} title={t("playlist.rename")}>
            <form onSubmit={(e) => { e.preventDefault(); void rename(); }}>
              <label className="label" htmlFor="pl-rename">{t("playlist.name")}</label>
              <input id="pl-rename" className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} data-autofocus />
              <div className="mt-4 flex justify-end gap-2"><button type="button" className="btn" onClick={() => setRenaming(false)}>{t("common.cancel")}</button><button className="btn btn-primary" disabled={!name.trim()}>{t("common.save")}</button></div>
            </form>
          </Sheet>
          <Confirm open={deleting} onClose={() => setDeleting(false)} onConfirm={remove} danger title={t("playlist.delete")} confirmLabel={t("common.delete")} body={t("playlist.deleteBody", { name: playlist.name })} />
        </article>
      );
    }}</Async>
  );
}
