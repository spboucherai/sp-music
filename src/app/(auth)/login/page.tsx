import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/session";
import { guessLocale } from "@/i18n/locale";
import { LoginForm } from "@/components/auth-forms";

export const metadata: Metadata = { title: "Connexion" };
export default async function LoginPage() {
  if (await getUser()) redirect("/");
  return <LoginForm locale={guessLocale((await headers()).get("accept-language"))} />;
}
