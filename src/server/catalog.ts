/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Music SP
 * File             : src/server/catalog.ts
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
import { norm } from "@/lib/text";

/** Read side of the library plus each account's own data (favourites, playlists, playback state). */

export interface Page { limit: number; offset: number }

const trackCols = (userId: string) => sql`
  t.id, t.title, t.track_no AS "trackNo", t.disc_no AS "discNo", t.duration_ms AS "durationMs", t.year,
  t.codec, t.container, t.sample_rate AS "sampleRate", t.bit_depth AS "bitDepth", t.channels, t.bitrate,
  t.web_playable AS "webPlayable", t.compat_state AS "compatState",
  json_build_object('id', ar.id, 'name', ar.name) AS artist,
  json_build_object('id', al.id, 'title', al.title, 'artworkId', al.artwork_id, 'artistName', aar.name) AS album,
  g.name AS genre,
  (SELECT ly.state FROM lyrics ly WHERE ly.track_id = t.id) AS "lyricsState",
  EXISTS (SELECT 1 FROM favorites f WHERE f.user_id = ${userId} AND f.track_id = t.id) AS favorite`;
const trackFrom = sql`
  FROM tracks t JOIN artists ar ON ar.id = t.artist_id JOIN albums al ON al.id = t.album_id
  JOIN artists aar ON aar.id = al.artist_id LEFT JOIN genres g ON g.id = t.genre_id`;

const albumCols = (userId: string) => sql`
  al.id, al.title, al.year, al.artwork_id AS "artworkId", al.created_at AS "createdAt",
  json_build_object('id', aar.id, 'name', aar.name) AS artist, g.name AS genre,
  (SELECT count(*)::int FROM tracks t WHERE t.album_id = al.id) AS "trackCount",
  (SELECT coalesce(sum(t.duration_ms), 0)::bigint FROM tracks t WHERE t.album_id = al.id)::float8 AS "durationMs",
  EXISTS (SELECT 1 FROM favorite_albums f WHERE f.user_id = ${userId} AND f.album_id = al.id) AS favorite`;
const albumFrom = sql`FROM albums al JOIN artists aar ON aar.id = al.artist_id LEFT JOIN genres g ON g.id = al.genre_id`;

const artistCols = sql`
  a.id, a.name,
  (SELECT count(*)::int FROM albums al WHERE al.artist_id = a.id) AS "albumCount",
  (SELECT count(*)::int FROM tracks t WHERE t.artist_id = a.id) AS "trackCount",
  (SELECT al.artwork_id FROM albums al WHERE al.artist_id = a.id AND al.artwork_id IS NOT NULL ORDER BY al.year DESC NULLS LAST LIMIT 1) AS "artworkId"`;

export async function home(userId: string) {
  const [recentAlbums, artists, recentTracks, playlists, [counts]] = await Promise.all([
    sql`SELECT ${albumCols(userId)} ${albumFrom} ORDER BY al.created_at DESC, al.title LIMIT 12`,
    sql`SELECT ${artistCols} FROM artists a WHERE EXISTS (SELECT 1 FROM tracks t WHERE t.artist_id = a.id) OR EXISTS (SELECT 1 FROM albums al WHERE al.artist_id = a.id) ORDER BY a.name_norm LIMIT 12`,
    sql`SELECT ${trackCols(userId)} ${trackFrom} ORDER BY t.created_at DESC, al.title, t.disc_no, t.track_no LIMIT 12`,
    listPlaylists(userId),
    sql<{ tracks: number; albums: number; artists: number }[]>`SELECT (SELECT count(*)::int FROM tracks) AS tracks, (SELECT count(*)::int FROM albums) AS albums, (SELECT count(*)::int FROM artists) AS artists`,
  ]);
  return { recentAlbums, artists, recentTracks, playlists: playlists.slice(0, 8), counts };
}

export async function listAlbums(userId: string, p: Page, sort: "recent" | "title" | "artist" | "year") {
  const order = sort === "recent" ? sql`al.created_at DESC, al.title_norm` : sort === "artist" ? sql`aar.name_norm, al.year NULLS LAST, al.title_norm` : sort === "year" ? sql`al.year DESC NULLS LAST, al.title_norm` : sql`al.title_norm`;
  const [items, [{ n }]] = await Promise.all([
    sql`SELECT ${albumCols(userId)} ${albumFrom} ORDER BY ${order} LIMIT ${p.limit} OFFSET ${p.offset}`,
    sql<{ n: number }[]>`SELECT count(*)::int AS n FROM albums`,
  ]);
  return { items, total: n, ...p };
}

export async function listArtists(p: Page) {
  const [items, [{ n }]] = await Promise.all([
    sql`SELECT ${artistCols} FROM artists a ORDER BY a.name_norm LIMIT ${p.limit} OFFSET ${p.offset}`,
    sql<{ n: number }[]>`SELECT count(*)::int AS n FROM artists`,
  ]);
  return { items, total: n, ...p };
}

export async function listTracks(userId: string, p: Page, sort: "title" | "recent" | "artist") {
  const order = sort === "recent" ? sql`t.created_at DESC, t.title_norm` : sort === "artist" ? sql`ar.name_norm, al.title_norm, t.disc_no, t.track_no` : sql`t.title_norm`;
  const [items, [{ n }]] = await Promise.all([
    sql`SELECT ${trackCols(userId)} ${trackFrom} ORDER BY ${order} LIMIT ${p.limit} OFFSET ${p.offset}`,
    sql<{ n: number }[]>`SELECT count(*)::int AS n FROM tracks`,
  ]);
  return { items, total: n, ...p };
}

export async function getAlbum(userId: string, id: string) {
  const [album] = await sql`SELECT ${albumCols(userId)} ${albumFrom} WHERE al.id = ${id}`;
  if (!album) throw new ApiError(404, "not_found", "Album not found");
  const tracks = await sql`SELECT ${trackCols(userId)} ${trackFrom} WHERE t.album_id = ${id} ORDER BY t.disc_no, t.track_no NULLS LAST, t.title_norm`;
  return { album, tracks };
}

export async function getArtist(userId: string, id: string) {
  const [artist] = await sql`SELECT ${artistCols} FROM artists a WHERE a.id = ${id}`;
  if (!artist) throw new ApiError(404, "not_found", "Artist not found");
  const [albums, tracks] = await Promise.all([
    sql`SELECT ${albumCols(userId)} ${albumFrom} WHERE al.artist_id = ${id} OR EXISTS (SELECT 1 FROM tracks t WHERE t.album_id = al.id AND t.artist_id = ${id}) ORDER BY al.year DESC NULLS LAST, al.title_norm`,
    sql`SELECT ${trackCols(userId)} ${trackFrom} WHERE t.artist_id = ${id} ORDER BY al.year DESC NULLS LAST, al.title_norm, t.disc_no, t.track_no NULLS LAST LIMIT 500`,
  ]);
  return { artist, albums, tracks };
}

export async function getTracks(userId: string, ids: string[]) {
  if (ids.length === 0) return [];
  const rows = await sql<{ id: string }[]>`SELECT ${trackCols(userId)} ${trackFrom} WHERE t.id = ANY(${ids}::uuid[])`;
  const by = new Map(rows.map((r) => [r.id, r]));
  return ids.map((i) => by.get(i)).filter(Boolean);
}

export async function search(userId: string, q: string) {
  const needle = norm(q);
  if (!needle) return { artists: [], albums: [], tracks: [] };
  const like = "%" + needle.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
  const [artists, albums, tracks] = await Promise.all([
    sql`SELECT ${artistCols} FROM artists a WHERE a.name_norm LIKE ${like} ORDER BY similarity(a.name_norm, ${needle}) DESC, a.name_norm LIMIT 12`,
    sql`SELECT ${albumCols(userId)} ${albumFrom} WHERE al.title_norm LIKE ${like} OR aar.name_norm LIKE ${like} OR g.name_norm LIKE ${like}
        ORDER BY (al.title_norm LIKE ${like}) DESC, similarity(al.title_norm, ${needle}) DESC, al.title_norm LIMIT 18`,
    sql`SELECT ${trackCols(userId)} ${trackFrom} WHERE t.title_norm LIKE ${like} OR ar.name_norm LIKE ${like} OR al.title_norm LIKE ${like} OR g.name_norm LIKE ${like}
        ORDER BY (t.title_norm LIKE ${like}) DESC, similarity(t.title_norm, ${needle}) DESC, al.title_norm, t.disc_no, t.track_no LIMIT 50`,
  ]);
  return { artists, albums, tracks };
}

// ── Favourites ──────────────────────────────────────────────────────────────────────────────────────

export async function listFavorites(userId: string, p: Page) {
  const [tracks, albums, [{ n }]] = await Promise.all([
    sql`SELECT ${trackCols(userId)} ${trackFrom} JOIN favorites fv ON fv.track_id = t.id AND fv.user_id = ${userId} ORDER BY fv.created_at DESC LIMIT ${p.limit} OFFSET ${p.offset}`,
    sql`SELECT ${albumCols(userId)} ${albumFrom} JOIN favorite_albums fa ON fa.album_id = al.id AND fa.user_id = ${userId} ORDER BY fa.created_at DESC LIMIT 100`,
    sql<{ n: number }[]>`SELECT count(*)::int AS n FROM favorites WHERE user_id = ${userId}`,
  ]);
  return { tracks, albums, total: n, ...p };
}

export async function setFavorite(userId: string, kind: "track" | "album", id: string, on: boolean) {
  try {
    if (kind === "track") {
      if (on) await sql`INSERT INTO favorites (user_id, track_id) VALUES (${userId}, ${id}) ON CONFLICT DO NOTHING`;
      else await sql`DELETE FROM favorites WHERE user_id = ${userId} AND track_id = ${id}`;
    } else if (on) await sql`INSERT INTO favorite_albums (user_id, album_id) VALUES (${userId}, ${id}) ON CONFLICT DO NOTHING`;
    else await sql`DELETE FROM favorite_albums WHERE user_id = ${userId} AND album_id = ${id}`;
  } catch (e) { if ((e as { code?: string }).code === "23503") throw new ApiError(404, "not_found"); throw e; }
  return { favorite: on };
}

// ── Playlists (always scoped to their owner: another account's id answers 404) ──────────────────────

export const listPlaylists = (userId: string) => sql`
  SELECT p.id, p.name, p.updated_at AS "updatedAt",
    (SELECT count(*)::int FROM playlist_tracks pt WHERE pt.playlist_id = p.id) AS "trackCount",
    (SELECT coalesce(array_agg(x.artwork_id), '{}') FROM (
       SELECT DISTINCT ON (al.artwork_id) al.artwork_id, pt.position FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id JOIN albums al ON al.id = t.album_id
       WHERE pt.playlist_id = p.id AND al.artwork_id IS NOT NULL ORDER BY al.artwork_id, pt.position LIMIT 4) x) AS "artworkIds"
  FROM playlists p WHERE p.user_id = ${userId} ORDER BY p.updated_at DESC`;

async function ownPlaylist(userId: string, id: string) {
  const [p] = await sql<{ id: string; name: string }[]>`SELECT id, name FROM playlists WHERE id = ${id} AND user_id = ${userId}`;
  if (!p) throw new ApiError(404, "not_found", "Playlist not found");
  return p;
}

export async function createPlaylist(userId: string, name: string, trackIds: string[]) {
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM playlists WHERE user_id = ${userId}`;
  if (n >= 500) throw new ApiError(409, "limit", "Too many playlists");
  const [p] = await sql<{ id: string }[]>`INSERT INTO playlists (user_id, name) VALUES (${userId}, ${name}) RETURNING id`;
  if (trackIds.length) await addToPlaylist(userId, p.id, trackIds);
  const [now] = await sql<{ updated_at: Date }[]>`SELECT updated_at FROM playlists WHERE id = ${p.id}`;
  return { id: p.id, updatedAt: now.updated_at };
}

export async function getPlaylist(userId: string, id: string) {
  const p = await ownPlaylist(userId, id);
  const tracks = await sql`SELECT pt.id AS "entryId", ${trackCols(userId)} ${trackFrom} JOIN playlist_tracks pt ON pt.track_id = t.id WHERE pt.playlist_id = ${id} ORDER BY pt.position, pt.added_at`;
  return { playlist: p, tracks };
}

export async function renamePlaylist(userId: string, id: string, name: string) {
  await ownPlaylist(userId, id);
  await sql`UPDATE playlists SET name = ${name}, updated_at = now() WHERE id = ${id}`;
}

export async function deletePlaylist(userId: string, id: string) {
  await ownPlaylist(userId, id);
  await sql`DELETE FROM playlists WHERE id = ${id}`;
}

export async function addToPlaylist(userId: string, id: string, trackIds: string[]) {
  await ownPlaylist(userId, id);
  const existing = await sql<{ id: string }[]>`SELECT id FROM tracks WHERE id = ANY(${trackIds}::uuid[])`;
  const known = new Set(existing.map((r) => r.id));
  const ids = trackIds.filter((t) => known.has(t));
  if (ids.length === 0) throw new ApiError(404, "not_found", "Track not found");
  await sql.begin(async (tx) => {
    const [{ max, n }] = await tx<{ max: number; n: number }[]>`SELECT coalesce(max(position), -1)::int AS max, count(*)::int AS n FROM playlist_tracks WHERE playlist_id = ${id}`;
    if (n + ids.length > 5000) throw new ApiError(409, "limit", "A playlist holds at most 5000 tracks");
    for (let i = 0; i < ids.length; i++) await tx`INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (${id}, ${ids[i]}, ${max + 1 + i})`;
    await tx`UPDATE playlists SET updated_at = now() WHERE id = ${id}`;
  });
  return { added: ids.length };
}

/** New order of the whole playlist, given as its entry ids. Entries left out are removed. */
export async function reorderPlaylist(userId: string, id: string, entryIds: string[]) {
  await ownPlaylist(userId, id);
  await sql.begin(async (tx) => {
    await tx`DELETE FROM playlist_tracks WHERE playlist_id = ${id} AND NOT (id = ANY(${entryIds}::uuid[]))`;
    for (let i = 0; i < entryIds.length; i++) await tx`UPDATE playlist_tracks SET position = ${i} WHERE id = ${entryIds[i]} AND playlist_id = ${id}`;
    await tx`UPDATE playlists SET updated_at = now() WHERE id = ${id}`;
  });
}

// ── Playback state ──────────────────────────────────────────────────────────────────────────────────

export async function getPlayback(userId: string) {
  const [s] = await sql<{ queue: string[]; queue_index: number; position_ms: number; shuffle: boolean; repeat: string; volume: number }[]>`
    SELECT queue, queue_index, position_ms, shuffle, repeat, volume FROM playback_state WHERE user_id = ${userId}`;
  if (!s) return { queue: [], index: 0, positionMs: 0, shuffle: false, repeat: "off", volume: 1 };
  // Tracks deleted since the state was saved are dropped; the index follows the surviving current track.
  const tracks = (await getTracks(userId, s.queue)) as { id: string }[];
  const currentId = s.queue[s.queue_index];
  const idx = tracks.findIndex((t) => t.id === currentId);
  return { queue: tracks, index: Math.max(0, idx), positionMs: idx >= 0 ? s.position_ms : 0, shuffle: s.shuffle, repeat: s.repeat, volume: s.volume };
}

export async function savePlayback(userId: string, s: { queue: string[]; index: number; positionMs: number; shuffle: boolean; repeat: "off" | "all" | "one"; volume: number }) {
  await sql`INSERT INTO playback_state (user_id, queue, queue_index, position_ms, shuffle, repeat, volume, updated_at)
    VALUES (${userId}, ${s.queue}::uuid[], ${s.index}, ${s.positionMs}, ${s.shuffle}, ${s.repeat}, ${s.volume}, now())
    ON CONFLICT (user_id) DO UPDATE SET queue = EXCLUDED.queue, queue_index = EXCLUDED.queue_index, position_ms = EXCLUDED.position_ms,
      shuffle = EXCLUDED.shuffle, repeat = EXCLUDED.repeat, volume = EXCLUDED.volume, updated_at = now()`;
}
