import "../../scripts/_env";
import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { sql } from "../lib/db";
import { env } from "../lib/env";
import { buildRendition, processUpload, pruneOrphans, reanalyseTrack, uploadTmpPath } from "../server/ingest";

/**
 * Background worker (one process): import queue, compatibility renditions, re-analysis, housekeeping.
 * The queue is the `uploads` table itself (FOR UPDATE SKIP LOCKED), so nothing is lost on a restart.
 */
let stopping = false;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function claimUpload(): Promise<string | null> {
  const [u] = await sql<{ id: string }[]>`
    UPDATE uploads SET status = 'validating', attempts = attempts + 1, updated_at = now()
    WHERE id = (SELECT id FROM uploads WHERE status = 'received' ORDER BY created_at, filename FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id`;
  return u?.id ?? null;
}
async function claimRendition(): Promise<string | null> {
  const [t] = await sql<{ id: string }[]>`
    UPDATE tracks SET compat_state = 'working' WHERE id = (SELECT id FROM tracks WHERE compat_state = 'queued' ORDER BY updated_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id`;
  return t?.id ?? null;
}
async function claimAnalysis(): Promise<string | null> {
  const [t] = await sql<{ id: string }[]>`
    UPDATE tracks SET analysis_requested = false WHERE id = (SELECT id FROM tracks WHERE analysis_requested ORDER BY updated_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id`;
  return t?.id ?? null;
}

/** Work interrupted by a crash or restart goes back to the queue (three attempts, then a visible error). */
async function recoverStale() {
  await sql`UPDATE uploads SET status = 'received', updated_at = now() WHERE status IN ('validating', 'extracting') AND updated_at < now() - interval '15 minutes' AND attempts < 3`;
  await sql`UPDATE uploads SET status = 'error', error_code = 'processing_interrupted', updated_at = now() WHERE status IN ('validating', 'extracting') AND updated_at < now() - interval '15 minutes'`;
  await sql`UPDATE tracks SET compat_state = 'queued' WHERE compat_state = 'working' AND updated_at < now() - interval '45 minutes'`;
}

async function housekeeping() {
  const days = env.uploadRetentionDays;
  // Abandoned uploads and old import rows (retention policy), then their scratch files.
  await sql`UPDATE uploads SET status = 'cancelled', updated_at = now() WHERE status = 'uploading' AND updated_at < now() - interval '2 days'`;
  await sql`DELETE FROM uploads WHERE status IN ('ready', 'cancelled') AND updated_at < now() - ${days} * interval '1 day'`;
  await sql`DELETE FROM uploads WHERE status IN ('error', 'duplicate') AND updated_at < now() - ${days} * interval '1 day'`;
  await sql`DELETE FROM webauthn_challenges WHERE expires_at < now()`;
  await sql`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`;
  await sql`DELETE FROM setup_tokens WHERE expires_at < now() - interval '30 days'`;
  await sql`DELETE FROM sessions WHERE expires_at < now() - interval '30 days' OR revoked_at < now() - interval '30 days'`;
  const live = new Set((await sql<{ id: string }[]>`SELECT id FROM uploads WHERE status NOT IN ('ready', 'cancelled')`).map((r) => path.basename(uploadTmpPath(r.id))));
  for (const dir of ["uploads", "work"]) {
    const d = path.join(env.tmpDir, dir);
    for (const f of await readdir(d).catch(() => [] as string[])) {
      if (dir === "uploads" && live.has(f)) continue;
      const s = await stat(path.join(d, f)).catch(() => null);
      if (s && Date.now() - s.mtimeMs > 6 * 3600_000) await rm(path.join(d, f), { force: true });
    }
  }
  await pruneOrphans();
}

async function main() {
  console.log(`[worker] started (storage ${env.storageDriver}, renditions ${env.renditions})`);
  let lastBeat = 0, lastHouse = 0;
  while (!stopping) {
    try {
      const now = Date.now();
      if (now - lastBeat > 20_000) { await sql`INSERT INTO worker_heartbeat (name) VALUES ('worker') ON CONFLICT (name) DO UPDATE SET beat_at = now()`; await recoverStale(); lastBeat = now; }
      if (now - lastHouse > 3600_000) { await housekeeping(); lastHouse = now; }
      const up = await claimUpload();
      if (up) { await processUpload(up); continue; }
      const an = await claimAnalysis();
      if (an) { await reanalyseTrack(an).catch((e) => console.error("[worker] analysis failed", an, e instanceof Error ? e.message : e)); continue; }
      const r = await claimRendition();
      if (r) { await buildRendition(r); continue; }
      await sleep(1500);
    } catch (e) {
      console.error("[worker] loop error", e instanceof Error ? `${e.name}: ${e.message}` : String(e));
      await sleep(5000);
    }
  }
  await sql.end({ timeout: 5 });
  console.log("[worker] stopped");
}

for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { stopping = true; });
main().catch((e) => { console.error(e); process.exit(1); });
