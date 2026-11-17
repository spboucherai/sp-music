"use client";
import type { Album, Track } from "@/lib/types";
import { useT } from "@/i18n";
import { AlbumCard, Async, Empty, PageHeader, PlayButtons, Section, TrackList, useApi } from "@/components/ui";
import { IHeart } from "@/components/icons";

export default function FavoritesPage() {
  const t = useT();
  const res = useApi<{ tracks: Track[]; albums: Album[]; total: number }>("/api/v1/library/favorites?limit=100");
  return (
    <>
      <PageHeader title={t("fav.title")}>{res.data && res.data.tracks.length > 0 && <PlayButtons tracks={res.data.tracks} />}</PageHeader>
      <Async res={res}>{(d) => d.tracks.length + d.albums.length === 0 ? <Empty icon={<IHeart size={28} />} title={t("fav.emptyTitle")} body={t("fav.emptyBody")} /> : (
        <>
          {d.albums.length > 0 && <Section title={t("lib.albums")}><div className="scroll-x -mx-4 px-4 sm:mx-0 sm:px-0">{d.albums.map((a) => <AlbumCard key={a.id} album={a} className="w-36 sm:w-44" />)}</div></Section>}
          {d.tracks.length > 0 && <Section title={t("lib.tracks")}>
            <TrackList tracks={d.tracks} onFavorite={(tr, on) => { if (!on) res.setData((x) => ({ ...x, tracks: x.tracks.filter((y) => y.id !== tr.id) })); }} />
            {d.total > d.tracks.length && <p className="mt-3 text-center text-xs text-muted">{t("fav.more", { shown: d.tracks.length, total: d.total })}</p>}
          </Section>}
        </>)}</Async>
    </>
  );
}
