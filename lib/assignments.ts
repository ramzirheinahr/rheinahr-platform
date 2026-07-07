import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// ─────────────────────── Assignment offer lifecycle ───────────────────────
//
// An Assignment row is the link between an Order and a Worker. Because of the
// `@@unique([orderId, workerId])` constraint there is at most ONE row per
// (order, worker) pair — so a worker who was offered a shift, *declined* it,
// and is offered the SAME shift again must have that one row RESURRECTED, not a
// second row inserted (which the DB rejects) and not silently skipped (which
// leaves the stale "declined" state in place — the bug that made a mistaken
// decline impossible to reverse). These helpers centralise that rule so every
// assignment path (grid cell, order page, bulk offer, worker re-accept) treats
// a declined row as a free slot that can be re-offered.

/** Fields reset when a declined/withdrawn offer is re-issued as fresh & pending. */
const REOFFER_RESET = {
  status: "pending",
  confirmedAt: null,
  cancelRequested: false,
  cancelNote: null,
  cancelRequestedAt: null,
} satisfies Prisma.AssignmentUpdateInput;

export type OfferResult = "created" | "reoffered" | "exists";

/**
 * Offer a single shift to a worker, idempotently.
 * - no row yet            → create a pending offer            ("created")
 * - existing DECLINED row → resurrect it to a pending offer   ("reoffered")
 * - existing pending/confirmed row → leave untouched          ("exists")
 *
 * Pass a transaction client as `db` to keep it inside a larger transaction.
 */
export async function offerAssignment(
  db: Prisma.TransactionClient,
  orderId: string,
  workerId: string,
): Promise<OfferResult> {
  const existing = await db.assignment.findUnique({
    where: { orderId_workerId: { orderId, workerId } },
    select: { id: true, status: true },
  });
  if (!existing) {
    await db.assignment.create({ data: { orderId, workerId, status: "pending" } });
    return "created";
  }
  if (existing.status === "declined") {
    await db.assignment.update({ where: { id: existing.id }, data: REOFFER_RESET });
    return "reoffered";
  }
  return "exists"; // already pending or confirmed — nothing to do
}

export type OfferPair = { orderId: string; workerId: string };

/**
 * Bulk variant of {@link offerAssignment} for the "offer many workers to many
 * shifts" path. Creates rows for brand-new pairs and resurrects declined ones,
 * scoped to the EXACT pairs given (never touching an unrelated decline).
 * Returns the pairs that ended up as a fresh pending offer — i.e. the ones
 * whose worker should now be notified.
 */
export async function offerAssignmentsBulk(
  db: Prisma.TransactionClient,
  pairs: OfferPair[],
): Promise<{ fresh: OfferPair[] }> {
  if (pairs.length === 0) return { fresh: [] };
  const key = (p: OfferPair) => `${p.orderId}:${p.workerId}`;

  const existing = await db.assignment.findMany({
    where: { OR: pairs.map((p) => ({ orderId: p.orderId, workerId: p.workerId })) },
    select: { id: true, orderId: true, workerId: true, status: true },
  });
  const byPair = new Map(existing.map((e) => [key(e), e]));

  const toCreate = pairs.filter((p) => !byPair.has(key(p)));
  const toResurrect = pairs.filter((p) => byPair.get(key(p))?.status === "declined");

  if (toCreate.length) {
    await db.assignment.createMany({
      data: toCreate.map((p) => ({ ...p, status: "pending" as const })),
      skipDuplicates: true,
    });
  }
  if (toResurrect.length) {
    await db.assignment.updateMany({
      where: { id: { in: toResurrect.map((p) => byPair.get(key(p))!.id) } },
      data: REOFFER_RESET,
    });
  }

  return { fresh: [...toCreate, ...toResurrect] };
}

/**
 * Run a transaction under SERIALIZABLE isolation with a few retries. Postgres
 * aborts one of two transactions that would otherwise interleave into an
 * inconsistent result (error code 40001 / Prisma P2034). This is the standard,
 * DB-enforced way to keep an invariant like "confirmed assignments ≤ shift
 * quantity" correct under concurrent acceptances — the same principle a bank
 * uses so two transfers can't both spend the same balance (see the note in the
 * chat). We retry the loser instead of surfacing a spurious error.
 */
export async function runSerializable<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  retries = 3,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      // P2034: write conflict / deadlock — safe to retry the whole transaction.
      if ((code === "P2034" || code === "40001") && attempt < retries) {
        await new Promise((r) => setTimeout(r, 25 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
}
