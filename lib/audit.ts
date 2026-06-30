import { prisma } from "@/lib/prisma";

// GDPR Art. 30 access log. Record every PII-touching action.
// IMPORTANT (CLAUDE.md §9): never put PII into `action`, `entity`, or `metadata`.
// Store identifiers/ids only — not names, emails, health data.
export async function audit(params: {
  userId?: string | null;
  action: string;
  entity?: string;
  entityId?: string;
  ipAddress?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId ?? null,
        action: params.action,
        entity: params.entity,
        entityId: params.entityId,
        ipAddress: params.ipAddress ?? null,
        metadata: params.metadata,
      },
    });
  } catch {
    // Never let audit failures break the main request; surface via monitoring.
    console.error("audit log failed", { action: params.action });
  }
}
