/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Music SP
 * File             : src/lib/client-api.ts
 * Module           : lib
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

export class ApiClientError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}

let csrf: string | null = null;
export const setCsrf = (t: string | null) => { csrf = t; };
export const getCsrf = () => csrf;

/** JSON fetch against our own API. Network failures surface as code "network". */
export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; raw?: BodyInit; headers?: Record<string, string>; keepalive?: boolean } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? (init.body !== undefined || init.raw !== undefined ? "POST" : "GET"),
      headers: { ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}), ...(csrf ? { "X-CSRF-Token": csrf } : {}), ...(init.headers ?? {}) },
      body: init.raw ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
      credentials: "same-origin", cache: "no-store", keepalive: init.keepalive,
    });
  } catch { throw new ApiClientError(0, "network", "Network error"); }
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    // The session ended (expired or revoked elsewhere): back to the sign-in page.
    if (res.status === 401 && !path.startsWith("/api/v1/auth/") && typeof window !== "undefined" && !/^\/(login|setup)/.test(window.location.pathname)) window.location.assign("/login");
    const e = (data as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiClientError(res.status, e?.code ?? "http_" + res.status, e?.message ?? `HTTP ${res.status}`, e?.details);
  }
  return data as T;
}
