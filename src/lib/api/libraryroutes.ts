import { z } from "zod";
import { sql } from "../db";
import { env } from "../env";
import { ApiError, body } from "../http";
import { rateLimit } from "../ratelimit";
import type { UserContext } from "../auth";
import * as cat from "@/server/catalog";
import { getLyrics } from "@/server/lyrics";
import { assertPlaylistBase, librarySync, listPlays, playlistStamp, recordPlays, userSync } from "@/server/sync";
import { ids, oneOf, page, playbackState, playlistName, uuid } from "./schemas";
import type { RouteDef } from "./router";

/** Listening surface, open to every signed-in account (admin or listener). Nothing here can change the library. */
export const libraryRoutes: RouteDef<UserContext>[] = [
  ["GET", "home", ({ ctx }) => cat.home(ctx.userId)],
  ["GET", "albums", ({ url, ctx }) => cat.listAlbums(ctx.userId, page(url, 60), oneOf(url, "sort", ["recent", "title", "artist", "year"] as const, "artist"))],
  ["GET", "albums/:id", ({ params, ctx }) => cat.getAlbum(ctx.userId, uuid.parse(params.id))],
  ["GET", "artists", ({ url }) => cat.listArtists(page(url, 60))],
  ["GET", "artists/:id", ({ params, ctx }) => cat.getArtist(ctx.userId, uuid.parse(params.id))],
  ["GET", "tracks", ({ url, ctx }) => cat.listTracks(ctx.userId, page(url, 100), oneOf(url, "sort", ["title", "recent", "artist"] as const, "artist"))],
  ["GET", "search", ({ url, ctx }) => cat.search(ctx.userId, (url.searchParams.get("q") ?? "").slice(0, 100))],

  ["GET", "favorites", ({ url, ctx }) => cat.listFavorites(ctx.userId, page(url, 100))],
  ["PUT", "favorites/:kind/:id", ({ params, ctx }) => cat.setFavorite(ctx.userId, z.enum(["track", "album"]).parse(params.kind), uuid.parse(params.id), true)],
  ["DELETE", "favorites/:kind/:id", ({ params, ctx }) => cat.setFavorite(ctx.userId, z.enum(["track", "album"]).parse(params.kind), uuid.parse(params.id), false)],

  ["GET", "playlists", async ({ ctx }) => ({ items: await cat.listPlaylists(ctx.userId) })],
  ["POST", "playlists", async ({ req, ctx }) => { const b = await body(req, z.object({ name: playlistName.shape.name, trackIds: z.array(uuid).max(500).optional() }).strict()); return cat.createPlaylist(ctx.userId, b.name, b.trackIds ?? []); }],
  ["GET", "playlists/:id", ({ params, ctx }) => cat.getPlaylist(ctx.userId, uuid.parse(params.id))],
  // baseUpdatedAt (optional, sent by clients that edit offline): the change is refused with 409 when the list moved on since.
  ["PATCH", "playlists/:id", async ({ req, params, ctx }) => {
    const id = uuid.parse(params.id);
    const b = await body(req, z.object({ name: playlistName.shape.name, baseUpdatedAt: z.string().max(40).optional() }).strict());
    await assertPlaylistBase(ctx.userId, id, b.baseUpdatedAt);
    await cat.renamePlaylist(ctx.userId, id, b.name);
    return playlistStamp(ctx.userId, id);
  }],
  ["DELETE", "playlists/:id", async ({ params, ctx }) => { await cat.deletePlaylist(ctx.userId, uuid.parse(params.id)); }],
  ["POST", "playlists/:id/tracks", async ({ req, params, ctx }) => {
    const id = uuid.parse(params.id);
    const b = await body(req, z.object({ trackIds: ids }).strict());
    const r = await cat.addToPlaylist(ctx.userId, id, b.trackIds);
    return { ...r, updatedAt: (await playlistStamp(ctx.userId, id)).updatedAt };
  }],
  ["PUT", "playlists/:id/order", async ({ req, params, ctx }) => {
    const id = uuid.parse(params.id);
    const b = await body(req, z.object({ entryIds: z.array(uuid).max(5000), baseUpdatedAt: z.string().max(40).optional() }).strict());
    await assertPlaylistBase(ctx.userId, id, b.baseUpdatedAt);
    await cat.reorderPlaylist(ctx.userId, id, b.entryIds);
    return playlistStamp(ctx.userId, id);
  }],

  // Native clients: catalogue deltas, the account's own data in one answer, listening history.
  ["GET", "sync", ({ url }) => { const since = Number(url.searchParams.get("since") ?? 0); if (!Number.isSafeInteger(since) || since < 0) throw new ApiError(400, "invalid_input", "since must be a revision"); return librarySync(since); }],
  ["GET", "sync/me", ({ ctx }) => userSync(ctx.userId)],
  ["GET", "history", ({ url, ctx }) => listPlays(ctx.userId, page(url, 100, 500))],
  ["POST", "history", async ({ req, ctx }) => {
    const b = await body(req, z.object({ events: z.array(z.object({
      id: uuid, trackId: uuid, playedAt: z.string().max(40), listenedMs: z.number().int().min(0).max(86_400_000), completed: z.boolean(), source: z.enum(["stream", "local"]),
    }).strict()).max(500) }).strict());
    return recordPlays(ctx.userId, req.headers.get("user-agent") ?? "", b.events);
  }],

  ["GET", "playback", ({ ctx }) => cat.getPlayback(ctx.userId)],
  ["PUT", "playback", async ({ req, ctx }) => { await cat.savePlayback(ctx.userId, await body(req, playbackState)); }],

  // Fallback for a browser that cannot decode an original: any listener may ask for the AAC rendition of a track.
  ["POST", "tracks/:id/compat", async ({ params, ctx }) => {
    const id = uuid.parse(params.id);
    const [t] = await sql<{ compat_state: string; codec: string }[]>`SELECT compat_state, codec FROM tracks WHERE id = ${id}`;
    if (!t) throw new ApiError(404, "not_found");
    if (t.compat_state === "ready" || t.compat_state === "queued" || t.compat_state === "working") return { compatState: t.compat_state };
    if (env.renditions === "never") throw new ApiError(409, "renditions_disabled", "Compatibility renditions are disabled on this server");
    if (t.codec.startsWith("dsd") && !env.transcodeDsd) throw new ApiError(409, "renditions_disabled", "DSD conversion is not enabled on this server");
    await rateLimit(`compat:${ctx.userId}`, 60, 3600);
    await sql`UPDATE tracks SET compat_state = 'queued', compat_error = NULL WHERE id = ${id} AND compat_state IN ('none', 'error', 'disabled')`;
    return { compatState: "queued" };
  }],
  ["GET", "tracks/:id/lyrics", ({ params }) => getLyrics(uuid.parse(params.id))],
  ["GET", "tracks/:id", async ({ params, ctx }) => { const [t] = await cat.getTracks(ctx.userId, [uuid.parse(params.id)]); if (!t) throw new ApiError(404, "not_found"); return t; }],
];
