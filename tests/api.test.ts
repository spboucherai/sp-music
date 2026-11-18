import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { BASE, Client, fixture, setupTokenFromFile, sleep, sql, STORAGE, tokenOf } from "./helpers";

const owner = new Client();
const listener = new Client();
const anon = new Client();
let trackA = "", trackB = "", albumId = "", listenerId = "";
let recoveryCodes: string[] = [];

afterAll(async () => { await sql.end(); });

describe("signed-out visitors", () => {
  it("cannot read the library, a track, a cover or the administration", async () => {
    for (const p of ["/api/v1/library/home", "/api/v1/library/tracks", "/api/v1/admin/health", "/api/v1/admin/users", "/api/v1/me/passkeys"]) expect((await anon.req(p)).status, p).toBe(401);
    expect((await anon.req("/api/v1/stream/00000000-0000-4000-8000-000000000000")).status).toBe(401);
    expect((await anon.req("/api/v1/art/00000000-0000-4000-8000-000000000000")).status).toBe(401);
    expect((await anon.json("/api/v1/admin/uploads", { json: { filename: "x.flac", size: 10 } })).status).toBe(401);
  });
  it("are redirected to the sign-in page", async () => {
    for (const p of ["/", "/admin", "/bibliotheque"]) { const r = await anon.req(p); expect(r.status, p).toBe(307); expect(r.headers.get("location")).toContain("/login"); }
  });
  it("get the security headers", async () => {
    const r = await anon.req("/login");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("x-frame-options")).toBe("DENY");
    expect(r.headers.get("strict-transport-security")).toContain("max-age");
    expect(r.headers.get("referrer-policy")).toBeTruthy();
  });
  it("cannot enrol a passkey without a token", async () => {
    expect((await anon.json("/api/v1/auth/register/options", { json: {} })).status).toBe(403);
    expect((await anon.json("/api/v1/auth/register/options", { json: { setupToken: "x".repeat(43) } })).status).toBe(403);
  });
});

describe("owner setup with a passkey", () => {
  const token = setupTokenFromFile();
  it("rejects a registration from the wrong origin, a wrong RP ID, or without user verification", async () => {
    expect((await owner.enrol(token, { origin: "https://evil.example" })).status).toBe(400);
    expect((await owner.enrol(token, { rpId: "evil.example" })).status).toBe(400);
    expect((await owner.enrol(token, { noUserVerification: true })).status).toBe(400);
    expect((await sql`SELECT count(*)::int AS n FROM authenticators`)[0].n).toBe(0);
  });
  it("enrols the first passkey, opens a session and hands out recovery codes once", async () => {
    const r = await owner.enrol(token);
    expect(r.status).toBe(200);
    recoveryCodes = (r.body as { recoveryCodes: string[] }).recoveryCodes;
    expect(recoveryCodes).toHaveLength(8);
    const s = await owner.refreshSession();
    expect(s.authenticated).toBe(true); expect(s.user!.role).toBe("admin");
    // replaying the same challenge and response is refused
    const replay = await owner.json("/api/v1/auth/register/verify", { json: { challengeId: r.challengeId, response: r.response, setupToken: token } });
    expect(replay.status).toBe(400); expect(replay.body.error!.code).toBe("challenge_expired");
  });
  it("closes setup mode: the token is single-use", async () => {
    const again = new Client();
    expect((await again.enrol(token)).status).toBe(403);
    expect((await again.json("/api/v1/auth/setup/info", { json: { setupToken: token } })).status).toBe(403);
  });
  it("stores only public credential data", async () => {
    const cols = (await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'authenticators'`).map((c) => c.column_name).sort();
    expect(cols).toEqual(["backed_up", "counter", "created_at", "credential_id", "device_type", "id", "last_used_at", "name", "public_key", "transports", "user_id"]);
  });
});

describe("sign-in", () => {
  it("rejects a wrong origin, a wrong RP ID, a bad signature and a missing user verification", async () => {
    const c = new Client(); c.auth = owner.auth;
    expect((await c.login(undefined, { origin: "https://evil.example" })).status).toBe(401);
    expect((await c.login(undefined, { rpId: "evil.example" })).status).toBe(401);
    expect((await c.login(undefined, { badSignature: true })).status).toBe(401);
    expect((await c.login(undefined, { noUserVerification: true })).status).toBe(401);
    expect(c.cookie).toBe("");
  });
  it("accepts a valid assertion, rotates the session, and refuses a replayed or expired challenge", async () => {
    const c = new Client(); c.auth = owner.auth;
    const r = await c.login();
    expect(r.status).toBe(200);
    expect(c.cookie).not.toBe(""); expect(c.cookie).not.toBe(owner.cookie);
    const replay = await new Client().json("/api/v1/auth/login/verify", { json: { challengeId: r.challengeId, response: r.response } });
    expect(replay.status).toBe(401);
    // expired challenge
    const d = new Client(); d.auth = owner.auth;
    const o = await d.json<{ challengeId: string; options: { challenge: string } }>("/api/v1/auth/login/options", { json: {} });
    await sql`UPDATE webauthn_challenges SET expires_at = now() - interval '1 second' WHERE id = ${o.body.challengeId}`;
    expect((await d.json("/api/v1/auth/login/verify", { json: { challengeId: o.body.challengeId, response: d.auth.get(o.body.options) } })).status).toBe(401);
    expect((await sql`SELECT count(*)::int AS n FROM audit_events WHERE action = 'login.failed'`)[0].n).toBeGreaterThanOrEqual(5);
  });
  it("sets an HttpOnly, Secure, SameSite cookie", async () => {
    const c = new Client(); c.auth = owner.auth;
    const o = await c.json<{ challengeId: string; options: { challenge: string } }>("/api/v1/auth/login/options", { json: {} });
    const res = await c.req("/api/v1/auth/login/verify", { json: { challengeId: o.body.challengeId, response: c.auth.get(o.body.options) } });
    const sc = (res.headers.getSetCookie() ?? []).join(";").toLowerCase();
    expect(sc).toContain("httponly"); expect(sc).toContain("secure"); expect(sc).toContain("samesite=lax"); expect(sc).not.toContain("domain=");
  });
  it("refuses state-changing requests without the CSRF token or from another origin", async () => {
    expect((await owner.json("/api/v1/admin/uploads", { json: { filename: "x.flac", size: 10 }, noCsrf: true })).body.error!.code).toBe("csrf");
    const r = await owner.json("/api/v1/admin/uploads", { json: { filename: "x.flac", size: 10 }, headers: { Origin: "https://evil.example" } });
    expect(r.status).toBe(403); expect(r.body.error!.code).toBe("bad_origin");
  });
});

describe("import", () => {
  it("uploads in chunks, resumes from the server's offset, analyses and indexes a FLAC", async () => {
    const data = fixture("a.flac");
    const c = await owner.json<{ id: string }>("/api/v1/admin/uploads", { json: { filename: "../../01 Onde.flac", size: data.length } });
    expect(c.status).toBe(200);
    const half = Math.floor(data.length / 2);
    expect((await owner.json(`/api/v1/admin/uploads/${c.body.id}?offset=0`, { method: "PATCH", raw: data.subarray(0, half) })).status).toBe(200);
    const wrong = await owner.json(`/api/v1/admin/uploads/${c.body.id}?offset=0`, { method: "PATCH", raw: data.subarray(0, half) });
    expect(wrong.status).toBe(409); expect(wrong.body.error!.details!.receivedBytes).toBe(half);
    const tooMuch = await owner.json(`/api/v1/admin/uploads/${c.body.id}?offset=${half}`, { method: "PATCH", raw: Buffer.concat([data.subarray(half), Buffer.alloc(10)]) });
    expect(tooMuch.status).toBe(413);
    expect((await owner.json(`/api/v1/admin/uploads/${c.body.id}?offset=${half}`, { method: "PATCH", raw: data.subarray(half) })).status).toBe(200);
    const u = await owner.waitUpload(c.body.id);
    expect(u.status, JSON.stringify(u)).toBe("ready");
    trackA = u.trackId!;
    const [row] = await sql`SELECT filename FROM uploads WHERE id = ${c.body.id}`;
    expect(row.filename).toBe("01 Onde.flac");
    const b = await owner.upload("b.flac", fixture("b.flac"));
    expect(b.body.status).toBe("ready"); trackB = (b.body as { trackId: string }).trackId;
  });
  it("exposes tags, technical data and the embedded cover", async () => {
    const t = (await owner.json<Record<string, never>>(`/api/v1/library/tracks/${trackA}`)).body as unknown as { title: string; codec: string; sampleRate: number; bitDepth: number; trackNo: number; year: number; genre: string; webPlayable: string; artist: { name: string }; album: { id: string; title: string; artworkId: string } };
    expect(t).toMatchObject({ title: "Onde À", codec: "flac", sampleRate: 44100, bitDepth: 16, trackNo: 1, year: 2024, genre: "Test", webPlayable: "yes" });
    expect(t.artist.name).toBe("Les Sinusoïdes"); expect(t.album.title).toBe("Fréquences");
    albumId = t.album.id;
    const al = await owner.json<{ tracks: { id: string }[] }>(`/api/v1/library/albums/${albumId}`);
    expect(al.body.tracks.map((x) => x.id)).toEqual([trackA, trackB]);
    for (const s of ["96", "320", "640", "orig"]) { const r = await owner.req(`/api/v1/art/${t.album.artworkId}?s=${s}`); expect(r.status, s).toBe(200); expect(r.headers.get("content-type")).toMatch(/^image\//); expect(r.headers.get("cache-control")).toContain("private"); }
    const found = await owner.json<{ tracks: { id: string }[]; albums: unknown[]; artists: unknown[] }>(`/api/v1/library/search?q=${encodeURIComponent("sinusoides")}`);
    expect(found.body.artists).toHaveLength(1); expect(found.body.tracks.length).toBe(2);
    expect((await owner.json<{ tracks: unknown[] }>("/api/v1/library/search?q=test")).body.tracks.length).toBeGreaterThan(0);   // by genre
  });
  it("detects duplicates by content hash and by track identity, and replaces only on confirmation", async () => {
    const same = await owner.upload("copy.flac", fixture("a.flac"));
    expect(same.body).toMatchObject({ status: "duplicate", errorCode: "same_file", duplicateOf: trackA });
    expect((await owner.json(`/api/v1/admin/uploads/${same.id}`, { method: "DELETE" })).status).toBe(200);
    const twin = await owner.upload("other.flac", fixture("a-other-encoding.flac"));
    expect(twin.body).toMatchObject({ status: "duplicate", errorCode: "same_track", duplicateOf: trackA });
    const [before] = await sql`SELECT storage_key, sha256 FROM media_assets WHERE track_id = ${trackA} AND kind = 'original'`;
    expect((await owner.json(`/api/v1/admin/uploads/${twin.id}/replace`, { json: {} })).status).toBe(200);
    expect((await owner.waitUpload(twin.id)).status).toBe("ready");
    const [after] = await sql`SELECT storage_key, sha256 FROM media_assets WHERE track_id = ${trackA} AND kind = 'original'`;
    expect(after.sha256).not.toBe(before.sha256);
    expect(existsSync(path.join(STORAGE, before.storage_key))).toBe(false);
    expect(existsSync(path.join(STORAGE, after.storage_key))).toBe(true);
    expect((await sql`SELECT count(*)::int AS n FROM audit_events WHERE action = 'track.replaced'`)[0].n).toBe(1);
    expect((await sql`SELECT count(*)::int AS n FROM tracks`)[0].n).toBe(2);
  });
  it("refuses impostors, broken files and oversized files cleanly", async () => {
    expect((await owner.upload("program.flac", fixture("program.flac"))).body).toMatchObject({ status: "error", errorCode: "unsupported_type" });
    expect((await owner.upload("text.mp3", fixture("text.mp3"))).body).toMatchObject({ status: "error", errorCode: "unsupported_type" });
    expect((await owner.upload("broken.flac", fixture("broken.flac"))).body).toMatchObject({ status: "error", errorCode: "undecodable" });
    const big = await owner.json("/api/v1/admin/uploads", { json: { filename: "huge.flac", size: 51 * 1024 * 1024 } });
    expect(big.status).toBe(413); expect(big.body.error!.code).toBe("file_too_large");
    expect((await owner.json("/api/v1/admin/uploads", { json: { filename: "zero.flac", size: 0 } })).status).toBe(400);
    expect((await sql`SELECT count(*)::int AS n FROM tracks`)[0].n).toBe(2);
    const err = await owner.json<{ raw?: string }>("/api/v1/admin/uploads/not-a-uuid");
    expect(err.status).toBe(400); expect(JSON.stringify(err.body)).not.toMatch(/\/tmp|\/Users|at .*\.ts/);
  });
  it("imports MP3 and untagged WAV, and prepares an AAC rendition for ALAC", async () => {
    expect((await owner.upload("c.mp3", fixture("c.mp3"))).body.status).toBe("ready");
    const wav = await owner.upload("03 Sans Tags.wav", fixture("03 Sans Tags.wav"));
    const w = (await owner.json(`/api/v1/library/tracks/${(wav.body as { trackId: string }).trackId}`)).body as unknown as { title: string; trackNo: number; album: { title: string } };
    expect(w).toMatchObject({ title: "Sans Tags", trackNo: 3 }); expect(w.album.title).toBe("Album inconnu");
    const alac = await owner.upload("d.m4a", fixture("d.m4a"));
    const id = (alac.body as { trackId: string }).trackId;
    let t: { codec: string; webPlayable: string; compatState: string } = { codec: "", webPlayable: "", compatState: "" };
    for (let i = 0; i < 100; i++) { t = (await owner.json(`/api/v1/library/tracks/${id}`)).body as never; if (t.compatState === "ready" || t.compatState === "error") break; await sleep(300); }
    expect(t).toMatchObject({ codec: "alac", webPlayable: "some", compatState: "ready" });
    const r = await owner.req(`/api/v1/stream/${id}?v=compat`, { headers: { Range: "bytes=0-99" } });
    expect(r.status).toBe(206); expect(r.headers.get("content-type")).toBe("audio/mp4");
    expect((await owner.req(`/api/v1/stream/${trackA}?v=compat`)).status).toBe(404);
    expect((await owner.req(`/api/v1/stream/${trackA}`, { method: "POST" })).status).toBe(405);
  });
  it("expands a ZIP safely (no path traversal) and refuses bombs and empty archives", async () => {
    const z = await owner.upload("album.zip", fixture("album.zip"));
    expect(z.body.status, JSON.stringify(z.body)).toBe("ready");
    for (let i = 0; i < 100; i++) { const [{ n }] = await sql`SELECT count(*)::int AS n FROM uploads WHERE parent_id = ${z.id} AND status NOT IN ('ready', 'error', 'duplicate')`; if (n === 0) break; await sleep(300); }
    const kids = await sql`SELECT filename, status FROM uploads WHERE parent_id = ${z.id} ORDER BY filename`;
    expect(kids.map((k) => [k.filename, k.status])).toEqual([["01 un.flac", "ready"], ["02 deux.flac", "ready"]]);
    // an archive carrying a "../" entry is refused whole, and nothing is written outside the storage
    const before = (await sql`SELECT count(*)::int AS n FROM tracks`)[0].n;
    expect((await owner.upload("evil.zip", fixture("evil.zip"))).body).toMatchObject({ status: "error", errorCode: "archive_invalid" });
    expect((await sql`SELECT count(*)::int AS n FROM tracks`)[0].n).toBe(before);
    for (const dir of [path.dirname(STORAGE), path.dirname(path.dirname(STORAGE)), "/tmp"]) expect(readdirSync(dir).filter((f) => f.includes("evil-escape"))).toEqual([]);
    expect((await owner.upload("bomb.zip", fixture("bomb.zip"))).body).toMatchObject({ status: "error", errorCode: "archive_too_large" });
    expect((await owner.upload("noaudio.zip", fixture("noaudio.zip"))).body).toMatchObject({ status: "error", errorCode: "archive_no_audio" });
  });
});

describe("private streaming", () => {
  it("serves the whole file and byte ranges with correct headers", async () => {
    const [asset] = await sql`SELECT storage_key, size_bytes FROM media_assets WHERE track_id = ${trackB} AND kind = 'original'`;
    const size = Number(asset.size_bytes); const data = fixture("b.flac");
    const full = await owner.req(`/api/v1/stream/${trackB}`);
    expect(full.status).toBe(200);
    expect(full.headers.get("content-type")).toBe("audio/flac"); expect(full.headers.get("accept-ranges")).toBe("bytes");
    expect(full.headers.get("content-length")).toBe(String(size)); expect(full.headers.get("cache-control")).toContain("private");
    expect(Buffer.from(await full.arrayBuffer()).equals(data)).toBe(true);
    const part = await owner.req(`/api/v1/stream/${trackB}`, { headers: { Range: "bytes=100-299" } });
    expect(part.status).toBe(206); expect(part.headers.get("content-range")).toBe(`bytes 100-299/${size}`); expect(part.headers.get("content-length")).toBe("200");
    expect(Buffer.from(await part.arrayBuffer()).equals(data.subarray(100, 300))).toBe(true);
    const tail = await owner.req(`/api/v1/stream/${trackB}`, { headers: { Range: "bytes=-50" } });
    expect(tail.status).toBe(206); expect(Buffer.from(await tail.arrayBuffer()).equals(data.subarray(size - 50))).toBe(true);
    const open = await owner.req(`/api/v1/stream/${trackB}`, { headers: { Range: `bytes=${size - 10}-` } });
    expect(open.status).toBe(206); expect(open.headers.get("content-length")).toBe("10");
    const bad = await owner.req(`/api/v1/stream/${trackB}`, { headers: { Range: `bytes=${size + 5}-` } });
    expect(bad.status).toBe(416); expect(bad.headers.get("content-range")).toBe(`bytes */${size}`);
    const etag = full.headers.get("etag")!;
    expect((await owner.req(`/api/v1/stream/${trackB}`, { headers: { "If-None-Match": etag } })).status).toBe(304);
    const head = await owner.req(`/api/v1/stream/${trackB}`, { method: "HEAD" });
    expect(head.status).toBe(200); expect(head.headers.get("content-length")).toBe(String(size));
  });
  it("never resolves anything but an opaque track id", async () => {
    for (const p of ["..%2F..%2Fetc%2Fpasswd", "originals", "not-a-uuid"]) expect((await owner.req(`/api/v1/stream/${p}`)).status).toBe(404);
    expect((await owner.req("/api/v1/stream/00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await fetch(`${BASE}/originals/`)).status).toBeGreaterThanOrEqual(300);
  });
});

describe("listener role", () => {
  it("is created by invitation only and can listen", async () => {
    const inv = await owner.json<{ id: string; inviteUrl: string }>("/api/v1/admin/users", { json: { email: "auditeur@example.test", displayName: "Auditeur", role: "listener" } });
    expect(inv.status).toBe(200); listenerId = inv.body.id;
    expect((await listener.enrol(tokenOf(inv.body.inviteUrl))).status).toBe(200);
    expect((await listener.refreshSession()).user!.role).toBe("listener");
    expect((await listener.json("/api/v1/library/home")).status).toBe(200);
    expect((await listener.req(`/api/v1/stream/${trackB}`, { headers: { Range: "bytes=0-9" } })).status).toBe(206);
    expect((await listener.json(`/api/v1/library/albums/${albumId}`)).status).toBe(200);
  });
  it("is refused by every administration endpoint, server-side", async () => {
    const calls: [string, string, unknown?][] = [
      ["POST", "/api/v1/admin/uploads", { filename: "x.flac", size: 10 }], ["GET", "/api/v1/admin/uploads"], ["GET", "/api/v1/admin/uploads/limits"],
      ["PATCH", "/api/v1/admin/tracks", { ids: [trackA], patch: { title: "Piraté" } }], ["POST", "/api/v1/admin/tracks/delete", { ids: [trackA], confirm: true }],
      ["POST", "/api/v1/admin/tracks/reanalyse", { ids: [trackA] }], ["PATCH", `/api/v1/admin/albums/${albumId}`, { title: "Piraté" }],
      ["POST", `/api/v1/admin/albums/${albumId}/delete`, { confirm: true }], ["PUT", `/api/v1/admin/albums/${albumId}/order`, { trackIds: [trackB, trackA] }],
      ["GET", "/api/v1/admin/users"], ["POST", "/api/v1/admin/users", { email: "x@example.test", displayName: "X", role: "admin" }],
      ["PATCH", `/api/v1/admin/users/${listenerId}`, { role: "admin" }], ["GET", "/api/v1/admin/health"], ["GET", "/api/v1/admin/audit"], ["POST", "/api/v1/admin/uploads/clear", {}],
    ];
    for (const [method, p, json] of calls) { const r = await listener.json(p, { method, json }); expect(r.status, `${method} ${p}`).toBe(403); expect(r.body.error!.code).toBe("forbidden"); }
    expect((await listener.req(`/api/v1/admin/albums/${albumId}/artwork`, { method: "PUT", raw: fixture("cover2.jpg") })).status).toBe(403);
    const page = await listener.req("/admin"); expect(page.status).toBe(307); expect(page.headers.get("location")).not.toContain("/admin");
    expect((await sql`SELECT title FROM tracks WHERE id = ${trackA}`)[0].title).toBe("Onde À");
  });
  it("owns its favourites, playlists and playback state; another account cannot reach them", async () => {
    expect((await listener.json(`/api/v1/library/favorites/track/${trackB}`, { method: "PUT" })).status).toBe(200);
    expect(((await listener.json<{ tracks: unknown[] }>("/api/v1/library/favorites")).body.tracks).length).toBe(1);
    expect(((await owner.json<{ tracks: unknown[] }>("/api/v1/library/favorites")).body.tracks).length).toBe(0);
    const pl = await listener.json<{ id: string }>("/api/v1/library/playlists", { json: { name: "Ma liste", trackIds: [trackA, trackB] } });
    expect(pl.status).toBe(200);
    const mine = await listener.json<{ tracks: { id: string; entryId: string }[] }>(`/api/v1/library/playlists/${pl.body.id}`);
    expect(mine.body.tracks.map((t) => t.id)).toEqual([trackA, trackB]);
    expect((await listener.json(`/api/v1/library/playlists/${pl.body.id}/order`, { method: "PUT", json: { entryIds: mine.body.tracks.map((t) => t.entryId).reverse() } })).status).toBe(200);
    expect((await listener.json<{ tracks: { id: string }[] }>(`/api/v1/library/playlists/${pl.body.id}`)).body.tracks.map((t) => t.id)).toEqual([trackB, trackA]);
    for (const [m, p, j] of [["GET", ""], ["PATCH", "", { name: "volée" }], ["DELETE", ""], ["POST", "/tracks", { trackIds: [trackA] }]] as [string, string, unknown?][])
      expect((await owner.json(`/api/v1/library/playlists/${pl.body.id}${p}`, { method: m, json: j })).status, `${m} ${p}`).toBe(404);
    const state = { queue: [trackA, trackB], index: 1, positionMs: 2500, shuffle: false, repeat: "all", volume: 0.6 };
    expect((await listener.json("/api/v1/library/playback", { method: "PUT", json: state })).status).toBe(200);
    const back = (await listener.json("/api/v1/library/playback")).body as unknown as { queue: { id: string }[]; index: number; positionMs: number; repeat: string; volume: number };
    expect(back.queue.map((t) => t.id)).toEqual([trackA, trackB]); expect(back).toMatchObject({ index: 1, positionMs: 2500, repeat: "all" });
    expect(((await owner.json("/api/v1/library/playback")).body as unknown as { queue: unknown[] }).queue).toEqual([]);
  });
});

describe("passkeys and sessions", () => {
  it("adds a second passkey, signs in with it, revokes it; the last one cannot be removed", async () => {
    const o = await owner.json<{ challengeId: string; options: { challenge: string; user: { id: string } } }>("/api/v1/auth/register/options", { json: {} });
    const second = owner.auth.create(o.body.options);
    expect((await owner.json("/api/v1/auth/register/verify", { json: { challengeId: o.body.challengeId, response: second, name: "Deuxième" } })).status).toBe(200);
    const list = await owner.json<{ items: { id: string; name: string; createdAt: string; lastUsedAt: string | null }[] }>("/api/v1/me/passkeys");
    expect(list.body.items).toHaveLength(2);
    const c = new Client(); c.auth = owner.auth;
    expect((await c.login(second.id)).status).toBe(200);
    const pk = list.body.items.find((k) => k.name === "Deuxième")!;
    expect((await owner.json(`/api/v1/me/passkeys/${pk.id}`, { method: "DELETE" })).status).toBe(200);
    const d = new Client(); d.auth = owner.auth;
    expect((await d.login(second.id)).status).toBe(401);
    const last = (await owner.json<{ items: { id: string; lastUsedAt: string | null }[] }>("/api/v1/me/passkeys")).body.items;
    expect(last).toHaveLength(1); expect(last[0].lastUsedAt).not.toBeNull();
    const r = await owner.json(`/api/v1/me/passkeys/${last[0].id}`, { method: "DELETE" });
    expect(r.status).toBe(409); expect(r.body.error!.code).toBe("last_passkey");
    // the revoked passkey's session is still listed and can be closed
    const sessions = (await owner.json<{ items: { id: string; current: boolean }[] }>("/api/v1/me/sessions")).body.items;
    expect(sessions.filter((s) => s.current)).toHaveLength(1);
    expect((await c.json("/api/v1/library/home")).status).toBe(200);
    expect((await owner.json("/api/v1/me/sessions/revoke-others", { json: {} })).status).toBe(200);
    expect((await c.json("/api/v1/library/home")).status).toBe(401);
    expect((await owner.json("/api/v1/library/home")).status).toBe(200);
  });
  it("lets an administrator close a listener's sessions and suspend the account", async () => {
    expect((await owner.json(`/api/v1/admin/users/${listenerId}/revoke-sessions`, { json: {} })).status).toBe(200);
    expect((await listener.json("/api/v1/library/home")).status).toBe(401);
    expect((await listener.login()).status).toBe(200);
    expect((await owner.json(`/api/v1/admin/users/${listenerId}`, { method: "PATCH", json: { disabled: true } })).status).toBe(200);
    expect((await listener.json("/api/v1/library/home")).status).toBe(401);
    expect((await listener.login()).status).toBe(401);
    expect((await owner.json(`/api/v1/admin/users/${listenerId}`, { method: "PATCH", json: { disabled: false } })).status).toBe(200);
    expect((await listener.login()).status).toBe(200);
  });
  it("protects the owner account and accepts each recovery code once", async () => {
    const me = (await owner.refreshSession()).user!.id;
    expect((await owner.json(`/api/v1/admin/users/${me}`, { method: "PATCH", json: { role: "listener" } })).status).toBe(403);
    expect((await owner.json(`/api/v1/admin/users/${me}`, { method: "DELETE" })).status).toBe(403);
    const c = new Client();
    expect((await c.json("/api/v1/auth/recovery", { json: { code: "0000-0000-0000" } })).status).toBe(401);
    expect((await c.json("/api/v1/auth/recovery", { json: { code: recoveryCodes[0] } })).status).toBe(200);
    expect((await new Client().json("/api/v1/auth/recovery", { json: { code: recoveryCodes[0] } })).status).toBe(401);
    // brute force is throttled per address
    const b = new Client(); let limited = false;
    for (let i = 0; i < 8; i++) if ((await b.json("/api/v1/auth/recovery", { json: { code: `aaaa-bbbb-${1000 + i}` } })).status === 429) limited = true;
    expect(limited).toBe(true);
  });
});

describe("library management", () => {
  it("edits tags, moves a track to another album, reorders, and sets a cover", async () => {
    expect((await owner.json("/api/v1/admin/tracks", { method: "PATCH", json: { ids: [trackB], patch: { title: "Onde B (corrigée)", year: 2025, genre: "Électro" } } })).status).toBe(200);
    expect((await owner.json(`/api/v1/library/tracks/${trackB}`)).body).toMatchObject({ title: "Onde B (corrigée)", year: 2025, genre: "Électro" });
    expect((await owner.json(`/api/v1/admin/albums/${albumId}/order`, { method: "PUT", json: { trackIds: [trackB, trackA] } })).status).toBe(200);
    expect((await owner.json<{ tracks: { id: string; trackNo: number }[] }>(`/api/v1/library/albums/${albumId}`)).body.tracks.map((t) => [t.id, t.trackNo])).toEqual([[trackB, 1], [trackA, 2]]);
    expect((await owner.json(`/api/v1/admin/albums/${albumId}/order`, { method: "PUT", json: { trackIds: [trackB] } })).status).toBe(400);
    const cover = await owner.json<{ artworkId: string }>(`/api/v1/admin/albums/${albumId}/artwork`, { method: "PUT", raw: fixture("cover2.jpg") });
    expect(cover.status).toBe(200);
    expect((await owner.req(`/api/v1/art/${cover.body.artworkId}?s=320`)).status).toBe(200);
    expect((await owner.json(`/api/v1/admin/albums/${albumId}/artwork`, { method: "PUT", raw: fixture("program.flac") })).status).toBe(400);
    expect((await owner.json("/api/v1/admin/tracks", { method: "PATCH", json: { ids: [trackA], patch: { album: "Nouvel album", albumArtist: "Les Sinusoïdes" } } })).status).toBe(200);
    const moved = (await owner.json(`/api/v1/library/tracks/${trackA}`)).body as unknown as { album: { id: string; title: string } };
    expect(moved.album.title).toBe("Nouvel album"); expect(moved.album.id).not.toBe(albumId);
    expect((await owner.json("/api/v1/admin/tracks", { method: "PATCH", json: { ids: [trackA], patch: { year: 99999 } } })).status).toBe(400);
    expect((await owner.json("/api/v1/admin/tracks", { method: "PATCH", json: { ids: [trackA], patch: { path: "/etc/passwd" } } })).status).toBe(400);
  });
  it("deletes a track: rows, files and playlist entries go; nothing else does; the deletion is audited", async () => {
    const assets = await sql`SELECT storage_key FROM media_assets WHERE track_id = ${trackA}`;
    const others = await sql`SELECT storage_key FROM media_assets WHERE track_id <> ${trackA} AND track_id IS NOT NULL`;
    expect((await owner.json("/api/v1/admin/tracks/delete", { json: { ids: [trackA] } })).status).toBe(400);      // needs the explicit confirmation
    const r = await owner.json<{ deleted: number; fileErrors: number }>("/api/v1/admin/tracks/delete", { json: { ids: [trackA], confirm: true } });
    expect(r.body).toMatchObject({ deleted: 1, fileErrors: 0 });
    for (const a of assets) expect(existsSync(path.join(STORAGE, a.storage_key)), a.storage_key).toBe(false);
    for (const a of others) expect(existsSync(path.join(STORAGE, a.storage_key)), a.storage_key).toBe(true);
    expect((await owner.req(`/api/v1/stream/${trackA}`)).status).toBe(404);
    expect((await sql`SELECT count(*)::int AS n FROM albums WHERE title = 'Nouvel album'`)[0].n).toBe(0);            // emptied album pruned
    expect((await sql`SELECT count(*)::int AS n FROM playlist_tracks WHERE track_id = ${trackA}`)[0].n).toBe(0);
    const [ev] = await sql`SELECT meta FROM audit_events WHERE action = 'track.deleted' AND entity_id = ${trackA}`;
    expect(ev.meta.title).toBe("Onde À"); expect(ev.meta.sha256).toMatch(/^[0-9a-f]{64}$/);
    const log = JSON.stringify((await owner.json("/api/v1/admin/audit?limit=200")).body);
    expect(log).not.toMatch(/spmusic_session|csrfToken|token_hash|clientDataJSON/);
    for (const c of recoveryCodes) expect(log).not.toContain(c);
  });
  it("reports system health", async () => {
    const h = (await owner.json("/api/v1/admin/health")).body as unknown as { storage: { available: boolean; usedBytes: number }; library: { tracks: number }; worker: { ok: boolean } };
    expect(h.storage.available).toBe(true); expect(h.storage.usedBytes).toBeGreaterThan(0); expect(h.worker.ok).toBe(true); expect(h.library.tracks).toBeGreaterThanOrEqual(5);
  });
});

describe("native clients", () => {
  const web = new Client();          // a browser, signed in with a passkey
  const app = new Client();          // the native app: no browser session, only what device linking hands it
  type Sync = { since: number; rev: number; more: boolean; artists: { id: string; name: string }[]; albums: { id: string; title: string; artistId: string }[];
    tracks: { id: string; title: string; albumId: string; lyricsState: string | null; file: { assetId: string; sha256: string; sizeBytes: number; mime: string } | null }[];
    deleted: { kind: string; id: string }[]; counts: { artists: number; albums: number; tracks: number } };
  let cursor = 0, playlistId = "", stamp = "", someTrack = "";

  it("publishes the app-site-association file for native passkeys", async () => {
    const r = await anon.req("/.well-known/apple-app-site-association");
    expect(r.status).toBe(200); expect(r.headers.get("content-type")).toBe("application/json");
    expect((await r.json()).webcredentials.apps).toEqual(["3YM54G49SN.ai.spboucher.spmusic", "3YM54G49SN.ai.spboucher.spmusic.ios"]);
  });

  it("links a device: the app shows a code, a signed-in browser approves it, the app gets its own session", async () => {
    const inv = await owner.json<{ inviteUrl: string }>("/api/v1/admin/users", { json: { email: "natif@example.test", displayName: "Natif", role: "listener" } });
    expect((await web.enrol(tokenOf(inv.body.inviteUrl))).status).toBe(200);
    const start = await app.json<{ deviceCode: string; userCode: string; verificationUrl: string }>("/api/v1/auth/device/start", { json: { deviceName: "MacBook de test" } });
    expect(start.status).toBe(200); expect(start.body.userCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/); expect(start.body.verificationUrl).toContain(`/appareil?code=${start.body.userCode}`);
    expect((await app.json("/api/v1/auth/device/poll", { json: { deviceCode: start.body.deviceCode } })).body).toMatchObject({ status: "pending" });
    // The approval needs a session and its CSRF token; a signed-out visitor is sent to sign in and comes back to the code.
    expect((await anon.json("/api/v1/auth/device/decide", { json: { userCode: start.body.userCode, approve: true } })).status).toBe(401);
    expect((await web.json("/api/v1/auth/device/decide", { json: { userCode: start.body.userCode, approve: true }, noCsrf: true })).status).toBe(403);
    const page = await anon.req(`/appareil?code=${start.body.userCode}`); expect(page.status).toBe(307);
    expect(decodeURIComponent(page.headers.get("location")!)).toContain(`/login?next=/appareil?code=${start.body.userCode}`);
    expect((await web.req(`/appareil?code=${start.body.userCode}`)).status).toBe(200);
    expect((await web.json("/api/v1/auth/device/info", { json: { userCode: "ZZZZ-ZZZZ" } })).status).toBe(404);
    expect((await web.json("/api/v1/auth/device/info", { json: { userCode: start.body.userCode.toLowerCase().replace("-", " ") } })).body).toMatchObject({ deviceName: "MacBook de test" });
    expect((await web.json("/api/v1/auth/device/decide", { json: { userCode: start.body.userCode, approve: true } })).status).toBe(200);
    expect((await web.json("/api/v1/auth/device/decide", { json: { userCode: start.body.userCode, approve: true } })).status).toBe(404);     // decided once
    const done = await app.json<{ status: string; sessionToken: string; csrfToken: string }>("/api/v1/auth/device/poll", { json: { deviceCode: start.body.deviceCode } });
    expect(done.body.status).toBe("approved"); expect(done.body.sessionToken.length).toBeGreaterThan(30);
    expect((await app.json("/api/v1/auth/device/poll", { json: { deviceCode: start.body.deviceCode } })).status).toBe(404);                    // consumed once
    app.cookie = `spmusic_session=${done.body.sessionToken}`;
    const me = await app.refreshSession();
    expect(me.authenticated).toBe(true); expect(me.user!.role).toBe("listener"); expect(app.csrf).toBe(done.body.csrfToken);
    const [row] = await sql`SELECT s.method, s.expires_at > now() + interval '60 days' AS long FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = 'natif@example.test' AND s.method = 'device'`;
    expect(row).toMatchObject({ method: "device", long: true });
    expect((await sql`SELECT device_hash FROM device_links WHERE user_code = ${start.body.userCode}`)[0].device_hash).not.toBe(start.body.deviceCode);
    // The browser can see and revoke the device's session like any other.
    const sessions = await web.json<{ items: { id: string; method: string; userAgent: string }[] }>("/api/v1/me/sessions");
    expect(sessions.body.items.some((x) => x.method === "device")).toBe(true);
  });

  it("refuses a denied or expired pairing and never signs in an unapproved one", async () => {
    const a = await anon.json<{ deviceCode: string; userCode: string }>("/api/v1/auth/device/start", { json: {} });
    expect((await web.json("/api/v1/auth/device/decide", { json: { userCode: a.body.userCode, approve: false } })).body).toMatchObject({ approved: false });
    expect((await anon.json("/api/v1/auth/device/poll", { json: { deviceCode: a.body.deviceCode } })).status).toBe(403);
    const b = await anon.json<{ deviceCode: string; userCode: string }>("/api/v1/auth/device/start", { json: {} });
    await sql`UPDATE device_links SET expires_at = now() - interval '1 second' WHERE user_code = ${b.body.userCode}`;
    expect((await web.json("/api/v1/auth/device/decide", { json: { userCode: b.body.userCode, approve: true } })).status).toBe(404);
    expect((await anon.json("/api/v1/auth/device/poll", { json: { deviceCode: b.body.deviceCode } })).status).toBe(410);
    expect((await anon.json("/api/v1/auth/device/poll", { json: { deviceCode: "x".repeat(43) } })).status).toBe(404);
  });

  it("sends the whole catalogue first, with what a client needs to download and verify each file", async () => {
    expect((await anon.req("/api/v1/library/sync")).status).toBe(401);
    const full = (await app.json<Sync>("/api/v1/library/sync?since=0")).body;
    const n = (await sql`SELECT (SELECT count(*)::int FROM tracks) AS tracks, (SELECT count(*)::int FROM albums) AS albums, (SELECT count(*)::int FROM artists) AS artists`)[0];
    expect(full.more).toBe(false); expect(full.counts).toEqual({ artists: n.artists, albums: n.albums, tracks: n.tracks });
    expect(full.tracks.length).toBe(n.tracks); expect(full.albums.length).toBe(n.albums); expect(full.artists.length).toBe(n.artists);
    const t = full.tracks.find((x) => x.id === trackB)!; someTrack = t.id;
    expect(t.file!.sha256).toMatch(/^[0-9a-f]{64}$/); expect(t.file!.mime).toBe("audio/flac");
    const bytes = Buffer.from(await (await app.req(`/api/v1/stream/${t.id}`)).arrayBuffer());
    expect(bytes.length).toBe(t.file!.sizeBytes);
    expect((await import("node:crypto")).createHash("sha256").update(bytes).digest("hex")).toBe(t.file!.sha256);
    expect(full.albums.every((a) => full.artists.some((x) => x.id === a.artistId))).toBe(true);
    cursor = full.rev;
    expect((await app.json<Sync>(`/api/v1/library/sync?since=${cursor}`)).body).toMatchObject({ rev: cursor, tracks: [], albums: [], artists: [], deleted: [] });
    expect((await app.json("/api/v1/library/sync?since=-1")).status).toBe(400);
  });

  it("then sends only what changed: edits, new files, lyrics and deletions", async () => {
    await owner.json("/api/v1/admin/tracks", { method: "PATCH", json: { ids: [someTrack], patch: { title: "Onde B (sync)" } } });
    let d = (await app.json<Sync>(`/api/v1/library/sync?since=${cursor}`)).body;
    expect(d.tracks.map((t) => [t.id, t.title])).toEqual([[someTrack, "Onde B (sync)"]]); expect(d.rev).toBeGreaterThan(cursor); cursor = d.rev;

    const up = await owner.upload("z-sync.flac", fixture("z1.flac").subarray(0));     // same content as an indexed file → duplicate, no change
    expect(up.body.status).toBe("duplicate");
    expect((await app.json<Sync>(`/api/v1/library/sync?since=${cursor}`)).body.tracks).toEqual([]);

    await sql`INSERT INTO lyrics (track_id, state, source, lines) VALUES (${someTrack}, 'ready', 'manual', '[]') ON CONFLICT (track_id) DO UPDATE SET state = 'ready'`;
    d = (await app.json<Sync>(`/api/v1/library/sync?since=${cursor}`)).body;
    expect(d.tracks.map((t) => [t.id, t.lyricsState])).toEqual([[someTrack, "ready"]]); cursor = d.rev;
    await sql`DELETE FROM lyrics WHERE track_id = ${someTrack}`;
    cursor = (await app.json<Sync>(`/api/v1/library/sync?since=${cursor}`)).body.rev;

    const [victim] = await sql<{ id: string; album_id: string }[]>`SELECT t.id, t.album_id FROM tracks t JOIN albums al ON al.id = t.album_id WHERE al.title = 'Zippé' ORDER BY t.track_no LIMIT 1`;
    await owner.json("/api/v1/admin/tracks/delete", { json: { ids: [victim.id], confirm: true } });
    d = (await app.json<Sync>(`/api/v1/library/sync?since=${cursor}`)).body;
    expect(d.deleted).toContainEqual(expect.objectContaining({ kind: "track", id: victim.id }));
    expect(d.counts.tracks).toBe((await sql`SELECT count(*)::int AS n FROM tracks`)[0].n); cursor = d.rev;
    // Revisions are strictly increasing and unique across the three tables.
    const revs = await sql<{ rev: string }[]>`SELECT rev FROM artists UNION ALL SELECT rev FROM albums UNION ALL SELECT rev FROM tracks UNION ALL SELECT rev FROM library_tombstones`;
    expect(new Set(revs.map((r) => r.rev)).size).toBe(revs.length);
  });

  it("sends an account's playlists, favourites and playback state in one answer, and only its own", async () => {
    const pl = await app.json<{ id: string; updatedAt: string }>("/api/v1/library/playlists", { json: { name: "Hors ligne", trackIds: [someTrack] } });
    expect(pl.status).toBe(200); playlistId = pl.body.id; stamp = pl.body.updatedAt;
    await app.json(`/api/v1/library/favorites/track/${someTrack}`, { method: "PUT" });
    const me = (await app.json<{ playlists: { id: string; name: string; updatedAt: string; entries: { entryId: string; trackId: string; position: number }[] }[]; favoriteTracks: { id: string }[]; favoriteAlbums: unknown[]; playback: unknown }>("/api/v1/library/sync/me")).body;
    expect(me.playlists).toHaveLength(1); expect(me.playlists[0]).toMatchObject({ id: playlistId, name: "Hors ligne", updatedAt: stamp });
    expect(me.playlists[0].entries.map((e) => e.trackId)).toEqual([someTrack]); expect(me.favoriteTracks.map((f) => f.id)).toEqual([someTrack]);
    const other = (await owner.json<{ playlists: { id: string }[] }>("/api/v1/library/sync/me")).body;
    expect(other.playlists.some((p) => p.id === playlistId)).toBe(false);
  });

  it("refuses an offline playlist edit made on a stale copy instead of overwriting the newer one", async () => {
    await sleep(5);
    const renamed = await app.json<{ updatedAt: string }>(`/api/v1/library/playlists/${playlistId}`, { method: "PATCH", json: { name: "Renommée ailleurs" } });
    expect(new Date(renamed.body.updatedAt).getTime()).toBeGreaterThan(new Date(stamp).getTime());
    const stale = await app.json(`/api/v1/library/playlists/${playlistId}/order`, { method: "PUT", json: { entryIds: [], baseUpdatedAt: stamp } });
    expect(stale.status).toBe(409); expect(stale.body.error!.code).toBe("conflict");
    expect((await app.json(`/api/v1/library/playlists/${playlistId}`, { method: "PATCH", json: { name: "Écrasée", baseUpdatedAt: stamp } })).status).toBe(409);
    expect((await sql`SELECT count(*)::int AS n FROM playlist_tracks WHERE playlist_id = ${playlistId}`)[0].n).toBe(1);                         // untouched
    const fresh = await app.json<{ updatedAt: string }>(`/api/v1/library/playlists/${playlistId}/order`, { method: "PUT", json: { entryIds: [], baseUpdatedAt: renamed.body.updatedAt } });
    expect(fresh.status).toBe(200); expect(fresh.body.updatedAt).toBeTruthy();
  });

  it("stores listening history once per event, per account", async () => {
    const ev = { id: "11111111-1111-4111-8111-111111111111", trackId: someTrack, playedAt: new Date(Date.now() - 60_000).toISOString(), listenedMs: 4200, completed: true, source: "local" };
    const gone = { ...ev, id: "22222222-2222-4222-8222-222222222222", trackId: "00000000-0000-4000-8000-000000000000" };
    expect((await app.json("/api/v1/library/history", { json: { events: [ev, gone] } })).body).toMatchObject({ stored: 1, skipped: 1 });
    expect((await app.json("/api/v1/library/history", { json: { events: [ev] } })).body).toMatchObject({ stored: 0, skipped: 1 });           // retry: no duplicate
    const h = (await app.json<{ items: { id: string; trackId: string; completed: boolean; source: string }[]; total: number }>("/api/v1/library/history")).body;
    expect(h.total).toBe(1); expect(h.items[0]).toMatchObject({ id: ev.id, trackId: someTrack, completed: true, source: "local" });
    expect((await owner.json<{ total: number }>("/api/v1/library/history")).body.total).toBe(0);
    expect((await app.json("/api/v1/library/history", { json: { events: [{ ...ev, extra: 1 }] } })).status).toBe(400);
  });

  it("ends when the account revokes the device's session", async () => {
    const sessions = await web.json<{ items: { id: string; method: string }[] }>("/api/v1/me/sessions");
    const dev = sessions.body.items.find((x) => x.method === "device")!;
    expect((await web.json(`/api/v1/me/sessions/${dev.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await app.req("/api/v1/library/sync")).status).toBe(401);
    expect((await app.req(`/api/v1/stream/${someTrack}`)).status).toBe(401);
  });
});

describe("lyrics", () => {
  const enabled = process.env.LYRICS === "manual" && existsSync(`${process.env.TEST_FIXTURES}/speech.flac`);
  it.skipIf(!enabled)("transcribes a track with word timings, marks an instrumental as empty, and keeps hand corrections", async () => {
    const up = await owner.upload("speech.flac", fixture("speech.flac"));
    expect(up.body.status).toBe("ready");
    const id = up.body.trackId as string;
    expect((await owner.json(`/api/v1/library/tracks/${id}/lyrics`)).body).toMatchObject({ state: "none", enabled: true });
    // a listener can read lyrics but never ask for or edit them
    expect((await listener.json("/api/v1/admin/lyrics/generate", { json: { ids: [id] } })).status).toBe(403);
    expect((await listener.json(`/api/v1/admin/tracks/${id}/lyrics`, { method: "PUT", json: { lines: [] } })).status).toBe(403);
    expect((await owner.json("/api/v1/admin/lyrics/generate", { json: { ids: [id, trackB], language: "en" } })).body).toMatchObject({ queued: 2 });
    type L = { state: string; lines: { t: number; e: number; text: string; w?: [number, number, string][] }[]; edited?: boolean };
    const wait = async (tid: string) => { for (let i = 0; i < 200; i++) { const l = (await owner.json(`/api/v1/library/tracks/${tid}/lyrics`)).body as unknown as L; if (!["queued", "working"].includes(l.state)) return l; await sleep(500); } throw new Error("lyrics timeout"); };
    const spoken = await wait(id);
    expect(spoken.state).toBe("ready");
    const all = spoken.lines.map((l) => l.text).join(" ").toLowerCase();
    expect(all).toContain("fox"); expect(all).toContain("cluster");
    const words = spoken.lines.flatMap((l) => l.w ?? []);
    expect(words.length).toBeGreaterThan(8);
    for (let i = 1; i < words.length; i++) expect(words[i][0]).toBeGreaterThanOrEqual(words[i - 1][0]);      // monotonic timings
    expect(spoken.lines[0].t).toBeLessThan(2000);
    expect((await wait(trackB)).state).toBe("empty");                                                           // a sine wave has no words
    expect(((await listener.json(`/api/v1/library/tracks/${id}/lyrics`)).body as unknown as L).state).toBe("ready");
    expect(((await owner.json(`/api/v1/library/tracks/${id}`)).body as unknown as { lyricsState: string }).lyricsState).toBe("ready");
    // correction by hand: unchanged lines keep their word timings, the edited one loses them
    const edited = spoken.lines.map((l, i) => ({ t: l.t, e: l.e, text: i === 0 ? "Texte corrigé" : l.text }));
    expect((await owner.json(`/api/v1/admin/tracks/${id}/lyrics`, { method: "PUT", json: { lines: edited } })).status).toBe(200);
    const after = (await owner.json(`/api/v1/library/tracks/${id}/lyrics`)).body as unknown as L;
    expect(after.edited).toBe(true); expect(after.lines[0].text).toBe("Texte corrigé"); expect(after.lines[0].w).toBeUndefined();
    if (after.lines.length > 1) expect(after.lines[1].w!.length).toBeGreaterThan(0);
    // regenerating does not overwrite a correction unless asked to
    expect((await owner.json("/api/v1/admin/lyrics/generate", { json: { ids: [id] } })).body).toMatchObject({ queued: 0, skipped: 1 });
    expect((await owner.json(`/api/v1/admin/tracks/${id}/lyrics`, { method: "DELETE" })).status).toBe(200);
    expect((await owner.json(`/api/v1/library/tracks/${id}/lyrics`)).body).toMatchObject({ state: "none" });
  });
  it.skipIf(enabled)("is skipped: no local mlx-whisper virtualenv", () => { console.warn("lyrics tests skipped (LYRICS_PYTHON not available)"); });
});
