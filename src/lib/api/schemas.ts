/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Music SP
 * File             : src/lib/api/schemas.ts
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

import { z } from "zod";

export const uuid = z.string().uuid();
export const ids = z.array(uuid).min(1).max(500);
const text = (max: number) => z.string().trim().min(1).max(max);
export const year = z.number().int().min(1000).max(2999).nullable();

export function page(url: URL, def = 50, max = 100) {
  const limit = Math.min(max, Math.max(1, Number(url.searchParams.get("limit")) || def));
  const offset = Math.max(0, Math.min(1_000_000, Number(url.searchParams.get("offset")) || 0));
  return { limit: Math.floor(limit), offset: Math.floor(offset) };
}
export function oneOf<T extends string>(url: URL, name: string, values: readonly T[], def: T): T {
  const v = url.searchParams.get(name) as T | null;
  return v && values.includes(v) ? v : def;
}

export const trackPatch = z.object({
  title: text(300).optional(), artist: text(200).optional(), album: text(300).optional(), albumArtist: text(200).optional(),
  trackNo: z.number().int().min(0).max(999).nullable().optional(), discNo: z.number().int().min(1).max(99).optional(),
  year: year.optional(), genre: z.string().trim().max(80).optional(),
}).strict().refine((o) => Object.keys(o).length > 0, "Nothing to change");

export const albumPatch = z.object({ title: text(300).optional(), artist: text(200).optional(), year: year.optional(), genre: z.string().trim().max(80).optional() })
  .strict().refine((o) => Object.keys(o).length > 0, "Nothing to change");

export const playbackState = z.object({
  queue: z.array(uuid).max(2000), index: z.number().int().min(0).max(2000), positionMs: z.number().int().min(0).max(86_400_000),
  shuffle: z.boolean(), repeat: z.enum(["off", "all", "one"]), volume: z.number().min(0).max(1),
}).strict();

export const playlistName = z.object({ name: text(120) }).strict();
export const invite = z.object({ email: z.string().trim().toLowerCase().email().max(200), displayName: text(80), role: z.enum(["admin", "listener"]) }).strict();
export const ACCENTS = ["ember", "violet", "ocean", "forest", "rose", "gold"] as const;
