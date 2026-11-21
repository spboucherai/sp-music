/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Music SP
 * File             : scripts/lyrics.ts
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
import { lyricsEnabled, queueLyrics } from "../src/server/lyrics";

/**
 * Queues lyrics transcription from the node's shell.
 *   tsx scripts/lyrics.ts --missing            every track that has no lyrics yet
 *   tsx scripts/lyrics.ts --album "Thriller"   one album (title contains)
 *   options: --lang fr|en|es|it|de|pt (default: detect)   --overwrite (also replace hand-corrected lyrics)   --wait
 */
async function main() {
  const a = process.argv.slice(2);
  const val = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  if (!lyricsEnabled()) throw new Error("Lyrics are not configured (LYRICS and LYRICS_PYTHON in .env)");
  const album = val("--album");
  if (!album && !a.includes("--missing")) throw new Error("Usage: tsx scripts/lyrics.ts --missing | --album <title> [--lang fr] [--overwrite] [--wait]");
  const rows = album
    ? await sql<{ id: string }[]>`SELECT t.id FROM tracks t JOIN albums al ON al.id = t.album_id WHERE al.title ILIKE ${"%" + album + "%"}`
    : await sql<{ id: string }[]>`SELECT t.id FROM tracks t WHERE NOT EXISTS (SELECT 1 FROM lyrics l WHERE l.track_id = t.id)`;
  const ids = rows.map((r) => r.id);
  const n = ids.length ? await queueLyrics(ids, val("--lang"), a.includes("--overwrite")) : 0;
  console.log(`${n} track(s) queued (${ids.length - n} skipped)`);
  if (a.includes("--wait") && n) {
    for (;;) {
      const st = await sql<{ state: string; n: number }[]>`SELECT state, count(*)::int AS n FROM lyrics WHERE track_id = ANY(${ids}::uuid[]) GROUP BY state`;
      if (!st.some((s) => s.state === "queued" || s.state === "working")) { console.log(st.map((s) => `${s.state}: ${s.n}`).join(", ")); break; }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  await sql.end();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
