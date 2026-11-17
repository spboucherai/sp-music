"use client";
import { useEffect, useState } from "react";
import { fmtBytes, fmtDate, fmtDuration } from "@/lib/format";
import { useLocale, useT } from "@/i18n";
import type { Key } from "@/i18n/messages";
import { Async, useApi } from "@/components/ui";
import { IRefresh } from "@/components/icons";

interface Health {
  storage: { driver: string; available: boolean; freeBytes: number | null; totalBytes: number | null; usedBytes: number; quotaBytes: number; byKind: { kind: string; files: number; bytes: number }[] };
  library: { tracks: number; albums: number; artists: number; durationMs: number; notPlayableInBrowser: number; renditionsPending: number; renditionErrors: number };
  imports: { counts: Record<string, number>; recentErrors: { id: string; filename: string; errorCode: string; errorDetail: string | null; updatedAt: string }[] };
  worker: { ok: boolean; ageSec: number | null };
  backup: { configured: boolean; last: { at: string; database: boolean; library: boolean; files?: number; bytes?: number } | null };
  config: { renditions: string; renditionBitrateKbps: number; transcodeDsd: boolean; maxFileBytes: number; uploadRetentionDays: number; rpId: string; origin: string };
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "err" }) {
  return <div className="card p-4"><p className="text-xs font-semibold text-muted">{label}</p><p className={`mt-1 text-xl font-extrabold tracking-tight ${tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "err" ? "text-danger" : ""}`}>{value}</p></div>;
}
const Row = ({ k, v }: { k: string; v: string }) => <div className="flex justify-between gap-4 py-1.5 text-sm"><dt className="text-muted">{k}</dt><dd className="text-right font-medium">{v}</dd></div>;

export function HealthPanel() {
  const t = useT(); const locale = useLocale();
  const res = useApi<Health>("/api/v1/admin/health");
  useEffect(() => { const iv = setInterval(res.reload, 15_000); return () => clearInterval(iv); }, [res.reload]);
  return (
    <div className="max-w-4xl">
      <div className="mb-3 flex justify-end"><button className="btn btn-sm" onClick={res.reload}><IRefresh size={14} />{t("health.refresh")}</button></div>
      <Async res={res}>{(h) => {
        const backupAge = h.backup.last ? (Date.now() - new Date(h.backup.last.at).getTime()) / 3600_000 : null;
        const pending = (h.imports.counts.received ?? 0) + (h.imports.counts.validating ?? 0) + (h.imports.counts.extracting ?? 0);
        return (<>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label={t("health.storage")} value={t(h.storage.available ? "health.available" : "health.unavailable")} tone={h.storage.available ? "ok" : "err"} />
            <Stat label={t("health.worker")} value={h.worker.ok ? t("health.running") : t("health.stopped")} tone={h.worker.ok ? "ok" : "err"} />
            <Stat label={t("health.analysis")} value={pending ? t("health.pendingN", { n: pending }) : t("health.idle")} tone={pending ? "warn" : "ok"} />
            <Stat label={t("health.lastBackup")} value={!h.backup.configured ? t("health.backupOff") : h.backup.last ? fmtDate(h.backup.last.at, locale) : t("health.backupNever")} tone={!h.backup.last ? "warn" : backupAge! > 36 ? "warn" : "ok"} />
            <Stat label={t("lib.tracks")} value={String(h.library.tracks)} />
            <Stat label={t("lib.albums")} value={String(h.library.albums)} />
            <Stat label={t("health.used")} value={fmtBytes(h.storage.usedBytes, locale)} />
            <Stat label={t("health.free")} value={fmtBytes(h.storage.freeBytes, locale)} tone={h.storage.freeBytes !== null && h.storage.freeBytes < 5 * 1024 ** 3 ? "warn" : undefined} />
          </div>
          <div className="mt-5 grid gap-5 md:grid-cols-2">
            <section className="card p-5"><h2 className="h-section mb-2">{t("health.library")}</h2><dl className="divide-y divide-line/60">
              <Row k={t("lib.artists")} v={String(h.library.artists)} />
              <Row k={t("health.totalDuration")} v={fmtDuration(h.library.durationMs, locale)} />
              {h.storage.byKind.map((k) => <Row key={k.kind} k={t(`health.kind.${k.kind}` as Key)} v={`${k.files} · ${fmtBytes(k.bytes, locale)}`} />)}
              <Row k={t("health.quota")} v={h.storage.quotaBytes ? fmtBytes(h.storage.quotaBytes, locale) : t("health.noQuota")} />
              <Row k={t("health.volume")} v={`${fmtBytes(h.storage.totalBytes, locale)} (${h.storage.driver})`} />
              <Row k={t("health.notPlayable")} v={String(h.library.notPlayableInBrowser)} />
              <Row k={t("health.renditions")} v={`${t("health.pendingN", { n: h.library.renditionsPending })} · ${t("health.errorsN", { n: h.library.renditionErrors })}`} />
            </dl></section>
            <section className="card p-5"><h2 className="h-section mb-2">{t("health.config")}</h2><dl className="divide-y divide-line/60">
              <Row k={t("health.origin")} v={h.config.origin} />
              <Row k="RP ID (WebAuthn)" v={h.config.rpId} />
              <Row k={t("health.maxFile")} v={fmtBytes(h.config.maxFileBytes, locale)} />
              <Row k={t("health.renditionPolicy")} v={`${h.config.renditions} · AAC ${h.config.renditionBitrateKbps} kb/s`} />
              <Row k="DSD → AAC" v={t(h.config.transcodeDsd ? "common.yes" : "common.no")} />
              <Row k={t("health.retention")} v={t("health.days", { n: h.config.uploadRetentionDays })} />
              <Row k={t("health.backupContent")} v={h.backup.last ? `${h.backup.last.files ?? "?"} ${t("health.originals")} · ${fmtBytes(h.backup.last.bytes ?? null, locale)}` : "—"} />
            </dl>
            <p className="mt-3 text-xs leading-relaxed text-faint">{t("health.retentionNote", { n: h.config.uploadRetentionDays })}</p></section>
          </div>
          <section className="card mt-5 p-5"><h2 className="h-section mb-2">{t("health.errors")}</h2>
            {h.imports.recentErrors.length === 0 ? <p className="text-sm text-muted">{t("health.noErrors")}</p> : (
              <ul className="divide-y divide-line/60">{h.imports.recentErrors.map((e) => <li key={e.id} className="py-2 text-sm"><span className="font-medium">{e.filename}</span> <span className="chip chip-err ml-1">{e.errorCode}</span><span className="block text-xs text-muted">{fmtDate(e.updatedAt, locale)}{e.errorDetail ? ` · ${e.errorDetail}` : ""}</span></li>)}</ul>)}
          </section>
        </>);
      }}</Async>
    </div>
  );
}

interface AuditEvent { id: string; at: string; actor: string; action: string; entity: string; entityId: string; meta: Record<string, unknown>; userName: string | null }
export function AuditPanel() {
  const t = useT(); const locale = useLocale();
  const [offset, setOffset] = useState(0);
  const res = useApi<{ items: AuditEvent[]; total: number; limit: number }>(`/api/v1/admin/audit?limit=50&offset=${offset}`);
  return (
    <div className="max-w-4xl">
      <p className="mb-3 text-sm leading-relaxed text-muted">{t("audit.help")}</p>
      <Async res={res}>{(d) => (<>
        <ul className="card divide-y divide-line">{d.items.map((e) => {
          const meta = Object.entries(e.meta).filter(([, v]) => v != null && v !== "").map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" · ");
          return (
            <li key={e.id} className="px-4 py-2.5 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3"><span className="font-mono text-[0.8rem] font-semibold">{e.action}</span><span className="text-xs text-muted">{fmtDate(e.at, locale)}</span></div>
              <p className="break-words text-xs text-muted">{e.userName ?? e.actor}{meta ? ` · ${meta}` : ""}</p>
            </li>);
        })}</ul>
        <div className="mt-4 flex items-center justify-between text-sm">
          <button className="btn btn-sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - d.limit))}>{t("audit.newer")}</button>
          <span className="text-xs text-muted">{offset + 1}–{Math.min(offset + d.limit, d.total)} / {d.total}</span>
          <button className="btn btn-sm" disabled={offset + d.limit >= d.total} onClick={() => setOffset(offset + d.limit)}>{t("audit.older")}</button>
        </div>
      </>)}</Async>
    </div>
  );
}
