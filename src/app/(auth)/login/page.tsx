/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Music SP
 * File             : src/app/(auth)/login/page.tsx
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
import { LoginForm } from "@/components/auth-forms";

export const metadata: Metadata = { title: "Connexion" };
/** Only our own device-approval page may be the destination after sign-in: never an arbitrary URL. */
const safeNext = (raw: string | undefined) => (raw && /^\/appareil(\?code=[A-Z0-9-]{0,9})?$/.test(raw) ? raw : "/");

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  if (await getUser()) redirect(next);
  return <LoginForm locale={guessLocale((await headers()).get("accept-language"))} next={next} />;
}
