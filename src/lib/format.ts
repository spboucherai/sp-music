/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Music SP
 * File             : src/lib/format.ts
 * Module           : lib
 * Repository       : https://git.spboucher.ai/sp-music
 * Project Website  : https://music.spboucher.ai
 * Created          : 2026-11-17
 * Last Modified    : 2026-11-17
 *
 * Author           : Simon-Pierre Boucher
 * Position         : Professor of Finance
 * Institution      : Université du Québec en Outaouais (UQO)
 * Organization     : SP Boucher
 * Website          : https://spboucher.ai
 * Git              : https://git.spboucher.ai
 *
 * Preferred Contact: support@spboucher.ai
 * Development      : dev@spboucher.ai
 * Support          : support@spboucher.ai
 * Security/Admin   : admin@spboucher.ai
 *
 * Copyright (c) 2026
 * Simon-Pierre Boucher
 * All rights reserved where applicable. This file is governed by the
 * applicable project license, copyright notices and relevant law.
 * Existing third-party rights and notices remain unaffected.
 *
 * License          : None specified (no license file in this repository)
 *
 * Do not embed credentials, private keys, access tokens,
 * certificates or confidential personal information.
 *
 * =============================================================================
 * END OF SP BOUCHER SOURCE HEADER
 * =============================================================================
 */

export function fmtTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}
export function fmtDuration(ms: number, locale: string): string {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return locale === "en" ? `${h} h ${m} min` : `${h} h ${String(m).padStart(2, "0")}`;
}
export function fmtBytes(n: number | null | undefined, locale: string): string {
  if (n == null) return "—";
  const units = locale === "en" ? ["B", "KB", "MB", "GB", "TB"] : ["o", "Ko", "Mo", "Go", "To"];
  let i = 0, v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toLocaleString(locale === "en" ? "en-CA" : "fr-CA", { maximumFractionDigits: v >= 100 || i === 0 ? 0 : 1 })} ${units[i]}`;
}
export function fmtDate(d: string | null | undefined, locale: string, withTime = true): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat(locale === "en" ? "en-CA" : "fr-CA", withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" }).format(new Date(d));
}
/** "FLAC · 44,1 kHz · 16 bits" from what is known; unknown parts are simply left out. */
export function audioInfo(t: { codec: string; sampleRate: number | null; bitDepth: number | null; bitrate?: number | null }, locale: string): string {
  const names: Record<string, string> = { flac: "FLAC", mp3: "MP3", aac: "AAC", alac: "ALAC", vorbis: "Vorbis", opus: "Opus" };
  const codec = names[t.codec] ?? (t.codec.startsWith("pcm") ? "PCM" : t.codec.startsWith("dsd") ? "DSD" : t.codec.toUpperCase());
  const lossy = ["mp3", "aac", "vorbis", "opus"].includes(t.codec);
  const parts = [codec];
  if (t.sampleRate) parts.push(`${(t.sampleRate / 1000).toLocaleString(locale === "en" ? "en-CA" : "fr-CA", { maximumFractionDigits: 1 })} kHz`);
  if (t.bitDepth && !lossy) parts.push(locale === "en" ? `${t.bitDepth}-bit` : `${t.bitDepth} bits`);
  if (lossy && t.bitrate) parts.push(`${Math.round(t.bitrate / 1000)} kb/s`);
  return parts.join(" · ");
}
