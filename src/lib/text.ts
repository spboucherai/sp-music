/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Music SP
 * File             : src/lib/text.ts
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

/** Lower-cased, accent-stripped, whitespace-collapsed form used for search and duplicate constraints. */
export const norm = (s: string) => s.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Display-safe file name: no path, no control characters, bounded length. Never used to build a storage path. */
export function safeFilename(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "";
   
  const clean = base.normalize("NFC").replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").replace(/^\.+/, "").trim();
  return (clean || "fichier").slice(0, 200);
}

export const clean = (s: string | undefined | null, max = 300) => (s ?? "").normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);  
