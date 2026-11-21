/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Music SP
 * File             : src/server/media-http.ts
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

import type { IncomingMessage, ServerResponse } from "node:http";
import { pipeline } from "node:stream";
import { sql } from "@/lib/db";
import { SESSION_COOKIE, userFromToken } from "@/lib/session-store";
import { keys, storage, THUMB_SIZES } from "./storage";
import { parseRange } from "./range";
import { env } from "@/lib/env";

/**
 * Private media delivery, served by the Node HTTP server itself (server.ts) rather than by a Next route handler:
 * Next strips Content-Length from handler responses, and a media element needs exact Content-Length /
 * Content-Range framing to seek. Same session cookie, same database check as every other route.
 *
 *   GET|HEAD /api/v1/stream/<track uuid>[?v=compat]   audio, HTTP Range supported (206)
 *   GET|HEAD /api/v1/art/<artwork uuid>[?s=96|320|640|orig]
 *
 * A track is addressed by its opaque id only; the file is resolved from media_assets and streamed from disk.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECURITY: Record<string, string> = {
  "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'", "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Cross-Origin-Resource-Policy": "same-origin",
};

function sessionToken(req: IncomingMessage): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === SESSION_COOKIE) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
function end(res: ServerResponse, status: number, code?: string, headers: Record<string, string> = {}) {
  const body = code ? JSON.stringify({ error: { code } }) : "";
  res.writeHead(status, { ...SECURITY, "Cache-Control": "no-store", ...(code ? { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body)) } : { "Content-Length": "0" }), ...headers });
  res.end(res.req.method === "HEAD" ? undefined : body);
}

/** Returns true when the request was a media request (and has been answered). */
export async function handleMedia(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://local");
  if (url.pathname === "/.well-known/apple-app-site-association") return appSiteAssociation(req, res);
  const m = url.pathname.match(/^\/api\/v1\/(stream|art)\/([^/]+)$/);
  if (!m) return false;
  try {
    if (req.method !== "GET" && req.method !== "HEAD") { end(res, 405, "method_not_allowed", { Allow: "GET, HEAD" }); return true; }
    if (!(await userFromToken(sessionToken(req)))) { end(res, 401, "unauthenticated"); return true; }
    if (!UUID.test(m[2])) { end(res, 404, "not_found"); return true; }
    if (m[1] === "stream") await stream(req, res, m[2], url.searchParams.get("v") === "compat");
    else await art(req, res, m[2], url.searchParams.get("s") ?? "320");
  } catch (e) {
    console.error("[media]", e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    if (!res.headersSent) end(res, 500, "internal"); else res.destroy();
  }
  return true;
}

async function send(req: IncomingMessage, res: ServerResponse, key: string, size: number, status: number, headers: Record<string, string>, range?: { start: number; end: number }) {
  res.writeHead(status, { ...SECURITY, ...headers });
  if (req.method === "HEAD") return void res.end();
  // pipeline() destroys the file stream when the listener seeks away or closes the tab mid-download.
  pipeline(storage().read(key, range), res, () => {});
}

async function stream(req: IncomingMessage, res: ServerResponse, trackId: string, compat: boolean) {
  const kind = compat ? "rendition" : "original";
  const [a] = await sql<{ id: string; storage_key: string; mime: string }[]>`SELECT id, storage_key, mime FROM media_assets WHERE track_id = ${trackId} AND kind = ${kind}`;
  if (!a) return end(res, 404, compat ? "rendition_missing" : "not_found");
  const size = await storage().size(a.storage_key);
  if (size === null) return end(res, 404, "file_unavailable");            // row present, file missing on the volume
  const etag = `"${a.id}"`;
  const base: Record<string, string> = {
    "Content-Type": a.mime, "Accept-Ranges": "bytes", ETag: etag, "Content-Disposition": "inline", Vary: "Cookie",
    // Private cache only, revalidated against the ETag: a replaced file (new asset id) is never served stale.
    "Cache-Control": "private, no-cache, no-transform",
  };
  const h = req.headers;
  if (h["if-none-match"] === etag && !h.range) { res.writeHead(304, { ...SECURITY, ...base }); return void res.end(); }
  const range = parseRange(h["if-range"] && h["if-range"] !== etag ? null : (h.range ?? null), size);
  if (range === "invalid") { res.writeHead(416, { ...SECURITY, ...base, "Content-Range": `bytes */${size}`, "Content-Length": "0" }); return void res.end(); }
  if (range) return send(req, res, a.storage_key, size, 206, { ...base, "Content-Length": String(range.end - range.start + 1), "Content-Range": `bytes ${range.start}-${range.end}/${size}` }, range);
  return send(req, res, a.storage_key, size, 200, { ...base, "Content-Length": String(size) });
}

async function art(req: IncomingMessage, res: ServerResponse, artworkId: string, s: string) {
  const [w] = await sql<{ sha256: string; mime: string }[]>`SELECT sha256, mime FROM artworks WHERE id = ${artworkId}`;
  if (!w) return end(res, 404, "not_found");
  const thumb = THUMB_SIZES.find((t) => String(t) === s);
  const key = thumb ? keys.artThumb(w.sha256, thumb) : s === "orig" ? keys.artOriginal(w.sha256, w.mime === "image/jpeg" ? "jpg" : w.mime.slice(6)) : null;
  const size = key ? await storage().size(key) : null;
  if (!key || size === null) return end(res, 404, "not_found");
  // An artwork id names one immutable image (content-addressed), so the private cache may keep it.
  return send(req, res, key, size, 200, { "Content-Type": thumb ? "image/jpeg" : w.mime, "Content-Length": String(size), "Cache-Control": "private, max-age=31536000, immutable", Vary: "Cookie" });
}

/**
 * Lets the native apps listed in APPLE_APP_IDS use this site's passkeys (AuthenticationServices checks this file,
 * fetched through Apple's CDN, before it offers a credential of this RP ID to the app). Public by design: it holds
 * application identifiers only.
 */
function appSiteAssociation(req: IncomingMessage, res: ServerResponse): true {
  if (req.method !== "GET" && req.method !== "HEAD") { end(res, 405, "method_not_allowed", { Allow: "GET, HEAD" }); return true; }
  const body = JSON.stringify({ webcredentials: { apps: env.appleAppIds } });
  res.writeHead(200, { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body)), "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" });
  res.end(req.method === "HEAD" ? undefined : body);
  return true;
}
