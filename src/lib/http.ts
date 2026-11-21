/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Music SP
 * File             : src/lib/http.ts
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

import { NextResponse } from "next/server";
import { z } from "zod";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message?: string, public details?: unknown) { super(message ?? code); }
}

export const ok = (data: unknown, init?: ResponseInit) => NextResponse.json(data, { ...init, headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) } });

export function fail(e: unknown): NextResponse {
  if (e instanceof ApiError) return NextResponse.json({ error: { code: e.code, message: e.message, details: e.details } }, { status: e.status, headers: { "Cache-Control": "no-store" } });
  if (e instanceof z.ZodError) return NextResponse.json({ error: { code: "invalid_input", message: "Invalid input", details: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) } }, { status: 400 });
  // Never leak internals; the log line carries no request body.
  console.error("[api] unhandled", e instanceof Error ? `${e.name}: ${e.message}` : String(e));
  return NextResponse.json({ error: { code: "internal", message: "Internal error" } }, { status: 500 });
}

type Ctx<P> = { params: Promise<P> };
export function route<P = Record<string, string>>(fn: (req: Request, params: P) => Promise<Response>) {
  return async (req: Request, ctx: Ctx<P>) => {
    try { return await fn(req, await ctx.params); } catch (e) { return fail(e); }
  };
}

export async function body<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try { raw = await req.json(); } catch { throw new ApiError(400, "invalid_json", "Body must be JSON"); }
  return schema.parse(raw);
}

/** Caddy on the tunnel gateway is the only hop; it sets X-Forwarded-For. */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  return (xff ? xff.split(",")[0].trim() : "") || req.headers.get("x-real-ip") || "local";
}

export const uuid = z.string().uuid();
