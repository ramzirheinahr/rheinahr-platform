"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensureQualificationCatalog, hashDefaultRate } from "@/lib/qualification-catalog";
import { todayInBerlin } from "@/lib/client-pricing-rate-change";

const names = z.object({
  nameDe: z.string().trim().min(2).max(120),
  nameEn: z.string().trim().min(2).max(120),
  nameAr: z.string().trim().min(2).max(120),
});
const price = z.number().int().min(1).max(100_000);
const createSchema = names.extend({
  code: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]{1,79}$/),
  defaultClientRateCents: price,
});
const updateSchema = names.extend({
  code: z.string().min(2).max(120),
  expectedUpdatedAt: z.iso.datetime(),
  defaultClientRateCents: price.nullable(),
  sortOrder: z.number().int().min(0).max(100_000),
  active: z.boolean(),
});

type Result = { ok: true } | { ok: false; error: string };

async function actorId(): Promise<string | null> {
  const actor = await getCurrentUser();
  return actor && roleSatisfies(actor.role, ["admin"]) ? actor.id : null;
}

function revalidateQualificationScreens() {
  revalidatePath("/admin/settings/system");
  revalidatePath("/admin/clients", "layout");
  revalidatePath("/admin/orders", "layout");
  revalidatePath("/admin/workers", "layout");
  revalidatePath("/client/orders", "layout");
}

export async function createQualificationAction(raw: z.input<typeof createSchema>): Promise<Result> {
  const userId = await actorId();
  if (!userId) return { ok: false, error: "Nur Administratoren dürfen Qualifikationen ändern." };
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Bitte Bezeichnung, Kennung und Stundensatz prüfen." };
  const input = parsed.data;
  const effectiveFrom = todayInBerlin();
  try {
    await ensureQualificationCatalog();
    await prisma.$transaction(async (tx) => {
      const sourceReference = "Systemeinstellungen: neuer Standard-Stundensatz";
      const terms = {
        qualificationCode: input.code, version: 1,
        hourlyRateInCents: input.defaultClientRateCents,
        effectiveFrom, sourceReference, verifiedByUserId: userId,
      };
      await tx.qualificationCatalog.create({ data: {
        code: input.code, nameDe: input.nameDe, nameEn: input.nameEn, nameAr: input.nameAr,
        defaultClientRateCents: input.defaultClientRateCents,
        sortOrder: await tx.qualificationCatalog.count() * 10 + 10,
      } });
      await tx.qualificationDefaultRateVersion.create({ data: {
        ...terms, effectiveFrom: new Date(`${effectiveFrom}T00:00:00.000Z`),
        frozenHash: hashDefaultRate(terms),
      } });
      await tx.auditLog.create({ data: {
        userId, action: "qualification.created", entity: "QualificationCatalog", entityId: input.code,
        metadata: { defaultClientRateCents: input.defaultClientRateCents, effectiveFrom },
      } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    revalidateQualificationScreens();
    return { ok: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, error: "Diese Kennung existiert bereits. Bitte eine andere wählen." };
    }
    return { ok: false, error: "Qualifikation konnte nicht gespeichert werden." };
  }
}

export async function updateQualificationAction(raw: z.input<typeof updateSchema>): Promise<Result> {
  const userId = await actorId();
  if (!userId) return { ok: false, error: "Nur Administratoren dürfen Qualifikationen ändern." };
  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Bitte Bezeichnungen und Stundensatz prüfen." };
  const input = parsed.data;
  const effectiveFrom = todayInBerlin();
  if (input.active && input.defaultClientRateCents === null) return { ok: false, error: "Eine aktive Qualifikation braucht einen Standardsatz." };
  try {
    await prisma.$transaction(async (tx) => {
      const previous = await tx.qualificationCatalog.findUniqueOrThrow({ where: { code: input.code } });
      const rateChanged = previous.defaultClientRateCents !== input.defaultClientRateCents;
      const changed = await tx.qualificationCatalog.updateMany({
        where: { code: input.code, updatedAt: new Date(input.expectedUpdatedAt) },
        data: {
          nameDe: input.nameDe, nameEn: input.nameEn, nameAr: input.nameAr,
          defaultClientRateCents: input.defaultClientRateCents,
          active: input.active, sortOrder: input.sortOrder,
        },
      });
      if (changed.count !== 1) throw new Error("Die Qualifikation wurde inzwischen geändert. Bitte neu laden.");
      if (rateChanged && input.defaultClientRateCents !== null) {
        const latest = await tx.qualificationDefaultRateVersion.findFirst({
          where: { qualificationCode: input.code }, orderBy: { version: "desc" }, select: { version: true },
        });
        const terms = {
          qualificationCode: input.code, version: (latest?.version ?? 0) + 1,
          hourlyRateInCents: input.defaultClientRateCents,
          effectiveFrom,
          sourceReference: "Systemeinstellungen: Änderung des Standard-Stundensatzes",
          verifiedByUserId: userId,
        };
        await tx.qualificationDefaultRateVersion.create({ data: {
          ...terms, effectiveFrom: new Date(`${effectiveFrom}T00:00:00.000Z`),
          frozenHash: hashDefaultRate(terms),
        } });
      }
      await tx.auditLog.create({ data: {
        userId, action: "qualification.updated", entity: "QualificationCatalog", entityId: input.code,
        metadata: {
          before: { nameDe: previous.nameDe, nameEn: previous.nameEn, nameAr: previous.nameAr, active: previous.active, defaultClientRateCents: previous.defaultClientRateCents },
          after: { nameDe: input.nameDe, nameEn: input.nameEn, nameAr: input.nameAr, active: input.active, defaultClientRateCents: input.defaultClientRateCents },
          effectiveFrom: rateChanged ? effectiveFrom : null,
        },
      } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    revalidateQualificationScreens();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Qualifikation konnte nicht gespeichert werden." };
  }
}
