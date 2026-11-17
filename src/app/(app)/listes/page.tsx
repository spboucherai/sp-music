"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client-api";
import type { Playlist } from "@/lib/types";
import { useT } from "@/i18n";
import { Async, Empty, Grid, GridSkeleton, PageHeader, PlaylistCard, Sheet, useApi, useErrorText, useToast } from "@/components/ui";
import { IList, IPlus } from "@/components/icons";

export default function PlaylistsPage() {
  const t = useT(); const router = useRouter(); const toast = useToast(); const text = useErrorText();
  const res = useApi<{ items: Playlist[] }>("/api/v1/library/playlists");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const create = async () => {
    try { const r = await api<{ id: string }>("/api/v1/library/playlists", { body: { name: name.trim() } }); setOpen(false); setName(""); router.push(`/listes/${r.id}`); }
    catch (e) { toast(text(e), "error"); }
  };
  const newBtn = <button className="btn btn-primary" onClick={() => setOpen(true)}><IPlus size={16} />{t("playlist.new")}</button>;
  return (
    <>
      <PageHeader title={t("playlist.title")}>{newBtn}</PageHeader>
      <Async res={res} skeleton={<GridSkeleton />}>{(d) => d.items.length === 0
        ? <Empty icon={<IList size={28} />} title={t("playlist.emptyTitle")} body={t("playlist.emptyBody")} action={newBtn} />
        : <Grid>{d.items.map((p) => <PlaylistCard key={p.id} playlist={p} />)}</Grid>}</Async>
      <Sheet open={open} onClose={() => setOpen(false)} title={t("playlist.new")}>
        <form onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <label className="label" htmlFor="pl-name">{t("playlist.name")}</label>
          <input id="pl-name" className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} data-autofocus />
          <div className="mt-4 flex justify-end gap-2"><button type="button" className="btn" onClick={() => setOpen(false)}>{t("common.cancel")}</button><button className="btn btn-primary" disabled={!name.trim()}>{t("common.create")}</button></div>
        </form>
      </Sheet>
    </>
  );
}
