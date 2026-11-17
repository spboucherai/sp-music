import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { sql, type Tx } from "@/lib/db";
import { env } from "@/lib/env";
import { ApiError } from "@/lib/http";
import { audit } from "@/lib/audit";
import { issueSetupToken, type UserContext } from "@/lib/auth";
import { clean, norm, safeFilename } from "@/lib/text";
import { storage } from "./storage";
import { libraryBytes, pruneOrphans, storeArtwork, uploadTmpPath, upsertAlbum, upsertArtist, upsertGenre } from "./ingest";
import { MediaError } from "./media";

/** Write side of the library. Every function here is only reachable through the admin router (role checked there). */

// ── Uploads ─────────────────────────────────────────────────────────────────────────────────────────

const uploadCols = sql`u.id, u.filename, u.size_bytes::float8 AS "sizeBytes", u.received_bytes::float8 AS "receivedBytes", u.status, u.error_code AS "errorCode",
  u.error_detail AS "errorDetail", u.kind, u.track_id AS "trackId", u.duplicate_of AS "duplicateOf", u.parent_id AS "parentId", u.created_at AS "createdAt", u.updated_at AS "updatedAt",
  (SELECT t.title FROM tracks t WHERE t.id = coalesce(u.track_id, u.duplicate_of)) AS "trackTitle"`;

export function uploadLimits() {
  return { maxFileBytes: env.maxFileBytes, chunkBytes: Math.min(8 * 1024 * 1024, env.maxChunkBytes), maxFiles: env.maxFilesPerBatch, quotaBytes: env.libraryQuotaBytes };
}

export async function createUpload(user: UserContext, input: { filename: string; size: number }) {
  if (input.size <= 0) throw new ApiError(400, "empty_file", "The file is empty");
  if (input.size > env.maxFileBytes) throw new ApiError(413, "file_too_large", `Files are limited to ${Math.round(env.maxFileBytes / 1048576)} MB`);
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM uploads WHERE status IN ('uploading', 'received', 'validating', 'extracting') AND parent_id IS NULL`;
  if (n >= env.maxFilesPerBatch) throw new ApiError(429, "too_many_uploads", `At most ${env.maxFilesPerBatch} files can be in progress at once`);
  const quota = env.libraryQuotaBytes;
  if (quota && (await libraryBytes()) + input.size > quota) throw new ApiError(413, "quota_exceeded", "The library quota is reached");
  const health = await storage().health();
  if (!health.ok) throw new ApiError(503, "storage_unavailable", "The library storage is not available");
  if (health.freeBytes !== null && health.freeBytes < input.size * 2 + 512 * 1024 * 1024) throw new ApiError(507, "disk_full", "Not enough free space on the library volume");
  const id = randomUUID();
  const tmp = uploadTmpPath(id);
  await mkdir(path.dirname(tmp), { recursive: true, mode: 0o700 });
  await (await open(tmp, "w", 0o600)).close();
  await sql`INSERT INTO uploads (id, user_id, filename, size_bytes) VALUES (${id}, ${user.userId}, ${safeFilename(input.filename)}, ${input.size})`;
  return { id, receivedBytes: 0, ...uploadLimits() };
}

/**
 * Appends one chunk at `offset`. The body is streamed to disk (never buffered whole) and counted as it arrives.
 * A chunk sent at the wrong offset answers 409 with the offset the server expects, which is how a client resumes.
 */
export async function appendChunk(id: string, offset: number, req: Request) {
  const [u] = await sql<{ size_bytes: string; received_bytes: string; status: string }[]>`SELECT size_bytes, received_bytes, status FROM uploads WHERE id = ${id}`;
  if (!u) throw new ApiError(404, "not_found", "Upload not found");
  if (u.status !== "uploading") throw new ApiError(409, "not_uploading", "This upload no longer accepts data");
  const size = Number(u.size_bytes), received = Number(u.received_bytes);
  if (offset !== received) throw new ApiError(409, "offset_mismatch", "Unexpected offset", { receivedBytes: received });
  const declared = Number(req.headers.get("content-length") ?? NaN);
  const room = Math.min(env.maxChunkBytes, size - received);
  if (Number.isFinite(declared) && declared > room) throw new ApiError(413, "chunk_too_large", "Chunk larger than allowed");
  if (!req.body) throw new ApiError(400, "empty_chunk", "Empty chunk");
  const tmp = uploadTmpPath(id);
  if (!(await stat(tmp).catch(() => null))) throw new ApiError(409, "file_missing", "The upload must be restarted");
  let n = 0;
  const guard = new Transform({ transform(chunk: Buffer, _e, cb) { n += chunk.length; if (n > room) cb(new ApiError(413, "chunk_too_large", "Chunk larger than allowed")); else cb(null, chunk); } });
  try {
    await pipeline(Readable.fromWeb(req.body as never), guard, createWriteStream(tmp, { flags: "r+", start: received }));
  } catch (e) { if (e instanceof ApiError) throw e; throw new ApiError(400, "chunk_interrupted", "The chunk was interrupted", { receivedBytes: received }); }
  if (n === 0) throw new ApiError(400, "empty_chunk", "Empty chunk");
  const done = received + n === size;
  const upd = await sql`UPDATE uploads SET received_bytes = ${received + n}, status = ${done ? "received" : "uploading"}, updated_at = now()
                        WHERE id = ${id} AND status = 'uploading' AND received_bytes = ${received} RETURNING id`;
  if (upd.length === 0) throw new ApiError(409, "offset_mismatch", "Concurrent write", { receivedBytes: received });
  return { receivedBytes: received + n, complete: done };
}

export async function getUpload(id: string) {
  const [u] = await sql`SELECT ${uploadCols} FROM uploads u WHERE u.id = ${id}`;
  if (!u) throw new ApiError(404, "not_found", "Upload not found");
  return u;
}

export async function listUploads(filter: "all" | "active" | "error" | "duplicate" | "ready", p: { limit: number; offset: number }) {
  const where = filter === "active" ? sql`u.status IN ('uploading', 'received', 'validating', 'extracting')` : filter === "error" ? sql`u.status = 'error'`
    : filter === "duplicate" ? sql`u.status = 'duplicate'` : filter === "ready" ? sql`u.status = 'ready'` : sql`true`;
  const [items, [{ n }], counts] = await Promise.all([
    sql`SELECT ${uploadCols} FROM uploads u WHERE ${where} ORDER BY u.created_at DESC, u.filename LIMIT ${p.limit} OFFSET ${p.offset}`,
    sql<{ n: number }[]>`SELECT count(*)::int AS n FROM uploads u WHERE ${where}`,
    sql<{ status: string; n: number }[]>`SELECT status, count(*)::int AS n FROM uploads GROUP BY status`,
  ]);
  return { items, total: n, ...p, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) };
}

export async function cancelUpload(user: UserContext, id: string) {
  const r = await sql`UPDATE uploads SET status = 'cancelled', updated_at = now() WHERE id = ${id} AND status IN ('uploading', 'received', 'duplicate', 'error') RETURNING id`;
  if (r.length === 0) throw new ApiError(409, "not_cancellable", "This upload can no longer be cancelled");
  await rm(uploadTmpPath(id), { force: true });
  return { ok: true };
}

/** Error → back in the queue when the data is still on the server; otherwise the client must send it again. */
export async function retryUpload(id: string) {
  const [u] = await sql<{ status: string; size_bytes: string }[]>`SELECT status, size_bytes FROM uploads WHERE id = ${id}`;
  if (!u) throw new ApiError(404, "not_found");
  if (u.status !== "error") throw new ApiError(409, "not_retryable", "Only failed imports can be retried");
  const st = await stat(uploadTmpPath(id)).catch(() => null);
  if (!st || st.size !== Number(u.size_bytes)) throw new ApiError(409, "file_missing", "The file must be uploaded again");
  await sql`UPDATE uploads SET status = 'received', error_code = NULL, error_detail = NULL, attempts = 0, updated_at = now() WHERE id = ${id}`;
  return { ok: true };
}

/** Explicit confirmation that a detected duplicate replaces the track already in the library. */
export async function confirmReplace(user: UserContext, id: string) {
  const r = await sql<{ duplicate_of: string }[]>`UPDATE uploads SET replace = true, status = 'received', error_code = NULL, updated_at = now() WHERE id = ${id} AND status = 'duplicate' RETURNING duplicate_of`;
  if (r.length === 0) throw new ApiError(409, "not_duplicate", "This upload is not waiting for a decision");
  await audit({ userId: user.userId, actor: "admin", action: "upload.replace_confirmed", entity: "track", entityId: r[0].duplicate_of ?? "" });
  return { ok: true };
}

export async function clearUploads() {
  const rows = await sql<{ id: string }[]>`DELETE FROM uploads WHERE status IN ('ready', 'cancelled', 'error', 'duplicate') RETURNING id`;
  for (const r of rows) await rm(uploadTmpPath(r.id), { force: true });
  return { removed: rows.length };
}

// ── Library edits ───────────────────────────────────────────────────────────────────────────────────

export interface TrackPatch { title?: string; artist?: string; album?: string; albumArtist?: string; trackNo?: number | null; discNo?: number; year?: number | null; genre?: string }

async function patchTrack(tx: Tx, id: string, p: TrackPatch) {
  const [cur] = await tx<{ id: string; album_id: string; album_title: string; album_artist: string; album_year: number | null; album_genre: string | null; album_art: string | null }[]>`
    SELECT t.id, t.album_id, al.title AS album_title, aa.name AS album_artist, al.year AS album_year, al.genre_id AS album_genre, al.artwork_id AS album_art
    FROM tracks t JOIN albums al ON al.id = t.album_id JOIN artists aa ON aa.id = al.artist_id WHERE t.id = ${id} FOR UPDATE OF t`;
  if (!cur) throw new ApiError(404, "not_found", "Track not found");
  const set: Record<string, unknown> = {};
  if (p.title !== undefined) { const t = clean(p.title); if (!t) throw new ApiError(400, "invalid_input", "The title cannot be empty"); set.title = t; set.title_norm = norm(t); }
  if (p.artist !== undefined) set.artist_id = await upsertArtist(tx, p.artist);
  if (p.trackNo !== undefined) set.track_no = p.trackNo;
  if (p.discNo !== undefined) set.disc_no = p.discNo;
  if (p.year !== undefined) set.year = p.year;
  let genreId: string | null | undefined;
  if (p.genre !== undefined) { genreId = await upsertGenre(tx, p.genre); set.genre_id = genreId; }
  if (p.album !== undefined || p.albumArtist !== undefined) {
    // Moving to another album: found by (album artist, title) or created; the cover follows when the target has none.
    const artistId = await upsertArtist(tx, p.albumArtist ?? cur.album_artist);
    set.album_id = await upsertAlbum(tx, { title: p.album ?? cur.album_title, artistId, year: p.year ?? cur.album_year, genreId: genreId ?? cur.album_genre, artworkId: cur.album_art });
  }
  if (Object.keys(set).length) await tx`UPDATE tracks SET ${tx(set)}, updated_at = now() WHERE id = ${id}`;
}

export async function updateTracks(user: UserContext, ids: string[], patch: TrackPatch) {
  if (ids.length > 1 && patch.title !== undefined) throw new ApiError(400, "invalid_input", "A title can only be set on one track at a time");
  await sql.begin(async (tx) => { for (const id of ids) await patchTrack(tx, id, patch); });
  await audit({ userId: user.userId, actor: "admin", action: "track.updated", entity: "track", entityId: ids.length === 1 ? ids[0] : "", meta: { count: ids.length, fields: Object.keys(patch) } });
  await pruneOrphans();
  return { updated: ids.length };
}

export async function updateAlbum(user: UserContext, id: string, p: { title?: string; artist?: string; year?: number | null; genre?: string }) {
  const merged = await sql.begin(async (tx) => {
    const [al] = await tx<{ id: string; title: string; artist_id: string; year: number | null; genre_id: string | null; artwork_id: string | null }[]>`SELECT id, title, artist_id, year, genre_id, artwork_id FROM albums WHERE id = ${id} FOR UPDATE`;
    if (!al) throw new ApiError(404, "not_found", "Album not found");
    const title = p.title !== undefined ? clean(p.title) : al.title;
    if (!title) throw new ApiError(400, "invalid_input", "The title cannot be empty");
    const artistId = p.artist !== undefined ? await upsertArtist(tx, p.artist) : al.artist_id;
    const genreId = p.genre !== undefined ? await upsertGenre(tx, p.genre) : al.genre_id;
    const year = p.year !== undefined ? p.year : al.year;
    const [other] = await tx<{ id: string }[]>`SELECT id FROM albums WHERE artist_id = ${artistId} AND title_norm = ${norm(title)} AND id <> ${id}`;
    if (other) {
      // The new identity is an album that already exists: its tracks join it (merge).
      await tx`UPDATE tracks SET album_id = ${other.id}, updated_at = now() WHERE album_id = ${id}`;
      await tx`UPDATE albums SET artwork_id = coalesce(artwork_id, ${al.artwork_id}), year = coalesce(year, ${year}), genre_id = coalesce(genre_id, ${genreId}) WHERE id = ${other.id}`;
      await tx`DELETE FROM favorite_albums WHERE album_id = ${id}`;
      await tx`DELETE FROM albums WHERE id = ${id}`;
      return other.id;
    }
    await tx`UPDATE albums SET title = ${title}, title_norm = ${norm(title)}, artist_id = ${artistId}, year = ${year}, genre_id = ${genreId} WHERE id = ${id}`;
    return null;
  }) as string | null;
  await audit({ userId: user.userId, actor: "admin", action: merged ? "album.merged" : "album.updated", entity: "album", entityId: id, meta: { fields: Object.keys(p), into: merged ?? undefined } });
  await pruneOrphans();
  return { id: merged ?? id, merged: !!merged };
}

/** Track order of an album: the given ids become tracks 1..n of their disc, in that order. */
export async function reorderAlbum(user: UserContext, albumId: string, trackIds: string[]) {
  await sql.begin(async (tx) => {
    const rows = await tx<{ id: string; disc_no: number }[]>`SELECT id, disc_no FROM tracks WHERE album_id = ${albumId} FOR UPDATE`;
    const disc = new Map(rows.map((r) => [r.id, r.disc_no]));
    if (trackIds.length !== rows.length || !trackIds.every((t) => disc.has(t)) || new Set(trackIds).size !== trackIds.length) throw new ApiError(400, "invalid_input", "The order must list every track of the album once");
    const next = new Map<number, number>();
    for (const t of trackIds) { const d = disc.get(t)!; const n = (next.get(d) ?? 0) + 1; next.set(d, n); await tx`UPDATE tracks SET track_no = ${n}, updated_at = now() WHERE id = ${t}`; }
  });
  await audit({ userId: user.userId, actor: "admin", action: "album.reordered", entity: "album", entityId: albumId });
  return { ok: true };
}

const MAX_COVER_UPLOAD = 25 * 1024 * 1024;
export async function setAlbumArtwork(user: UserContext, albumId: string, req: Request) {
  const [al] = await sql<{ id: string }[]>`SELECT id FROM albums WHERE id = ${albumId}`;
  if (!al) throw new ApiError(404, "not_found", "Album not found");
  if (!req.body) throw new ApiError(400, "invalid_input", "Image required");
  const dir = path.join(env.tmpDir, "work");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `${randomUUID()}.img`);
  let n = 0;
  const guard = new Transform({ transform(chunk: Buffer, _e, cb) { n += chunk.length; if (n > MAX_COVER_UPLOAD) cb(new ApiError(413, "image_too_large", "Covers are limited to 25 MB")); else cb(null, chunk); } });
  try {
    try { await pipeline(Readable.fromWeb(req.body as never), guard, createWriteStream(tmp, { mode: 0o600 })); }
    catch (e) { if (e instanceof ApiError) throw e; throw new ApiError(400, "upload_interrupted", "The image upload was interrupted"); }
    let artworkId: string;
    try { artworkId = await storeArtwork(tmp); }
    catch (e) { if (e instanceof MediaError) throw new ApiError(400, e.code, e.message); throw e; }
    await sql`UPDATE albums SET artwork_id = ${artworkId} WHERE id = ${albumId}`;
    await audit({ userId: user.userId, actor: "admin", action: "album.artwork_set", entity: "album", entityId: albumId });
    await pruneOrphans();
    return { artworkId };
  } finally { await rm(tmp, { force: true }); }
}

/**
 * Deletes tracks: rows first (one transaction), then exactly the files those rows named — the storage keys are
 * read from media_assets of the deleted tracks, so no other file can be touched.
 */
export async function deleteTracks(user: UserContext, ids: string[]) {
  const removed = await sql.begin(async (tx) => {
    const tracks = await tx<{ id: string; title: string; album: string; artist: string }[]>`
      SELECT t.id, t.title, al.title AS album, ar.name AS artist FROM tracks t JOIN albums al ON al.id = t.album_id JOIN artists ar ON ar.id = t.artist_id WHERE t.id = ANY(${ids}::uuid[]) FOR UPDATE OF t`;
    if (tracks.length === 0) throw new ApiError(404, "not_found", "Track not found");
    const tids = tracks.map((t) => t.id);
    const assets = await tx<{ storage_key: string; sha256: string | null; kind: string; track_id: string }[]>`SELECT storage_key, sha256, kind, track_id FROM media_assets WHERE track_id = ANY(${tids}::uuid[])`;
    await tx`DELETE FROM tracks WHERE id = ANY(${tids}::uuid[])`;      // cascades: assets, favourites, playlist entries
    for (const t of tracks) {
      await audit({ userId: user.userId, actor: "admin", action: "track.deleted", entity: "track", entityId: t.id,
        meta: { title: t.title, album: t.album, artist: t.artist, sha256: assets.find((a) => a.track_id === t.id && a.kind === "original")?.sha256 ?? null } }, tx);
    }
    return { tracks, assets };
  }) as { tracks: { id: string }[]; assets: { storage_key: string }[] };
  const st = storage();
  let fileErrors = 0;
  for (const a of removed.assets) await st.delete(a.storage_key).catch(() => { fileErrors++; });
  await pruneOrphans();
  return { deleted: removed.tracks.length, fileErrors };
}

export async function deleteAlbum(user: UserContext, albumId: string) {
  const rows = await sql<{ id: string }[]>`SELECT id FROM tracks WHERE album_id = ${albumId}`;
  const [al] = await sql<{ title: string }[]>`SELECT title FROM albums WHERE id = ${albumId}`;
  if (!al) throw new ApiError(404, "not_found", "Album not found");
  await audit({ userId: user.userId, actor: "admin", action: "album.deleted", entity: "album", entityId: albumId, meta: { title: al.title, tracks: rows.length } });
  if (rows.length === 0) { await pruneOrphans(); return { deleted: 0, fileErrors: 0 }; }
  return deleteTracks(user, rows.map((r) => r.id));
}

/** Queues a fresh analysis (technical data, missing cover, rendition) — picked up by the worker. */
export async function requestReanalysis(user: UserContext, ids: string[]) {
  const r = await sql`UPDATE tracks SET analysis_requested = true, updated_at = now() WHERE id = ANY(${ids}::uuid[]) RETURNING id`;
  if (r.length === 0) throw new ApiError(404, "not_found");
  await audit({ userId: user.userId, actor: "admin", action: "track.reanalysis_requested", meta: { count: r.length } });
  return { queued: r.length };
}

// ── Accounts ────────────────────────────────────────────────────────────────────────────────────────

export const listUsers = () => sql`
  SELECT u.id, u.email, u.display_name AS "displayName", u.role, u.is_owner AS "isOwner", u.disabled_at AS "disabledAt", u.created_at AS "createdAt",
    (SELECT count(*)::int FROM authenticators a WHERE a.user_id = u.id) AS passkeys,
    (SELECT count(*)::int FROM sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > now()) AS sessions,
    (SELECT max(s.last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS "lastSeenAt",
    EXISTS (SELECT 1 FROM setup_tokens t WHERE t.user_id = u.id AND t.used_at IS NULL AND t.expires_at > now()) AS "invitePending"
  FROM users u ORDER BY u.is_owner DESC, u.created_at`;

const INVITE_TTL_MIN = 72 * 60;
const inviteUrl = (token: string) => `${env.appUrl}/setup#${token}`;

/** There is no public sign-up: an account exists only because an administrator created it. The link is shown once. */
export async function inviteUser(admin: UserContext, input: { email: string; displayName: string; role: "admin" | "listener" }) {
  let id: string;
  try {
    [{ id }] = await sql<{ id: string }[]>`INSERT INTO users (email, display_name, role) VALUES (${input.email}, ${clean(input.displayName, 80)}, ${input.role}) RETURNING id`;
  } catch (e) { if ((e as { code?: string }).code === "23505") throw new ApiError(409, "email_taken", "An account already uses this address"); throw e; }
  const token = await issueSetupToken(id, "invite", INVITE_TTL_MIN);
  await audit({ userId: admin.userId, actor: "admin", action: "user.invited", entity: "user", entityId: id, meta: { role: input.role } });
  return { id, inviteUrl: inviteUrl(token), expiresInHours: INVITE_TTL_MIN / 60 };
}

async function targetUser(id: string) {
  const [u] = await sql<{ id: string; is_owner: boolean; role: string }[]>`SELECT id, is_owner, role FROM users WHERE id = ${id}`;
  if (!u) throw new ApiError(404, "not_found", "Account not found");
  return u;
}

export async function reinviteUser(admin: UserContext, id: string) {
  const u = await targetUser(id);
  if (u.is_owner) throw new ApiError(403, "owner_protected", "The owner's access is recovered from the server's shell only");
  const token = await issueSetupToken(id, "invite", INVITE_TTL_MIN);
  await audit({ userId: admin.userId, actor: "admin", action: "user.reinvited", entity: "user", entityId: id });
  return { inviteUrl: inviteUrl(token), expiresInHours: INVITE_TTL_MIN / 60 };
}

export async function updateUser(admin: UserContext, id: string, p: { role?: "admin" | "listener"; disabled?: boolean; displayName?: string }) {
  const u = await targetUser(id);
  if (u.is_owner && (p.role !== undefined || p.disabled !== undefined)) throw new ApiError(403, "owner_protected", "The owner account cannot be demoted or disabled");
  if (id === admin.userId && (p.role === "listener" || p.disabled)) throw new ApiError(403, "self_protected", "You cannot demote or disable your own account");
  await sql.begin(async (tx) => {
    if (p.role !== undefined) await tx`UPDATE users SET role = ${p.role} WHERE id = ${id}`;
    if (p.displayName !== undefined) await tx`UPDATE users SET display_name = ${clean(p.displayName, 80)} WHERE id = ${id}`;
    if (p.disabled !== undefined) {
      await tx`UPDATE users SET disabled_at = ${p.disabled ? sql`now()` : null} WHERE id = ${id}`;
      if (p.disabled) await tx`UPDATE sessions SET revoked_at = now() WHERE user_id = ${id} AND revoked_at IS NULL`;
    }
  });
  await audit({ userId: admin.userId, actor: "admin", action: "user.updated", entity: "user", entityId: id, meta: p });
  return { ok: true };
}

export async function deleteUser(admin: UserContext, id: string) {
  const u = await targetUser(id);
  if (u.is_owner) throw new ApiError(403, "owner_protected", "The owner account cannot be deleted");
  if (id === admin.userId) throw new ApiError(403, "self_protected", "You cannot delete your own account");
  await sql`DELETE FROM users WHERE id = ${id}`;
  await audit({ userId: admin.userId, actor: "admin", action: "user.deleted", entity: "user", entityId: id });
  return { ok: true };
}

export async function revokeUserSessions(admin: UserContext, id: string) {
  await targetUser(id);
  const r = await sql`UPDATE sessions SET revoked_at = now() WHERE user_id = ${id} AND revoked_at IS NULL AND id <> ${admin.sessionId} RETURNING id`;
  await audit({ userId: admin.userId, actor: "admin", action: "user.sessions_revoked", entity: "user", entityId: id, meta: { count: r.length } });
  return { revoked: r.length };
}

// ── Health and audit ────────────────────────────────────────────────────────────────────────────────

export async function health() {
  const st = storage();
  const [sth, [c], byKind, statuses, [hb], recentErrors] = await Promise.all([
    st.health(),
    sql<{ tracks: number; albums: number; artists: number; duration: number; unplayable: number; compat_pending: number; compat_error: number }[]>`
      SELECT (SELECT count(*)::int FROM tracks) AS tracks, (SELECT count(*)::int FROM albums) AS albums, (SELECT count(*)::int FROM artists) AS artists,
        (SELECT coalesce(sum(duration_ms), 0)::float8 FROM tracks) AS duration,
        (SELECT count(*)::int FROM tracks WHERE web_playable <> 'yes' AND compat_state <> 'ready') AS unplayable,
        (SELECT count(*)::int FROM tracks WHERE compat_state IN ('queued', 'working')) AS compat_pending,
        (SELECT count(*)::int FROM tracks WHERE compat_state = 'error') AS compat_error`,
    sql<{ kind: string; files: number; bytes: number }[]>`SELECT kind, count(*)::int AS files, coalesce(sum(size_bytes), 0)::float8 AS bytes FROM media_assets GROUP BY kind`,
    sql<{ status: string; n: number }[]>`SELECT status, count(*)::int AS n FROM uploads GROUP BY status`,
    sql<{ age: number | null }[]>`SELECT (SELECT extract(epoch FROM now() - beat_at)::int FROM worker_heartbeat WHERE name = 'worker') AS age`,
    sql`SELECT id, filename, error_code AS "errorCode", error_detail AS "errorDetail", updated_at AS "updatedAt" FROM uploads WHERE status = 'error' ORDER BY updated_at DESC LIMIT 10`,
  ]);
  let backup: { at: string; database: boolean; library: boolean; files?: number; bytes?: number } | null = null;
  if (env.backupDir) {
    try { backup = JSON.parse(await readFile(path.join(env.backupDir, "last-backup.json"), "utf8")); } catch { backup = null; }
  }
  const used = byKind.reduce((s, k) => s + k.bytes, 0);
  return {
    storage: { driver: st.driver, available: sth.ok, freeBytes: sth.freeBytes, totalBytes: sth.totalBytes, usedBytes: used, quotaBytes: env.libraryQuotaBytes, byKind },
    library: { tracks: c.tracks, albums: c.albums, artists: c.artists, durationMs: c.duration, notPlayableInBrowser: c.unplayable, renditionsPending: c.compat_pending, renditionErrors: c.compat_error },
    imports: { counts: Object.fromEntries(statuses.map((s) => [s.status, s.n])), recentErrors },
    worker: { ok: hb.age !== null && hb.age < 120, ageSec: hb.age },
    backup: { configured: !!env.backupDir, last: backup },
    config: { renditions: env.renditions, renditionBitrateKbps: env.renditionBitrateK, transcodeDsd: env.transcodeDsd, maxFileBytes: env.maxFileBytes, uploadRetentionDays: env.uploadRetentionDays, rpId: env.rpId, origin: env.appUrl },
  };
}

export async function listAudit(p: { limit: number; offset: number }) {
  const [items, [{ n }]] = await Promise.all([
    sql`SELECT e.id::text, e.at, e.actor, e.action, e.entity, e.entity_id AS "entityId", e.meta, u.display_name AS "userName"
        FROM audit_events e LEFT JOIN users u ON u.id = e.user_id ORDER BY e.at DESC, e.id DESC LIMIT ${p.limit} OFFSET ${p.offset}`,
    sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_events`,
  ]);
  return { items, total: n, ...p };
}
