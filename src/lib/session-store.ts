/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Music SP
 * File             : src/lib/session-store.ts
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

import { sql } from "./db";
import { sha256 } from "./crypto";

/** Session lookup without any Next.js import, so the native media server can use it too. */
export const SESSION_COOKIE = "spmusic_session";
export type Role = "admin" | "listener";
export interface UserContext { userId: string; email: string; displayName: string; role: Role; isOwner: boolean; locale: "fr" | "en"; accent: string; sessionId: string; csrfToken: string }

/** Session lookup from a raw cookie value. Used by Next (through cookies()) and by the native media server. */
export async function userFromToken(token: string | undefined | null): Promise<UserContext | null> {
  if (!token) return null;
  const [row] = await sql<{ id: string; user_id: string; csrf_token: string; email: string; display_name: string; role: Role; is_owner: boolean; locale: "fr" | "en"; accent: string; last_seen_at: Date }[]>`
    SELECT s.id, s.user_id, s.csrf_token, u.email, u.display_name, u.role, u.is_owner, u.locale, u.accent, s.last_seen_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${sha256(token)} AND s.revoked_at IS NULL AND s.expires_at > now() AND u.disabled_at IS NULL`;
  if (!row) return null;
  if (Date.now() - new Date(row.last_seen_at).getTime() > 60_000) await sql`UPDATE sessions SET last_seen_at = now() WHERE id = ${row.id}`;
  return { userId: row.user_id, email: row.email, displayName: row.display_name, role: row.role, isOwner: row.is_owner, locale: row.locale, accent: row.accent, sessionId: row.id, csrfToken: row.csrf_token };
}

