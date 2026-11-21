/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Music SP
 * File             : src/app/(auth)/appareil/page.tsx
 * Module           : app
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

import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/session";
import { guessLocale } from "@/i18n/locale";
import { DeviceLinkForm } from "@/components/auth-forms";

export const metadata: Metadata = { title: "Associer un appareil", referrer: "no-referrer" };

/** Approval page of a native app's pairing code. Signing in comes first; the code is carried through the sign-in page. */
export default async function DevicePage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const code = ((await searchParams).code ?? "").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 9);
  const u = await getUser();
  if (!u) redirect(`/login?next=${encodeURIComponent(`/appareil${code ? `?code=${code}` : ""}`)}`);
  return <DeviceLinkForm locale={u.locale ?? guessLocale((await headers()).get("accept-language"))} code={code} csrfToken={u.csrfToken} displayName={u.displayName} />;
}
