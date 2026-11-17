import { execFile } from "node:child_process";
import { open } from "node:fs/promises";
import { promisify } from "node:util";
import { env } from "@/lib/env";
import { clean } from "@/lib/text";

const run = promisify(execFile);

export type Kind = "flac" | "mp3" | "m4a" | "wav" | "aiff" | "ogg" | "dsf" | "dff" | "aac" | "zip" | "jpeg" | "png" | "webp";
export class MediaError extends Error { constructor(public code: string, message?: string) { super(message ?? code); } }

/** Type from the first bytes of the content. The extension and the declared MIME type are never trusted. */
export async function sniff(file: string): Promise<Kind | null> {
  const fh = await open(file, "r");
  try {
    const b = Buffer.alloc(16);
    const { bytesRead } = await fh.read(b, 0, 16, 0);
    if (bytesRead < 12) return null;
    const s = (o: number, n: number) => b.toString("latin1", o, o + n);
    if (s(0, 4) === "fLaC") return "flac";
    if (s(0, 3) === "ID3") {
      // An ID3v2 tag may precede MP3, FLAC, AAC or AIFF data: look at what follows the tag.
      const hdr = Buffer.alloc(10); await fh.read(hdr, 0, 10, 0);
      const size = ((hdr[6] & 0x7f) << 21) | ((hdr[7] & 0x7f) << 14) | ((hdr[8] & 0x7f) << 7) | (hdr[9] & 0x7f);
      const after = Buffer.alloc(4); const r = await fh.read(after, 0, 4, 10 + size);
      if (r.bytesRead === 4 && after.toString("latin1") === "fLaC") return "flac";
      if (r.bytesRead >= 2 && after[0] === 0xff && (after[1] & 0xf6) === 0xf0) return "aac";
      return "mp3";
    }
    if (s(4, 4) === "ftyp") return "m4a";
    if (s(0, 4) === "RIFF" && s(8, 4) === "WAVE") return "wav";
    if (s(0, 4) === "RIFF" && s(8, 4) === "WEBP") return "webp";
    if (s(0, 4) === "FORM" && (s(8, 4) === "AIFF" || s(8, 4) === "AIFC")) return "aiff";
    if (s(0, 4) === "OggS") return "ogg";
    if (s(0, 4) === "DSD ") return "dsf";
    if (s(0, 4) === "FRM8") return "dff";
    if (s(0, 4) === "PK\u0003\u0004") return "zip";
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
    if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
    if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return "aac";       // ADTS
    if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return "mp3";       // MPEG audio frame sync
    return null;
  } finally { await fh.close(); }
}

export const AUDIO_KINDS: ReadonlySet<Kind> = new Set(["flac", "mp3", "m4a", "wav", "aiff", "ogg", "dsf", "dff", "aac"]);
const EXT: Record<string, string> = { flac: "flac", mp3: "mp3", m4a: "m4a", wav: "wav", aiff: "aiff", ogg: "ogg", dsf: "dsf", dff: "dff", aac: "aac" };
export const extFor = (k: Kind) => EXT[k] ?? "bin";

export interface Probe {
  codec: string; container: string; durationMs: number; sampleRate: number | null; bitDepth: number | null; channels: number | null; bitrate: number | null;
  hasPicture: boolean;
  tags: { title: string; artist: string; album: string; albumArtist: string; trackNo: number | null; discNo: number | null; year: number | null; genre: string };
}

/** ffprobe with an argument vector (no shell): a hostile file name cannot become a command. */
export async function probe(file: string): Promise<Probe> {
  let out: string;
  try {
    ({ stdout: out } = await run(env.ffprobe, ["-v", "error", "-hide_banner", "-show_format", "-show_streams", "-of", "json", "--", file], { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 }));
  } catch { throw new MediaError("undecodable", "ffprobe could not read the file"); }
  let data: { streams?: Record<string, unknown>[]; format?: Record<string, unknown> };
  try { data = JSON.parse(out); } catch { throw new MediaError("undecodable"); }
  const streams = data.streams ?? [];
  const a = streams.find((s) => s.codec_type === "audio");
  if (!a) throw new MediaError("no_audio_stream", "The file holds no audio stream");
  if (streams.some((s) => s.codec_type === "video" && !(s.disposition as Record<string, number> | undefined)?.attached_pic)) throw new MediaError("not_audio", "Video files are not accepted");
  const fmt = data.format ?? {};
  const tagsRaw: Record<string, string> = {};
  for (const src of [fmt.tags, a.tags]) for (const [k, v] of Object.entries((src as Record<string, string>) ?? {})) if (typeof v === "string" && !(k.toLowerCase() in tagsRaw)) tagsRaw[k.toLowerCase()] = v;
  const tag = (...names: string[]) => { for (const n of names) if (tagsRaw[n]) return clean(tagsRaw[n]); return ""; };
  const num = (v: string) => { const m = v.match(/^\s*(\d{1,4})/); return m ? Number(m[1]) : null; };
  const yearM = tag("date", "year", "originaldate", "tyer", "tdrc").match(/(1\d{3}|2\d{3})/);
  const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? Math.round(x) : null; };
  const duration = Number(fmt.duration ?? a.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new MediaError("undecodable", "The audio stream has no measurable duration");
  const codec = String(a.codec_name ?? "");
  return {
    codec, container: String(fmt.format_name ?? "").split(",")[0],
    durationMs: Math.round(duration * 1000),
    sampleRate: n(a.sample_rate), channels: n(a.channels), bitrate: n(fmt.bit_rate ?? a.bit_rate),
    bitDepth: n(a.bits_per_raw_sample) ?? n(a.bits_per_sample) ?? (codec.startsWith("dsd") ? 1 : null),
    hasPicture: streams.some((s) => s.codec_type === "video"),
    tags: {
      title: tag("title"), artist: tag("artist"), album: tag("album"), albumArtist: tag("album_artist", "albumartist", "album artist"),
      trackNo: num(tag("track", "tracknumber")), discNo: num(tag("disc", "discnumber")), year: yearM ? Number(yearM[1]) : null, genre: tag("genre"),
    },
  };
}

/**
 * Can browsers decode the original?
 *  yes  — FLAC, MP3, AAC, PCM WAV, Vorbis/Opus… (every current engine, Safari included for FLAC since 11)
 *  some — ALAC and AIFF: Safari only → an AAC rendition is prepared at import
 *  no   — DSD and anything else → original kept, rendition only under explicit configuration
 */
export function webPlayable(p: Pick<Probe, "codec" | "container">): "yes" | "some" | "no" {
  const c = p.codec;
  if (c.startsWith("dsd")) return "no";
  if (c === "alac") return "some";
  if (p.container === "aiff") return "some";
  if (c === "flac" || c === "mp3" || c === "aac") return "yes";
  if (p.container === "wav" && /^pcm_(s16le|s24le|u8|f32le|s32le)$/.test(c)) return "yes";
  // Safari decodes Ogg Vorbis/Opus only since 18.4: treat as partial so a rendition exists.
  if (c === "vorbis" || c === "opus") return "some";
  return "no";
}

export function mimeFor(codec: string, container: string): string {
  if (codec === "flac") return "audio/flac";
  if (codec === "mp3") return "audio/mpeg";
  if (container === "wav") return "audio/wav";
  if (container === "aiff") return "audio/aiff";
  if (container === "ogg") return "audio/ogg";
  if (container === "aac") return "audio/aac";
  if (codec === "aac" || codec === "alac" || container === "mov") return "audio/mp4";
  if (codec.startsWith("dsd")) return "audio/x-dsd";
  return "application/octet-stream";
}

/** AAC compatibility rendition. The original is only read. High-resolution sources are brought to 44.1/48 kHz. */
export async function transcodeAac(src: string, dest: string, sampleRate: number | null): Promise<void> {
  const rate = sampleRate && sampleRate % 44100 === 0 ? 44100 : sampleRate && sampleRate <= 48000 && sampleRate !== 44100 ? sampleRate : sampleRate && sampleRate > 48000 ? 48000 : 44100;
  try {
    await run(env.ffmpeg, ["-v", "error", "-hide_banner", "-nostdin", "-y", "-i", src, "-map", "0:a:0", "-vn", "-c:a", "aac", "-b:a", `${env.renditionBitrateK}k`, "-ar", String(rate), "-ac", "2", "-movflags", "+faststart", "-f", "ipod", dest], { timeout: 30 * 60_000, maxBuffer: 4 * 1024 * 1024 });
  } catch (e) { throw new MediaError("transcode_failed", String((e as { stderr?: string }).stderr ?? "").slice(0, 300)); }
}

/** Embedded cover → file, stream-copied (the picture bytes are not re-encoded). Returns false when there is none. */
export async function extractCover(src: string, dest: string): Promise<boolean> {
  try { await run(env.ffmpeg, ["-v", "error", "-hide_banner", "-nostdin", "-y", "-i", src, "-an", "-map", "0:v:0", "-frames:v", "1", "-c:v", "copy", "-f", "image2", dest], { timeout: 60_000 }); return true; }
  catch { return false; }
}

const MAX_IMAGE_PIXELS = 8000;
export async function imageSize(file: string): Promise<{ width: number; height: number }> {
  try {
    const { stdout } = await run(env.ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", "--", file], { timeout: 30_000 });
    const s = JSON.parse(stdout).streams?.[0];
    const width = Number(s?.width), height = Number(s?.height);
    if (!(width > 0 && height > 0)) throw new Error();
    if (width > MAX_IMAGE_PIXELS || height > MAX_IMAGE_PIXELS) throw new MediaError("image_too_large", `Images are limited to ${MAX_IMAGE_PIXELS} px per side`);
    return { width, height };
  } catch (e) { if (e instanceof MediaError) throw e; throw new MediaError("bad_image", "The image could not be read"); }
}

/** Square JPEG thumbnail (centre crop). The source image is left untouched. */
export async function makeThumb(src: string, dest: string, size: number): Promise<void> {
  try {
    await run(env.ffmpeg, ["-v", "error", "-hide_banner", "-nostdin", "-y", "-i", src, "-frames:v", "1", "-vf", `scale=${size}:${size}:force_original_aspect_ratio=increase:flags=lanczos,crop=${size}:${size}`, "-q:v", "3", "-f", "image2", "-c:v", "mjpeg", dest], { timeout: 60_000 });
  } catch { throw new MediaError("bad_image", "The image could not be converted"); }
}
