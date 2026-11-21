/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Music SP
 * File             : server.ts
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

import "./scripts/_env";
import { createServer } from "node:http";
import next from "next";
import { handleMedia } from "./src/server/media-http";

/**
 * Music SP web process: one Node HTTP server. Audio and cover requests are answered natively
 * (src/server/media-http.ts — exact Content-Length / Range framing); everything else goes to Next.js.
 */
const port = Number(process.env.PORT ?? 8690);
const hostname = process.env.HOST ?? "0.0.0.0";
const dev = process.env.NODE_ENV !== "production";

async function main() {
  const app = next({ dev, hostname, port });
  await app.prepare();
  const handle = app.getRequestHandler();
  const server = createServer((req, res) => {
    handleMedia(req, res).then((done) => { if (!done) return handle(req, res); }).catch((e) => {
      console.error("[server]", e instanceof Error ? e.message : e);
      if (!res.headersSent) res.writeHead(500); res.end();
    });
  });
  // Uploads arrive in chunks of a few MB; a slow phone connection must not be cut mid-chunk.
  server.requestTimeout = 10 * 60_000; server.headersTimeout = 60_000; server.keepAliveTimeout = 65_000;
  server.listen(port, hostname, () => console.log(`[web] Music SP listening on http://${hostname}:${port} (${dev ? "development" : "production"})`));
  const stop = () => server.close(() => process.exit(0));
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
}
main().catch((e) => { console.error(e); process.exit(1); });
