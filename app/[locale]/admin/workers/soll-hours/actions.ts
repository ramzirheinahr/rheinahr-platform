"use server";

import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Locale } from "@/i18n/routing";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const sollHoursSchema = z.object({
  id: z.string().optional(),
  workerId: z.string().min(1),
  validFrom: z.string().regex(/^\d{4}-\d{2}$/, "Invalid format. Expected YYYY-MM"),
  weeklyHours: z.coerce.number().min(0),
  monthlyHours: z.coerce.number().min(0),
});

export async function saveWorkerSollHours(
  locale: Locale,
  formData: FormData
) {
  try {
    const user = await requireRole(locale, "admin");

    const data = {
      id: formData.get("id")?.toString(),
      workerId: formData.get("workerId")?.toString(),
      validFrom: formData.get("validFrom")?.toString(),
      weeklyHours: formData.get("weeklyHours"),
      monthlyHours: formData.get("monthlyHours"),
    };

    const parsed = sollHoursSchema.safeParse(data);
    if (!parsed.success) {
      return { ok: false, error: "invalidData" };
    }

    const { id, workerId, validFrom, weeklyHours, monthlyHours } = parsed.data;

    // Ensure worker exists
    const worker = await prisma.worker.findUnique({ where: { id: workerId } });
    if (!worker) return { ok: false, error: "notFound" };

    if (id) {
      // Update existing
      await prisma.workerSollHours.update({
        where: { id },
        data: { validFrom, weeklyHours, monthlyHours },
      });
    } else {
      // Check for duplicate validFrom
      const existing = await prisma.workerSollHours.findUnique({
        where: { workerId_validFrom: { workerId, validFrom } },
      });
      if (existing) {
        return { ok: false, error: "duplicatePeriod" };
      }

      // Create new
      await prisma.workerSollHours.create({
        data: { workerId, validFrom, weeklyHours, monthlyHours },
      });
    }

    revalidatePath(`/${locale}/admin/workers/${workerId}/edit`);
    return { ok: true };
  } catch (error) {
    console.error("saveWorkerSollHours error:", error);
    return { ok: false, error: "saveError" };
  }
}

export async function deleteWorkerSollHours(
  locale: Locale,
  id: string,
  workerId: string
) {
  try {
    await requireRole(locale, "admin");
    
    await prisma.workerSollHours.delete({
      where: { id },
    });
    
    revalidatePath(`/${locale}/admin/workers/${workerId}/edit`);
    return { ok: true };
  } catch (error) {
    console.error("deleteWorkerSollHours error:", error);
    return { ok: false, error: "deleteError" };
  }
}
