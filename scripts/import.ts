import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import "./_env";
import { sql } from "../src/lib/db";
import { env } from "../src/lib/env";
import { audit } from "../src/lib/audit";
import { safeFilename } from "../src/lib/text";
import { uploadTmpPath } from "../src/server/ingest";

/**
 * Server-side import, for an administrator with shell access to the node:
 *   tsx scripts/import.ts <file or directory> [...]     (add --wait to follow the worker until everything is settled)
 * Files are COPIED into the import queue and go through exactly the same pipeline as a browser upload
 * (content sniffing, ffprobe, duplicate detection, cover extraction). The sources are left untouched.
 */
const AUDIO = /\.(flac|mp3|m4a|aac|wav|aiff?|ogg|opus|dsf|dff)$/i;

async function collect(p: string, out: string[]) {
  const s = await stat(p);
  if (s.isDirectory()) { for (const f of (await readdir(p)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) if (!f.startsWith(".")) await collect(path.join(p, f), out); }
  else if (s.isFile() && AUDIO.test(p)) out.push(p);
}

async function main() {
  const args = process.argv.slice(2);
  const wait = args.includes("--wait");
  const files: string[] = [];
  for (const a of args.filter((x) => !x.startsWith("--"))) await collect(path.resolve(a), files);
  if (files.length === 0) throw new Error("No audio file found. Usage: tsx scripts/import.ts <file or directory> [...] [--wait]");
  const [owner] = await sql<{ id: string }[]>`SELECT id FROM users WHERE is_owner`;
  if (!owner) throw new Error("No owner account: run scripts/bootstrap.ts first");
  await mkdir(path.dirname(uploadTmpPath(randomUUID())), { recursive: true, mode: 0o700 });
  const ids: string[] = [];
  for (const f of files) {
    const size = (await stat(f)).size;
    if (size > env.maxFileBytes) { console.log(`skipped (larger than UPLOAD_MAX_FILE_MB): ${f}`); continue; }
    const id = randomUUID();
    await copyFile(f, uploadTmpPath(id));
    await sql`INSERT INTO uploads (id, user_id, filename, size_bytes, received_bytes, status) VALUES (${id}, ${owner.id}, ${safeFilename(f)}, ${size}, ${size}, 'received')`;
    ids.push(id);
  }
  await audit({ userId: owner.id, actor: "admin", action: "import.cli", meta: { files: ids.length } });
  console.log(`${ids.length} file(s) queued for the worker`);
  if (wait) {
    for (;;) {
      const rows = await sql<{ status: string; n: number }[]>`SELECT status, count(*)::int AS n FROM uploads WHERE id = ANY(${ids}::uuid[]) GROUP BY status`;
      const pending = rows.filter((r) => ["received", "validating", "extracting"].includes(r.status)).reduce((s, r) => s + r.n, 0);
      if (pending === 0) { console.log(rows.map((r) => `${r.status}: ${r.n}`).join(", ")); break; }
      await new Promise((r) => setTimeout(r, 1000));
    }
    for (const r of await sql<{ filename: string; status: string; error_code: string | null }[]>`SELECT filename, status, error_code FROM uploads WHERE id = ANY(${ids}::uuid[]) AND status <> 'ready' ORDER BY filename`) console.log(`  ${r.status} ${r.error_code ?? ""} — ${r.filename}`);
  }
  await sql.end();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
