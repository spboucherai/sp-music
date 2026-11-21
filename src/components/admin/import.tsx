/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Music SP
 * File             : src/components/admin/import.tsx
 * Module           : components
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
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiClientError, getCsrf } from "@/lib/client-api";
import { fmtBytes, fmtDate } from "@/lib/format";
import { useLocale, useT } from "@/i18n";
import type { Key } from "@/i18n/messages";
import { Confirm, useApi, useErrorText, useToast } from "@/components/ui";
import { IAlert, ICheck, IClose, IRefresh, ISpinner, IUpload } from "@/components/icons";

/**
 * Import. Files are sent in chunks (resumable): a failed chunk is retried, and a file whose upload broke can be
 * resumed from the offset the server holds. Extensions only pre-filter what is queued; the server decides from
 * the content.
 */
const ACCEPT_RE = /\.(flac|mp3|m4a|aac|wav|aiff?|ogg|opus|dsf|dff|zip)$/i;
const ACCEPT = ".flac,.mp3,.m4a,.aac,.wav,.aif,.aiff,.ogg,.opus,.dsf,.dff,.zip,audio/*";

type Phase = "queued" | "sending" | "sent" | "failed" | "cancelled";
interface Item { key: string; file: File; phase: Phase; sent: number; uploadId?: string; error?: string; xhr?: XMLHttpRequest }
interface Limits { maxFileBytes: number; chunkBytes: number; maxFiles: number; quotaBytes: number }
interface ServerUpload { id: string; filename: string; sizeBytes: number; receivedBytes: number; status: string; errorCode: string | null; errorDetail: string | null; kind: string | null; trackId: string | null; duplicateOf: string | null; parentId: string | null; createdAt: string; trackTitle: string | null }

function sendChunk(url: string, blob: Blob, onProgress: (n: number) => void, bind: (x: XMLHttpRequest) => void): Promise<{ status: number; body: { receivedBytes?: number; complete?: boolean; error?: { code?: string; message?: string; details?: { receivedBytes?: number } } } }> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    bind(x);
    x.open("PATCH", url);
    x.setRequestHeader("Content-Type", "application/octet-stream");
    const csrf = getCsrf(); if (csrf) x.setRequestHeader("X-CSRF-Token", csrf);
    x.upload.onprogress = (e) => onProgress(e.loaded);
    x.onload = () => { let body = {}; try { body = JSON.parse(x.responseText); } catch { /* not JSON */ } resolve({ status: x.status, body }); };
    x.onerror = () => reject(new Error("network"));
    x.onabort = () => reject(new Error("aborted"));
    x.send(blob);
  });
}

async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const entries = Array.from(dt.items).map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e);
  if (entries.length === 0) return Array.from(dt.files);
  const out: File[] = [];
  const walk = async (e: FileSystemEntry): Promise<void> => {
    if (out.length > 5000) return;
    if (e.isFile) out.push(await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej)));
    else if (e.isDirectory) {
      const reader = (e as FileSystemDirectoryEntry).createReader();
      for (;;) { const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej)); if (!batch.length) break; for (const c of batch) await walk(c); }
    }
  };
  for (const e of entries) await walk(e);
  return out;
}

const STATUS_CHIP: Record<string, string> = { ready: "chip-ok", error: "chip-err", duplicate: "chip-warn", cancelled: "", uploading: "", received: "chip-accent", validating: "chip-accent", extracting: "chip-accent" };

export function ImportPanel() {
  const t = useT(); const locale = useLocale(); const toast = useToast(); const text = useErrorText();
  const limits = useApi<Limits>("/api/v1/admin/uploads/limits");
  const [items, setItems] = useState<Item[]>([]);
  const itemsRef = useRef(items); itemsRef.current = items;
  const [over, setOver] = useState(false);
  const [filter, setFilter] = useState<"all" | "active" | "error" | "duplicate" | "ready">("all");
  const server = useApi<{ items: ServerUpload[]; total: number; counts: Record<string, number> }>(`/api/v1/admin/uploads?filter=${filter}&limit=200`);
  const [confirmReplace, setConfirmReplace] = useState<ServerUpload | null>(null);
  const running = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const dirInput = useRef<HTMLInputElement>(null);

  const patch = useCallback((key: string, p: Partial<Item>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x))), []);

  const run = useCallback(async (key: string) => {
    const lim = limits.data; const it = itemsRef.current.find((x) => x.key === key);
    if (!lim || !it) return;
    running.current++;
    try {
      let id = it.uploadId, offset = 0;
      if (id) { try { const u = await api<ServerUpload>(`/api/v1/admin/uploads/${id}`); if (u.status === "uploading") offset = u.receivedBytes; else id = undefined; } catch { id = undefined; } }
      if (!id) { const r = await api<{ id: string }>("/api/v1/admin/uploads", { body: { filename: it.file.name, size: it.file.size } }); id = r.id; }
      patch(key, { phase: "sending", uploadId: id, sent: offset, error: undefined });
      let failures = 0;
      while (offset < it.file.size) {
        if (itemsRef.current.find((x) => x.key === key)?.phase === "cancelled") return;
        const end = Math.min(offset + lim.chunkBytes, it.file.size);
        try {
          const base = offset;
          const r = await sendChunk(`/api/v1/admin/uploads/${id}?offset=${offset}`, it.file.slice(offset, end), (n) => patch(key, { sent: base + n }), (xhr) => patch(key, { xhr }));
          if (r.status === 200 && typeof r.body.receivedBytes === "number") { offset = r.body.receivedBytes; failures = 0; patch(key, { sent: offset }); continue; }
          const expected = r.body.error?.details?.receivedBytes;
          if (r.status === 409 && typeof expected === "number") { offset = expected; continue; }       // resume where the server is
          if (r.status === 401) { window.location.assign("/login"); return; }
          if (r.status >= 500 || r.status === 400) { if (++failures <= 3) { await new Promise((res) => setTimeout(res, 1000 * failures)); continue; } }
          throw new ApiClientError(r.status, r.body.error?.code ?? `http_${r.status}`, r.body.error?.message ?? "");
        } catch (e) {
          if ((e as Error).message === "aborted") return;
          if ((e as Error).message === "network" && ++failures <= 3) { await new Promise((res) => setTimeout(res, 1500 * failures)); continue; }
          throw e;
        }
      }
      patch(key, { phase: "sent", sent: it.file.size, xhr: undefined });
      server.reload();
    } catch (e) {
      patch(key, { phase: "failed", error: (e as Error).message === "network" ? t("err.network") : text(e), xhr: undefined });
    } finally { running.current--; pump(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limits.data, patch, t, text]);

  const pump = useCallback(() => {
    for (const it of itemsRef.current) {
      if (running.current >= 2) break;
      if (it.phase === "queued") { it.phase = "sending"; void run(it.key); }
    }
  }, [run]);
  useEffect(() => { pump(); }, [items, pump]);

  const add = (files: File[]) => {
    const lim = limits.data; if (!lim) return;
    const accepted: Item[] = []; let skipped = 0, tooBig = 0;
    for (const f of files) {
      if (f.name.startsWith(".") || !ACCEPT_RE.test(f.name)) { skipped++; continue; }
      if (f.size > lim.maxFileBytes) { tooBig++; continue; }
      if (f.size === 0) { skipped++; continue; }
      accepted.push({ key: `${f.name}:${f.size}:${f.lastModified}:${Math.random().toString(36).slice(2)}`, file: f, phase: "queued", sent: 0 });
    }
    const room = lim.maxFiles - itemsRef.current.filter((x) => x.phase === "queued" || x.phase === "sending").length;
    if (accepted.length > room) { toast(t("import.tooMany", { n: lim.maxFiles }), "error"); accepted.length = Math.max(0, room); }
    if (tooBig) toast(t("import.tooBig", { n: tooBig, max: fmtBytes(lim.maxFileBytes, locale) }), "error");
    else if (skipped && accepted.length === 0) toast(t("import.noneAccepted"), "error");
    else if (skipped) toast(t("import.skipped", { n: skipped }));
    accepted.sort((a, b) => a.file.name.localeCompare(b.file.name, undefined, { numeric: true }));
    if (accepted.length) setItems((xs) => [...xs, ...accepted]);
  };

  const cancel = async (it: Item) => {
    it.xhr?.abort(); patch(it.key, { phase: "cancelled", xhr: undefined });
    if (it.uploadId) await api(`/api/v1/admin/uploads/${it.uploadId}`, { method: "DELETE" }).catch(() => {});
    server.reload();
  };

  // Poll the server-side list while anything is still being sent or analysed.
  const active = items.some((x) => x.phase === "queued" || x.phase === "sending") || (server.data?.items.some((u) => ["received", "validating", "extracting"].includes(u.status)) ?? false) || ((server.data?.counts.received ?? 0) + (server.data?.counts.validating ?? 0) + (server.data?.counts.extracting ?? 0) > 0);
  useEffect(() => { if (!active) return; const iv = setInterval(server.reload, 2000); return () => clearInterval(iv); }, [active, server.reload]);

  const act = async (path: string, method = "POST") => { try { await api(path, { method, body: method === "POST" ? {} : undefined }); server.reload(); } catch (e) { toast(text(e), "error"); } };
  const local = items.filter((x) => x.phase !== "sent" && x.phase !== "cancelled");
  const counts = server.data?.counts ?? {};

  return (
    <div className="max-w-4xl">
      <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={async (e) => { e.preventDefault(); setOver(false); add(await filesFromDrop(e.dataTransfer)); }}
        className={`rounded-3xl border-2 border-dashed p-8 text-center transition-colors ${over ? "border-accent bg-raised" : "border-line bg-surface"}`}>
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-raised text-accent"><IUpload size={26} /></div>
        <p className="text-base font-bold">{t("import.dropTitle")}</p>
        <p className="mx-auto mt-1 max-w-lg text-sm leading-relaxed text-muted">{t("import.dropBody")}</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button className="btn btn-primary" onClick={() => fileInput.current?.click()} disabled={!limits.data}>{t("import.pickFiles")}</button>
          <button className="btn" onClick={() => dirInput.current?.click()} disabled={!limits.data}>{t("import.pickFolder")}</button>
        </div>
        <input ref={fileInput} type="file" multiple accept={ACCEPT} className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { add(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
        <input ref={dirInput} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} onChange={(e) => { add(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
        {limits.data && <p className="mt-4 text-xs text-faint">{t("import.limits", { max: fmtBytes(limits.data.maxFileBytes, locale), n: limits.data.maxFiles })}{limits.data.quotaBytes ? ` · ${t("import.quota", { q: fmtBytes(limits.data.quotaBytes, locale) })}` : ""}</p>}
        {limits.error && <p className="mt-3 text-sm text-danger" role="alert">{text(limits.error)}</p>}
      </div>

      {local.length > 0 && (
        <section className="mt-6" aria-labelledby="h-sending">
          <h2 id="h-sending" className="h-section mb-2">{t("import.sending")}</h2>
          <ul className="card divide-y divide-line">{local.map((it) => {
            const pct = it.file.size ? Math.round((it.sent / it.file.size) * 100) : 0;
            return (
              <li key={it.key} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{it.file.name}</p>
                  {it.phase === "failed" ? <p className="flex items-center gap-1 text-xs text-danger" role="alert"><IAlert size={12} />{it.error}</p> : (
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t("import.progressOf", { name: it.file.name })}><div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} /></div>
                      <span className="w-24 text-right text-xs tabular-nums text-muted">{it.phase === "queued" ? t("import.waiting") : `${pct} % · ${fmtBytes(it.file.size, locale)}`}</span>
                    </div>)}
                </div>
                {it.phase === "failed" && <button className="btn btn-sm" onClick={() => patch(it.key, { phase: "queued", error: undefined })}><IRefresh size={14} />{t("common.retry")}</button>}
                <button className="icon-btn text-muted" onClick={() => void cancel(it)} aria-label={t("import.cancelOf", { name: it.file.name })}><IClose size={18} /></button>
              </li>);
          })}</ul>
        </section>
      )}

      <section className="mt-8" aria-labelledby="h-imports">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="h-imports" className="h-section">{t("import.history")}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="imp-filter" className="sr-only">{t("import.filter")}</label>
            <select id="imp-filter" className="input !min-h-9 !w-auto !text-sm" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
              <option value="all">{t("import.f.all")}</option>
              <option value="active">{t("import.f.active")} ({(counts.received ?? 0) + (counts.validating ?? 0) + (counts.extracting ?? 0) + (counts.uploading ?? 0)})</option>
              <option value="error">{t("import.f.error")} ({counts.error ?? 0})</option>
              <option value="duplicate">{t("import.f.duplicate")} ({counts.duplicate ?? 0})</option>
              <option value="ready">{t("import.f.ready")} ({counts.ready ?? 0})</option>
            </select>
            <button className="btn btn-sm" onClick={() => void act("/api/v1/admin/uploads/clear")}>{t("import.clear")}</button>
          </div>
        </div>
        {server.data && server.data.items.length === 0 ? <p className="card p-6 text-center text-sm text-muted">{t(filter === "all" ? "import.noneYet" : "import.noneFilter")}</p> : (
          <ul className="card divide-y divide-line" aria-live="polite">{server.data?.items.map((u) => (
            <li key={u.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 ${u.parentId ? "pl-8" : ""}`}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{u.filename}</p>
                <p className="text-xs text-muted">
                  {fmtBytes(u.sizeBytes, locale)} · {fmtDate(u.createdAt, locale)}
                  {u.status === "ready" && u.kind === "zip" ? ` · ${t("import.archiveDone", { n: u.errorDetail ?? "0" })}` : ""}
                  {u.status === "ready" && u.trackTitle ? ` · ${u.trackTitle}` : ""}
                </p>
                {u.status === "error" && <p className="mt-0.5 text-xs text-danger">{t(`import.e.${u.errorCode}` as Key) === `import.e.${u.errorCode}` ? `${t("import.e.generic")} (${u.errorCode})` : t(`import.e.${u.errorCode}` as Key)}</p>}
                {u.status === "duplicate" && <p className="mt-0.5 text-xs text-warn">{t(u.errorCode === "same_file" ? "import.dupSameFile" : "import.dupSameTrack", { title: u.trackTitle ?? "—" })}</p>}
              </div>
              <span className={`chip ${STATUS_CHIP[u.status] ?? ""}`}>
                {["received", "validating", "extracting"].includes(u.status) ? <ISpinner size={12} /> : u.status === "ready" ? <ICheck size={12} /> : null}
                {t(`import.s.${u.status}` as Key)}
              </span>
              {u.status === "error" && <button className="btn btn-sm" onClick={() => void act(`/api/v1/admin/uploads/${u.id}/retry`)}>{t("import.retryAnalysis")}</button>}
              {u.status === "duplicate" && <><button className="btn btn-sm" onClick={() => setConfirmReplace(u)}>{t("import.replace")}</button><button className="btn btn-sm" onClick={() => void act(`/api/v1/admin/uploads/${u.id}`, "DELETE")}>{t("import.ignore")}</button></>}
              {(u.status === "uploading" || u.status === "error") && <button className="icon-btn !h-8 !w-8 text-muted" onClick={() => void act(`/api/v1/admin/uploads/${u.id}`, "DELETE")} aria-label={t("import.cancelOf", { name: u.filename })}><IClose size={16} /></button>}
            </li>))}</ul>
        )}
      </section>
      <Confirm open={!!confirmReplace} onClose={() => setConfirmReplace(null)} danger title={t("import.replaceTitle")} confirmLabel={t("import.replace")}
        body={t(confirmReplace?.errorCode === "same_file" ? "import.replaceBodySame" : "import.replaceBody", { title: confirmReplace?.trackTitle ?? "—" })}
        onConfirm={async () => { const u = confirmReplace!; setConfirmReplace(null); await act(`/api/v1/admin/uploads/${u.id}/replace`); }} />
    </div>
  );
}
