"use client";
import { useParams } from "next/navigation";
import { useEffect } from "react";
import type { Album, Artist, Track } from "@/lib/types";
import { useT } from "@/i18n";
import { AlbumCard, Artwork, Async, Grid, PlayButtons, Section, TrackList, useApi } from "@/components/ui";

export default function ArtistPage() {
  const { id } = useParams<{ id: string }>();
  const t = useT();
  const res = useApi<{ artist: Artist; albums: Album[]; tracks: Track[] }>(`/api/v1/library/artists/${id}`);
  const name = res.data?.artist.name;
  useEffect(() => { if (name) document.title = `${name} · Music SP`; }, [name]);
  return (
    <Async res={res}>{({ artist, albums, tracks }) => (
      <article>
        <header className="mb-8 flex flex-col items-center gap-5 text-center sm:flex-row sm:items-end sm:text-left">
          <Artwork artworkId={artist.artworkId} seed={artist.name} size={640} className="w-44 flex-none shadow-2xl shadow-black/60" rounded="rounded-full" priority />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-widest text-faint">{t("artist.label")}</p>
            <h1 className="h-page mt-1 break-words">{artist.name}</h1>
            <p className="mt-1 text-sm text-muted">{t(albums.length === 1 ? "count.album" : "count.albums", { n: albums.length })} · {t(tracks.length === 1 ? "count.track" : "count.tracks", { n: tracks.length })}</p>
            <PlayButtons tracks={tracks} className="mt-4 justify-center sm:justify-start" />
          </div>
        </header>
        {albums.length > 0 && <Section title={t("lib.albums")}><Grid>{albums.map((a) => <AlbumCard key={a.id} album={a} />)}</Grid></Section>}
        {tracks.length > 0 && <Section title={t("lib.tracks")}><TrackList tracks={tracks} /></Section>}
      </article>
    )}</Async>
  );
}
