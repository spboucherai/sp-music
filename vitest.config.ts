import { defineConfig } from "vitest/config";
import path from "node:path";

/** Integration tests talk HTTP to a real production build (scripts/test.sh starts it with its worker and database). */
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], fileParallelism: false, sequence: { concurrent: false }, testTimeout: 120_000, hookTimeout: 120_000 },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
});
