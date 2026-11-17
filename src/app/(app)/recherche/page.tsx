"use client";
import { useEffect, useState } from "react";
import type { Album, Artist, Track } from "@/lib/types";
import { useT } from "@/i18n";
import { AlbumCard, ArtistCard, Async, Empty, PageHeader, Section, TrackList, useApi } from "@/components/ui";
import { IClose, ISearch } from "@/components/icons";

export default function SearchPage() {
  const t = useT();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => { const id = setTimeout(() => setDebounced(q.trim()), 220); return () => clearTimeout(id); }, [q]);
  const res = useApi<{ artists: Artist[]; albums: Album[]; tracks: Track[] }>(debounced ? `/api/v1/library/search?q=${encodeURIComponent(debounced)}` : null);
  return (
    <>
      <PageHeader title={t("search.title")} />
      <form role="search" className="relative mb-6 max-w-xl" onSubmit={(e) => e.preventDefault()}>
        <label htmlFor="q" className="sr-only">{t("search.placeholder")}</label>
        <ISearch size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
        <input id="q" type="search" className="input !rounded-full !pl-10 !pr-10" placeholder={t("search.placeholder")} value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" autoCorrect="off" enterKeyHint="search" autoFocus />
        {q && <button type="button" className="icon-btn absolute right-0.5 top-1/2 !h-9 !w-9 -translate-y-1/2 text-muted" onClick={() => setQ("")} aria-label={t("search.clear")}><IClose size={16} /></button>}
      </form>
      {!debounced ? <Empty icon={<ISearch size={28} />} title={t("search.hintTitle")} body={t("search.hintBody")} /> : (
        <Async res={res}>{(d) => d.artists.length + d.albums.length + d.tracks.length === 0 ? <Empty icon={<ISearch size={28} />} title={t("search.noneTitle", { q: debounced })} body={t("search.noneBody")} /> : (
          <div aria-live="polite">
            {d.artists.length > 0 && <Section title={t("lib.artists")}><div className="scroll-x -mx-4 px-4 sm:mx-0 sm:px-0">{d.artists.map((a) => <ArtistCard key={a.id} artist={a} className="w-28 sm:w-36" />)}</div></Section>}
            {d.albums.length > 0 && <Section title={t("lib.albums")}><div className="scroll-x -mx-4 px-4 sm:mx-0 sm:px-0">{d.albums.map((a) => <AlbumCard key={a.id} album={a} className="w-36 sm:w-44" />)}</div></Section>}
            {d.tracks.length > 0 && <Section title={t("lib.tracks")}><TrackList tracks={d.tracks} /></Section>}
          </div>)}</Async>
      )}
    </>
  );
}
