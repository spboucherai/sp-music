/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Music SP
 * File             : src/app/(app)/listes/page.tsx
 * Module           : app
 * Repository       : https://git.spboucher.ai/sp-music
 * Project Website  : https://music.spboucher.ai
 * Created          : 2026-11-17
 * Last Modified    : 2026-11-17
 *
 * Author           : Simon-Pierre Boucher
 * Position         : Professor of Finance
 * Institution      : Université du Québec en Outaouais (UQO)
 * Organization     : SP Boucher
 * Website          : https://spboucher.ai
 * Git              : https://git.spboucher.ai
 *
 * Preferred Contact: support@spboucher.ai
 * Development      : dev@spboucher.ai
 * Support          : support@spboucher.ai
 * Security/Admin   : admin@spboucher.ai
 *
 * Copyright (c) 2026
 * Simon-Pierre Boucher
 * All rights reserved where applicable. This file is governed by the
 * applicable project license, copyright notices and relevant law.
 * Existing third-party rights and notices remain unaffected.
 *
 * License          : None specified (no license file in this repository)
 *
 * Do not embed credentials, private keys, access tokens,
 * certificates or confidential personal information.
 *
 * =============================================================================
 * END OF SP BOUCHER SOURCE HEADER
 * =============================================================================
 */

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
