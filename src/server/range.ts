/** Single byte range of an HTTP Range header. null: no range (serve everything); "invalid": answer 416. */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null | "invalid" {
  if (!header) return null;
  const m = header.trim().match(/^bytes=(\d*)-(\d*)$/);
  if (!m) return header.trim().startsWith("bytes=") && header.includes(",") ? null : "invalid";   // multi-range: whole file
  const [, a, b] = m;
  if (a === "" && b === "") return "invalid";
  if (size === 0) return "invalid";
  if (a === "") {                                   // suffix: last N bytes
    const n = Number(b);
    if (!Number.isSafeInteger(n) || n === 0) return "invalid";
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(a);
  const end = b === "" ? size - 1 : Math.min(Number(b), size - 1);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return "invalid";
  return { start, end };
}
