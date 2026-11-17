import type { Metadata } from "next";
import { headers } from "next/headers";
import { guessLocale } from "@/i18n/locale";
import { SetupForm } from "@/components/auth-forms";

export const metadata: Metadata = { title: "Clé d’accès", referrer: "no-referrer" };
export default async function SetupPage() {
  return <SetupForm locale={guessLocale((await headers()).get("accept-language"))} />;
}
