import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import yauzl from "yauzl";
import { sql, type Tx } from "@/lib/db";
import { env } from "@/lib/env";
import { audit } from "@/lib/audit";
import { clean, norm, safeFilename } from "@/lib/text";
import { keys, storage, THUMB_SIZES } from "./storage";
import { AUDIO_KINDS, extFor, extractCover, imageSize, makeThumb, MediaError, mimeFor, probe, sniff, transcodeAac, webPlayable, type Kind, type Probe } from "./media";

/** Import pipeline, run by the worker: validation → metadata → storage. Everything here works on server-built paths. */

export const uploadTmpPath = (uploadId: string) => path.join(env.tmpDir, "uploads", `${uploadId}.part`);
const scratch = async () => { const d = path.join(env.tmpDir, "work"); await mkdir(d, { recursive: true, mode: 0o700 }); return path.join(d, randomUUID()); };

export async function fileSha256(file: string): Promise<string> {
  const h = createHash("sha256");
  await pipeline(createReadStream(file), h);
  return h.digest("hex");
}

export async function libraryBytes(): Promise<number> {
  const [r] = await sql<{ n: string }[]>`SELECT coalesce(sum(size_bytes), 0)::text AS n FROM media_assets`;
  return Number(r.n);
}

// ── Entities ────────────────────────────────────────────────────────────────────────────────────────

export async function upsertArtist(tx: Tx, name: string): Promise<string> {
  const n = clean(name, 200) || "Artiste inconnu";
  const [r] = await tx<{ id: string }[]>`INSERT INTO artists (name, name_norm) VALUES (${n}, ${norm(n)}) ON CONFLICT (name_norm) DO UPDATE SET name_norm = EXCLUDED.name_norm RETURNING id`;
  return r.id;
}
export async function upsertGenre(tx: Tx, name: string): Promise<string | null> {
  const n = clean(name, 80);
  if (!n) return null;
  const [r] = await tx<{ id: string }[]>`INSERT INTO genres (name, name_norm) VALUES (${n}, ${norm(n)}) ON CONFLICT (name_norm) DO UPDATE SET name_norm = EXCLUDED.name_norm RETURNING id`;
  return r.id;
}
export async function upsertAlbum(tx: Tx, a: { title: string; artistId: string; year: number | null; genreId: string | null; artworkId: string | null }): Promise<string> {
  const t = clean(a.title, 300) || "Album inconnu";
  const [r] = await tx<{ id: string }[]>`
    INSERT INTO albums (title, title_norm, artist_id, year, genre_id, artwork_id) VALUES (${t}, ${norm(t)}, ${a.artistId}, ${a.year}, ${a.genreId}, ${a.artworkId})
    ON CONFLICT (artist_id, title_norm) DO UPDATE SET
      year = coalesce(albums.year, EXCLUDED.year), genre_id = coalesce(albums.genre_id, EXCLUDED.genre_id), artwork_id = coalesce(albums.artwork_id, EXCLUDED.artwork_id)
    RETURNING id`;
  return r.id;
}

/** Removes albums, artists, genres and cover files nothing refers to any more. Returns nothing: best effort after a change. */
export async function pruneOrphans(): Promise<void> {
  await sql`DELETE FROM albums al WHERE NOT EXISTS (SELECT 1 FROM tracks t WHERE t.album_id = al.id)`;
  await sql`DELETE FROM artists a WHERE NOT EXISTS (SELECT 1 FROM tracks t WHERE t.artist_id = a.id) AND NOT EXISTS (SELECT 1 FROM albums al WHERE al.artist_id = a.id)`;
  await sql`DELETE FROM genres g WHERE NOT EXISTS (SELECT 1 FROM tracks t WHERE t.genre_id = g.id) AND NOT EXISTS (SELECT 1 FROM albums al WHERE al.genre_id = g.id)`;
  const orphans = await sql<{ id: string }[]>`SELECT id FROM artworks w WHERE NOT EXISTS (SELECT 1 FROM albums al WHERE al.artwork_id = w.id) AND w.created_at < now() - interval '10 minutes'`;
  for (const w of orphans) {
    const assets = await sql<{ storage_key: string }[]>`SELECT storage_key FROM media_assets WHERE artwork_id = ${w.id}`;
    const gone = await sql`DELETE FROM artworks w WHERE id = ${w.id} AND NOT EXISTS (SELECT 1 FROM albums al WHERE al.artwork_id = w.id) RETURNING id`;
    if (gone.length) for (const a of assets) await storage().delete(a.storage_key).catch(() => {});
  }
}

// ── Cover art ───────────────────────────────────────────────────────────────────────────────────────

const MAX_COVER_BYTES = 25 * 1024 * 1024;

/** Validates an image file, stores it untouched plus normalised square thumbnails. Deduplicated by content hash. */
export async function storeArtwork(file: string): Promise<string> {
  const kind = await sniff(file);
  if (kind !== "jpeg" && kind !== "png" && kind !== "webp") throw new MediaError("bad_image", "Covers must be JPEG, PNG or WebP");
  const size = (await stat(file)).size;
  if (size > MAX_COVER_BYTES) throw new MediaError("image_too_large", "Covers are limited to 25 MB");
  const { width, height } = await imageSize(file);
  const sha = await fileSha256(file);
  const [existing] = await sql<{ id: string }[]>`SELECT id FROM artworks WHERE sha256 = ${sha}`;
  if (existing) { await rm(file, { force: true }); return existing.id; }
  const st = storage();
  const thumbs: { size: number; tmp: string; bytes: number }[] = [];
  try {
    for (const s of THUMB_SIZES) { const tmp = `${await scratch()}.jpg`; await makeThumb(file, tmp, s); thumbs.push({ size: s, tmp, bytes: (await stat(tmp)).size }); }
    const ext = kind === "jpeg" ? "jpg" : kind;
    const mime = kind === "jpeg" ? "image/jpeg" : `image/${kind}`;
    await st.putFile(keys.artOriginal(sha, ext), file);
    for (const t of thumbs) await st.putFile(keys.artThumb(sha, t.size), t.tmp);
    return await sql.begin(async (tx) => {
      const [w] = await tx<{ id: string }[]>`INSERT INTO artworks (sha256, mime, width, height) VALUES (${sha}, ${mime}, ${width}, ${height}) ON CONFLICT (sha256) DO UPDATE SET mime = EXCLUDED.mime RETURNING id`;
      await tx`INSERT INTO media_assets (kind, storage_key, sha256, size_bytes, mime, artwork_id) VALUES ('artwork', ${keys.artOriginal(sha, ext)}, ${sha}, ${size}, ${mime}, ${w.id}) ON CONFLICT (storage_key) DO NOTHING`;
      for (const t of thumbs) await tx`INSERT INTO media_assets (kind, storage_key, size_bytes, mime, artwork_id) VALUES ('thumbnail', ${keys.artThumb(sha, t.size)}, ${t.bytes}, 'image/jpeg', ${w.id}) ON CONFLICT (storage_key) DO NOTHING`;
      return w.id;
    }) as string;
  } finally { for (const t of thumbs) await rm(t.tmp, { force: true }); }
}

async function coverFromAudio(file: string): Promise<string | null> {
  const tmp = `${await scratch()}.img`;
  try {
    if (!(await extractCover(file, tmp))) return null;
    return await storeArtwork(tmp);
  } catch { return null; }       // a broken embedded picture never fails the import of the audio
  finally { await rm(tmp, { force: true }); }
}

// ── One upload ──────────────────────────────────────────────────────────────────────────────────────

interface UploadRow { id: string; user_id: string | null; filename: string; size_bytes: string; replace: boolean; duplicate_of: string | null; parent_id: string | null }
const setStatus = (id: string, status: string) => sql`UPDATE uploads SET status = ${status}, updated_at = now() WHERE id = ${id}`;

function tagsWithFallback(p: Probe, filename: string) {
  const base = filename.replace(/\.[A-Za-z0-9]{2,5}$/, "");
  const m = base.match(/^(?:(\d{1,2})[-.](\d{1,3})|(\d{1,3}))[\s._-]+(.+)$/);
  return {
    title: p.tags.title || clean(m ? m[4] : base) || "Sans titre",
    artist: p.tags.artist || p.tags.albumArtist || "Artiste inconnu",
    albumArtist: p.tags.albumArtist || p.tags.artist || "Artiste inconnu",
    album: p.tags.album || "Album inconnu",
    trackNo: p.tags.trackNo ?? (m ? Number(m[2] ?? m[3]) : null),
    discNo: p.tags.discNo ?? (m?.[1] && m[2] ? Number(m[1]) : 1),
    year: p.tags.year, genre: p.tags.genre,
  };
}

function compatStateFor(playable: "yes" | "some" | "no", codec: string): string {
  if (env.renditions === "never") return playable === "yes" ? "none" : "disabled";
  if (playable === "some") return "queued";
  if (playable === "no") return codec.startsWith("dsd") && env.transcodeDsd ? "queued" : "disabled";
  return "none";
}

/** Processes a fully received upload. Never throws: the outcome is written on the row. */
export async function processUpload(id: string): Promise<void> {
  const [u] = await sql<UploadRow[]>`SELECT id, user_id, filename, size_bytes, replace, duplicate_of, parent_id FROM uploads WHERE id = ${id}`;
  if (!u) return;
  const tmp = uploadTmpPath(id);
  const fail = async (code: string, detail?: string, keepFile = false) => {
    await sql`UPDATE uploads SET status = 'error', error_code = ${code}, error_detail = ${detail?.slice(0, 300) ?? null}, updated_at = now() WHERE id = ${id}`;
    if (!keepFile) await rm(tmp, { force: true });
  };
  try {
    const size = (await stat(tmp).catch(() => null))?.size;
    if (size == null) return void (await fail("file_missing", "The uploaded data is no longer on the server; send the file again"));
    if (size !== Number(u.size_bytes)) return void (await fail("size_mismatch"));
    if (size === 0) return void (await fail("empty_file"));

    // 1. Validation from the real content.
    const kind = await sniff(tmp);
    await sql`UPDATE uploads SET kind = ${kind}, updated_at = now() WHERE id = ${id}`;
    if (kind === "zip") { if (u.parent_id) return void (await fail("nested_archive")); return void (await expandArchive(u, tmp)); }
    if (!kind || !AUDIO_KINDS.has(kind)) return void (await fail("unsupported_type", "Accepted: FLAC, MP3, AAC/M4A, ALAC, WAV, AIFF, Ogg, DSD (DSF/DFF), or a ZIP of those"));
    const quota = env.libraryQuotaBytes;
    if (quota && (await libraryBytes()) + size > quota) return void (await fail("quota_exceeded", "The library quota is reached", true));

    const sha = await fileSha256(tmp);
    await sql`UPDATE uploads SET sha256 = ${sha} WHERE id = ${id}`;
    const [same] = await sql<{ track_id: string }[]>`SELECT track_id FROM media_assets WHERE kind = 'original' AND sha256 = ${sha}`;
    if (same && !u.replace) {
      await sql`UPDATE uploads SET status = 'duplicate', duplicate_of = ${same.track_id}, error_code = 'same_file', updated_at = now() WHERE id = ${id}`;
      return;
    }

    // 2. Metadata.
    await setStatus(id, "extracting");
    let p: Probe;
    try { p = await probe(tmp); } catch (e) { return void (await fail(e instanceof MediaError ? e.code : "undecodable", e instanceof Error ? e.message : undefined)); }
    const tags = tagsWithFallback(p, u.filename);
    const playable = webPlayable(p);

    // A different file for a track already in the library (same album artist, album, disc, number and title).
    const [twin] = same ? [] : await sql<{ id: string }[]>`
      SELECT t.id FROM tracks t JOIN albums al ON al.id = t.album_id JOIN artists aa ON aa.id = al.artist_id
      WHERE aa.name_norm = ${norm(tags.albumArtist)} AND al.title_norm = ${norm(tags.album)} AND t.title_norm = ${norm(tags.title)}
        AND t.disc_no = ${tags.discNo ?? 1} AND t.track_no IS NOT DISTINCT FROM ${tags.trackNo}`;
    if (twin && !u.replace) {
      await sql`UPDATE uploads SET status = 'duplicate', duplicate_of = ${twin.id}, error_code = 'same_track', updated_at = now() WHERE id = ${id}`;
      return;
    }
    const replacing = u.replace ? (same?.track_id ?? twin?.id ?? null) : null;

    const artworkId = p.hasPicture ? await coverFromAudio(tmp) : null;
    const ext = extFor(kind as Kind);
    const key = keys.original(sha, ext);
    const st = storage();
    const mime = mimeFor(p.codec, p.container);
    const compat = compatStateFor(playable, p.codec);

    // 3. Storage, then the rows. The file is in place before any row points at it.
    const oldKeys: string[] = [];
    if (!same) await st.putFile(key, tmp); else await rm(tmp, { force: true });
    const trackId = await sql.begin(async (tx) => {
      const artistId = await upsertArtist(tx, tags.artist);
      const albumArtistId = await upsertArtist(tx, tags.albumArtist);
      const genreId = await upsertGenre(tx, tags.genre);
      const albumId = await upsertAlbum(tx, { title: tags.album, artistId: albumArtistId, year: tags.year, genreId, artworkId });
      const cols = { title: tags.title, title_norm: norm(tags.title), artist_id: artistId, album_id: albumId, track_no: tags.trackNo, disc_no: tags.discNo ?? 1, year: tags.year, genre_id: genreId,
        duration_ms: p.durationMs, codec: p.codec, container: p.container, sample_rate: p.sampleRate, bit_depth: p.bitDepth, channels: p.channels, bitrate: p.bitrate, web_playable: playable, compat_state: compat, compat_error: null };
      let tid: string;
      if (replacing) {
        // Same track id: playlists, favourites and queues keep pointing at it.
        const old = await tx<{ storage_key: string; kind: string }[]>`SELECT storage_key, kind FROM media_assets WHERE track_id = ${replacing} AND kind IN ('original', 'rendition')`;
        for (const o of old) if (o.storage_key !== key) oldKeys.push(o.storage_key);
        await tx`DELETE FROM media_assets WHERE track_id = ${replacing} AND kind IN ('original', 'rendition')`;
        await tx`UPDATE tracks SET ${tx(cols)}, updated_at = now() WHERE id = ${replacing}`;
        tid = replacing;
      } else {
        const [t] = await tx<{ id: string }[]>`INSERT INTO tracks ${tx(cols)} RETURNING id`;
        tid = t.id;
      }
      await tx`INSERT INTO media_assets (kind, storage_key, sha256, size_bytes, mime, track_id) VALUES ('original', ${key}, ${sha}, ${size}, ${mime}, ${tid})`;
      await tx`UPDATE uploads SET status = 'ready', track_id = ${tid}, error_code = NULL, error_detail = NULL, updated_at = now() WHERE id = ${id}`;
      return tid;
    }) as string;
    for (const k of oldKeys) await st.delete(k).catch(() => {});
    if (replacing) {
      await audit({ userId: u.user_id, actor: "admin", action: "track.replaced", entity: "track", entityId: trackId, meta: { sha256: sha, reason: same ? "same_file" : "same_track" } });
      await pruneOrphans();
    }
  } catch (e) {
    console.error("[ingest] upload failed", id, e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    await fail(e instanceof MediaError ? e.code : "internal", e instanceof MediaError ? e.message : undefined, true).catch(() => {});
  }
}

// ── Archives ────────────────────────────────────────────────────────────────────────────────────────

/**
 * ZIP import. Entries are never written under their own names: each audio entry becomes a child upload stored at
 * a server-generated path, so "../" or absolute paths in the archive are harmless. Bounded against bombs: entry
 * count, per-entry size, total size and compression ratio are checked on the bytes actually produced.
 */
async function expandArchive(u: UploadRow, zipPath: string): Promise<void> {
  const id = u.id;
  const created: string[] = [];
  let total = 0;
  try {
    const zip = await new Promise<yauzl.ZipFile>((res, rej) => yauzl.open(zipPath, { lazyEntries: true, autoClose: true, validateEntrySizes: true, strictFileNames: false }, (e, z) => (e || !z ? rej(e) : res(z))));
    if (zip.entryCount > env.archiveMaxEntries) { zip.close(); throw new MediaError("archive_too_many_entries", `Archives are limited to ${env.archiveMaxEntries} entries`); }
    const zipSize = (await stat(zipPath)).size;
    await mkdir(path.dirname(uploadTmpPath(id)), { recursive: true, mode: 0o700 });
    await new Promise<void>((resolve, reject) => {
      zip.on("error", reject);
      zip.on("end", resolve);
      zip.on("entry", (entry: yauzl.Entry) => {
        const name = String(entry.fileName);
        const isDir = name.endsWith("/");
        const base = safeFilename(name);
        const skip = isDir || name.startsWith("__MACOSX/") || base.startsWith("._") || !/\.(flac|mp3|m4a|aac|wav|aiff?|ogg|opus|dsf|dff)$/i.test(base);
        if (skip) return zip.readEntry();
        if (entry.uncompressedSize > env.maxFileBytes) return reject(new MediaError("archive_entry_too_large", `An entry exceeds the per-file limit`));
        if ((entry.generalPurposeBitFlag & 0x1) !== 0) return reject(new MediaError("archive_encrypted", "Encrypted archives are not accepted"));
        if (created.length >= env.maxFilesPerBatch) return reject(new MediaError("archive_too_many_entries", `Archives are limited to ${env.maxFilesPerBatch} audio files`));
        zip.openReadStream(entry, (err, rs) => {
          if (err || !rs) return reject(err ?? new MediaError("archive_invalid"));
          const childId = randomUUID();
          const dest = uploadTmpPath(childId);
          let n = 0;
          const guard = new Transform({ transform(chunk: Buffer, _enc, cb) {
            n += chunk.length; total += chunk.length;
            if (n > env.maxFileBytes) return cb(new MediaError("archive_entry_too_large"));
            if (total > env.archiveMaxTotalBytes) return cb(new MediaError("archive_too_large", "The archive expands beyond the configured limit"));
            if (total > zipSize * env.archiveMaxRatio && total > 100 * 1024 * 1024) return cb(new MediaError("archive_bomb", "Suspicious compression ratio"));
            cb(null, chunk);
          } });
          pipeline(rs, guard, createWriteStream(dest, { mode: 0o600 }))
            .then(async () => {
              await sql`INSERT INTO uploads (id, user_id, parent_id, filename, size_bytes, received_bytes, status) VALUES (${childId}, ${u.user_id}, ${id}, ${base}, ${n}, ${n}, 'uploading')`;
              created.push(childId);
              zip.readEntry();
            })
            .catch(async (e) => { await rm(dest, { force: true }); reject(e); });
        });
      });
      zip.readEntry();
    });
    if (created.length === 0) throw new MediaError("archive_no_audio", "The archive holds no supported audio file");
    // Children are released to the queue only once the whole archive passed its checks.
    await sql`UPDATE uploads SET status = 'received', updated_at = now() WHERE id = ANY(${created}::uuid[])`;
    await sql`UPDATE uploads SET status = 'ready', error_detail = ${`${created.length}`}, updated_at = now() WHERE id = ${id}`;
  } catch (e) {
    for (const c of created) await rm(uploadTmpPath(c), { force: true });
    if (created.length) await sql`DELETE FROM uploads WHERE id = ANY(${created}::uuid[])`;
    const code = e instanceof MediaError ? e.code : "archive_invalid";
    await sql`UPDATE uploads SET status = 'error', error_code = ${code}, error_detail = ${e instanceof MediaError ? e.message.slice(0, 300) : null}, updated_at = now() WHERE id = ${id}`;
  } finally { await rm(zipPath, { force: true }); }
}

// ── Compatibility renditions ────────────────────────────────────────────────────────────────────────

export async function buildRendition(trackId: string): Promise<void> {
  const [t] = await sql<{ storage_key: string; sample_rate: number | null }[]>`
    SELECT m.storage_key, t.sample_rate FROM tracks t JOIN media_assets m ON m.track_id = t.id AND m.kind = 'original' WHERE t.id = ${trackId}`;
  if (!t) return;
  const st = storage();
  const tmp = `${await scratch()}.m4a`;
  try {
    await transcodeAac(await st.localPath(t.storage_key), tmp, t.sample_rate);
    const size = (await stat(tmp)).size;
    const key = keys.rendition(trackId);
    await st.putFile(key, tmp);
    await sql.begin(async (tx) => {
      await tx`DELETE FROM media_assets WHERE track_id = ${trackId} AND kind = 'rendition'`;
      await tx`INSERT INTO media_assets (kind, storage_key, size_bytes, mime, track_id) VALUES ('rendition', ${key}, ${size}, 'audio/mp4', ${trackId})`;
      await tx`UPDATE tracks SET compat_state = 'ready', compat_error = NULL, updated_at = now() WHERE id = ${trackId}`;
    });
  } catch (e) {
    await sql`UPDATE tracks SET compat_state = 'error', compat_error = ${(e instanceof MediaError ? e.code : "internal")}, updated_at = now() WHERE id = ${trackId}`;
  } finally { await rm(tmp, { force: true }); }
}

/** Re-reads the technical data (and the cover, if the album has none) of a stored original. */
export async function reanalyseTrack(trackId: string): Promise<void> {
  const [t] = await sql<{ storage_key: string; album_id: string; has_art: boolean }[]>`
    SELECT m.storage_key, t.album_id, (al.artwork_id IS NOT NULL) AS has_art FROM tracks t JOIN media_assets m ON m.track_id = t.id AND m.kind = 'original' JOIN albums al ON al.id = t.album_id WHERE t.id = ${trackId}`;
  if (!t) return;
  const file = await storage().localPath(t.storage_key);
  const p = await probe(file);
  const playable = webPlayable(p);
  const [cur] = await sql<{ compat_state: string }[]>`SELECT compat_state FROM tracks WHERE id = ${trackId}`;
  const compat = cur.compat_state === "ready" ? "ready" : compatStateFor(playable, p.codec);
  await sql`UPDATE tracks SET duration_ms = ${p.durationMs}, codec = ${p.codec}, container = ${p.container}, sample_rate = ${p.sampleRate}, bit_depth = ${p.bitDepth},
    channels = ${p.channels}, bitrate = ${p.bitrate}, web_playable = ${playable}, compat_state = ${compat}, compat_error = NULL, updated_at = now() WHERE id = ${trackId}`;
  if (!t.has_art && p.hasPicture) {
    const art = await coverFromAudio(file);
    if (art) await sql`UPDATE albums SET artwork_id = ${art} WHERE id = ${t.album_id} AND artwork_id IS NULL`;
  }
}
