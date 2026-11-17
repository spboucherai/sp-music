import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { storage } from "@/server/storage";

/** Liveness for the dispatcher: database, storage volume, worker heartbeat. No library data, no paths. */
export async function GET() {
  try {
    const [hb] = await sql<{ age: number | null }[]>`SELECT (SELECT extract(epoch FROM now() - beat_at)::int FROM worker_heartbeat WHERE name = 'worker') AS age`;
    const st = await storage().health();
    const ok = st.ok;
    return NextResponse.json({ ok, db: true, storage: st.ok, worker: { ok: hb.age !== null && hb.age < 120, ageSec: hb.age } }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, db: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
