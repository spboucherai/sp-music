import type { Locale } from "./index";

/** Locale of a signed-out visitor: the browser's language, French unless it asks for English. */
export function guessLocale(acceptLanguage: string | null): Locale {
  const first = (acceptLanguage ?? "").split(",")[0]?.trim().toLowerCase() ?? "";
  return first.startsWith("en") ? "en" : "fr";
}
