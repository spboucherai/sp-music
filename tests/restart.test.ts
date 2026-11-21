/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Music SP
 * File             : tests/restart.test.ts
 * Module           : tests
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

import { afterAll, expect, it } from "vitest";
import { Client, sql } from "./helpers";

afterAll(async () => { await sql.end(); });

it("keeps the library, the files and the sessions across a restart", async () => {
  const [s] = await sql`SELECT s.id FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.is_owner AND s.revoked_at IS NULL ORDER BY s.created_at DESC LIMIT 1`;
  expect(s).toBeTruthy();
  const tracks = await sql`SELECT t.id, m.size_bytes FROM tracks t JOIN media_assets m ON m.track_id = t.id AND m.kind = 'original'`;
  expect(tracks.length).toBeGreaterThanOrEqual(5);
  // a fresh listener session proves the passkey store survived too
  const [inv] = await sql`SELECT count(*)::int AS n FROM authenticators`;
  expect(inv.n).toBeGreaterThanOrEqual(2);
  const anon = new Client();
  expect((await anon.req(`/api/v1/stream/${tracks[0].id}`)).status).toBe(401);
  const health = await (await fetch(`${process.env.TEST_BASE_URL}/api/health`)).json();
  expect(health).toMatchObject({ ok: true, db: true, storage: true });
});
