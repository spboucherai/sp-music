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
