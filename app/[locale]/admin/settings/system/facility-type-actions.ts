"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensureFacilityTypeCatalog } from "@/lib/facility-type-catalog";

const namesSchema = z.object({
  nameDe: z.string().trim().min(2, "Name (DE) muss mindestens 2 Zeichen lang sein.").max(120),
  nameEn: z.string().trim().max(120).optional().nullable(),
  nameAr: z.string().trim().max(120).optional().nullable(),
});

const createSchema = namesSchema.extend({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_-]{2,80}$/, "Kennung muss 2-80 Kleinbuchstaben, Zahlen oder Bindestriche enthalten."),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
});

const updateSchema = namesSchema.extend({
  code: z.string().min(2).max(120),
  sortOrder: z.number().int().min(0).max(100_000),
  active: z.boolean(),
});

type ActionResponse = { ok: true } | { ok: false; error: string };

async function checkAdminActor(): Promise<string | null> {
  const actor = await getCurrentUser();
  return actor && roleSatisfies(actor.role, ["admin", "super_admin"]) ? actor.id : null;
}

function revalidateFacilityScreens() {
  revalidatePath("/admin/settings/system");
  revalidatePath("/admin/clients", "layout");
  revalidatePath("/admin/clients/new");
  revalidatePath("/admin/clients/[id]/edit", "page");
}

export async function createFacilityTypeAction(raw: z.input<typeof createSchema>): Promise<ActionResponse> {
  const userId = await checkAdminActor();
  if (!userId) {
    return { ok: false, error: "Nur Administratoren dürfen Einrichtungstypen verwalten." };
  }

  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message || "Ungültige Eingabedaten.";
    return { ok: false, error: msg };
  }

  const { code, nameDe, nameEn, nameAr, sortOrder } = parsed.data;

  try {
    await ensureFacilityTypeCatalog();

    const maxSort =
      sortOrder ??
      ((await prisma.facilityTypeCatalog.aggregate({ _max: { sortOrder: true } }))._max.sortOrder ?? 0) + 10;

    await prisma.facilityTypeCatalog.create({
      data: {
        code,
        nameDe,
        nameEn: nameEn?.trim() || nameDe,
        nameAr: nameAr?.trim() || nameDe,
        active: true,
        sortOrder: maxSort,
      },
    });

    revalidateFacilityScreens();
    return { ok: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, error: "Diese Kennung existiert bereits. Bitte wählen Sie eine andere Kennung." };
    }
    console.error("Failed to create facility type:", error);
    return { ok: false, error: "Einrichtungstyp konnte nicht gespeichert werden." };
  }
}

export async function updateFacilityTypeAction(raw: z.input<typeof updateSchema>): Promise<ActionResponse> {
  const userId = await checkAdminActor();
  if (!userId) {
    return { ok: false, error: "Nur Administratoren dürfen Einrichtungstypen verwalten." };
  }

  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message || "Ungültige Eingabedaten.";
    return { ok: false, error: msg };
  }

  const { code, nameDe, nameEn, nameAr, sortOrder, active } = parsed.data;

  try {
    await prisma.facilityTypeCatalog.update({
      where: { code },
      data: {
        nameDe,
        nameEn: nameEn?.trim() || nameDe,
        nameAr: nameAr?.trim() || nameDe,
        sortOrder,
        active,
      },
    });

    revalidateFacilityScreens();
    return { ok: true };
  } catch (error) {
    console.error("Failed to update facility type:", error);
    return { ok: false, error: "Einrichtungstyp konnte nicht aktualisiert werden." };
  }
}

export async function deleteFacilityTypeAction(code: string): Promise<ActionResponse> {
  const userId = await checkAdminActor();
  if (!userId) {
    return { ok: false, error: "Nur Administratoren dürfen Einrichtungstypen verwalten." };
  }

  if (!code || typeof code !== "string") {
    return { ok: false, error: "Ungültige Kennung." };
  }

  try {
    // Check if any client is currently assigned to this facility type
    const clientCount = await prisma.client.count({
      where: { facilityType: code },
    });

    if (clientCount > 0) {
      return {
        ok: false,
        error: `Dieser Einrichtungstyp wird derzeit von ${clientCount} Einrichtung(en) verwendet und kann nicht gelöscht werden. Bitte deaktivieren/archivieren Sie ihn stattdessen.`,
      };
    }

    await prisma.facilityTypeCatalog.delete({
      where: { code },
    });

    revalidateFacilityScreens();
    return { ok: true };
  } catch (error) {
    console.error("Failed to delete facility type:", error);
    return { ok: false, error: "Einrichtungstyp konnte nicht gelöscht werden." };
  }
}
