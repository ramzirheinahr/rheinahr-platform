"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { z } from "zod";
async function assertAdmin() {
  const user = await getCurrentUser();
  if (!user || !roleSatisfies(user.role, ["admin"])) throw new Error("forbidden");
  return user;
}

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function saveDailyNote(
  dateStr: string,
  note: string,
): Promise<{ ok: boolean; error?: string }> {
  let admin;
  try {
    admin = await assertAdmin();
  } catch {
    return { ok: false, error: "forbidden" };
  }

  if (!dateSchema.safeParse(dateStr).success) {
    return { ok: false, error: "invalid_date" };
  }

  const key = `daily_note_${dateStr}`;
  const trimmed = note.trim();

  try {
    if (trimmed.length === 0) {
      await prisma.systemSetting.deleteMany({
        where: { key },
      });
    } else {
      await prisma.systemSetting.upsert({
        where: { key },
        update: { value: trimmed },
        create: { key, value: trimmed },
      });
    }

    await audit({
      userId: admin.id,
      action: "dailyNote.save",
      entity: "SystemSetting",
      entityId: key,
      metadata: { date: dateStr, noteLength: trimmed.length },
    });

    revalidatePath("/admin/schedule/book");
    return { ok: true };
  } catch (err) {
    console.error("Failed to save daily note:", err);
    return { ok: false, error: "save_failed" };
  }
}
