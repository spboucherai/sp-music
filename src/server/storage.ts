import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat, statfs, copyFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { env } from "@/lib/env";

/**
 * Private object storage of the library. Keys are opaque strings built by the server
 * ("originals/ab/<sha256>.flac"); nothing a client sends ever reaches a key or a path.
 */
export interface Storage {
  readonly driver: string;
  /** Moves a finished local file into storage (atomic on the local driver). */
  putFile(key: string, localPath: string): Promise<void>;
  put(key: string, data: Readable): Promise<void>;
  /** Byte range, both bounds inclusive. */
  read(key: string, range?: { start: number; end: number }): Readable;
  size(key: string): Promise<number | null>;
  delete(key: string): Promise<void>;
  /** A path ffmpeg/ffprobe can open. Local driver: the file itself. */
  localPath(key: string): Promise<string>;
  health(): Promise<{ ok: boolean; freeBytes: number | null; totalBytes: number | null; detail?: string }>;
}

const KEY_RE = /^[a-z0-9]+(\/[A-Za-z0-9._-]+)+$/;

class LocalStorage implements Storage {
  readonly driver = "local";
  constructor(private root: string) {}
  private resolve(key: string): string {
    if (!KEY_RE.test(key) || key.includes("..")) throw new Error("invalid storage key");
    const p = path.resolve(this.root, key);
    if (!p.startsWith(this.root + path.sep)) throw new Error("invalid storage key");
    return p;
  }
  async putFile(key: string, localPath: string) {
    const dest = this.resolve(key);
    await mkdir(path.dirname(dest), { recursive: true, mode: 0o700 });
    try { await rename(localPath, dest); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e; await copyFile(localPath, dest + ".part"); await rename(dest + ".part", dest); await rm(localPath, { force: true }); }
  }
  async put(key: string, data: Readable) {
    const dest = this.resolve(key);
    await mkdir(path.dirname(dest), { recursive: true, mode: 0o700 });
    await pipeline(data, createWriteStream(dest + ".part", { mode: 0o600 }));
    await rename(dest + ".part", dest);
  }
  read(key: string, range?: { start: number; end: number }) { return createReadStream(this.resolve(key), range); }
  async size(key: string) { try { return (await stat(this.resolve(key))).size; } catch { return null; } }
  async delete(key: string) { await rm(this.resolve(key), { force: true }); }
  async localPath(key: string) { return this.resolve(key); }
  async health() {
    try {
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      const s = await statfs(this.root);
      return { ok: true, freeBytes: Number(s.bavail) * Number(s.bsize), totalBytes: Number(s.blocks) * Number(s.bsize) };
    } catch (e) { return { ok: false, freeBytes: null, totalBytes: null, detail: (e as NodeJS.ErrnoException).code ?? "error" }; }
  }
}

let instance: Storage | null = null;
export function storage(): Storage {
  if (instance) return instance;
  const driver = env.storageDriver;
  if (driver === "local") return (instance = new LocalStorage(env.storageRoot));
  // The cluster uses a node volume. An S3-compatible driver plugs in here by implementing `Storage`
  // (see docs/ARCHITECTURE.md); it is deliberately not shipped untested.
  throw new Error(`STORAGE_DRIVER=${driver} is not implemented (available: local)`);
}

export const keys = {
  original: (sha: string, ext: string) => `originals/${sha.slice(0, 2)}/${sha}.${ext}`,
  rendition: (trackId: string) => `renditions/${trackId.slice(0, 2)}/${trackId}.m4a`,
  artOriginal: (sha: string, ext: string) => `art/${sha.slice(0, 2)}/${sha}/orig.${ext}`,
  artThumb: (sha: string, size: number) => `art/${sha.slice(0, 2)}/${sha}/${size}.jpg`,
};
export const THUMB_SIZES = [96, 320, 640] as const;
