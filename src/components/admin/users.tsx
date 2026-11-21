/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Music SP
 * File             : src/components/admin/users.tsx
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
import { useState } from "react";
import { api } from "@/lib/client-api";
import { fmtDate } from "@/lib/format";
import { useLocale, useT } from "@/i18n";
import { Async, Confirm, Sheet, useApi, useErrorText, useMe, useToast } from "@/components/ui";
import { IPlus, ISpinner } from "@/components/icons";

interface User { id: string; email: string; displayName: string; role: "admin" | "listener"; isOwner: boolean; disabledAt: string | null; createdAt: string; passkeys: number; sessions: number; lastSeenAt: string | null; invitePending: boolean }

export function UsersPanel() {
  const t = useT(); const locale = useLocale(); const me = useMe(); const toast = useToast(); const text = useErrorText();
  const res = useApi<{ items: User[] }>("/api/v1/admin/users");
  const [inviting, setInviting] = useState(false);
  const [f, setF] = useState({ displayName: "", email: "", role: "listener" as "admin" | "listener" });
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<{ url: string; hours: number; name: string } | null>(null);
  const [del, setDel] = useState<User | null>(null);

  const call = async (fn: () => Promise<unknown>, ok?: string) => { try { await fn(); if (ok) toast(ok); res.reload(); } catch (e) { toast(text(e), "error"); } };
  const invite = async () => {
    setBusy(true);
    try { const r = await api<{ inviteUrl: string; expiresInHours: number }>("/api/v1/admin/users", { body: f }); setInviting(false); setLink({ url: r.inviteUrl, hours: r.expiresInHours, name: f.displayName }); setF({ displayName: "", email: "", role: "listener" }); res.reload(); }
    catch (e) { toast(text(e), "error"); } finally { setBusy(false); }
  };
  return (
    <div className="max-w-4xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm leading-relaxed text-muted">{t("users.help")}</p>
        <button className="btn btn-primary" onClick={() => setInviting(true)}><IPlus size={16} />{t("users.invite")}</button>
      </div>
      <Async res={res}>{(d) => (
        <ul className="card divide-y divide-line">{d.items.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{u.displayName}
                <span className={`chip ml-2 ${u.role === "admin" ? "chip-accent" : ""}`}>{t(u.isOwner ? "role.owner" : u.role === "admin" ? "role.admin" : "role.listener")}</span>
                {u.disabledAt && <span className="chip chip-err ml-1">{t("users.disabled")}</span>}
                {u.passkeys === 0 && <span className="chip chip-warn ml-1">{t(u.invitePending ? "users.invitePending" : "users.noPasskey")}</span>}
              </p>
              <p className="truncate text-xs text-muted">{u.email} · {t("users.passkeysN", { n: u.passkeys })} · {u.lastSeenAt ? t("account.lastSeen", { date: fmtDate(u.lastSeenAt, locale) }) : t("users.neverSeen")}</p>
            </div>
            {!u.isOwner && u.id !== me.id && (
              <div className="flex flex-wrap gap-1.5">
                <button className="btn btn-sm" onClick={() => call(() => api(`/api/v1/admin/users/${u.id}`, { method: "PATCH", body: { role: u.role === "admin" ? "listener" : "admin" } }))}>{t(u.role === "admin" ? "users.makeListener" : "users.makeAdmin")}</button>
                <button className="btn btn-sm" onClick={async () => { try { const r = await api<{ inviteUrl: string; expiresInHours: number }>(`/api/v1/admin/users/${u.id}/invite`, { method: "POST", body: {} }); setLink({ url: r.inviteUrl, hours: r.expiresInHours, name: u.displayName }); res.reload(); } catch (e) { toast(text(e), "error"); } }}>{t("users.newLink")}</button>
                <button className="btn btn-sm" disabled={u.sessions === 0} onClick={() => call(() => api(`/api/v1/admin/users/${u.id}/revoke-sessions`, { method: "POST", body: {} }), t("users.sessionsRevoked"))}>{t("users.revokeSessions", { n: u.sessions })}</button>
                <button className="btn btn-sm" onClick={() => call(() => api(`/api/v1/admin/users/${u.id}`, { method: "PATCH", body: { disabled: !u.disabledAt } }))}>{t(u.disabledAt ? "users.enable" : "users.disable")}</button>
                <button className="btn btn-sm btn-danger" onClick={() => setDel(u)}>{t("common.delete")}</button>
              </div>)}
          </li>))}</ul>)}</Async>

      <Sheet open={inviting} onClose={() => setInviting(false)} title={t("users.invite")}>
        <form onSubmit={(e) => { e.preventDefault(); void invite(); }} className="space-y-3">
          <div><label className="label" htmlFor="u-name">{t("users.name")}</label><input id="u-name" className="input" value={f.displayName} maxLength={80} onChange={(e) => setF({ ...f, displayName: e.target.value })} data-autofocus required /></div>
          <div><label className="label" htmlFor="u-email">{t("users.email")}</label><input id="u-email" type="email" className="input" value={f.email} maxLength={200} onChange={(e) => setF({ ...f, email: e.target.value })} required /><p className="mt-1 text-xs text-faint">{t("users.emailHelp")}</p></div>
          <div><label className="label" htmlFor="u-role">{t("users.role")}</label>
            <select id="u-role" className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as "admin" | "listener" })}><option value="listener">{t("role.listener")} — {t("users.roleListenerHelp")}</option><option value="admin">{t("role.admin")} — {t("users.roleAdminHelp")}</option></select></div>
          <div className="flex justify-end gap-2 pt-1"><button type="button" className="btn" onClick={() => setInviting(false)}>{t("common.cancel")}</button><button className="btn btn-primary" disabled={busy || !f.displayName.trim() || !f.email.trim()}>{busy && <ISpinner size={16} />}{t("users.createLink")}</button></div>
        </form>
      </Sheet>
      <Sheet open={!!link} onClose={() => setLink(null)} title={t("users.linkTitle")}>
        <p className="text-sm leading-relaxed text-muted">{t("users.linkBody", { name: link?.name ?? "", hours: link?.hours ?? 0 })}</p>
        <label htmlFor="inv-link" className="sr-only">{t("users.linkTitle")}</label>
        <textarea id="inv-link" readOnly rows={3} className="input mt-3 !h-auto break-all py-2 font-mono !text-xs" value={link?.url ?? ""} onFocus={(e) => e.target.select()} />
        <button className="btn btn-primary mt-3 w-full" onClick={() => navigator.clipboard?.writeText(link?.url ?? "").then(() => toast(t("users.copied"))).catch(() => {})}>{t("users.copy")}</button>
      </Sheet>
      <Confirm open={!!del} onClose={() => setDel(null)} danger title={t("users.deleteTitle")} confirmLabel={t("common.delete")} body={t("users.deleteBody", { name: del?.displayName ?? "" })}
        onConfirm={async () => { const u = del!; setDel(null); await call(() => api(`/api/v1/admin/users/${u.id}`, { method: "DELETE" })); }} />
    </div>
  );
}
