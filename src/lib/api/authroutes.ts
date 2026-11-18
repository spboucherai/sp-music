import { z } from "zod";
import { ApiError, body, clientIp } from "../http";
import { rateLimit } from "../ratelimit";
import { safeEqual } from "../crypto";
import {
  assertSameOrigin, authenticationOptions, clearSessionCookie, currentUser, decideDeviceLink, deviceLinkInfo, loginWithRecoveryCode, pollDeviceLink,
  registrationOptions, revokeSession, setupTokenInfo, startDeviceLink, verifyAuthentication, verifyRegistration, type UserContext,
} from "../auth";
import { audit } from "../audit";
import type { RouteDef } from "./router";

const anyJson = z.record(z.string(), z.unknown());
const csrfOk = (req: Request, u: UserContext) => { if (!safeEqual(req.headers.get("x-csrf-token") ?? "", u.csrfToken)) throw new ApiError(403, "csrf", "Invalid CSRF token"); };

/** Public surface: everything a signed-out browser may call. Each route is rate-limited per client address. */
export const authRoutes: RouteDef<{ ip: string }>[] = [
  ["GET", "session", async () => {
    const u = await currentUser();
    return u ? { authenticated: true, csrfToken: u.csrfToken, user: { id: u.userId, email: u.email, displayName: u.displayName, role: u.role, isOwner: u.isOwner, locale: u.locale, accent: u.accent } } : { authenticated: false };
  }],
  ["POST", "setup/info", async ({ req, ctx }) => {
    assertSameOrigin(req); await rateLimit(`auth:${ctx.ip}`, 30, 600);
    const b = await body(req, z.object({ setupToken: z.string().min(20).max(200) }));
    return setupTokenInfo(b.setupToken);
  }],
  ["POST", "register/options", async ({ req, ctx }) => {
    assertSameOrigin(req); await rateLimit(`auth:${ctx.ip}`, 30, 600);
    const b = await body(req, z.object({ setupToken: z.string().max(200).optional() }));
    const user = b.setupToken ? null : await currentUser();
    if (user) csrfOk(req, user);
    return registrationOptions({ setupToken: b.setupToken, user });
  }],
  ["POST", "register/verify", async ({ req, ctx }) => {
    assertSameOrigin(req); await rateLimit(`auth:${ctx.ip}`, 30, 600);
    const b = await body(req, z.object({ challengeId: z.string().uuid(), response: anyJson, name: z.string().max(60).optional(), setupToken: z.string().max(200).optional() }));
    const user = b.setupToken ? null : await currentUser();
    if (user) csrfOk(req, user);
    return verifyRegistration({ challengeId: b.challengeId, response: b.response as never, name: b.name, setupToken: b.setupToken, user }, req);
  }],
  ["POST", "login/options", async ({ req, ctx }) => { assertSameOrigin(req); await rateLimit(`auth:${ctx.ip}`, 30, 600); return authenticationOptions(); }],
  ["POST", "login/verify", async ({ req, ctx }) => {
    assertSameOrigin(req); await rateLimit(`auth:${ctx.ip}`, 30, 600);
    const b = await body(req, z.object({ challengeId: z.string().uuid(), response: anyJson }));
    return verifyAuthentication({ challengeId: b.challengeId, response: b.response as never }, req);
  }],
  ["POST", "recovery", async ({ req, ctx }) => {
    assertSameOrigin(req); await rateLimit(`recovery:${ctx.ip}`, 5, 900);
    const b = await body(req, z.object({ code: z.string().min(8).max(40) }));
    return loginWithRecoveryCode(b.code, req);
  }],
  // Device linking for native apps (see src/lib/auth.ts). start/poll are called by the app, info/decide by a signed-in browser.
  ["POST", "device/start", async ({ req, ctx }) => {
    assertSameOrigin(req); await rateLimit(`device:${ctx.ip}`, 10, 600);
    const b = await body(req, z.object({ deviceName: z.string().max(80).optional() }).strict());
    return startDeviceLink(b.deviceName ?? "", req);
  }],
  ["POST", "device/poll", async ({ req, ctx }) => {
    assertSameOrigin(req); await rateLimit(`devicepoll:${ctx.ip}`, 600, 600);
    const b = await body(req, z.object({ deviceCode: z.string().min(20).max(200) }).strict());
    return pollDeviceLink(b.deviceCode, req);
  }],
  ["POST", "device/info", async ({ req }) => {
    assertSameOrigin(req);
    const u = await currentUser();
    if (!u) throw new ApiError(401, "unauthenticated", "Sign in required");
    csrfOk(req, u); await rateLimit(`devicecode:${u.userId}`, 30, 600);          // also bounds guessing of someone else's code
    const b = await body(req, z.object({ userCode: z.string().min(8).max(20) }).strict());
    return deviceLinkInfo(b.userCode);
  }],
  ["POST", "device/decide", async ({ req }) => {
    assertSameOrigin(req);
    const u = await currentUser();
    if (!u) throw new ApiError(401, "unauthenticated", "Sign in required");
    csrfOk(req, u); await rateLimit(`devicecode:${u.userId}`, 30, 600);
    const b = await body(req, z.object({ userCode: z.string().min(8).max(20), approve: z.boolean() }).strict());
    return decideDeviceLink(u, b.userCode, b.approve, req);
  }],
  ["POST", "logout", async ({ req }) => {
    assertSameOrigin(req);
    const u = await currentUser();
    if (u) { csrfOk(req, u); await revokeSession(u.sessionId, u.userId); await audit({ userId: u.userId, actor: u.role, action: "logout", ip: clientIp(req) }); }
    await clearSessionCookie();
    return { ok: true };
  }],
];
