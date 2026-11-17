import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type AuthenticatorTransport, type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { sql } from "./db";
import { env } from "./env";
import { ApiError, clientIp } from "./http";
import { randomToken, safeEqual, sha256 } from "./crypto";
import { audit } from "./audit";
import { SESSION_COOKIE, userFromToken, type Role, type UserContext } from "./session-store";

export { SESSION_COOKIE, userFromToken };
export type { Role, UserContext };

const SESSION_DAYS = 30;
const RP_NAME = "Music SP";

export const rpId = () => env.rpId;
export const origin = () => new URL(env.appUrl).origin;


// ── Sessions ────────────────────────────────────────────────────────────────────────────────────────

/** A new session (new random token) is issued at every authentication: the identifier is never reused. */
export async function createSession(userId: string, method: "passkey" | "recovery_code" | "setup", req: Request): Promise<void> {
  const token = randomToken(32);
  const csrf = randomToken(24);
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await sql`INSERT INTO sessions (user_id, token_hash, csrf_token, method, user_agent, ip, expires_at)
            VALUES (${userId}, ${sha256(token)}, ${csrf}, ${method}, ${(req.headers.get("user-agent") ?? "").slice(0, 300)}, ${clientIp(req)}, ${expires})`;
  const jar = await cookies();
  // Host-only cookie (no Domain attribute): it is never sent to another spboucher.ai sub-domain.
  jar.set(SESSION_COOKIE, token, { httpOnly: true, secure: env.isProd, sameSite: "lax", path: "/", expires });
}

export async function currentUser(): Promise<UserContext | null> {
  return userFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

/**
 * Guard of every authenticated API route. State-changing requests must come from our own origin AND carry the
 * session's CSRF token in a header (a cross-site form cannot set it).
 */
export async function requireUser(req: Request): Promise<UserContext> {
  const user = await currentUser();
  if (!user) throw new ApiError(401, "unauthenticated", "Sign in required");
  if (req.method !== "GET" && req.method !== "HEAD") {
    assertSameOrigin(req);
    const sent = req.headers.get("x-csrf-token") ?? "";
    if (!safeEqual(sent, user.csrfToken)) throw new ApiError(403, "csrf", "Invalid CSRF token");
  }
  return user;
}

/** Guard of the whole /api/v1/admin surface: the role is read from the database on every request. */
export async function requireAdmin(req: Request): Promise<UserContext> {
  const user = await requireUser(req);
  if (user.role !== "admin") throw new ApiError(403, "forbidden", "Administrator role required");
  return user;
}

export function assertSameOrigin(req: Request): void {
  const o = req.headers.get("origin");
  if (o && o !== origin()) throw new ApiError(403, "bad_origin", "Cross-origin request refused");
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") throw new ApiError(403, "bad_origin", "Cross-site request refused");
}

export async function revokeSession(sessionId: string, userId: string): Promise<boolean> {
  const r = await sql`UPDATE sessions SET revoked_at = now() WHERE id = ${sessionId} AND user_id = ${userId} AND revoked_at IS NULL RETURNING id`;
  return r.length > 0;
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, "", { httpOnly: true, secure: env.isProd, sameSite: "lax", path: "/", maxAge: 0 });
}

// ── Enrolment tokens ────────────────────────────────────────────────────────────────────────────────

export async function passkeyCount(userId: string): Promise<number> {
  const [r] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM authenticators WHERE user_id = ${userId}`;
  return r.n;
}

type TokenRow = { id: string; user_id: string; purpose: "setup" | "recovery" | "invite" };
async function validSetupToken(raw: string): Promise<TokenRow | null> {
  const [t] = await sql<TokenRow[]>`
    SELECT t.id, t.user_id, t.purpose FROM setup_tokens t JOIN users u ON u.id = t.user_id
    WHERE t.token_hash = ${sha256(raw)} AND t.used_at IS NULL AND t.expires_at > now() AND u.disabled_at IS NULL`;
  return t ?? null;
}

/** What an enrolment link is for, so the setup page can explain itself. Says nothing when the token is invalid. */
export async function setupTokenInfo(raw: string) {
  const t = await validSetupToken(raw);
  if (!t) throw new ApiError(403, "invalid_setup_token", "This enrolment link is invalid or has expired");
  const [u] = await sql<{ display_name: string; role: Role }[]>`SELECT display_name, role FROM users WHERE id = ${t.user_id}`;
  return { purpose: t.purpose, displayName: u.display_name, role: u.role };
}

/**
 * Issues a one-time enrolment token and returns the raw value once (only its SHA-256 is stored).
 * 'setup' and 'recovery' are issued from the server's shell only; 'invite' by an administrator.
 */
export async function issueSetupToken(userId: string, purpose: "setup" | "recovery" | "invite", ttlMinutes: number): Promise<string> {
  const raw = randomToken(32);
  await sql`UPDATE setup_tokens SET used_at = now() WHERE user_id = ${userId} AND used_at IS NULL`;
  await sql`INSERT INTO setup_tokens (user_id, token_hash, purpose, expires_at) VALUES (${userId}, ${sha256(raw)}, ${purpose}, now() + ${ttlMinutes} * interval '1 minute')`;
  await audit({ userId, actor: "system", action: `setup_token.issued.${purpose}` });
  return raw;
}

// ── WebAuthn registration ───────────────────────────────────────────────────────────────────────────

/**
 * A passkey can be enrolled in two cases only: with a one-time token (owner setup, recovery, invitation), or from
 * an authenticated session (adding another device to one's own account).
 */
export async function registrationOptions(input: { setupToken?: string; user?: UserContext | null }) {
  let userId: string;
  if (input.user) userId = input.user.userId;
  else {
    const t = input.setupToken ? await validSetupToken(input.setupToken) : null;
    if (!t) throw new ApiError(403, "invalid_setup_token", "This enrolment link is invalid or has expired");
    userId = t.user_id;
  }
  const [user] = await sql<{ id: string; email: string; display_name: string }[]>`SELECT id, email, display_name FROM users WHERE id = ${userId}`;
  const existing = await sql<{ credential_id: string; transports: string[] }[]>`SELECT credential_id, transports FROM authenticators WHERE user_id = ${userId}`;
  const options = await generateRegistrationOptions({
    rpName: RP_NAME, rpID: rpId(),
    userName: user.email, userDisplayName: user.display_name,
    userID: new TextEncoder().encode(user.id),
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({ id: c.credential_id, transports: c.transports as AuthenticatorTransport[] })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  const [ch] = await sql<{ id: string }[]>`INSERT INTO webauthn_challenges (challenge, kind, user_id, expires_at)
    VALUES (${options.challenge}, 'registration', ${userId}, now() + interval '5 minutes') RETURNING id`;
  return { challengeId: ch.id, options };
}

export async function verifyRegistration(input: { challengeId: string; response: RegistrationResponseJSON; name?: string; setupToken?: string; user?: UserContext | null }, req: Request) {
  // Single use: the challenge row is deleted as it is read, whatever the outcome.
  const [ch] = await sql<{ challenge: string; user_id: string }[]>`
    DELETE FROM webauthn_challenges WHERE id = ${input.challengeId} AND kind = 'registration' AND expires_at > now() RETURNING challenge, user_id`;
  if (!ch) throw new ApiError(400, "challenge_expired", "The enrolment challenge has expired, start again");
  let token: TokenRow | null = null;
  if (input.user) { if (input.user.userId !== ch.user_id) throw new ApiError(403, "forbidden"); }
  else {
    token = input.setupToken ? await validSetupToken(input.setupToken) : null;
    if (!token || token.user_id !== ch.user_id) throw new ApiError(403, "invalid_setup_token", "This enrolment link is invalid or has expired");
  }
  let verification;
  try {
    verification = await verifyRegistrationResponse({ response: input.response, expectedChallenge: ch.challenge, expectedOrigin: origin(), expectedRPID: rpId(), requireUserVerification: true });
  } catch { throw new ApiError(400, "registration_failed", "The passkey could not be verified"); }
  if (!verification.verified || !verification.registrationInfo) throw new ApiError(400, "registration_failed", "The passkey could not be verified");
  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  const name = (input.name ?? "").trim().slice(0, 60) || "Passkey";

  let recoveryCodes: string[] | null = null;
  await sql.begin(async (tx) => {
    if (token) {
      const used = await tx`UPDATE setup_tokens SET used_at = now() WHERE id = ${token.id} AND used_at IS NULL RETURNING id`;
      if (used.length === 0) throw new ApiError(403, "invalid_setup_token", "This enrolment link was already used");
      if (token.purpose === "recovery") {
        // Recovery replaces every credential and signs out every device.
        await tx`DELETE FROM authenticators WHERE user_id = ${ch.user_id}`;
        await tx`UPDATE sessions SET revoked_at = now() WHERE user_id = ${ch.user_id} AND revoked_at IS NULL`;
      }
    }
    await tx`INSERT INTO authenticators (user_id, credential_id, public_key, counter, transports, device_type, backed_up, name)
             VALUES (${ch.user_id}, ${credential.id}, ${Buffer.from(credential.publicKey)}, ${credential.counter}, ${credential.transports ?? []}, ${credentialDeviceType}, ${credentialBackedUp}, ${name})`;
    if (token) {
      await tx`DELETE FROM recovery_codes WHERE user_id = ${ch.user_id}`;
      recoveryCodes = Array.from({ length: 8 }, () => randomBytes(6).toString("hex").replace(/(.{4})(.{4})(.{4})/, "$1-$2-$3"));
      for (const c of recoveryCodes) await tx`INSERT INTO recovery_codes (user_id, code_hash) VALUES (${ch.user_id}, ${sha256(c)})`;
    }
  });
  await audit({ userId: ch.user_id, actor: "system", action: token ? `passkey.enrolled.${token.purpose}` : "passkey.added", ip: clientIp(req) });
  if (token) await createSession(ch.user_id, "setup", req);
  return { ok: true, recoveryCodes };
}

// ── WebAuthn authentication ─────────────────────────────────────────────────────────────────────────

export async function authenticationOptions() {
  // Discoverable credentials: no allowCredentials list, so the response says nothing about which accounts exist.
  const options = await generateAuthenticationOptions({ rpID: rpId(), userVerification: "required" });
  const [ch] = await sql<{ id: string }[]>`INSERT INTO webauthn_challenges (challenge, kind, expires_at)
    VALUES (${options.challenge}, 'authentication', now() + interval '5 minutes') RETURNING id`;
  return { challengeId: ch.id, options };
}

export async function verifyAuthentication(input: { challengeId: string; response: AuthenticationResponseJSON }, req: Request) {
  const [ch] = await sql<{ challenge: string }[]>`
    DELETE FROM webauthn_challenges WHERE id = ${input.challengeId} AND kind = 'authentication' AND expires_at > now() RETURNING challenge`;
  const denied = new ApiError(401, "login_failed", "Sign-in failed");
  if (!ch) { await audit({ actor: "system", action: "login.failed", meta: { why: "challenge" }, ip: clientIp(req) }); throw denied; }
  const [cred] = await sql<{ id: string; user_id: string; credential_id: string; public_key: Buffer; counter: string; transports: string[]; role: Role }[]>`
    SELECT a.id, a.user_id, a.credential_id, a.public_key, a.counter, a.transports, u.role
    FROM authenticators a JOIN users u ON u.id = a.user_id
    WHERE a.credential_id = ${String(input.response.id ?? "")} AND u.disabled_at IS NULL`;
  if (!cred) { await audit({ actor: "system", action: "login.failed", meta: { why: "unknown_credential" }, ip: clientIp(req) }); throw denied; }
  let v;
  try {
    v = await verifyAuthenticationResponse({
      response: input.response, expectedChallenge: ch.challenge, expectedOrigin: origin(), expectedRPID: rpId(), requireUserVerification: true,
      credential: { id: cred.credential_id, publicKey: new Uint8Array(cred.public_key), counter: Number(cred.counter), transports: cred.transports as AuthenticatorTransport[] },
    });
  } catch { v = null; }
  if (!v?.verified) { await audit({ userId: cred.user_id, actor: "system", action: "login.failed", meta: { why: "bad_assertion" }, ip: clientIp(req) }); throw denied; }
  await sql`UPDATE authenticators SET counter = ${v.authenticationInfo.newCounter}, last_used_at = now(), backed_up = ${v.authenticationInfo.credentialBackedUp} WHERE id = ${cred.id}`;
  await createSession(cred.user_id, "passkey", req);
  await audit({ userId: cred.user_id, actor: cred.role, action: "login.passkey", ip: clientIp(req) });
  return { ok: true };
}

/** Recovery: a one-use code opens a session, from which a new passkey can be enrolled. */
export async function loginWithRecoveryCode(code: string, req: Request) {
  const normalized = code.trim().toLowerCase();
  const [row] = await sql<{ id: string; user_id: string }[]>`
    UPDATE recovery_codes r SET used_at = now() FROM users u
    WHERE r.code_hash = ${sha256(normalized)} AND r.used_at IS NULL AND u.id = r.user_id AND u.disabled_at IS NULL RETURNING r.id, r.user_id`;
  if (!row) { await audit({ actor: "system", action: "login.failed", meta: { why: "bad_recovery_code" }, ip: clientIp(req) }); throw new ApiError(401, "login_failed", "Sign-in failed"); }
  await createSession(row.user_id, "recovery_code", req);
  await audit({ userId: row.user_id, actor: "system", action: "login.recovery_code", ip: clientIp(req) });
  return { ok: true };
}
