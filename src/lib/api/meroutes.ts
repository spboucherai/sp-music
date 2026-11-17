import { z } from "zod";
import { sql } from "../db";
import { ApiError, body, clientIp } from "../http";
import { revokeSession, type UserContext } from "../auth";
import { audit } from "../audit";
import { ACCENTS, uuid } from "./schemas";
import type { RouteDef } from "./router";

/** The signed-in account's own security and preferences. Every query is scoped to ctx.userId. */
export const meRoutes: RouteDef<UserContext>[] = [
  ["PATCH", "preferences", async ({ req, ctx }) => {
    const b = await body(req, z.object({ locale: z.enum(["fr", "en"]).optional(), accent: z.enum(ACCENTS).optional(), displayName: z.string().trim().min(1).max(80).optional() }).strict());
    if (b.locale) await sql`UPDATE users SET locale = ${b.locale} WHERE id = ${ctx.userId}`;
    if (b.accent) await sql`UPDATE users SET accent = ${b.accent} WHERE id = ${ctx.userId}`;
    if (b.displayName) await sql`UPDATE users SET display_name = ${b.displayName} WHERE id = ${ctx.userId}`;
    return { ok: true };
  }],
  ["GET", "passkeys", async ({ ctx }) => ({
    items: await sql`SELECT id, name, device_type AS "deviceType", backed_up AS "backedUp", created_at AS "createdAt", last_used_at AS "lastUsedAt" FROM authenticators WHERE user_id = ${ctx.userId} ORDER BY created_at`,
  })],
  ["PATCH", "passkeys/:id", async ({ req, params, ctx }) => {
    const b = await body(req, z.object({ name: z.string().trim().min(1).max(60) }).strict());
    const r = await sql`UPDATE authenticators SET name = ${b.name} WHERE id = ${uuid.parse(params.id)} AND user_id = ${ctx.userId} RETURNING id`;
    if (r.length === 0) throw new ApiError(404, "not_found");
    return { ok: true };
  }],
  ["DELETE", "passkeys/:id", async ({ req, params, ctx }) => {
    const id = uuid.parse(params.id);
    // The last passkey cannot be removed from here: the account would only be reachable through recovery.
    const removed = await sql.begin(async (tx) => {
      const all = await tx<{ id: string }[]>`SELECT id FROM authenticators WHERE user_id = ${ctx.userId} FOR UPDATE`;
      if (!all.some((a) => a.id === id)) throw new ApiError(404, "not_found");
      if (all.length <= 1) throw new ApiError(409, "last_passkey", "Add another passkey before removing the last one");
      return tx`DELETE FROM authenticators WHERE id = ${id} AND user_id = ${ctx.userId} RETURNING id`;
    });
    await audit({ userId: ctx.userId, actor: ctx.role, action: "passkey.revoked", entity: "passkey", entityId: id, ip: clientIp(req) });
    return { ok: removed.length > 0 };
  }],
  ["GET", "sessions", async ({ ctx }) => ({
    items: (await sql<{ id: string }[]>`SELECT id, method, user_agent AS "userAgent", ip, created_at AS "createdAt", last_seen_at AS "lastSeenAt", expires_at AS "expiresAt"
      FROM sessions WHERE user_id = ${ctx.userId} AND revoked_at IS NULL AND expires_at > now() ORDER BY last_seen_at DESC`).map((s) => ({ ...s, current: s.id === ctx.sessionId })),
  })],
  ["DELETE", "sessions/:id", async ({ req, params, ctx }) => {
    const ok = await revokeSession(uuid.parse(params.id), ctx.userId);
    if (!ok) throw new ApiError(404, "not_found");
    await audit({ userId: ctx.userId, actor: ctx.role, action: "session.revoked", ip: clientIp(req) });
    return { ok: true };
  }],
  ["POST", "sessions/revoke-others", async ({ req, ctx }) => {
    const r = await sql`UPDATE sessions SET revoked_at = now() WHERE user_id = ${ctx.userId} AND id <> ${ctx.sessionId} AND revoked_at IS NULL RETURNING id`;
    await audit({ userId: ctx.userId, actor: ctx.role, action: "session.revoked_others", meta: { count: r.length }, ip: clientIp(req) });
    return { revoked: r.length };
  }],
  ["GET", "recovery-codes", async ({ ctx }) => {
    const [r] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM recovery_codes WHERE user_id = ${ctx.userId} AND used_at IS NULL`;
    return { remaining: r.n };
  }],
];
