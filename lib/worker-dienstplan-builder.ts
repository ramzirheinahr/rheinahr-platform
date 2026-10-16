import { prisma } from "@/lib/prisma";
import { getWorkerMonthSchedule } from "@/lib/worker-schedule";
import { formatBirthDate } from "@/lib/worker-utils";
import type {
  WorkerDienstplanPdfData,
  WorkerDienstplanPdfRow,
  WorkerDienstplanLeaveRow,
  WorkerDienstplanTotals,
} from "@/lib/pdf/worker-dienstplan";

const QUALIFICATION_LABELS_DE: Record<string, string> = {
  pflegefachkraft: "Pflegefachkraft",
  pflegehelfer: "Pflegehilfskraft",
  betreuungskraft: "Pflegefachassistent*in",
  pflegedienstleitung: "Pflegedienstleitung (PDL)",
  kuechenhilfe: "Küchenhilfe",
  hausmeister: "Hausmeister",
};

const GERMAN_DAY_NAMES = ["So.", "Mo.", "Di.", "Mi.", "Do.", "Fr.", "Sa."];

const GERMAN_MONTHS = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

const LEAVE_TYPE_LABELS_DE: Record<string, string> = {
  vacation: "Erholungsurlaub",
  sick: "Arbeitsunfähigkeit (AU)",
  other: "Sonderurlaub / Freistellung",
};

function parseTimeToMinutes(timeStr: string): number {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(":").map((v) => parseInt(v, 10) || 0);
  return h * 60 + m;
}

/**
 * Determines the shift categorization (Frühdienst / Spätdienst / Nachtdienst / Tagdienst)
 * with dedicated high-contrast badge colors.
 */
export function getShiftTypeInfo(
  startTime: string,
  endTime?: string,
): {
  shiftCode: "FD" | "SD" | "ND" | "TD";
  shiftLabel: string;
  shiftBadgeBg: string;
  shiftBadgeText: string;
  shiftBadgeBorder: string;
} {
  const startMin = parseTimeToMinutes(startTime);
  const endMin = endTime ? parseTimeToMinutes(endTime) : null;

  // Night shift: starts at or after 20:00 (1200m) or before 05:00 (300m),
  // or crosses midnight and ends early morning.
  const isNight =
    startMin >= 20 * 60 ||
    startMin < 5 * 60 ||
    (endMin !== null && endMin < startMin && endMin <= 10 * 60);

  if (isNight) {
    return {
      shiftCode: "ND",
      shiftLabel: "Nachtdienst",
      shiftBadgeBg: "#ede9fe",
      shiftBadgeText: "#5b21b6",
      shiftBadgeBorder: "#c4b5fd",
    };
  }

  // Late shift: starts between 11:30 and 19:59
  if (startMin >= 11 * 60 + 30 && startMin < 20 * 60) {
    return {
      shiftCode: "SD",
      shiftLabel: "Spätdienst",
      shiftBadgeBg: "#ffedd5",
      shiftBadgeText: "#9a3412",
      shiftBadgeBorder: "#fdba74",
    };
  }

  // Morning shift: starts between 05:00 and 11:29
  if (startMin >= 5 * 60 && startMin < 11 * 60 + 30) {
    // If it's a long full-day shift spanning into late afternoon (e.g. 08:00 - 17:00),
    // mark as Tagdienst (TD), otherwise classic Frühdienst (FD)
    if (endMin !== null && endMin > startMin && endMin - startMin >= 8 * 60 + 30 && startMin >= 8 * 60) {
      return {
        shiftCode: "TD",
        shiftLabel: "Tagdienst",
        shiftBadgeBg: "#f1f5f9",
        shiftBadgeText: "#334155",
        shiftBadgeBorder: "#cbd5e1",
      };
    }

    return {
      shiftCode: "FD",
      shiftLabel: "Frühdienst",
      shiftBadgeBg: "#e0f2fe",
      shiftBadgeText: "#0369a1",
      shiftBadgeBorder: "#7dd3fc",
    };
  }

  // Default fallback: Tagdienst
  return {
    shiftCode: "TD",
    shiftLabel: "Tagdienst",
    shiftBadgeBg: "#f1f5f9",
    shiftBadgeText: "#334155",
    shiftBadgeBorder: "#cbd5e1",
  };
}

export function formatDateDe(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  if (!y || !m || !d) return dateStr;
  return `${d.padStart(2, "0")}.${m.padStart(2, "0")}.${y}`;
}

export function getDayOfWeekDe(dateStr: string): { label: string; isWeekend: boolean } {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const dayIndex = dt.getUTCDay();
  const label = GERMAN_DAY_NAMES[dayIndex] || "—";
  const isWeekend = dayIndex === 0 || dayIndex === 6;
  return { label, isWeekend };
}

export async function buildWorkerDienstplanPdfData(
  workerId: string,
  year: number,
  month: number,
): Promise<WorkerDienstplanPdfData> {
  const worker = await prisma.worker.findUnique({
    where: { id: workerId },
    select: {
      id: true,
      fullName: true,
      salutation: true,
      internalNumber: true,
      qualification: true,
      birthDate: true,
      phone: true,
    },
  });

  if (!worker) {
    throw new Error(`Worker with ID "${workerId}" not found`);
  }

  const { rows: rawRows, leaveDays: rawLeaveDays, totals: rawTotals } =
    await getWorkerMonthSchedule(workerId, year, month);

  // Sort rows chronologically
  const sortedRawRows = [...rawRows].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.startTime.localeCompare(b.startTime);
  });

  let earlyCount = 0;
  let lateCount = 0;
  let nightCount = 0;
  let dayCount = 0;
  let sumPlannedHours = 0;
  let sumConfirmedHours = 0;

  const rows: WorkerDienstplanPdfRow[] = sortedRawRows.map((r) => {
    const { label: dayOfWeek, isWeekend } = getDayOfWeekDe(r.date);
    const dateFormatted = formatDateDe(r.date);
    const shiftInfo = getShiftTypeInfo(r.startTime, r.endTime);

    if (shiftInfo.shiftCode === "FD") earlyCount++;
    else if (shiftInfo.shiftCode === "SD") lateCount++;
    else if (shiftInfo.shiftCode === "ND") nightCount++;
    else dayCount++;

    sumPlannedHours += r.scheduledHours || 0;
    if (r.confirmedHours != null) {
      sumConfirmedHours += r.confirmedHours;
    }

    let statusLabel = "Offen";
    let isConfirmed = false;
    if (r.confirmedHours != null || r.status === "confirmed") {
      statusLabel = "Bestätigt";
      isConfirmed = true;
    } else if (r.status === "pending") {
      statusLabel = "Eingeteilt";
      isConfirmed = false;
    } else if (r.status === "declined") {
      statusLabel = "Abgelehnt";
      isConfirmed = false;
    }

    return {
      id: r.id,
      date: r.date,
      dateFormatted,
      dayOfWeek,
      isWeekend,
      startTime: r.startTime,
      endTime: r.endTime,
      timeRange: `${r.startTime} – ${r.endTime}`,
      breakMinutes: r.breakMinutes ?? 30,
      scheduledHours: Number((r.scheduledHours || 0).toFixed(2)),
      confirmedHours: r.confirmedHours != null ? Number(r.confirmedHours.toFixed(2)) : null,
      shiftCode: shiftInfo.shiftCode,
      shiftLabel: shiftInfo.shiftLabel,
      shiftBadgeBg: shiftInfo.shiftBadgeBg,
      shiftBadgeText: shiftInfo.shiftBadgeText,
      shiftBadgeBorder: shiftInfo.shiftBadgeBorder,
      facilityName: r.facilityName || "—",
      address: r.address || null,
      notes: r.notes || null,
      statusLabel,
      isConfirmed,
    };
  });

  const leaves: WorkerDienstplanLeaveRow[] = (rawLeaveDays || []).map((ld) => ({
    dateFormatted: formatDateDe(ld.date),
    typeLabel: LEAVE_TYPE_LABELS_DE[ld.type] || "Freistellung",
    hours: Number((ld.hours || 0).toFixed(2)),
  }));

  const monthName = GERMAN_MONTHS[month - 1] || `${month}`;
  const monthLabel = `${monthName} ${year}`;

  const now = new Date();
  const generatedAt = `${now.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Berlin",
  })}, ${now.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  })} Uhr`;

  const qualKey = worker.qualification.toLowerCase().trim();
  const qualDisplay = QUALIFICATION_LABELS_DE[qualKey] || worker.qualification;

  const totals: WorkerDienstplanTotals = {
    totalShifts: rows.length,
    earlyShiftsCount: earlyCount,
    lateShiftsCount: lateCount,
    nightShiftsCount: nightCount,
    dayShiftsCount: dayCount,
    plannedHours: Number(sumPlannedHours.toFixed(2)),
    confirmedHours: Number(sumConfirmedHours.toFixed(2)),
    requiredHours: Number((rawTotals?.requiredHours || 0).toFixed(2)),
  };

  return {
    worker: {
      id: worker.id,
      fullName: worker.fullName,
      salutation: worker.salutation,
      internalNumber: worker.internalNumber,
      qualification: qualDisplay,
      birthDate: formatBirthDate(worker.birthDate),
      phone: worker.phone,
    },
    monthLabel,
    year,
    month,
    generatedAt,
    rows,
    leaves,
    totals,
  };
}
