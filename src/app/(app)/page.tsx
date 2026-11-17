"use client";
import Link from "next/link";
import type { Album, Artist, Playlist, Track } from "@/lib/types";
import { useT } from "@/i18n";
import { AlbumCard, ArtistCard, Async, Empty, GridSkeleton, PlaylistCard, Section, TrackList, useApi, useMe } from "@/components/ui";
import { IUpload } from "@/components/icons";

interface Home { recentAlbums: Album[]; artists: Artist[]; recentTracks: Track[]; playlists: Playlist[]; counts: { tracks: number; albums: number; artists: number } }

export default function HomePage() {
  const t = useT(); const me = useMe();
  const res = useApi<Home>("/api/v1/library/home");
  return (
    <>
      <h1 className="h-page mb-6">{t("home.title")}</h1>
      <Async res={res} skeleton={<GridSkeleton />}>{(d) => d.counts.tracks === 0 ? (
        <Empty title={t("home.emptyTitle")} body={t(me.role === "admin" ? "home.emptyAdmin" : "home.emptyListener")}
          action={me.role === "admin" ? <Link href="/admin" className="btn btn-primary"><IUpload size={16} />{t("home.firstUpload")}</Link> : undefined} />
      ) : (
        <>
          <Section title={t("home.recentAlbums")} href="/bibliotheque?tab=albums">
            <div className="scroll-x -mx-4 px-4 sm:mx-0 sm:px-0">{d.recentAlbums.map((a) => <AlbumCard key={a.id} album={a} className="w-36 sm:w-44" />)}</div>
          </Section>
          <Section title={t("home.artists")} href="/bibliotheque?tab=artists">
            <div className="scroll-x -mx-4 px-4 sm:mx-0 sm:px-0">{d.artists.map((a) => <ArtistCard key={a.id} artist={a} className="w-28 sm:w-36" />)}</div>
          </Section>
          {d.playlists.length > 0 && (
            <Section title={t("home.playlists")} href="/listes">
              <div className="scroll-x -mx-4 px-4 sm:mx-0 sm:px-0">{d.playlists.map((p) => <PlaylistCard key={p.id} playlist={p} className="w-36 sm:w-44" />)}</div>
            </Section>
          )}
          <Section title={t("home.recentTracks")} href="/bibliotheque?tab=tracks"><TrackList tracks={d.recentTracks} /></Section>
        </>
      )}</Async>
    </>
  );
}
