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
