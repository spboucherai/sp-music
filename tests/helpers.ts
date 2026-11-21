/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Music SP
 * File             : tests/helpers.ts
 * Module           : tests
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

import { readFileSync } from "node:fs";
import postgres from "postgres";
import { SoftAuthenticator, type Tamper } from "./webauthn";

export const BASE = process.env.TEST_BASE_URL ?? "http://localhost:8691";
export const FIX = process.env.TEST_FIXTURES!;
export const STORAGE = process.env.STORAGE_ROOT!;
export const sql = postgres(process.env.DATABASE_URL!, { max: 2, onnotice: () => {} });
export const fixture = (name: string) => readFileSync(`${FIX}/${name}`);
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let ipSeq = 0;

/** One browser: its own cookie jar, CSRF token, client address and authenticator. */
export class Client {
  cookie = ""; csrf = "";
  ip = `10.9.${Math.floor(Math.random() * 250)}.${++ipSeq % 250}`;
  auth = new SoftAuthenticator(BASE, new URL(BASE).hostname);

  async req(path: string, init: { method?: string; json?: unknown; raw?: Buffer | Uint8Array; headers?: Record<string, string>; noCsrf?: boolean; redirect?: RequestRedirect } = {}) {
    const method = init.method ?? (init.json !== undefined || init.raw ? "POST" : "GET");
    const headers: Record<string, string> = { "X-Forwarded-For": this.ip, ...(this.cookie ? { Cookie: this.cookie } : {}) };
    if (method !== "GET" && method !== "HEAD") { headers.Origin = BASE; if (this.csrf && !init.noCsrf) headers["X-CSRF-Token"] = this.csrf; }
    if (init.json !== undefined) headers["Content-Type"] = "application/json";
    if (init.raw) headers["Content-Type"] = "application/octet-stream";
    const res = await fetch(BASE + path, { method, headers: { ...headers, ...(init.headers ?? {}) }, body: init.raw ? new Uint8Array(init.raw) : init.json !== undefined ? JSON.stringify(init.json) : undefined, redirect: init.redirect ?? "manual" });
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) { const [pair] = c.split(";"); if (pair.startsWith("spmusic_session=")) this.cookie = pair.endsWith("=") ? "" : pair; }
    return res;
  }
  async json<T = Record<string, unknown>>(path: string, init: Parameters<Client["req"]>[1] = {}): Promise<{ status: number; body: T & { error?: { code: string; details?: Record<string, unknown> } } }> {
    const res = await this.req(path, init);
    const text = await res.text();
    let body: unknown = null; try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text.slice(0, 200) }; }
    return { status: res.status, body: body as never };
  }
  async refreshSession() {
    const s = await this.json<{ authenticated: boolean; csrfToken?: string; user?: { id: string; role: string } }>("/api/v1/auth/session");
    this.csrf = s.body.csrfToken ?? "";
    return s.body;
  }
  /** Enrols a passkey with a one-time token (owner setup, invitation, recovery). */
  async enrol(setupToken: string, tamper: Tamper = {}) {
    const o = await this.json<{ challengeId: string; options: { challenge: string; user: { id: string } } }>("/api/v1/auth/register/options", { json: { setupToken } });
    if (o.status !== 200) return { status: o.status, body: o.body as Record<string, unknown> & { error?: { code: string } }, challengeId: "", response: null as unknown };
    const response = this.auth.create(o.body.options, tamper);
    const v = await this.json<{ recoveryCodes: string[] | null }>("/api/v1/auth/register/verify", { json: { challengeId: o.body.challengeId, response, name: "Test device", setupToken } });
    if (v.status === 200) await this.refreshSession();
    return { status: v.status, body: v.body, challengeId: o.body.challengeId, response };
  }
  async login(credentialId?: string, tamper: Tamper = {}) {
    const o = await this.json<{ challengeId: string; options: { challenge: string } }>("/api/v1/auth/login/options", { json: {} });
    const response = this.auth.get(o.body.options, credentialId, tamper);
    const v = await this.json("/api/v1/auth/login/verify", { json: { challengeId: o.body.challengeId, response } });
    if (v.status === 200) await this.refreshSession();
    return { status: v.status, body: v.body, challengeId: o.body.challengeId, response };
  }
  /** Chunked upload, then waits for the worker's verdict. */
   
  async upload(name: string, data: Buffer, chunk = 256 * 1024): Promise<{ status: number; id: string; body: Record<string, any> }> {
    const c = await this.json<{ id: string }>("/api/v1/admin/uploads", { json: { filename: name, size: data.length } });
    if (c.status !== 200) return { status: c.status, body: c.body, id: "" };
    for (let off = 0; off < data.length; off += chunk) {
      const r = await this.json(`/api/v1/admin/uploads/${c.body.id}?offset=${off}`, { method: "PATCH", raw: data.subarray(off, off + chunk) });
      if (r.status !== 200) return { status: r.status, body: r.body, id: c.body.id };
    }
    return { status: 200, id: c.body.id, body: await this.waitUpload(c.body.id) };
  }
  async waitUpload(id: string, timeoutMs = 60_000) {
    const t0 = Date.now();
    for (;;) {
      const u = await this.json<{ status: string; errorCode: string | null; trackId: string | null; duplicateOf: string | null; errorDetail: string | null }>(`/api/v1/admin/uploads/${id}`);
      if (["ready", "error", "duplicate", "cancelled"].includes(u.body.status)) return u.body;
      if (Date.now() - t0 > timeoutMs) throw new Error(`upload ${id} still ${u.body.status}`);
      await sleep(300);
    }
  }
}

export function setupTokenFromFile(): string {
  const url = readFileSync(process.env.SETUP_URL_FILE!, "utf8").trim();
  return url.split("#")[1];
}
export const tokenOf = (inviteUrl: string) => inviteUrl.split("#")[1];
