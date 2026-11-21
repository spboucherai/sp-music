/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Music SP
 * File             : scripts/secrets-scan.ts
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

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** Fails if a tracked (or about-to-be-tracked) file looks like it contains a credential. */
const files = execSync("git ls-files --cached --others --exclude-standard", { encoding: "utf8" }).split("\n").filter(Boolean);
const patterns: [string, RegExp][] = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["postgres URL with password", /postgres(?:ql)?:\/\/[^:\s/]+:(?!CHANGE_ME|password\b)[^@\s]{6,}@/],
  ["APP_SECRET value", /^APP_SECRET=[A-Za-z0-9+/=_-]{32,}\s*$/m],
  ["generic API key", /\b(?:sk|pk)-[A-Za-z0-9_-]{24,}\b/],
];
let bad = 0;
for (const f of files) {
  if (/\.(png|ico|jpg|webp|lock)$|pnpm-lock\.yaml$/.test(f) || f === ".env") continue;
  let text: string;
  try { text = readFileSync(f, "utf8"); } catch { continue; }
  for (const [name, re] of patterns) if (re.test(text)) { console.error(`SECRET? ${name} in ${f}`); bad++; }
}
if (files.includes(".env") && execSync("git ls-files .env", { encoding: "utf8" }).trim()) { console.error(".env is tracked by git"); bad++; }
if (bad) process.exit(1);
console.log(`secrets scan ok (${files.length} files)`);
