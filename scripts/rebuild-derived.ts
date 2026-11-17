import "./_env";
import { rm, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { sql } from "../src/lib/db";
import { env } from "../src/lib/env";
import { keys, storage, THUMB_SIZES } from "../src/server/storage";
import { makeThumb } from "../src/server/media";

/**
 * After a restore: checks every stored file the database refers to.
 *  - missing thumbnails are rebuilt from the cover original;
 *  - missing renditions are queued again for the worker;
 *  - missing ORIGINALS are reported (exit code 1): they can only come back from a backup.
 */
async function main() {
  const st = storage();
  let missingOriginals = 0, thumbs = 0, renditions = 0;
  for (const a of await sql<{ storage_key: string; track_id: string; kind: string }[]>`SELECT storage_key, track_id, kind FROM media_assets WHERE kind IN ('original', 'rendition')`) {
    if ((await st.size(a.storage_key)) !== null) continue;
    if (a.kind === "original") { missingOriginals++; console.error(`MISSING ORIGINAL ${a.storage_key} (track ${a.track_id})`); }
    else { await sql`DELETE FROM media_assets WHERE storage_key = ${a.storage_key}`; await sql`UPDATE tracks SET compat_state = 'queued' WHERE id = ${a.track_id}`; renditions++; }
  }
  const work = path.join(env.tmpDir, "work"); await mkdir(work, { recursive: true });
  for (const w of await sql<{ sha256: string; mime: string }[]>`SELECT sha256, mime FROM artworks`) {
    const orig = keys.artOriginal(w.sha256, w.mime === "image/jpeg" ? "jpg" : w.mime.slice(6));
    if ((await st.size(orig)) === null) { console.error(`MISSING COVER ${orig}`); continue; }
    for (const s of THUMB_SIZES) {
      if ((await st.size(keys.artThumb(w.sha256, s))) !== null) continue;
      const src = path.join(work, randomUUID()), tmp = `${src}.jpg`;
      await copyFile(await st.localPath(orig), src);
      await makeThumb(src, tmp, s); await st.putFile(keys.artThumb(w.sha256, s), tmp); await rm(src, { force: true }); thumbs++;
    }
  }
  console.log(`thumbnails rebuilt: ${thumbs}, renditions queued: ${renditions}, missing originals: ${missingOriginals}`);
  await sql.end();
  if (missingOriginals) process.exit(1);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
