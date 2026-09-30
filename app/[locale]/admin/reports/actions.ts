"use server";

import { requireRole } from "@/lib/auth";
import {
  getReportsMetadata,
  getStundennachweisData,
  getMonatslisteData,
  getAuegData,
  getMitarbeiterListeData,
  getArbeitszeitkontoData,
  saveAzkNotes,
  getReisespesenData,
  getMonthlySpesenOverviewData,
  calculateUrlaubEntitlement,
  getAzkStandData,
  transferOrCopyShifts,
} from "@/lib/reports-data";

export async function fetchReportsMetadataAction() {
  await requireRole("de", "admin");
  return await getReportsMetadata();
}

export async function fetchStundennachweisAction(params: {
  startDate: string;
  endDate: string;
  qualification?: string;
  clientId?: string;
}) {
  await requireRole("de", "admin");
  return await getStundennachweisData(params);
}

export async function fetchMonatslisteAction(params: {
  year: number;
  month: number;
  workerId: string;
  clientId?: string;
}) {
  await requireRole("de", "admin");
  return await getMonatslisteData(params);
}

export async function fetchAuegAction(params: {
  startDate: string;
  endDate: string;
}) {
  await requireRole("de", "admin");
  return await getAuegData(params);
}

export async function fetchMitarbeiterListeAction(params: {
  startDate: string;
  endDate: string;
  clientId: string;
  qualification?: string;
}) {
  await requireRole("de", "admin");
  return await getMitarbeiterListeData(params);
}

export async function fetchArbeitszeitkontoAction(params: {
  workerId: string;
  startMonth?: string;
  endMonth?: string;
  zeiterfassungInsgesamt?: boolean;
  withPrevBalance?: boolean;
}) {
  await requireRole("de", "admin");
  return await getArbeitszeitkontoData(params);
}

export async function saveAzkNotesAction(params: {
  workerId: string;
  notes: Record<string, string>;
}) {
  await requireRole("de", "admin");
  // Strictly internal: no notification sent
  return await saveAzkNotes(params);
}

export async function saveAzkInternalDataAction(params: {
  workerId: string;
  adjustments: Record<
    string,
    { kAusgleich?: string | number; vacation?: string | number; sick?: string | number; sonstige?: string | number }
  >;
  notes: Record<string, string>;
}) {
  await requireRole("de", "admin");
  // Strictly internal: no notification sent
  const { prisma } = await import("@/lib/prisma");
  const { revalidatePath } = await import("next/cache");

  // 1. Save notes
  await saveAzkNotes({ workerId: params.workerId, notes: params.notes });

  // 2. Save adjustments based on desired column totals
  const months = Object.keys(params.adjustments);
  if (months.length > 0) {
    const startMonthStr = months.reduce((min, m) => (m < min ? m : min));
    const endMonthStr = months.reduce((max, m) => (m > max ? m : max));
    const startD = new Date(`${startMonthStr}-01T00:00:00Z`);
    const [endY, endM] = endMonthStr.split("-").map(Number);
    const endD = new Date(Date.UTC(endY, endM, 1)); // start of next month

    const [leaveDays, assignments, existingAdjustments] = await Promise.all([
      prisma.leaveDay.findMany({
        where: {
          leaveRequest: { workerId: params.workerId },
          status: "approved",
          date: { gte: startD, lt: endD },
        },
        select: {
          date: true,
          hours: true,
          leaveRequest: { select: { type: true } },
        },
      }),
      prisma.assignment.findMany({
        where: {
          workerId: params.workerId,
          status: "confirmed",
          order: {
            shiftDate: { gte: startD, lt: endD },
          },
        },
        select: {
          bonusHours: true,
          order: { select: { shiftDate: true } },
        },
      }),
      prisma.workerHoursAdjustment.findMany({
        where: {
          workerId: params.workerId,
          month: { in: months },
        },
      }),
    ]);

    for (const [month, values] of Object.entries(params.adjustments)) {
      const monthLeaves = leaveDays.filter((l) => {
        const d = l.date;
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}` === month;
      });
      const vacationBase = Math.round(
        monthLeaves.filter((l) => l.leaveRequest.type === "vacation").reduce((sum, l) => sum + l.hours, 0) * 100
      ) / 100;
      const sickBase = Math.round(
        monthLeaves.filter((l) => l.leaveRequest.type === "sick").reduce((sum, l) => sum + l.hours, 0) * 100
      ) / 100;
      const otherLeaveBase = Math.round(
        monthLeaves.filter((l) => l.leaveRequest.type === "other").reduce((sum, l) => sum + l.hours, 0) * 100
      ) / 100;

      const monthAssignments = assignments.filter((a) => {
        const d = a.order.shiftDate;
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}` === month;
      });
      const bonusHoursTotal = monthAssignments.reduce((sum, a) => sum + (a.bonusHours || 0), 0);
      const sonstigeBase = Math.round((otherLeaveBase + bonusHoursTotal) * 100) / 100;

      const types: Array<{
        key: keyof typeof values;
        type: "k_ausgleich" | "urlaub" | "krank" | "sonstige";
        base: number;
      }> = [
        { key: "kAusgleich", type: "k_ausgleich", base: 0 },
        { key: "vacation", type: "urlaub", base: vacationBase },
        { key: "sick", type: "krank", base: sickBase },
        { key: "sonstige", type: "sonstige", base: sonstigeBase },
      ];

      for (const { key, type, base } of types) {
        const rawVal = values[key];
        const existingList = existingAdjustments.filter((a) => a.month === month && a.type === type);

        if (rawVal === undefined || rawVal === null || String(rawVal).trim() === "") {
          // Field was cleared: remove any manual adjustments so it resets to base
          if (existingList.length > 0) {
            await prisma.workerHoursAdjustment.deleteMany({
              where: { workerId: params.workerId, month, type },
            });
          }
        } else {
          const targetTotal = Number(String(rawVal).replace(",", "."));
          if (!isNaN(targetTotal)) {
            const neededAdj = Math.round((targetTotal - base) * 100) / 100;

            if (Math.abs(neededAdj) < 0.001) {
              // Desired total equals base hours -> no adjustment needed
              if (existingList.length > 0) {
                await prisma.workerHoursAdjustment.deleteMany({
                  where: { workerId: params.workerId, month, type },
                });
              }
            } else {
              // Non-zero adjustment needed
              const primary = existingList[0];
              if (primary) {
                if (Math.abs(primary.hours - neededAdj) >= 0.001) {
                  await prisma.workerHoursAdjustment.update({
                    where: { id: primary.id },
                    data: { hours: neededAdj },
                  });
                }
                if (existingList.length > 1) {
                  const extraIds = existingList.slice(1).map((a) => a.id);
                  await prisma.workerHoursAdjustment.deleteMany({
                    where: { id: { in: extraIds } },
                  });
                }
              } else {
                await prisma.workerHoursAdjustment.create({
                  data: {
                    workerId: params.workerId,
                    month,
                    type,
                    hours: neededAdj,
                  },
                });
              }
            }
          }
        }
      }
    }
  }

  revalidatePath(`/admin/reports`);
  revalidatePath(`/admin/workers/${params.workerId}/schedule`);
  revalidatePath(`/worker`);
  return { ok: true };
}

export async function fetchReisespesenAction(params: {
  year: number;
  month: number;
  workerId: string;
}) {
  await requireRole("de", "admin");
  return await getReisespesenData(params);
}

export async function fetchMonthlySpesenOverviewAction(params: {
  year: number;
  month: number;
  onlyWithAmounts?: boolean;
}) {
  await requireRole("de", "admin");
  return await getMonthlySpesenOverviewData(params);
}

export async function calculateUrlaubAction(params: {
  contractDaysPerWeek: number;
  actualDaysPerWeek: number;
  periodStart: string;
  periodEnd: string;
  takenDays: number;
  annualVacationDays?: number;
}) {
  await requireRole("de", "admin");
  return calculateUrlaubEntitlement(params);
}

export async function fetchAzkStandAction(year: number, month: number) {
  await requireRole("de", "admin");
  return await getAzkStandData(year, month);
}

export async function transferOrCopyShiftsAction(params: {
  mode: "copy" | "transfer";
  source: {
    year: number;
    month: number;
    workerId: string;
    clientId?: string;
  };
  target: {
    year: number;
    month: number;
    workerId: string;
    clientId?: string;
  };
}) {
  await requireRole("de", "admin");
  // Strictly internal: zero notifications dispatched
  return await transferOrCopyShifts(params);
}
