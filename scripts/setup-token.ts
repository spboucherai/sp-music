/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Music SP
 * File             : scripts/setup-token.ts
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

import "./_env";
import { sql } from "../src/lib/db";
import { env } from "../src/lib/env";
import { issueSetupToken } from "../src/lib/auth";

/**
 * Recovery from the server's shell (the only recovery path besides the printed recovery codes).
 *   tsx scripts/setup-token.ts                      → owner: add a passkey (existing ones kept)
 *   tsx scripts/setup-token.ts --recovery           → owner: replace every passkey, sign out every device
 *   tsx scripts/setup-token.ts --user a@b.c [...]   → same for another account
 * The link is printed on the terminal only; run it interactively, never from a job whose output is logged.
 */
async function main() {
  const recovery = process.argv.includes("--recovery");
  const i = process.argv.indexOf("--user");
  const email = i > 0 ? process.argv[i + 1] : null;
  const [u] = email ? await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${email}` : await sql<{ id: string }[]>`SELECT id FROM users WHERE is_owner`;
  if (!u) throw new Error(email ? `No account ${email}` : "No owner account: run scripts/bootstrap.ts first");
  const token = await issueSetupToken(u.id, recovery ? "recovery" : "setup", 30);
  console.log(`${env.appUrl}/setup#${token}`);
  console.log(recovery ? "Valid 30 minutes, one use. Enrolling with it REMOVES the other passkeys and signs out every device." : "Valid 30 minutes, one use.");
  await sql.end();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
