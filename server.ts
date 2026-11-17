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
