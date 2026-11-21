/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Music SP
 * File             : src/server/sync.ts
 * Module           : server
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

import { sql } from "@/lib/db";
import { ApiError } from "@/lib/http";

/**
 * Read side for native clients that keep their own copy of the catalogue (SP Music for macOS).
 *
 * `librarySync(since)` returns every artist, album and track whose revision is above `since`, plus the tombstones
 * of what was deleted. All four reads share one snapshot; revisions commit in increasing order (see migration 003),
 * so the highest revision in the answer is a safe cursor for the next call.
 */

const PAGE = 4000;

export async function librarySync(since: number) {
  return sql.begin("isolation level repeatable read read only", async (tx) => {
    const [artists, albums, tracks, deleted, [counts]] = await Promise.all([
      tx<{ rev: number }[]>`SELECT a.id, a.name, a.rev::float8 AS rev FROM artists a WHERE a.rev > ${since} ORDER BY a.rev LIMIT ${PAGE}`,
      tx<{ rev: number }[]>`
        SELECT al.id, al.title, al.year, al.artwork_id AS "artworkId", al.artist_id AS "artistId", g.name AS genre, al.created_at AS "createdAt", al.rev::float8 AS rev
        FROM albums al LEFT JOIN genres g ON g.id = al.genre_id WHERE al.rev > ${since} ORDER BY al.rev LIMIT ${PAGE}`,
      tx<{ rev: number }[]>`
        SELECT t.id, t.title, t.track_no AS "trackNo", t.disc_no AS "discNo", t.duration_ms AS "durationMs", t.year,
          t.codec, t.container, t.sample_rate AS "sampleRate", t.bit_depth AS "bitDepth", t.channels, t.bitrate,
          t.web_playable AS "webPlayable", t.compat_state AS "compatState", t.artist_id AS "artistId", t.album_id AS "albumId", g.name AS genre,
          (SELECT ly.state FROM lyrics ly WHERE ly.track_id = t.id) AS "lyricsState", t.created_at AS "createdAt",
          (SELECT json_build_object('assetId', m.id, 'sha256', m.sha256, 'sizeBytes', m.size_bytes, 'mime', m.mime) FROM media_assets m WHERE m.track_id = t.id AND m.kind = 'original') AS file,
          (SELECT json_build_object('assetId', m.id, 'sizeBytes', m.size_bytes, 'mime', m.mime) FROM media_assets m WHERE m.track_id = t.id AND m.kind = 'rendition') AS compat,
          t.rev::float8 AS rev
        FROM tracks t LEFT JOIN genres g ON g.id = t.genre_id WHERE t.rev > ${since} ORDER BY t.rev LIMIT ${PAGE}`,
      tx<{ rev: number }[]>`SELECT kind, id, rev::float8 AS rev FROM library_tombstones WHERE rev > ${since} ORDER BY rev LIMIT ${PAGE}`,
      tx<{ artists: number; albums: number; tracks: number }[]>`SELECT (SELECT count(*)::int FROM artists) AS artists, (SELECT count(*)::int FROM albums) AS albums, (SELECT count(*)::int FROM tracks) AS tracks`,
    ]);
    // A truncated list ends at its last revision: the cursor may not go past the lowest such end, or rows would be skipped.
    const lists = [artists, albums, tracks, deleted];
    const truncated = lists.filter((l) => l.length === PAGE);
    const more = truncated.length > 0;
    const top = (l: { rev: number }[]) => (l.length ? l[l.length - 1].rev : since);
    const rev = more ? Math.min(...truncated.map(top)) : Math.max(since, ...lists.map(top));
    const keep = <T extends { rev: number }>(l: T[]) => (more ? l.filter((r) => r.rev <= rev) : l);
    return { since, rev, more, artists: keep(artists), albums: keep(albums), tracks: keep(tracks), deleted: keep(deleted), counts };
  });
}

/** Everything that belongs to one account, in one answer: small by nature, so always sent whole. */
export async function userSync(userId: string) {
  const [playlists, entries, favTracks, favAlbums, [pb]] = await Promise.all([
    sql<{ id: string }[]>`SELECT id, name, created_at AS "createdAt", updated_at AS "updatedAt" FROM playlists WHERE user_id = ${userId} ORDER BY updated_at DESC`,
    sql<{ playlistId: string }[]>`
      SELECT pt.playlist_id AS "playlistId", pt.id AS "entryId", pt.track_id AS "trackId", pt.position, pt.added_at AS "addedAt"
      FROM playlist_tracks pt JOIN playlists p ON p.id = pt.playlist_id WHERE p.user_id = ${userId} ORDER BY pt.playlist_id, pt.position, pt.added_at`,
    sql`SELECT track_id AS id, created_at AS "createdAt" FROM favorites WHERE user_id = ${userId} ORDER BY created_at DESC`,
    sql`SELECT album_id AS id, created_at AS "createdAt" FROM favorite_albums WHERE user_id = ${userId} ORDER BY created_at DESC`,
    sql<{ queue: string[]; queue_index: number; position_ms: number; shuffle: boolean; repeat: string; volume: number; updated_at: Date }[]>`
      SELECT queue, queue_index, position_ms, shuffle, repeat, volume, updated_at FROM playback_state WHERE user_id = ${userId}`,
  ]);
  const by = new Map<string, unknown[]>();
  for (const e of entries) { const { playlistId, ...rest } = e; (by.get(playlistId) ?? by.set(playlistId, []).get(playlistId)!).push(rest); }
  return {
    playlists: playlists.map((p) => ({ ...p, entries: by.get(p.id) ?? [] })),
    favoriteTracks: favTracks, favoriteAlbums: favAlbums,
    playback: pb ? { queue: pb.queue, index: pb.queue_index, positionMs: pb.position_ms, shuffle: pb.shuffle, repeat: pb.repeat, volume: pb.volume, updatedAt: pb.updated_at } : null,
  };
}

// ── Listening history ───────────────────────────────────────────────────────────────────────────────

export interface PlayEvent { id: string; trackId: string; playedAt: string; listenedMs: number; completed: boolean; source: "stream" | "local" }

/** Idempotent: an event already stored (same client-generated id) or naming a deleted track is skipped, not refused. */
export async function recordPlays(userId: string, client: string, events: PlayEvent[]) {
  if (events.length === 0) return { stored: 0, skipped: 0 };
  const known = new Set((await sql<{ id: string }[]>`SELECT id FROM tracks WHERE id = ANY(${events.map((e) => e.trackId)}::uuid[])`).map((r) => r.id));
  const now = Date.now();
  let stored = 0;
  for (const e of events) {
    if (!known.has(e.trackId)) continue;
    const at = new Date(e.playedAt);
    if (Number.isNaN(at.getTime()) || at.getTime() > now + 86_400_000) continue;       // a clock far in the future is not history
    const r = await sql`INSERT INTO play_events (id, user_id, track_id, played_at, listened_ms, completed, source, client)
      VALUES (${e.id}, ${userId}, ${e.trackId}, ${at}, ${e.listenedMs}, ${e.completed}, ${e.source}, ${client.slice(0, 120)}) ON CONFLICT (id) DO NOTHING RETURNING id`;
    stored += r.length;
  }
  return { stored, skipped: events.length - stored };
}

export async function listPlays(userId: string, p: { limit: number; offset: number }) {
  const [items, [{ n }]] = await Promise.all([
    sql`SELECT id, track_id AS "trackId", played_at AS "playedAt", listened_ms AS "listenedMs", completed, source
        FROM play_events WHERE user_id = ${userId} ORDER BY played_at DESC, id LIMIT ${p.limit} OFFSET ${p.offset}`,
    sql<{ n: number }[]>`SELECT count(*)::int AS n FROM play_events WHERE user_id = ${userId}`,
  ]);
  return { items, total: n, ...p };
}

/** Optimistic concurrency for playlist edits made offline: refuse when the list changed after the client's copy. */
export async function assertPlaylistBase(userId: string, id: string, base: string | undefined) {
  if (!base) return;
  const at = new Date(base);
  if (Number.isNaN(at.getTime())) throw new ApiError(400, "invalid_input", "baseUpdatedAt is not a date");
  const [p] = await sql<{ updated_at: Date }[]>`SELECT updated_at FROM playlists WHERE id = ${id} AND user_id = ${userId}`;
  if (!p) throw new ApiError(404, "not_found", "Playlist not found");
  // The client holds millisecond precision (JSON dates); compare at that precision.
  if (Math.floor(p.updated_at.getTime()) > at.getTime()) throw new ApiError(409, "conflict", "The playlist was changed elsewhere", { updatedAt: p.updated_at.toISOString() });
}

export async function playlistStamp(userId: string, id: string) {
  const [p] = await sql<{ updated_at: Date }[]>`SELECT updated_at FROM playlists WHERE id = ${id} AND user_id = ${userId}`;
  return { ok: true, updatedAt: p?.updated_at ?? null };
}
