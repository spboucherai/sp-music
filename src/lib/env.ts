/** Server-side configuration. Never import this from a client component. */
import path from "node:path";

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}
const opt = (name: string) => process.env[name] || undefined;
const int = (name: string, def: number) => { const v = opt(name); if (!v) return def; const n = Number(v); if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a positive number`); return n; };
const MB = 1024 * 1024;

export const env = {
  get databaseUrl() { return req("DATABASE_URL"); },
  /** Public origin of the site. WebAuthn's expected origin and (by default) its RP ID derive from it. */
  get appUrl() { return (opt("APP_URL") ?? "http://localhost:8690").replace(/\/$/, ""); },
  /** WebAuthn RP ID: the site's host name by default; may be a registrable parent domain (e.g. spboucher.ai). */
  get rpId() { return opt("WEBAUTHN_RP_ID") ?? new URL(this.appUrl).hostname; },
  get appSecret() { const s = req("APP_SECRET"); if (s.length < 32) throw new Error("APP_SECRET must be at least 32 characters"); return s; },
  get isProd() { return process.env.NODE_ENV === "production"; },
  get ownerEmail() { return opt("OWNER_EMAIL"); },
  get ownerName() { return opt("OWNER_NAME") ?? "Propriétaire"; },

  // Storage
  get storageDriver() { return opt("STORAGE_DRIVER") ?? "local"; },
  /** Mount point of the private library volume (never under public/). */
  get storageRoot() { return path.resolve(/*turbopackIgnore: true*/ req("STORAGE_ROOT")); },
  /** Scratch space for uploads in progress and processing; same volume as the library keeps moves atomic. */
  get tmpDir() { return path.resolve(/*turbopackIgnore: true*/ opt("TMP_DIR") ?? path.join(/*turbopackIgnore: true*/ this.storageRoot, ".tmp")); },

  // Upload limits
  get maxFileBytes() { return int("UPLOAD_MAX_FILE_MB", 2048) * MB; },
  get maxChunkBytes() { return int("UPLOAD_MAX_CHUNK_MB", 16) * MB; },
  get maxFilesPerBatch() { return int("UPLOAD_MAX_FILES", 500); },
  /** Total size the library may reach (originals + renditions + artwork). 0 = no quota. */
  get libraryQuotaBytes() { return int("LIBRARY_QUOTA_GB", 0) * 1024 * MB; },
  get archiveMaxEntries() { return int("ARCHIVE_MAX_ENTRIES", 2000); },
  get archiveMaxTotalBytes() { return int("ARCHIVE_MAX_TOTAL_MB", 20480) * MB; },
  get archiveMaxRatio() { return int("ARCHIVE_MAX_RATIO", 100); },
  /** Incomplete uploads and finished import rows older than this are purged by the worker. */
  get uploadRetentionDays() { return int("UPLOAD_RETENTION_DAYS", 30); },

  // Renditions
  /** auto: AAC rendition at import for codecs some browsers cannot decode, and on demand otherwise. never: originals only. */
  get renditions(): "auto" | "never" { const v = opt("RENDITIONS") ?? "auto"; if (v !== "auto" && v !== "never") throw new Error("RENDITIONS must be auto or never"); return v; },
  get renditionBitrateK() { return int("RENDITION_BITRATE_KBPS", 256); },
  /** DSD (DSF/DFF) is kept as is; a playable rendition is produced only when this is explicitly true. */
  get transcodeDsd() { return opt("TRANSCODE_DSD") === "true"; },
  get ffmpeg() { return opt("FFMPEG_PATH") ?? "ffmpeg"; },
  get ffprobe() { return opt("FFPROBE_PATH") ?? "ffprobe"; },

  // Lyrics (speech-to-text on the node, optional)
  /** off: feature hidden. manual: an administrator asks for lyrics. auto: also queued for every new import. */
  get lyrics(): "off" | "manual" | "auto" { const v = opt("LYRICS") ?? "off"; if (v !== "off" && v !== "manual" && v !== "auto") throw new Error("LYRICS must be off, manual or auto"); return v; },
  /** Python of a virtualenv that has mlx-whisper installed. */
  get lyricsPython() { return opt("LYRICS_PYTHON"); },
  get lyricsModel() { return opt("LYRICS_MODEL") ?? "mlx-community/whisper-large-v3-turbo"; },

  get backupDir() { return opt("BACKUP_DIR"); },

  /** Apple app identifiers (TeamID.bundleId, comma-separated) allowed to use this site's passkeys natively. */
  get appleAppIds() { return (opt("APPLE_APP_IDS") ?? "3YM54G49SN.ai.spboucher.spmusic,3YM54G49SN.ai.spboucher.spmusic.ios").split(",").map((s) => s.trim()).filter(Boolean); },
};
