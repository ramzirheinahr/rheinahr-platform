"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { audit } from "@/lib/audit";

export type ActionState = { ok: boolean; error?: string };

async function assertAdmin() {
  const user = await getCurrentUser();
  if (!user || !roleSatisfies(user.role, ["admin"])) {
    throw new Error("forbidden");
  }
  return user;
}

export async function createAppointment(formData: FormData): Promise<ActionState> {
  try {
    const admin = await assertAdmin();
    const title = formData.get("title") as string;
    const date = new Date(formData.get("date") as string);
    const startTime = formData.get("startTime") as string;
    const endTime = formData.get("endTime") as string;
    const description = formData.get("description") as string | null;
    const location = formData.get("location") as string | null;
    const clientId = formData.get("clientId") as string | null;
    const workerId = formData.get("workerId") as string | null;

    if (!title || !date || !startTime || !endTime) {
       return { ok: false, error: "Missing required fields" };
    }

    const appointment = await prisma.appointment.create({
      data: {
        title,
        date,
        startTime,
        endTime,
        description: description || null,
        location: location || null,
        clientId: clientId || null,
        workerId: workerId || null,
        managerId: admin.id,
      },
    });

    await audit({ userId: admin.id, action: "appointment.create", entity: "Appointment", entityId: appointment.id });
    revalidatePath("/[locale]/admin/appointments", "page");
    return { ok: true };
  } catch (err: any) {
    console.error(err);
    return { ok: false, error: err.message };
  }
}

export async function updateAppointment(id: string, formData: FormData): Promise<ActionState> {
  try {
    const admin = await assertAdmin();
    const title = formData.get("title") as string;
    const date = new Date(formData.get("date") as string);
    const startTime = formData.get("startTime") as string;
    const endTime = formData.get("endTime") as string;
    const description = formData.get("description") as string | null;
    const location = formData.get("location") as string | null;
    const clientId = formData.get("clientId") as string | null;
    const workerId = formData.get("workerId") as string | null;

    if (!title || !date || !startTime || !endTime) {
       return { ok: false, error: "Missing required fields" };
    }

    await prisma.appointment.update({
      where: { id },
      data: {
        title,
        date,
        startTime,
        endTime,
        description: description || null,
        location: location || null,
        clientId: clientId || null,
        workerId: workerId || null,
      },
    });

    await audit({ userId: admin.id, action: "appointment.update", entity: "Appointment", entityId: id });
    revalidatePath("/[locale]/admin/appointments", "page");
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function deleteAppointment(id: string): Promise<ActionState> {
  try {
    const admin = await assertAdmin();
    await prisma.appointment.delete({ where: { id } });
    await audit({ userId: admin.id, action: "appointment.delete", entity: "Appointment", entityId: id });
    revalidatePath("/[locale]/admin/appointments", "page");
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}
