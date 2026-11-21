/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Music SP
 * File             : src/i18n/index.tsx
 * Module           : i18n
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
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { M, type Key } from "./messages";

export type Locale = "fr" | "en";
type Vars = Record<string, string | number>;
export type T = (key: Key, vars?: Vars) => string;

export function translate(locale: Locale, key: Key, vars?: Vars): string {
  let s: string = M[key]?.[locale === "en" ? 1 : 0] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

const Ctx = createContext<{ locale: Locale; t: T }>({ locale: "fr", t: (k, v) => translate("fr", k, v) });

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo(() => ({ locale, t: ((k, v) => translate(locale, k, v)) as T }), [locale]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useT = () => useContext(Ctx).t;
export const useLocale = () => useContext(Ctx).locale;
