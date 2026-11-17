import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";
import { ApiError } from "@/lib/http";
import { audit } from "@/lib/audit";
import type { UserContext } from "@/lib/auth";
import { clean, norm } from "@/lib/text";
import { storage } from "./storage";

const run = promisify(execFile);

/** One displayed line. `w` (word timings) exists on transcribed lines; a line typed by hand has none. */
export interface LyricLine { t: number; e: number; text: string; w?: [number, number, string][] }
interface Segment { start: number; end: number; text: string; no_speech_prob: number; avg_logprob: number; compression_ratio: number; words: { start: number; end: number; word: string }[] }

export const LANGUAGES = ["fr", "en", "es", "it", "de", "pt"] as const;
export const lyricsEnabled = () => env.lyrics !== "off" && !!env.lyricsPython;

// Sentences speech models invent over music or silence (subtitle credits from their training data).
const HALLUCINATIONS = [/sous-?titr/i, /soci[ée]t[ée] radio-canada/i, /amara\.org/i, /merci d'avoir regard/i, /thanks? for watching/i, /subtitles? by/i, /^\s*(music|musique|applaud\w*|♪+)\s*$/i, /abonnez-vous/i, /subscribe/i];
// Stock phrases the model emits, with full confidence, over music or a plain tone where nobody sings.
const FILLERS = new Set(["thank you", "thank you very much", "thanks", "thanks for watching", "you", "bye", "bye bye", "merci", "merci beaucoup", "a bientot", "oh", "ah", "hmm", "okay", "ok"]);
const isFiller = (text: string) => FILLERS.has(norm(text).replace(/[^a-z ]/g, "").trim());
const MAX_LINE_CHARS = 46;

/** Model output → display lines: hallucinations and low-confidence noise dropped, long segments cut at word boundaries. */
export function toLines(segments: Segment[]): LyricLine[] {
  const lines: LyricLine[] = [];
  let prevText = "", repeats = 0;
  for (const s of segments) {
    const text = clean(s.text, 500);
    if (!text || s.words.length === 0) continue;
    if (HALLUCINATIONS.some((h) => h.test(text))) continue;
    if (s.no_speech_prob > 0.6 && s.avg_logprob < -1) continue;       // the model itself doubts anyone is singing
    if (s.compression_ratio > 2.8) continue;                           // degenerate repetition inside one segment
    // The same sentence more than four times in a row is a decoding loop far more often than a chorus.
    const n = norm(text);
    repeats = n === prevText ? repeats + 1 : 0; prevText = n;
    if (repeats >= 4) continue;
    let cur: [number, number, string][] = [], len = 0;
    const flush = () => {
      if (!cur.length) return;
      lines.push({ t: cur[0][0], e: cur[cur.length - 1][1], text: cur.map((w) => w[2]).join("").trim(), w: cur.map((w, i) => [w[0], w[1], i === 0 ? w[2].trimStart() : w[2]]) });
      cur = []; len = 0;
    };
    for (const w of s.words) {
      const word = w.word.replace(/[\u0000-\u001f]/g, "");                // eslint-disable-line no-control-regex
      if (!word.trim()) continue;
      const startsNew = len + word.length > MAX_LINE_CHARS && len > 12 && word.startsWith(" ");
      if (startsNew) flush();
      const start = Math.max(0, Math.round(w.start * 1000)), end = Math.max(start + 40, Math.round(w.end * 1000));
      cur.push([start, end, word]); len += word.length;
      if (/[.!?…]\s*$/.test(word) && len > 18) flush();
    }
    flush();
  }
  const kept = lines.filter((l) => l.text.length > 0);
  // A filler standing alone (more than 8 s of nothing on both sides) is noise, not a lyric; a transcript made of
  // nothing but fillers means the track is instrumental.
  const out = kept.filter((l, i) => !isFiller(l.text) || (i > 0 && l.t - kept[i - 1].e < 8000) || (i < kept.length - 1 && kept[i + 1].t - l.e < 8000));
  return out.every((l) => isFiller(l.text)) ? [] : out;
}

/** Language hint when none was requested: the genre tag sometimes says it; otherwise the model detects. */
function languageFromGenre(genre: string | null): string | null {
  const g = norm(genre ?? "");
  if (/franco|chanson|quebec|french|francais/.test(g)) return "fr";
  return null;
}

/** Worker side: transcribes one queued track. Never throws; the outcome is written on the row. */
export async function transcribeTrack(trackId: string): Promise<void> {
  const fail = (error: string) => sql`UPDATE lyrics SET state = 'error', error = ${error.slice(0, 200)}, updated_at = now() WHERE track_id = ${trackId}`;
  try {
    if (!lyricsEnabled()) return void (await fail("lyrics_disabled"));
    const [t] = await sql<{ storage_key: string; requested_language: string | null; genre: string | null }[]>`
      SELECT m.storage_key, l.requested_language, g.name AS genre FROM lyrics l JOIN tracks t ON t.id = l.track_id
      JOIN media_assets m ON m.track_id = t.id AND m.kind = 'original' LEFT JOIN genres g ON g.id = t.genre_id WHERE l.track_id = ${trackId}`;
    if (!t) return;
    const file = await storage().localPath(t.storage_key);
    const language = t.requested_language ?? languageFromGenre(t.genre) ?? "auto";
    const script = path.join(process.cwd(), "scripts", "transcribe.py");
    let stdout: string;
    try {
      ({ stdout } = await run(env.lyricsPython!, [script, file, env.lyricsModel, language], { timeout: 30 * 60_000, maxBuffer: 128 * 1024 * 1024, env: { ...process.env, HF_HUB_DISABLE_TELEMETRY: "1", TOKENIZERS_PARALLELISM: "false" } }));
    } catch (e) {
      const msg = String((e as { stderr?: string }).stderr ?? "").split("\n").filter((l) => l.startsWith("transcribe failed")).pop();
      return void (await fail(msg ?? "transcription_failed"));
    }
    const out = JSON.parse(stdout) as { language: string | null; segments: Segment[] };
    const lines = toLines(out.segments);
    await sql`UPDATE lyrics SET state = ${lines.length ? "ready" : "empty"}, lines = ${sql.json(lines as never)}, language = ${out.language}, source = 'whisper',
      model = ${env.lyricsModel}, edited = false, error = NULL, updated_at = now() WHERE track_id = ${trackId}`;
  } catch (e) {
    console.error("[lyrics]", trackId, e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    await fail("internal").catch(() => {});
  }
}

export async function claimLyrics(): Promise<string | null> {
  const [l] = await sql<{ track_id: string }[]>`
    UPDATE lyrics SET state = 'working', updated_at = now() WHERE track_id = (SELECT track_id FROM lyrics WHERE state = 'queued' ORDER BY updated_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING track_id`;
  return l?.track_id ?? null;
}

/** Queues a transcription. Lines corrected by hand are kept unless `overwrite` is explicit. */
export async function queueLyrics(trackIds: string[], language: string | null, overwrite: boolean): Promise<number> {
  const r = await sql`
    INSERT INTO lyrics (track_id, state, requested_language) SELECT id, 'queued', ${language} FROM tracks WHERE id = ANY(${trackIds}::uuid[])
    ON CONFLICT (track_id) DO UPDATE SET state = 'queued', requested_language = EXCLUDED.requested_language, error = NULL, updated_at = now()
      WHERE lyrics.state NOT IN ('queued', 'working') AND (${overwrite} OR NOT lyrics.edited)
    RETURNING track_id`;
  return r.length;
}

// ── API ─────────────────────────────────────────────────────────────────────────────────────────────

export async function getLyrics(trackId: string) {
  const [l] = await sql<{ state: string; language: string | null; source: string; edited: boolean; lines: LyricLine[]; error: string | null }[]>`
    SELECT state, language, source, edited, lines, error FROM lyrics WHERE track_id = ${trackId}`;
  if (!l) { const [t] = await sql`SELECT 1 FROM tracks WHERE id = ${trackId}`; if (!t) throw new ApiError(404, "not_found"); return { state: "none", lines: [], enabled: lyricsEnabled() }; }
  return { state: l.state, language: l.language, source: l.source, edited: l.edited, lines: l.state === "ready" ? l.lines : [], enabled: lyricsEnabled() };
}

export async function requestLyrics(user: UserContext, ids: string[], language: string | null, overwrite: boolean) {
  if (!lyricsEnabled()) throw new ApiError(409, "lyrics_disabled", "Lyrics transcription is not configured on this server");
  const queued = await queueLyrics(ids, language, overwrite);
  await audit({ userId: user.userId, actor: "admin", action: "lyrics.requested", meta: { count: queued, language: language ?? "auto" } });
  return { queued, skipped: ids.length - queued };
}

/** Manual correction: line timings are kept; a line whose text is unchanged keeps its word timings too. */
export async function saveLyrics(user: UserContext, trackId: string, input: { t: number; e: number; text: string }[], language: string | null) {
  const [t] = await sql`SELECT 1 FROM tracks WHERE id = ${trackId}`;
  if (!t) throw new ApiError(404, "not_found", "Track not found");
  const [old] = await sql<{ lines: LyricLine[] }[]>`SELECT lines FROM lyrics WHERE track_id = ${trackId}`;
  const prev = new Map((old?.lines ?? []).map((l) => [`${l.t}:${l.text}`, l]));
  const lines: LyricLine[] = input.map((l) => ({ t: l.t, e: Math.max(l.e, l.t + 200), text: clean(l.text, 300) })).filter((l) => l.text).sort((a, b) => a.t - b.t)
    .map((l) => { const same = prev.get(`${l.t}:${l.text}`); return same?.w ? { ...l, w: same.w } : l; });
  await sql`INSERT INTO lyrics (track_id, state, lines, source, edited, language) VALUES (${trackId}, ${lines.length ? "ready" : "empty"}, ${sql.json(lines as never)}, 'manual', true, ${language})
    ON CONFLICT (track_id) DO UPDATE SET state = EXCLUDED.state, lines = EXCLUDED.lines, edited = true, language = coalesce(EXCLUDED.language, lyrics.language), error = NULL, updated_at = now()`;
  await audit({ userId: user.userId, actor: "admin", action: "lyrics.edited", entity: "track", entityId: trackId, meta: { lines: lines.length } });
  return { lines: lines.length };
}

export async function deleteLyrics(user: UserContext, trackId: string) {
  const r = await sql`DELETE FROM lyrics WHERE track_id = ${trackId} RETURNING track_id`;
  if (r.length === 0) throw new ApiError(404, "not_found");
  await audit({ userId: user.userId, actor: "admin", action: "lyrics.deleted", entity: "track", entityId: trackId });
  return { ok: true };
}
