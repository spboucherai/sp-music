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
