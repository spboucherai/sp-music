/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Music SP
 * File             : src/lib/audit.ts
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

import { j, sql, type Tx } from "./db";

export interface AuditInput { userId?: string | null; actor: "admin" | "listener" | "system"; action: string; entity?: string; entityId?: string; meta?: Record<string, unknown>; ip?: string | null }

/** Audit trail. `meta` never holds cookies, tokens, recovery codes, WebAuthn challenges or audio content. */
export async function audit(a: AuditInput, tx: Tx | typeof sql = sql): Promise<void> {
  await tx`INSERT INTO audit_events (user_id, actor, action, entity, entity_id, meta, ip)
           VALUES (${a.userId ?? null}, ${a.actor}, ${a.action}, ${a.entity ?? ""}, ${a.entityId ?? ""}, ${j(a.meta ?? {})}, ${a.ip ?? null})`;
}
