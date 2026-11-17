"use client";
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { useEffect, useState } from "react";
import { api, ApiClientError } from "@/lib/client-api";
import { I18nProvider, useT, type Locale } from "@/i18n";
import type { Key } from "@/i18n/messages";
import { IAlert, ICheck, IKey, ILogo, ISpinner } from "./icons";

/** Suggested name for a new passkey, from the device the browser reports. Editable before saving. */
export function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Macintosh/.test(ua)) return navigator.maxTouchPoints > 1 ? "iPad" : "Mac";
  if (/Android/.test(ua)) return "Android";
  if (/Windows/.test(ua)) return "Windows";
  return "Passkey";
}

/** Maps a WebAuthn / API failure to a sentence. A cancelled system prompt is not an error worth shouting about. */
export function authErrorKey(e: unknown): Key {
  if (e instanceof ApiClientError) {
    if (e.code === "network") return "err.network";
    if (e.code === "rate_limited") return "err.rate_limited";
    if (e.code === "invalid_setup_token") return "auth.err.token";
    if (e.code === "challenge_expired") return "auth.err.challenge";
    if (e.code === "login_failed") return "auth.err.login";
    return "auth.err.generic";
  }
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "AbortError") return "auth.err.cancelled";
  if (name === "InvalidStateError") return "auth.err.exists";
  if (name === "SecurityError") return "auth.err.security";
  return "auth.err.generic";
}

function Frame({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle?: string }) {
  return (
    <main className="relative flex min-h-dvh items-center justify-center px-5 py-10">
      <div className="pointer-events-none absolute inset-0 opacity-50" aria-hidden style={{ background: "radial-gradient(90% 55% at 50% 0%, color-mix(in srgb, var(--accent) 30%, transparent), transparent 70%)" }} />
      <div className="fade-up relative w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center text-center">
          <ILogo size={64} />
          <p className="mt-4 text-2xl font-extrabold tracking-tight">Music <span className="brand-text">SP</span></p>
          <h1 className="mt-5 text-lg font-bold">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm leading-relaxed text-muted">{subtitle}</p>}
        </div>
        {children}
      </div>
    </main>
  );
}

function Unsupported() {
  const t = useT();
  const insecure = typeof window !== "undefined" && !window.isSecureContext;
  return (
    <div className="card p-4 text-sm leading-relaxed" role="alert">
      <p className="flex items-center gap-2 font-bold text-warn"><IAlert size={18} />{t("auth.unsupportedTitle")}</p>
      <p className="mt-2 text-muted">{t(insecure ? "auth.unsupportedInsecure" : "auth.unsupportedBrowser")}</p>
    </div>
  );
}

function LoginInner() {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Key | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [recovery, setRecovery] = useState(false);
  const [code, setCode] = useState("");
  useEffect(() => setSupported(browserSupportsWebAuthn()), []);

  const signIn = async () => {
    setBusy(true); setErr(null);
    try {
      const { challengeId, options } = await api<{ challengeId: string; options: never }>("/api/v1/auth/login/options", { method: "POST", body: {} });
      // The browser shows the system dialog here (Face ID, Touch ID, device code or a nearby phone).
      const response = await startAuthentication({ optionsJSON: options });
      await api("/api/v1/auth/login/verify", { body: { challengeId, response } });
      window.location.assign("/");
    } catch (e) { setErr(authErrorKey(e)); setBusy(false); }
  };
  const submitCode = async () => {
    setBusy(true); setErr(null);
    try { await api("/api/v1/auth/recovery", { body: { code } }); window.location.assign("/compte?recovered=1"); }
    catch (e) { setErr(e instanceof ApiClientError && e.code === "login_failed" ? "auth.err.code" : authErrorKey(e)); setBusy(false); }
  };

  return (
    <Frame title={t("auth.loginTitle")} subtitle={t("auth.loginSubtitle")}>
      {supported === false ? <Unsupported /> : (
        <button className="btn btn-primary w-full !min-h-12 !text-base" onClick={signIn} disabled={busy || supported === null}>{busy && !recovery ? <ISpinner size={18} /> : <IKey size={18} />}{t("auth.signIn")}</button>
      )}
      {err && <p className="mt-3 flex items-start gap-2 rounded-xl border border-[#6b2428] bg-[#2a1214] p-3 text-sm text-[#ffb4b4]" role="alert"><IAlert size={16} className="mt-0.5 flex-none" />{t(err)}</p>}
      <div className="mt-6 text-center">
        {!recovery ? <button className="text-sm font-semibold text-muted underline-offset-4 hover:text-ink hover:underline" onClick={() => setRecovery(true)}>{t("auth.noPasskey")}</button> : (
          <div className="card p-4 text-left">
            <p className="text-sm font-bold">{t("auth.recoveryTitle")}</p>
            <p className="mt-1 text-sm leading-relaxed text-muted">{t("auth.recoveryBody")}</p>
            <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); void submitCode(); }}>
              <label htmlFor="code" className="sr-only">{t("auth.recoveryCode")}</label>
              <input id="code" className="input font-mono" placeholder="xxxx-xxxx-xxxx" autoComplete="one-time-code" autoCapitalize="none" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} />
              <button className="btn" disabled={busy || code.trim().length < 8}>{t("auth.submitCode")}</button>
            </form>
            <p className="mt-3 text-xs leading-relaxed text-faint">{t("auth.recoveryShell")}</p>
          </div>
        )}
      </div>
      <p className="mt-8 text-center text-xs leading-relaxed text-faint">{t("auth.privateNote")}</p>
    </Frame>
  );
}

function SetupInner() {
  const t = useT();
  const [token, setToken] = useState<string | null>(null);
  const [info, setInfo] = useState<{ purpose: "setup" | "recovery" | "invite"; displayName: string; role: string } | null>(null);
  const [phase, setPhase] = useState<"loading" | "invalid" | "ready" | "done">("loading");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Key | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    // The token travels in the URL fragment: it is never sent in a request line, a Referer header or a proxy log.
    const raw = window.location.hash.slice(1);
    setSupported(browserSupportsWebAuthn()); setName(deviceName());
    if (!raw) { setPhase("invalid"); return; }
    setToken(raw);
    api<{ purpose: "setup" | "recovery" | "invite"; displayName: string; role: string }>("/api/v1/auth/setup/info", { body: { setupToken: raw } })
      .then((i) => { setInfo(i); setPhase("ready"); }).catch(() => setPhase("invalid"));
  }, []);

  const enrol = async () => {
    if (!token) return;
    setBusy(true); setErr(null);
    try {
      const { challengeId, options } = await api<{ challengeId: string; options: never }>("/api/v1/auth/register/options", { body: { setupToken: token } });
      const response = await startRegistration({ optionsJSON: options });
      const r = await api<{ recoveryCodes: string[] | null }>("/api/v1/auth/register/verify", { body: { challengeId, response, name: name.trim() || deviceName(), setupToken: token } });
      history.replaceState(null, "", "/setup");
      setCodes(r.recoveryCodes); setPhase("done");
    } catch (e) { const k = authErrorKey(e); setErr(k); if (k === "auth.err.token") setPhase("invalid"); } finally { setBusy(false); }
  };

  if (phase === "loading") return <Frame title={t("auth.setupTitle")}><div className="flex justify-center text-muted"><ISpinner /></div></Frame>;
  if (phase === "invalid") return (
    <Frame title={t("auth.linkInvalidTitle")} subtitle={t("auth.linkInvalidBody")}>
      <a href="/login" className="btn w-full">{t("auth.backToLogin")}</a>
    </Frame>
  );
  if (phase === "done") return (
    <Frame title={t("auth.doneTitle")} subtitle={t("auth.doneBody")}>
      {codes && (
        <div className="card p-4">
          <p className="flex items-center gap-2 text-sm font-bold text-warn"><IAlert size={16} />{t("auth.codesTitle")}</p>
          <p className="mt-1 text-sm leading-relaxed text-muted">{t("auth.codesBody")}</p>
          <ul className="mt-3 grid grid-cols-2 gap-2 font-mono text-sm" aria-label={t("auth.codesTitle")}>{codes.map((c) => <li key={c} className="rounded-lg bg-raised px-2 py-1.5 text-center tracking-wide">{c}</li>)}</ul>
          <button className="btn btn-sm mt-3 w-full" onClick={() => navigator.clipboard?.writeText(codes.join("\n")).catch(() => {})}>{t("auth.copyCodes")}</button>
          <label className="mt-4 flex items-start gap-2.5 text-sm"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--accent)]" checked={saved} onChange={(e) => setSaved(e.target.checked)} /><span>{t("auth.codesSaved")}</span></label>
        </div>
      )}
      <button className="btn btn-primary mt-4 w-full !min-h-12" disabled={!!codes && !saved} onClick={() => window.location.assign("/")}><ICheck size={18} />{t("auth.enter")}</button>
    </Frame>
  );
  return (
    <Frame title={t(info?.purpose === "recovery" ? "auth.recoverTitle" : info?.purpose === "invite" ? "auth.inviteTitle" : "auth.setupTitle")}
      subtitle={t(info?.purpose === "recovery" ? "auth.recoverBody" : "auth.setupBody", { name: info?.displayName ?? "" })}>
      {!supported ? <Unsupported /> : (
        <form onSubmit={(e) => { e.preventDefault(); void enrol(); }}>
          <label className="label" htmlFor="pk-name">{t("auth.passkeyName")}</label>
          <input id="pk-name" className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          <p className="mt-1.5 text-xs text-faint">{t("auth.passkeyNameHint")}</p>
          <button className="btn btn-primary mt-4 w-full !min-h-12 !text-base" disabled={busy}>{busy ? <ISpinner size={18} /> : <IKey size={18} />}{t("auth.createPasskey")}</button>
        </form>
      )}
      {err && <p className="mt-3 flex items-start gap-2 rounded-xl border border-[#6b2428] bg-[#2a1214] p-3 text-sm text-[#ffb4b4]" role="alert"><IAlert size={16} className="mt-0.5 flex-none" />{t(err)}</p>}
      <p className="mt-6 text-center text-xs leading-relaxed text-faint">{t("auth.biometricNote")}</p>
    </Frame>
  );
}

export const LoginForm = ({ locale }: { locale: Locale }) => <I18nProvider locale={locale}><LoginInner /></I18nProvider>;
export const SetupForm = ({ locale }: { locale: Locale }) => <I18nProvider locale={locale}><SetupInner /></I18nProvider>;
