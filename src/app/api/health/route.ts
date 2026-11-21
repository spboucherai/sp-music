/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Music SP
 * File             : src/app/api/health/route.ts
 * Module           : app
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
import { sql } from "@/lib/db";
import { storage } from "@/server/storage";

/** Liveness for the dispatcher: database, storage volume, worker heartbeat. No library data, no paths. */
export async function GET() {
  try {
    const [hb] = await sql<{ age: number | null }[]>`SELECT (SELECT extract(epoch FROM now() - beat_at)::int FROM worker_heartbeat WHERE name = 'worker') AS age`;
    const st = await storage().health();
    const ok = st.ok;
    return NextResponse.json({ ok, db: true, storage: st.ok, worker: { ok: hb.age !== null && hb.age < 120, ageSec: hb.age } }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, db: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
