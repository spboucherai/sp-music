/** Lower-cased, accent-stripped, whitespace-collapsed form used for search and duplicate constraints. */
export const norm = (s: string) => s.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Display-safe file name: no path, no control characters, bounded length. Never used to build a storage path. */
export function safeFilename(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "";
   
  const clean = base.normalize("NFC").replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").replace(/^\.+/, "").trim();
  return (clean || "fichier").slice(0, 200);
}

export const clean = (s: string | undefined | null, max = 300) => (s ?? "").normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);  
