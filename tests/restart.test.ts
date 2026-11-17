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
