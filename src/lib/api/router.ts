/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Music SP
 * File             : src/lib/api/router.ts
 * Module           : lib
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

import { ApiError, fail, ok } from "../http";

export interface RouteCtx<C> { req: Request; url: URL; params: Record<string, string>; ctx: C }
type Handler<C> = (r: RouteCtx<C>) => Promise<unknown>;
export type RouteDef<C> = [method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", pattern: string, handler: Handler<C>];

/**
 * One catch-all route per API surface. The guard runs before ANY handler is looked up, so a handler cannot be
 * reached without it (no admin route can forget its authentication check).
 */
export function makeRouter<C>(routes: RouteDef<C>[], guard: (req: Request) => Promise<C>) {
  const compiled = routes.map(([method, pattern, handler]) => ({ method, parts: pattern.split("/").filter(Boolean), handler }));
  return async (req: Request, context: { params: Promise<{ path?: string[] }> }): Promise<Response> => {
    try {
      const ctx = await guard(req);
      const path = (await context.params).path ?? [];
      let pathMatched = false;
      for (const r of compiled) {
        if (r.parts.length !== path.length) continue;
        const params: Record<string, string> = {};
        if (!r.parts.every((p, i) => (p.startsWith(":") ? ((params[p.slice(1)] = path[i]), true) : p === path[i]))) continue;
        pathMatched = true;
        if (r.method !== req.method) continue;
        const out = await r.handler({ req, url: new URL(req.url), params, ctx });
        return out instanceof Response ? out : ok(out ?? { ok: true });
      }
      throw pathMatched ? new ApiError(405, "method_not_allowed") : new ApiError(404, "not_found");
    } catch (e) { return fail(e); }
  };
}
