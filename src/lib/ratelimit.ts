import { sql } from "./db";
import { ApiError } from "./http";

/** Fixed-window counter in PostgreSQL (shared by the web processes, survives restarts). */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<void> {
  const [row] = await sql<{ count: number }[]>`
    INSERT INTO rate_limits (key, window_start, count)
    VALUES (${key}, to_timestamp(floor(extract(epoch FROM now()) / ${windowSec}) * ${windowSec}), 1)
    ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
    RETURNING count`;
  if (row.count > limit) throw new ApiError(429, "rate_limited", "Too many requests, try again later");
}
