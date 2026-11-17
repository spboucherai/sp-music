"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import type { Album, Artist, Paged, Track } from "@/lib/types";
import { useT } from "@/i18n";
import type { Key } from "@/i18n/messages";
import { AlbumCard, ArtistCard, Async, Empty, Grid, GridSkeleton, PageHeader, TrackList, useApi, useErrorText, useToast, type Loaded } from "@/components/ui";
import { ISpinner } from "@/components/icons";

const TABS = ["albums", "artists", "tracks"] as const;
type Tab = (typeof TABS)[number];

/** Appends the next page to an already loaded list. */
function More<T>({ res, path }: { res: Loaded<Paged<T>>; path: string }) {
  const t = useT(); const toast = useToast(); const text = useErrorText();
  const [busy, setBusy] = useState(false);
  const d = res.data;
  if (!d || d.items.length >= d.total) return null;
  const load = async () => {
    setBusy(true);
    try { const next = await api<Paged<T>>(`${path}${path.includes("?") ? "&" : "?"}offset=${d.items.length}`); res.setData((cur) => ({ ...cur, items: [...cur.items, ...next.items], total: next.total })); }
    catch (e) { toast(text(e), "error"); } finally { setBusy(false); }
  };
  return <div className="mt-6 flex justify-center"><button className="btn" onClick={load} disabled={busy}>{busy && <ISpinner size={16} />}{t("common.loadMore", { shown: d.items.length, total: d.total })}</button></div>;
}

function Albums() {
  const t = useT();
  const [sort, setSort] = useState("artist");
  const path = `/api/v1/library/albums?sort=${sort}`;
  const res = useApi<Paged<Album>>(path);
  return (<>
    <div className="mb-4 flex items-center gap-2"><label htmlFor="sort" className="text-xs font-semibold text-muted">{t("lib.sort")}</label>
      <select id="sort" className="input !min-h-9 !w-auto !text-sm" value={sort} onChange={(e) => setSort(e.target.value)}>
        {(["artist", "title", "recent", "year"] as const).map((s) => <option key={s} value={s}>{t(`lib.sort.${s}` as Key)}</option>)}</select></div>
    <Async res={res} skeleton={<GridSkeleton n={12} />}>{(d) => d.items.length === 0 ? <Empty title={t("lib.empty")} /> : <Grid>{d.items.map((a) => <AlbumCard key={a.id} album={a} />)}</Grid>}</Async>
    <More res={res} path={path} />
  </>);
}
function Artists() {
  const t = useT(); const path = "/api/v1/library/artists"; const res = useApi<Paged<Artist>>(path);
  return (<><Async res={res} skeleton={<GridSkeleton n={12} />}>{(d) => d.items.length === 0 ? <Empty title={t("lib.empty")} /> : <Grid>{d.items.map((a) => <ArtistCard key={a.id} artist={a} />)}</Grid>}</Async><More res={res} path={path} /></>);
}
function Tracks() {
  const t = useT(); const path = "/api/v1/library/tracks?sort=artist"; const res = useApi<Paged<Track>>(path);
  return (<><Async res={res}>{(d) => d.items.length === 0 ? <Empty title={t("lib.empty")} /> : <TrackList tracks={d.items} />}</Async><More res={res} path={path} /></>);
}

function Library() {
  const t = useT(); const router = useRouter(); const params = useSearchParams();
  const fromUrl = params.get("tab") as Tab | null;
  const [tab, setTab] = useState<Tab>(fromUrl && TABS.includes(fromUrl) ? fromUrl : "albums");
  useEffect(() => { if (fromUrl && TABS.includes(fromUrl)) setTab(fromUrl); }, [fromUrl]);
  const pick = (k: Tab) => { setTab(k); router.replace(`/bibliotheque?tab=${k}`, { scroll: false }); };
  return (
    <>
      <PageHeader title={t("lib.title")} />
      <div className="mb-5 inline-flex rounded-full border border-line bg-surface p-1" role="tablist" aria-label={t("lib.title")}>
        {TABS.map((k) => <button key={k} role="tab" id={`tab-${k}`} aria-selected={tab === k} aria-controls="lib-panel" onClick={() => pick(k)} className={`rounded-full px-4 py-1.5 text-sm font-bold ${tab === k ? "bg-ink text-bg" : "text-muted hover:text-ink"}`}>{t(`lib.${k}` as Key)}</button>)}
      </div>
      <div id="lib-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>{tab === "albums" ? <Albums /> : tab === "artists" ? <Artists /> : <Tracks />}</div>
    </>
  );
}
export default function LibraryPage() { return <Suspense><Library /></Suspense>; }
