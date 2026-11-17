import { j, sql, type Tx } from "./db";

export interface AuditInput { userId?: string | null; actor: "admin" | "listener" | "system"; action: string; entity?: string; entityId?: string; meta?: Record<string, unknown>; ip?: string | null }

/** Audit trail. `meta` never holds cookies, tokens, recovery codes, WebAuthn challenges or audio content. */
export async function audit(a: AuditInput, tx: Tx | typeof sql = sql): Promise<void> {
  await tx`INSERT INTO audit_events (user_id, actor, action, entity, entity_id, meta, ip)
           VALUES (${a.userId ?? null}, ${a.actor}, ${a.action}, ${a.entity ?? ""}, ${a.entityId ?? ""}, ${j(a.meta ?? {})}, ${a.ip ?? null})`;
}
