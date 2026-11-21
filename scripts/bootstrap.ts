/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Music SP
 * File             : scripts/bootstrap.ts
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

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import "./_env";
import { sql } from "../src/lib/db";
import { env } from "../src/lib/env";
import { issueSetupToken, passkeyCount } from "../src/lib/auth";
import { storage } from "../src/server/storage";

/**
 * Idempotent first-run setup, run at every deployment.
 *  - creates the owner account (administrator) from OWNER_EMAIL / OWNER_NAME — the only account ever created
 *    outside the admin panel; there is no default password and no public sign-up;
 *  - while the owner has no passkey, issues a one-time enrolment link (24 h) written to SETUP_URL_FILE (mode 0600),
 *    never to the logs. Once a passkey exists this script issues nothing: setup mode is closed.
 */
async function main() {
  const st = await storage().health();
  if (!st.ok) throw new Error(`STORAGE_ROOT is not usable (${st.detail})`);
  let [u] = await sql<{ id: string }[]>`SELECT id FROM users WHERE is_owner`;
  if (!u) {
    const email = env.ownerEmail;
    if (!email) throw new Error("OWNER_EMAIL is required to create the owner account");
    [u] = await sql<{ id: string }[]>`INSERT INTO users (email, display_name, role, is_owner) VALUES (${email}, ${env.ownerName}, 'admin', true) RETURNING id`;
    console.log("  owner account created");
  }
  if ((await passkeyCount(u.id)) === 0) {
    const file = process.env.SETUP_URL_FILE;
    const token = await issueSetupToken(u.id, "setup", 24 * 60);
    const url = `${env.appUrl}/setup#${token}`;
    if (file) { mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); writeFileSync(file, url + "\n", { mode: 0o600 }); console.log(`  owner has no passkey: one-time enrolment link written to ${file} (valid 24 h)`); }
    else if (process.stdout.isTTY) console.log(`  owner has no passkey: one-time enrolment link (valid 24 h):\n  ${url}`);
    else throw new Error("Owner has no passkey and SETUP_URL_FILE is not set: refusing to print the enrolment link to a log");
  } else console.log("  owner passkey present: setup mode closed");
  await sql.end();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
