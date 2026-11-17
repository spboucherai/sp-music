export interface Track {
  id: string; title: string; trackNo: number | null; discNo: number; durationMs: number; year: number | null;
  codec: string; container: string; sampleRate: number | null; bitDepth: number | null; channels: number | null; bitrate: number | null;
  webPlayable: "yes" | "some" | "no"; compatState: "none" | "queued" | "working" | "ready" | "error" | "disabled";
  artist: { id: string; name: string }; album: { id: string; title: string; artworkId: string | null; artistName: string };
  genre: string | null; favorite: boolean; entryId?: string;
  lyricsState: null | "queued" | "working" | "ready" | "empty" | "error";
}
export interface Album { id: string; title: string; year: number | null; artworkId: string | null; createdAt: string; artist: { id: string; name: string }; genre: string | null; trackCount: number; durationMs: number; favorite: boolean }
export interface Artist { id: string; name: string; albumCount: number; trackCount: number; artworkId: string | null }
export interface Playlist { id: string; name: string; updatedAt: string; trackCount: number; artworkIds: string[] }
export interface Me { id: string; email: string; displayName: string; role: "admin" | "listener"; isOwner: boolean; locale: "fr" | "en"; accent: string }
export interface Paged<T> { items: T[]; total: number; limit: number; offset: number }
export interface LyricLine { t: number; e: number; text: string; w?: [number, number, string][] }
export interface Lyrics { state: "none" | "queued" | "working" | "ready" | "empty" | "error"; language?: string | null; source?: string; edited?: boolean; lines: LyricLine[]; enabled: boolean }
