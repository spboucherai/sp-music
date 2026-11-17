import postgres from "postgres";
import { env } from "./env";

declare global { var __spmusicSql: ReturnType<typeof postgres> | undefined; }

export const sql = globalThis.__spmusicSql ?? (globalThis.__spmusicSql = postgres(env.databaseUrl, { max: 10, idle_timeout: 30, onnotice: () => {} }));
export type Sql = typeof sql;
export type Tx = postgres.TransactionSql;
export const j = (v: unknown) => sql.json(v as never);
export const iso = (d: Date | string | null | undefined) => (d == null ? null : new Date(d).toISOString());
