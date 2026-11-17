import { z } from "zod";
import { ApiError, body } from "../http";
import type { UserContext } from "../auth";
import * as adm from "@/server/admin";
import { deleteLyrics, LANGUAGES, requestLyrics, saveLyrics } from "@/server/lyrics";
import { albumPatch, ids, invite, oneOf, page, trackPatch, uuid } from "./schemas";
import type { RouteDef } from "./router";

/** Administration surface. The router's guard (requireAdmin) runs before any of these handlers is even looked up. */
export const adminRoutes: RouteDef<UserContext>[] = [
  // Imports
  ["GET", "uploads/limits", async () => adm.uploadLimits()],
  ["POST", "uploads", async ({ req, ctx }) => adm.createUpload(ctx, await body(req, z.object({ filename: z.string().min(1).max(500), size: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }).strict()))],
  ["GET", "uploads", ({ url }) => adm.listUploads(oneOf(url, "filter", ["all", "active", "error", "duplicate", "ready"] as const, "all"), page(url, 100, 500))],
  ["GET", "uploads/:id", ({ params }) => adm.getUpload(uuid.parse(params.id))],
  ["PATCH", "uploads/:id", ({ req, url, params }) => {
    const offset = Number(url.searchParams.get("offset"));
    if (!Number.isSafeInteger(offset) || offset < 0) throw new ApiError(400, "invalid_input", "offset is required");
    return adm.appendChunk(uuid.parse(params.id), offset, req);
  }],
  ["DELETE", "uploads/:id", ({ params, ctx }) => adm.cancelUpload(ctx, uuid.parse(params.id))],
  ["POST", "uploads/:id/retry", ({ params }) => adm.retryUpload(uuid.parse(params.id))],
  ["POST", "uploads/:id/replace", ({ params, ctx }) => adm.confirmReplace(ctx, uuid.parse(params.id))],
  ["POST", "uploads/clear", () => adm.clearUploads()],

  // Library
  ["PATCH", "tracks", async ({ req, ctx }) => { const b = await body(req, z.object({ ids, patch: trackPatch }).strict()); return adm.updateTracks(ctx, b.ids, b.patch); }],
  ["POST", "tracks/delete", async ({ req, ctx }) => { const b = await body(req, z.object({ ids, confirm: z.literal(true) }).strict()); return adm.deleteTracks(ctx, b.ids); }],
  ["POST", "tracks/reanalyse", async ({ req, ctx }) => { const b = await body(req, z.object({ ids }).strict()); return adm.requestReanalysis(ctx, b.ids); }],
  ["PATCH", "albums/:id", async ({ req, params, ctx }) => adm.updateAlbum(ctx, uuid.parse(params.id), await body(req, albumPatch))],
  ["PUT", "albums/:id/order", async ({ req, params, ctx }) => { const b = await body(req, z.object({ trackIds: ids }).strict()); return adm.reorderAlbum(ctx, uuid.parse(params.id), b.trackIds); }],
  ["PUT", "albums/:id/artwork", ({ req, params, ctx }) => adm.setAlbumArtwork(ctx, uuid.parse(params.id), req)],
  ["POST", "albums/:id/delete", async ({ req, params, ctx }) => { await body(req, z.object({ confirm: z.literal(true) }).strict()); return adm.deleteAlbum(ctx, uuid.parse(params.id)); }],

  // Lyrics
  ["POST", "lyrics/generate", async ({ req, ctx }) => { const b = await body(req, z.object({ ids, language: z.enum(LANGUAGES).nullable().optional(), overwrite: z.boolean().optional() }).strict()); return requestLyrics(ctx, b.ids, b.language ?? null, b.overwrite ?? false); }],
  ["PUT", "tracks/:id/lyrics", async ({ req, params, ctx }) => {
    const b = await body(req, z.object({ language: z.enum(LANGUAGES).nullable().optional(), lines: z.array(z.object({ t: z.number().int().min(0).max(86_400_000), e: z.number().int().min(0).max(86_400_000), text: z.string().max(300) }).strict()).max(2000) }).strict());
    return saveLyrics(ctx, uuid.parse(params.id), b.lines, b.language ?? null);
  }],
  ["DELETE", "tracks/:id/lyrics", ({ params, ctx }) => deleteLyrics(ctx, uuid.parse(params.id))],

  // Accounts
  ["GET", "users", async () => ({ items: await adm.listUsers() })],
  ["POST", "users", async ({ req, ctx }) => adm.inviteUser(ctx, await body(req, invite))],
  ["PATCH", "users/:id", async ({ req, params, ctx }) => adm.updateUser(ctx, uuid.parse(params.id), await body(req, z.object({ role: z.enum(["admin", "listener"]).optional(), disabled: z.boolean().optional(), displayName: z.string().trim().min(1).max(80).optional() }).strict()))],
  ["DELETE", "users/:id", ({ params, ctx }) => adm.deleteUser(ctx, uuid.parse(params.id))],
  ["POST", "users/:id/invite", ({ params, ctx }) => adm.reinviteUser(ctx, uuid.parse(params.id))],
  ["POST", "users/:id/revoke-sessions", ({ params, ctx }) => adm.revokeUserSessions(ctx, uuid.parse(params.id))],

  ["GET", "health", () => adm.health()],
  ["GET", "audit", ({ url }) => adm.listAudit(page(url, 50, 200))],
];
