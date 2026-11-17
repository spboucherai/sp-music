import { describe, expect, it } from "vitest";
import { parseRange } from "../src/server/range";
import { norm, safeFilename } from "../src/lib/text";
import { sniff } from "../src/server/media";
import { FIX } from "./helpers";

describe("range parsing", () => {
  it("handles the forms a media element sends", () => {
    expect(parseRange(null, 1000)).toBeNull();
    expect(parseRange("bytes=0-", 1000)).toEqual({ start: 0, end: 999 });
    expect(parseRange("bytes=100-199", 1000)).toEqual({ start: 100, end: 199 });
    expect(parseRange("bytes=900-5000", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
  });
  it("rejects what cannot be satisfied", () => {
    for (const h of ["bytes=1000-", "bytes=5-2", "bytes=-0", "bytes=-", "items=0-1", "bytes=a-b"]) expect(parseRange(h, 1000)).toBe("invalid");
  });
});

describe("names", () => {
  it("never keeps a path or control characters", () => {
    expect(safeFilename("../../etc/passwd")).toBe("passwd");
    expect(safeFilename("C:\\Users\\x\\song.flac")).toBe("song.flac");
    expect(safeFilename("a\u0000b<c>.mp3")).toBe("abc.mp3");
    expect(safeFilename("...")).toBe("fichier");
  });
  it("normalises for search", () => { expect(norm("  Hate  SUPRÊME, pt. 1 ")).toBe("hate supreme, pt. 1"); });
});

describe("content sniffing ignores extensions", () => {
  it("recognises real formats and refuses impostors", async () => {
    expect(await sniff(`${FIX}/a.flac`)).toBe("flac");
    expect(await sniff(`${FIX}/c.mp3`)).toBe("mp3");
    expect(await sniff(`${FIX}/d.m4a`)).toBe("m4a");
    expect(await sniff(`${FIX}/03 Sans Tags.wav`)).toBe("wav");
    expect(await sniff(`${FIX}/album.zip`)).toBe("zip");
    expect(await sniff(`${FIX}/program.flac`)).toBeNull();
    expect(await sniff(`${FIX}/text.mp3`)).toBeNull();
  });
});
