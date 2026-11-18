"use client";
import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { api } from "@/lib/client-api";
import { fmtDate } from "@/lib/format";
import { ACCENT_NAMES } from "@/i18n/messages";
import { useLocale, useT } from "@/i18n";
import type { Key } from "@/i18n/messages";
import { authErrorKey, deviceName } from "@/components/auth-forms";
import { Async, Confirm, PageHeader, Sheet, useApi, useErrorText, useMe, useToast } from "@/components/ui";
import { IAlert, IEdit, IKey, IPlus, ISpinner, ITrash } from "@/components/icons";

interface Passkey { id: string; name: string; deviceType: string | null; backedUp: boolean; createdAt: string; lastUsedAt: string | null }
interface Session { id: string; method: string; userAgent: string; ip: string | null; createdAt: string; lastSeenAt: string; current: boolean }

function describeAgent(ua: string): string {
  if (/^SPMusic\//.test(ua)) return `SP Music · ${(ua.match(/\(([^;)]+)/)?.[1] ?? "Mac").slice(0, 40)}`;
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Macintosh/.test(ua) ? "Mac" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  const br = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  return [br, os].filter(Boolean).join(" · ") || ua.slice(0, 40) || "—";
}

function Account() {
  const t = useT(); const locale = useLocale(); const me = useMe(); const toast = useToast(); const text = useErrorText(); const router = useRouter();
  const recovered = useSearchParams().get("recovered") === "1";
  const keys = useApi<{ items: Passkey[] }>("/api/v1/me/passkeys");
  const sessions = useApi<{ items: Session[] }>("/api/v1/me/sessions");
  const codes = useApi<{ remaining: number }>("/api/v1/me/recovery-codes");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [rename, setRename] = useState<Passkey | null>(null);
  const [del, setDel] = useState<Passkey | null>(null);
  const [err, setErr] = useState<Key | null>(null);

  const addPasskey = async () => {
    setBusy(true); setErr(null);
    try {
      const { challengeId, options } = await api<{ challengeId: string; options: never }>("/api/v1/auth/register/options", { body: {} });
      const response = await startRegistration({ optionsJSON: options });
      await api("/api/v1/auth/register/verify", { body: { challengeId, response, name: newName.trim() || deviceName() } });
      setAdding(false); keys.reload(); toast(t("account.passkeyAdded"));
    } catch (e) { setErr(authErrorKey(e)); } finally { setBusy(false); }
  };
  const pref = async (body: Record<string, string>) => {
    try { await api("/api/v1/me/preferences", { method: "PATCH", body }); if (body.accent) document.documentElement.dataset.accent = body.accent; router.refresh(); }
    catch (e) { toast(text(e), "error"); }
  };
  const logout = async () => { try { await api("/api/v1/auth/logout", { method: "POST", body: {} }); } finally { window.location.assign("/login"); } };

  return (
    <div className="max-w-2xl">
      <PageHeader title={t("account.title")} />
      {recovered && <p className="mb-5 flex items-start gap-2 rounded-xl border border-[#57431a] bg-[#261e0d] p-3 text-sm text-warn" role="status"><IAlert size={16} className="mt-0.5 flex-none" />{t("account.recoveredNote")}</p>}

      <section className="card mb-5 p-5">
        <p className="text-lg font-bold">{me.displayName}</p>
        <p className="text-sm text-muted">{me.email}</p>
        <p className="mt-2"><span className={`chip ${me.role === "admin" ? "chip-accent" : ""}`}>{t(me.role === "admin" ? (me.isOwner ? "role.owner" : "role.admin") : "role.listener")}</span></p>
      </section>

      <section className="card mb-5 p-5" aria-labelledby="h-pk">
        <div className="mb-1 flex items-center justify-between gap-3">
          <h2 id="h-pk" className="h-section">{t("account.passkeys")}</h2>
          <button className="btn btn-sm" onClick={() => { setNewName(deviceName()); setErr(null); setAdding(true); }} disabled={typeof window !== "undefined" && !browserSupportsWebAuthn()}><IPlus size={14} />{t("account.addPasskey")}</button>
        </div>
        <p className="mb-3 text-sm leading-relaxed text-muted">{t("account.passkeysHelp")}</p>
        <Async res={keys}>{(d) => (
          <ul className="divide-y divide-line">{d.items.map((k) => (
            <li key={k.id} className="flex items-center gap-3 py-3">
              <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-raised text-accent"><IKey size={18} /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{k.name} {k.backedUp && <span className="chip ml-1">{t("account.synced")}</span>}</p>
                <p className="text-xs text-muted">{t("account.created", { date: fmtDate(k.createdAt, locale, false) })} · {k.lastUsedAt ? t("account.lastUsed", { date: fmtDate(k.lastUsedAt, locale) }) : t("account.neverUsed")}</p>
              </div>
              <button className="icon-btn text-muted" onClick={() => { setNewName(k.name); setRename(k); }} aria-label={t("account.renamePasskey", { name: k.name })}><IEdit size={18} /></button>
              <button className="icon-btn text-muted" onClick={() => setDel(k)} disabled={d.items.length <= 1} title={d.items.length <= 1 ? t("err.last_passkey") : undefined} aria-label={t("account.revokePasskey", { name: k.name })}><ITrash size={18} /></button>
            </li>))}</ul>)}</Async>
        {codes.data && <p className="mt-3 border-t border-line pt-3 text-xs leading-relaxed text-faint">{t("account.recoveryCodes", { n: codes.data.remaining })}</p>}
      </section>

      <section className="card mb-5 p-5" aria-labelledby="h-se">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="h-se" className="h-section">{t("account.sessions")}</h2>
          <button className="btn btn-sm" onClick={async () => { try { const r = await api<{ revoked: number }>("/api/v1/me/sessions/revoke-others", { method: "POST", body: {} }); toast(t("account.revokedN", { n: r.revoked })); sessions.reload(); } catch (e) { toast(text(e), "error"); } }}>{t("account.revokeOthers")}</button>
        </div>
        <Async res={sessions}>{(d) => (
          <ul className="divide-y divide-line">{d.items.map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{describeAgent(s.userAgent)} {s.current && <span className="chip chip-ok ml-1">{t("account.thisDevice")}</span>}</p>
                <p className="text-xs text-muted">{t("account.lastSeen", { date: fmtDate(s.lastSeenAt, locale) })}{s.ip ? ` · ${s.ip}` : ""}</p>
              </div>
              {!s.current && <button className="btn btn-sm" onClick={async () => { try { await api(`/api/v1/me/sessions/${s.id}`, { method: "DELETE" }); sessions.reload(); } catch (e) { toast(text(e), "error"); } }}>{t("account.revoke")}</button>}
            </li>))}</ul>)}</Async>
      </section>

      <section className="card mb-5 p-5" aria-labelledby="h-pr">
        <h2 id="h-pr" className="h-section mb-3">{t("account.preferences")}</h2>
        <fieldset>
          <legend className="label">{t("account.accent")}</legend>
          <div className="flex flex-wrap gap-2.5">{ACCENT_NAMES.map((a) => (
            <button key={a} data-accent={a} aria-pressed={me.accent === a} aria-label={t(`accent.${a}` as Key)} title={t(`accent.${a}` as Key)} onClick={() => pref({ accent: a })}
              className={`h-10 w-10 rounded-full border-2 ${me.accent === a ? "border-ink" : "border-transparent"}`} style={{ background: "linear-gradient(135deg, var(--accent), var(--accent-2))" }} />))}</div>
        </fieldset>
        <div className="mt-4"><label className="label" htmlFor="lang">{t("account.language")}</label>
          <select id="lang" className="input !w-auto" value={me.locale} onChange={(e) => pref({ locale: e.target.value })}><option value="fr">Français</option><option value="en">English</option></select></div>
      </section>

      <section className="card mb-5 p-5 text-sm leading-relaxed text-muted" aria-labelledby="h-pv">
        <h2 id="h-pv" className="h-section mb-2 text-ink">{t("account.privacy")}</h2>
        <p>{t("account.privacyBody")}</p>
      </section>

      <button className="btn w-full sm:w-auto" onClick={logout}>{t("account.logout")}</button>

      <Sheet open={adding} onClose={() => setAdding(false)} title={t("account.addPasskey")}>
        <form onSubmit={(e) => { e.preventDefault(); void addPasskey(); }}>
          <p className="mb-3 text-sm leading-relaxed text-muted">{t("account.addPasskeyBody")}</p>
          <label className="label" htmlFor="npk">{t("auth.passkeyName")}</label>
          <input id="npk" className="input" value={newName} maxLength={60} onChange={(e) => setNewName(e.target.value)} data-autofocus />
          {err && <p className="mt-3 text-sm text-danger" role="alert">{t(err)}</p>}
          <div className="mt-4 flex justify-end gap-2"><button type="button" className="btn" onClick={() => setAdding(false)}>{t("common.cancel")}</button><button className="btn btn-primary" disabled={busy}>{busy ? <ISpinner size={16} /> : <IKey size={16} />}{t("auth.createPasskey")}</button></div>
        </form>
      </Sheet>
      <Sheet open={!!rename} onClose={() => setRename(null)} title={t("account.renameTitle")}>
        <form onSubmit={async (e) => { e.preventDefault(); try { await api(`/api/v1/me/passkeys/${rename!.id}`, { method: "PATCH", body: { name: newName.trim() } }); setRename(null); keys.reload(); } catch (x) { toast(text(x), "error"); } }}>
          <label className="label" htmlFor="rpk">{t("auth.passkeyName")}</label>
          <input id="rpk" className="input" value={newName} maxLength={60} onChange={(e) => setNewName(e.target.value)} data-autofocus />
          <div className="mt-4 flex justify-end gap-2"><button type="button" className="btn" onClick={() => setRename(null)}>{t("common.cancel")}</button><button className="btn btn-primary" disabled={!newName.trim()}>{t("common.save")}</button></div>
        </form>
      </Sheet>
      <Confirm open={!!del} onClose={() => setDel(null)} danger title={t("account.revokeTitle")} confirmLabel={t("account.revoke")} body={t("account.revokeBody", { name: del?.name ?? "" })}
        onConfirm={async () => { try { await api(`/api/v1/me/passkeys/${del!.id}`, { method: "DELETE" }); setDel(null); keys.reload(); toast(t("account.passkeyRevoked")); } catch (e) { toast(text(e), "error"); setDel(null); } }} />
    </div>
  );
}
export default function AccountPage() { return <Suspense><Account /></Suspense>; }
