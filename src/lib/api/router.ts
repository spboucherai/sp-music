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
