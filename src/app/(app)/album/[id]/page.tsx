"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect } from "react";
import type { Album, Track } from "@/lib/types";
import { audioInfo, fmtDuration } from "@/lib/format";
import { useLocale, useT } from "@/i18n";
import { Artwork, Async, FavButton, PlayButtons, TrackList, useApi, useFavorite, useMe } from "@/components/ui";
import { IEdit } from "@/components/icons";

export default function AlbumPage() {
  const { id } = useParams<{ id: string }>();
  const t = useT(); const locale = useLocale(); const me = useMe();
  const res = useApi<{ album: Album; tracks: Track[] }>(`/api/v1/library/albums/${id}`);
  const fav = useFavorite();
  const title = res.data?.album.title;
  useEffect(() => { if (title) document.title = `${title} · Music SP`; }, [title]);
  return (
    <Async res={res}>{({ album, tracks }) => {
      const infos = Array.from(new Set(tracks.map((x) => audioInfo(x, locale))));
      return (
        <article>
          <header className="mb-6 flex flex-col items-center gap-5 text-center sm:flex-row sm:items-end sm:text-left">
            <Artwork artworkId={album.artworkId} seed={album.title} size={640} className="w-56 flex-none shadow-2xl shadow-black/60 sm:w-60" rounded="rounded-2xl" priority />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold uppercase tracking-widest text-faint">{t("album.label")}</p>
              <h1 className="h-page mt-1 break-words">{album.title}</h1>
              <p className="mt-1 text-lg font-semibold"><Link href={`/artiste/${album.artist.id}`} className="text-accent hover:underline">{album.artist.name}</Link></p>
              <p className="mt-1 text-sm text-muted">{[album.genre, album.year, t(album.trackCount === 1 ? "count.track" : "count.tracks", { n: album.trackCount }), fmtDuration(album.durationMs, locale)].filter(Boolean).join(" · ")}</p>
              <p className="mt-2 flex flex-wrap justify-center gap-1.5 sm:justify-start">{infos.slice(0, 3).map((i) => <span key={i} className="chip">{i}</span>)}</p>
              <div className="mt-4 flex items-center justify-center gap-2 sm:justify-start">
                <PlayButtons tracks={tracks} className="flex-1 sm:flex-none" />
                <FavButton on={album.favorite} label={t(album.favorite ? "fav.removeAlbum" : "fav.addAlbum")} onToggle={async () => { const on = !album.favorite; res.setData((d) => ({ ...d, album: { ...d.album, favorite: on } })); if (!(await fav("album", album.id, on))) res.setData((d) => ({ ...d, album: { ...d.album, favorite: !on } })); }} />
                {me.role === "admin" && <Link href={`/admin?tab=library&album=${album.id}`} className="icon-btn" aria-label={t("admin.editAlbum")} title={t("admin.editAlbum")}><IEdit size={20} /></Link>}
              </div>
            </div>
          </header>
          <TrackList tracks={tracks} variant="album" showDisc />
        </article>
      );
    }}</Async>
  );
}
