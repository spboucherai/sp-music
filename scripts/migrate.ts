/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Music SP
 * File             : scripts/migrate.ts
 * Module           : scripts
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

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import "./_env";
import { sql } from "../src/lib/db";

/** Applies db/migrations/*.sql in order, once each (checksummed). */
async function main() {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`;
  const dir = path.join(process.cwd(), "db/migrations");
  for (const name of (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort()) {
    const body = await readFile(path.join(dir, name), "utf8");
    const checksum = createHash("sha256").update(body).digest("hex");
    const [done] = await sql<{ checksum: string }[]>`SELECT checksum FROM schema_migrations WHERE name = ${name}`;
    if (done) { if (done.checksum !== checksum) throw new Error(`Migration ${name} was modified after being applied`); continue; }
    await sql.begin(async (tx) => { await tx.unsafe(body); await tx`INSERT INTO schema_migrations (name, checksum) VALUES (${name}, ${checksum})`; });
    console.log(`applied ${name}`);
  }
  await sql.end();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
