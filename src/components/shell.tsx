/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Music SP
 * File             : src/components/shell.tsx
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
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { setCsrf } from "@/lib/client-api";
import type { Me } from "@/lib/types";
import { I18nProvider, useT } from "@/i18n";
import type { Key } from "@/i18n/messages";
import { PlayerProvider, useCurrentTrack, usePlayerActions } from "./player";
import { NowPlaying, PlayerBar, type PlayerTab } from "./player-ui";
import { MeProvider, ToastProvider, TrackMenuProvider } from "./ui";
import { IGear, IHeart, IHome, ILibrary, IList, ILogo, ISearch, IUser } from "./icons";

const NAV: { href: string; key: Key; icon: (p: { size?: number }) => ReactNode; match: RegExp }[] = [
  { href: "/", key: "nav.listen", icon: IHome, match: /^\/$/ },
  { href: "/recherche", key: "nav.search", icon: ISearch, match: /^\/recherche/ },
  { href: "/bibliotheque", key: "nav.library", icon: ILibrary, match: /^\/(bibliotheque|album|artiste)/ },
  { href: "/listes", key: "nav.playlists", icon: IList, match: /^\/listes/ },
  { href: "/favoris", key: "nav.favorites", icon: IHeart, match: /^\/favoris/ },
];

function Chrome({ me, children }: { me: Me; children: ReactNode }) {
  const t = useT();
  const path = usePathname();
  const track = useCurrentTrack();
  const actions = usePlayerActions();
  const [sheet, setSheet] = useState<{ open: boolean; tab: PlayerTab }>({ open: false, tab: "now" });
  const close = useCallback(() => setSheet((s) => ({ ...s, open: false })), []);
  useEffect(() => { close(); }, [path, close]);
  // Space bar toggles playback when no control or field has the focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.code !== "Space" || e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(el.tagName) || el.isContentEditable) return;
      e.preventDefault(); actions.toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [actions]);
  const hasPlayer = !!track;
  return (
    <div className="min-h-dvh" style={{ "--toast-b": hasPlayer ? "150px" : "80px" } as React.CSSProperties}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[90] focus:rounded-lg focus:bg-ink focus:px-3 focus:py-2 focus:text-bg">{t("nav.skip")}</a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-line bg-surface lg:flex" style={{ width: "var(--sidebar-w)", paddingBottom: hasPlayer ? "var(--playerbar-h)" : 0 }}>
        <Link href="/" className="flex items-center gap-2.5 px-5 py-5"><ILogo size={30} /><span className="text-lg font-extrabold tracking-tight">Music <span className="brand-text">SP</span></span></Link>
        <nav className="flex-1 space-y-0.5 px-3" aria-label={t("nav.main")}>
          {NAV.map((n) => { const on = n.match.test(path); return (
            <Link key={n.href} href={n.href} aria-current={on ? "page" : undefined} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold ${on ? "bg-raised text-accent" : "text-muted hover:bg-hover hover:text-ink"}`}><n.icon size={20} />{t(n.key)}</Link>); })}
        </nav>
        <div className="space-y-0.5 border-t border-line p-3">
          {me.role === "admin" && <Link href="/admin" aria-current={path.startsWith("/admin") ? "page" : undefined} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold ${path.startsWith("/admin") ? "bg-raised text-accent" : "text-muted hover:bg-hover hover:text-ink"}`}><IGear size={20} />{t("nav.admin")}</Link>}
          <Link href="/compte" aria-current={path.startsWith("/compte") ? "page" : undefined} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold ${path.startsWith("/compte") ? "bg-raised text-accent" : "text-muted hover:bg-hover hover:text-ink"}`}><IUser size={20} /><span className="truncate">{me.displayName}</span></Link>
        </div>
      </aside>

      {/* Phone header */}
      <header className="glass sticky top-0 z-30 flex items-center justify-between border-b border-line px-4 lg:hidden" style={{ paddingTop: "var(--safe-t)", height: "calc(52px + var(--safe-t))" }}>
        <Link href="/" className="flex items-center gap-2"><ILogo size={26} /><span className="text-base font-extrabold tracking-tight">Music <span className="brand-text">SP</span></span></Link>
        <div className="flex items-center">
          {me.role === "admin" && <Link href="/admin" className="icon-btn" aria-label={t("nav.admin")}><IGear size={21} /></Link>}
          <Link href="/compte" className="icon-btn" aria-label={t("nav.account")}><IUser size={21} /></Link>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="mx-auto max-w-[1400px] px-4 pt-5 outline-none sm:px-6 lg:pt-8"
        style={{ paddingBottom: `calc(${hasPlayer ? "var(--mini-h) + 28px + " : "12px + "}var(--tabbar-h) + var(--safe-b))` }}>
        <div className="lg:pl-[var(--sidebar-w)]"><div className="lg:pl-4">{children}</div></div>
        <div className="hidden lg:block" style={{ height: hasPlayer ? "var(--playerbar-h)" : 0 }} />
      </main>

      <PlayerBar onOpen={(tab) => setSheet({ open: true, tab })} />
      <NowPlaying open={sheet.open} tab={sheet.tab} onTab={(tab) => setSheet({ open: true, tab })} onClose={close} />

      {/* Phone tab bar */}
      <nav className="glass fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line lg:hidden" style={{ height: "calc(var(--tabbar-h) + var(--safe-b))", paddingBottom: "var(--safe-b)" }} aria-label={t("nav.main")}>
        {NAV.map((n) => { const on = n.match.test(path); return (
          <Link key={n.href} href={n.href} aria-current={on ? "page" : undefined} className={`flex flex-col items-center justify-center gap-0.5 text-[0.66rem] font-semibold ${on ? "text-accent" : "text-muted"}`}><n.icon size={22} /><span>{t(n.key)}</span></Link>); })}
      </nav>
    </div>
  );
}

export function AppShell({ me, csrfToken, children }: { me: Me; csrfToken: string; children: ReactNode }) {
  setCsrf(csrfToken);
  return (
    <I18nProvider locale={me.locale}>
      <MeProvider value={me}>
        <ToastProvider>
          <PlayerProvider>
            <TrackMenuProvider>
              <Chrome me={me}>{children}</Chrome>
            </TrackMenuProvider>
          </PlayerProvider>
        </ToastProvider>
      </MeProvider>
    </I18nProvider>
  );
}
