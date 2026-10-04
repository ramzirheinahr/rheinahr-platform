import { prisma } from "@/lib/prisma";
import type { Qualification } from "@/lib/validations";
import { shiftLetterForStart, availabilityLetters } from "@/lib/master-schedule-core";

export type AvailableWorker = {
  id: string;
  fullName: string;
  internalNumber: string | null;
  qualification: string;
  phone: string | null;
  availLetters: string; // e.g. "F", "S", "N", "FSN", "OFF", "Urlaub"
  hasBlocks: boolean;
  status: "free" | "busy" | "leave" | "off";
  currentShiftLabel?: string;
};

export type DailyNotebookShift = {
  id: string; // assignmentId or orderId-index for unassigned
  orderId: string;
  assignmentId?: string;
  isUnassigned: boolean;
  workerId?: string;
  workerName?: string;
  workerInternalNumber?: string | null;
  workerQualification?: string | null;
  workerPhone?: string | null;
  facilityId: string;
  facilityName: string;
  facilityShortCode?: string | null;
  facilityAddress?: string | null;
  startTime: string; // "HH:mm"
  endTime: string;   // "HH:mm"
  breakMinutes: number;
  ward?: string | null; // station / Wohnbereich
  requiredQualification: string;
  remainingCount?: number;
  status: "pending" | "confirmed" | "unassigned";
  clientConfirmed: boolean;
  cancelRequested: boolean;
  cancelNote?: string | null;
  shiftLetter: "F" | "S" | "N";
};

export type MiniCalendarDay = {
  day: number;
  dateStr: string;
  isCurrentMonth: boolean;
  isSelectedDay: boolean;
  hasShifts: boolean;
};

export type MiniCalendarWeek = {
  weekNum: number;
  days: (MiniCalendarDay | null)[]; // 7 days (Mon-Sun)
};

export type MiniCalendarMonth = {
  year: number;
  month: number; // 1-12
  monthName: string;
  weeks: MiniCalendarWeek[];
};

export type DailyNotebookData = {
  dateStr: string; // "YYYY-MM-DD"
  year: number;
  month: number;
  day: number;
  dayOfWeekName: string; // e.g. "MONTAG"
  monthName: string;     // e.g. "JULI"
  dayOfYear: number;     // e.g. 201
  daysRemaining: number; // e.g. 164
  calendarWeek: number;  // e.g. 30
  prevDateStr: string;
  nextDateStr: string;
  shifts: DailyNotebookShift[];
  shiftsBySlot: Record<string, DailyNotebookShift[]>;
  nightShifts: DailyNotebookShift[];
  stats: {
    totalShifts: number;
    assignedCount: number;
    unassignedCount: number;
    workersCount: number;
  };
  dailyNote: string;
  miniCalendars: [MiniCalendarMonth, MiniCalendarMonth, MiniCalendarMonth];
  facilities: { id: string; shortCode: string | null; facilityName: string; address: string | null }[];
  availableWorkers: AvailableWorker[];
};

// Standard German 15-minute time slots as seen in the physical diary
export const MORNING_SLOTS = [
  "06:00", "06:15", "06:30", "06:45",
  "07:00", "07:15", "07:30", "07:45",
  "08:00", "08:15", "08:30", "08:45",
  "09:00", "09:15", "09:30", "09:45",
  "10:00", "10:15", "10:30", "10:45",
  "11:00", "11:15", "11:30", "11:45",
  "12:00", "12:15", "12:30", "12:45",
] as const;

export const AFTERNOON_SLOTS = [
  "13:00", "13:15", "13:30", "13:45",
  "14:00", "14:15", "14:30", "14:45",
  "15:00", "15:15", "15:30", "15:45",
  "16:00", "16:15", "16:30", "16:45",
  "17:00", "17:15", "17:30", "17:45",
  "18:00", "18:15", "18:30", "18:45",
  "19:00", "19:15", "19:30", "19:45",
] as const;

export const NIGHT_SLOTS = [
  "20:00", "20:15", "20:30", "20:45",
  "21:00", "21:15", "21:30", "21:45",
  "22:00", "22:15", "22:30", "22:45",
  "23:00", "23:15", "23:30", "23:45",
] as const;

// ISO week number calculation (DIN 1355 / ISO 8601)
function getISOWeekNumber(d: Date): number {
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = target.getTime();
  target.setUTCMonth(0, 1);
  if (target.getUTCDay() !== 4) {
    target.setUTCMonth(0, 1 + ((4 - target.getUTCDay() + 7) % 7));
  }
  return 1 + Math.ceil((firstThursday - target.getTime()) / 604800000);
}

// Day of year & remaining days
function getDayOfYearInfo(d: Date): { dayOfYear: number; daysRemaining: number } {
  const year = d.getUTCFullYear();
  const start = new Date(Date.UTC(year, 0, 1));
  const diff = d.getTime() - start.getTime();
  const oneDay = 1000 * 60 * 60 * 24;
  const dayOfYear = Math.floor(diff / oneDay) + 1;
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  const totalDays = isLeap ? 366 : 365;
  const daysRemaining = totalDays - dayOfYear;
  return { dayOfYear, daysRemaining };
}

// Build a mini calendar month grid with week numbers (Wo) and Mon-Sun days
function buildMiniCalendarMonth(year: number, month: number, selectedDateStr: string): MiniCalendarMonth {
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  
  const monthName = new Intl.DateTimeFormat("de-DE", { month: "long" }).format(monthStart);

  const weeks: MiniCalendarWeek[] = [];
  let currentWeekDays: (MiniCalendarDay | null)[] = [];
  let currentWeekNum = getISOWeekNumber(monthStart);

  // Pad days before the 1st of month (Monday = 0 ... Sunday = 6)
  const firstDayOfWeek = (monthStart.getUTCDay() + 6) % 7;
  for (let i = 0; i < firstDayOfWeek; i++) {
    currentWeekDays.push(null);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const curDate = new Date(Date.UTC(year, month - 1, day));
    const dayStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    
    currentWeekDays.push({
      day,
      dateStr: dayStr,
      isCurrentMonth: true,
      isSelectedDay: dayStr === selectedDateStr,
      hasShifts: false,
    });

    if (currentWeekDays.length === 7) {
      weeks.push({
        weekNum: currentWeekNum,
        days: currentWeekDays,
      });
      currentWeekDays = [];
      if (day < daysInMonth) {
        const nextDayDate = new Date(Date.UTC(year, month - 1, day + 1));
        currentWeekNum = getISOWeekNumber(nextDayDate);
      }
    }
  }

  // Pad remaining days to 7
  if (currentWeekDays.length > 0) {
    while (currentWeekDays.length < 7) {
      currentWeekDays.push(null);
    }
    weeks.push({
      weekNum: currentWeekNum,
      days: currentWeekDays,
    });
  }

  return {
    year,
    month,
    monthName,
    weeks,
  };
}

// Map any start time (e.g. "06:00", "06:30", "13:30", "14:15") to standard or exact slot
export function normalizeTimeToSlot(time: string): string {
  if (!time) return "06:00";
  const [hStr, mStr] = time.split(":");
  const h = Number(hStr) || 0;
  const m = Number(mStr) || 0;
  // Round to nearest 15 minutes or match exact
  const remainder = m % 15;
  let roundedM = m;
  if (remainder < 8) {
    roundedM = m - remainder;
  } else {
    roundedM = m + (15 - remainder);
  }
  let roundedH = h;
  if (roundedM >= 60) {
    roundedM = 0;
    roundedH = (roundedH + 1) % 24;
  }
  return `${String(roundedH).padStart(2, "0")}:${String(roundedM).padStart(2, "0")}`;
}

export async function getDailyNotebook(
  dateStr: string,
  qualificationFilter?: string,
  locale = "de"
): Promise<DailyNotebookData> {
  const parts = dateStr.split("-").map(Number);
  const year = parts[0] || new Date().getUTCFullYear();
  const month = parts[1] || new Date().getUTCMonth() + 1;
  const day = parts[2] || new Date().getUTCDate();

  const dayDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const nextDayDate = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0));
  const prevDayDate = new Date(Date.UTC(year, month - 1, day - 1, 0, 0, 0));

  const validDateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const prevDateStr = `${prevDayDate.getUTCFullYear()}-${String(prevDayDate.getUTCMonth() + 1).padStart(2, "0")}-${String(prevDayDate.getUTCDate()).padStart(2, "0")}`;
  const nextDateStr = `${nextDayDate.getUTCFullYear()}-${String(nextDayDate.getUTCMonth() + 1).padStart(2, "0")}-${String(nextDayDate.getUTCDate()).padStart(2, "0")}`;

  const { dayOfYear, daysRemaining } = getDayOfYearInfo(dayDate);
  const calendarWeek = getISOWeekNumber(dayDate);

  // German day of week (MONTAG, DIENSTAG, etc.) and month (JULI, AUGUST, etc.)
  const dayOfWeekName = new Intl.DateTimeFormat("de-DE", { weekday: "long" }).format(dayDate).toUpperCase();
  const monthName = new Intl.DateTimeFormat("de-DE", { month: "long" }).format(dayDate).toUpperCase();

  // Qualification filter condition
  const qualificationWhere = qualificationFilter && qualificationFilter !== "all"
    ? qualificationFilter === "betreuungskraft"
      ? { requiredQualification: { notIn: ["pflegefachkraft", "pflegehelfer", "pflegedienstleitung", "kuechenhilfe", "hausmeister"] } }
      : { requiredQualification: qualificationFilter }
    : {};

  // Parallel database fetch for:
  // 1. Orders on that day (including client and assignments)
  // 2. Active facilities
  // 3. Saved daily note in SystemSetting
  // 4. Workers and their availability on that day
  const [orders, facilities, noteSetting, workersList] = await Promise.all([
    prisma.order.findMany({
      where: {
        shiftDate: { gte: dayDate, lt: nextDayDate },
        status: { not: "cancelled" },
        ...qualificationWhere,
      },
      include: {
        client: {
          select: {
            id: true,
            shortCode: true,
            facilityName: true,
            address: true,
          },
        },
        assignments: {
          where: { status: { not: "declined" } },
          include: {
            worker: {
              select: {
                id: true,
                internalNumber: true,
                fullName: true,
                phone: true,
                qualification: true,
              },
            },
            serviceConfirmation: {
              select: {
                id: true,
                hoursWorked: true,
              },
            },
          },
        },
      },
      orderBy: [{ startTime: "asc" }, { client: { facilityName: "asc" } }],
    }),
    prisma.client.findMany({
      where: { user: { active: true } },
      orderBy: { facilityName: "asc" },
      select: {
        id: true,
        shortCode: true,
        facilityName: true,
        address: true,
      },
    }),
    prisma.systemSetting.findUnique({
      where: { key: `daily_note_${validDateStr}` },
      select: { value: true },
    }),
    prisma.worker.findMany({
      where: {
        user: { active: true },
        ...(qualificationFilter && qualificationFilter !== "all"
          ? qualificationFilter === "betreuungskraft"
            ? { qualification: { notIn: ["pflegefachkraft", "pflegehelfer", "pflegedienstleitung", "kuechenhilfe", "hausmeister"] } }
            : { qualification: qualificationFilter }
          : {}),
      },
      orderBy: { fullName: "asc" },
      select: {
        id: true,
        internalNumber: true,
        fullName: true,
        phone: true,
        qualification: true,
        availability: {
          where: { date: { gte: dayDate, lt: nextDayDate } },
          select: { startTime: true, endTime: true, status: true },
        },
        assignments: {
          where: {
            status: { not: "declined" },
            order: {
              shiftDate: { gte: dayDate, lt: nextDayDate },
              status: { not: "cancelled" },
            },
          },
          select: {
            id: true,
            status: true,
            order: {
              select: {
                startTime: true,
                endTime: true,
                client: { select: { facilityName: true } },
              },
            },
          },
        },
        leaveRequests: {
          where: {
            days: { some: { date: { gte: dayDate, lt: nextDayDate }, status: "approved" } },
          },
          select: { id: true },
        },
      },
    }),
  ]);

  const shifts: DailyNotebookShift[] = [];
  const assignedWorkerIds = new Set<string>();

  for (const o of orders) {
    // 1. Assigned shifts
    for (const a of o.assignments) {
      if (a.worker) {
        assignedWorkerIds.add(a.worker.id);
      }
      shifts.push({
        id: a.id,
        orderId: o.id,
        assignmentId: a.id,
        isUnassigned: false,
        workerId: a.worker?.id,
        workerName: a.worker?.fullName,
        workerInternalNumber: a.worker?.internalNumber,
        workerQualification: a.worker?.qualification,
        workerPhone: a.worker?.phone,
        facilityId: o.client.id,
        facilityName: o.client.facilityName,
        facilityShortCode: o.client.shortCode,
        facilityAddress: o.client.address,
        startTime: o.startTime,
        endTime: o.endTime,
        breakMinutes: o.breakMinutes,
        ward: o.notes,
        requiredQualification: o.requiredQualification,
        status: a.status as "pending" | "confirmed",
        clientConfirmed: a.serviceConfirmation !== null,
        cancelRequested: a.cancelRequested,
        cancelNote: a.cancelNote,
        shiftLetter: shiftLetterForStart(o.startTime),
      });
    }

    // 2. Unassigned shifts (Open headcount spots)
    const remaining = o.quantity - o.assignments.length;
    if (remaining > 0 && !["completed", "confirmed"].includes(o.status)) {
      for (let i = 0; i < remaining; i++) {
        shifts.push({
          id: `unassigned-${o.id}-${i}`,
          orderId: o.id,
          isUnassigned: true,
          facilityId: o.client.id,
          facilityName: o.client.facilityName,
          facilityShortCode: o.client.shortCode,
          facilityAddress: o.client.address,
          startTime: o.startTime,
          endTime: o.endTime,
          breakMinutes: o.breakMinutes,
          ward: o.notes,
          requiredQualification: o.requiredQualification,
          remainingCount: remaining,
          status: "unassigned",
          clientConfirmed: false,
          cancelRequested: false,
          shiftLetter: shiftLetterForStart(o.startTime),
        });
      }
    }
  }

  // Sort shifts chronologically by startTime, then facilityName
  shifts.sort((a, b) => a.startTime.localeCompare(b.startTime) || a.facilityName.localeCompare(b.facilityName));

  // Distribute shifts into slots
  const shiftsBySlot: Record<string, DailyNotebookShift[]> = {};
  const nightShifts: DailyNotebookShift[] = [];

  for (const s of shifts) {
    const slot = normalizeTimeToSlot(s.startTime);
    // Determine whether this falls in day slots (06:00 to 19:45)
    const hour = Number(s.startTime.split(":")[0]) || 0;
    if (hour >= 20 || hour < 6) {
      nightShifts.push(s);
    }

    // Also place in slot mapping so row lookup finds it
    if (!shiftsBySlot[slot]) {
      shiftsBySlot[slot] = [];
    }
    shiftsBySlot[slot].push(s);
  }

  // Stats
  const assignedCount = shifts.filter((s) => !s.isUnassigned).length;
  const unassignedCount = shifts.filter((s) => s.isUnassigned).length;

  const availableWorkers: AvailableWorker[] = workersList.map((w) => {
    let availLetters = "";
    let status: "free" | "busy" | "leave" | "off" = "free";
    let currentShiftLabel: string | undefined = undefined;

    if (w.leaveRequests.length > 0) {
      status = "leave";
      availLetters = "Urlaub";
    } else if (w.availability.some((b) => b.status === "unavailable")) {
      status = "off";
      availLetters = "OFF";
    } else if (w.availability.length > 0) {
      availLetters = availabilityLetters(w.availability);
    }

    if (w.assignments.length > 0) {
      status = "busy";
      const a = w.assignments[0];
      currentShiftLabel = `${a.order.startTime}–${a.order.endTime} (${a.order.client.facilityName})`;
    }

    return {
      id: w.id,
      fullName: w.fullName,
      internalNumber: w.internalNumber,
      qualification: w.qualification,
      phone: w.phone,
      availLetters,
      hasBlocks: w.availability.length > 0,
      status,
      currentShiftLabel,
    };
  });

  // Sort available workers:
  // 1. Free workers with declared available shift windows (e.g. F, S, N, FS, SN, etc.) first
  // 2. Free workers without declared availability
  // 3. Busy workers (already assigned)
  // 4. Off / Leave (Urlaub / OFF)
  // Inside the same priority group, sort alphabetically by fullName
  const statusPriority: Record<string, number> = {
    freeWithShifts: 0,
    free: 1,
    busy: 2,
    off: 3,
    leave: 4,
  };

  availableWorkers.sort((a, b) => {
    const aKey = a.status === "free" && a.availLetters && a.availLetters !== "Urlaub" && a.availLetters !== "OFF" ? "freeWithShifts" : a.status;
    const bKey = b.status === "free" && b.availLetters && b.availLetters !== "Urlaub" && b.availLetters !== "OFF" ? "freeWithShifts" : b.status;
    const aPrio = statusPriority[aKey] ?? 99;
    const bPrio = statusPriority[bKey] ?? 99;

    if (aPrio !== bPrio) {
      return aPrio - bPrio;
    }
    return a.fullName.localeCompare(b.fullName, "de");
  });

  // Mini calendars: Month - 1, Month, Month + 1
  const prevMonthDate = new Date(Date.UTC(year, month - 2, 1));
  const nextMonthDate = new Date(Date.UTC(year, month, 1));

  const miniCalendars: [MiniCalendarMonth, MiniCalendarMonth, MiniCalendarMonth] = [
    buildMiniCalendarMonth(prevMonthDate.getUTCFullYear(), prevMonthDate.getUTCMonth() + 1, validDateStr),
    buildMiniCalendarMonth(year, month, validDateStr),
    buildMiniCalendarMonth(nextMonthDate.getUTCFullYear(), nextMonthDate.getUTCMonth() + 1, validDateStr),
  ];

  return {
    dateStr: validDateStr,
    year,
    month,
    day,
    dayOfWeekName,
    monthName,
    dayOfYear,
    daysRemaining,
    calendarWeek,
    prevDateStr,
    nextDateStr,
    shifts,
    shiftsBySlot,
    nightShifts,
    stats: {
      totalShifts: shifts.length,
      assignedCount,
      unassignedCount,
      workersCount: assignedWorkerIds.size,
    },
    dailyNote: noteSetting?.value || "",
    miniCalendars,
    facilities,
    availableWorkers,
  };
}
