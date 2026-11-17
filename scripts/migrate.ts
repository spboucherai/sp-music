import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import "./_env";
import { sql } from "../src/lib/db";

/** Applies db/migrations/*.sql in order, once each (checksummed). */
async function main() {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`;
  const dir = path.join(process.cwd(), "db/migrations");
  for (const name of (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort()) {
    const body = await readFile(path.join(dir, name), "utf8");
    const checksum = createHash("sha256").update(body).digest("hex");
    const [done] = await sql<{ checksum: string }[]>`SELECT checksum FROM schema_migrations WHERE name = ${name}`;
    if (done) { if (done.checksum !== checksum) throw new Error(`Migration ${name} was modified after being applied`); continue; }
    await sql.begin(async (tx) => { await tx.unsafe(body); await tx`INSERT INTO schema_migrations (name, checksum) VALUES (${name}, ${checksum})`; });
    console.log(`applied ${name}`);
  }
  await sql.end();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
