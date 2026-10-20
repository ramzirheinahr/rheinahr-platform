import "server-only";

import { prisma } from "@/lib/prisma";
import { getCompanyConfig } from "@/lib/config/company";
import { resolveRates, rateFor } from "@/lib/pricing";
import { catalogRateMap, getQualificationCatalog } from "@/lib/qualification-catalog";
import { getShiftTypeInfo } from "@/lib/worker-dienstplan-builder";

export type KklRow = {
  workerName: string;
  birthDate: string;
  socialSecurityNumber: string;
  qualificationCode: string;
  hourlyRateFormatted: string;
  startDateFormatted: string;
  endDateFormatted: string;
  weeklyHoursFormatted: string;
  shiftCodesFormatted: string;
  // Raw values for sorting
  startDateRaw: string;
};

export type KklReportData = {
  company: {
    name: string;
    street: string;
    city: string;
  };
  client: {
    id: string;
    facilityName: string;
    companyAndAddress: string;
  };
  year: number;
  month: number;
  monthLabel: string;
  rows: KklRow[];
  generatedAt: string;
};

const QUAL_SHORT_MAP: Record<string, string> = {
  pflegefachkraft: "PFK",
  pflegehelfer: "PHK",
  pflegehilfskraft: "PHK",
  betreuungskraft: "PHK",
  pflegefachassistent: "PHK",
  kuechenhilfe: "KH",
  hausmeister: "HM",
  hilfskraft: "HK",
  pflegedienstleitung: "PDL",
};

export function mapQualificationToShort(qual: string): string {
  const normalized = qual.trim().toLowerCase();
  return QUAL_SHORT_MAP[normalized] || qual.toUpperCase();
}

function formatDateDe(date: Date | null | undefined): string {
  if (!date) return "";
  const d = new Date(date);
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const year = d.getUTCFullYear();
  return `${day}.${month}.${year}`;
}

function formatHours(hours: number): string {
  if (Number.isInteger(hours)) return String(hours);
  return hours.toFixed(2).replace(".", ",").replace(/,00$/, "");
}

function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function netHours(startTime: string, endTime: string, breakMinutes: number = 30): number {
  let start = parseTimeToMinutes(startTime);
  let end = parseTimeToMinutes(endTime);
  if (end < start) end += 24 * 60; // overnight
  const grossMinutes = Math.max(0, end - start);
  const netMinutes = Math.max(0, grossMinutes - breakMinutes);
  return Math.round((netMinutes / 60) * 100) / 100;
}

export async function getKklReportData(
  clientId: string,
  year: number,
  month: number,
): Promise<KklReportData | null> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      facilityName: true,
      address: true,
      billingInfo: true,
      hourlyRates: true,
    },
  });

  if (!client) return null;

  const companyConfig = await getCompanyConfig();

  // Resolve rates
  const catalogDefaults = catalogRateMap(await getQualificationCatalog({ includeArchived: true }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rates = resolveRates(client as any, catalogDefaults);

  // Month range
  const startOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const endOfMonth = new Date(Date.UTC(year, month, 1));

  // Fetch all assignments for this facility in this month
  const assignments = await prisma.assignment.findMany({
    where: {
      order: {
        clientId,
        status: { not: "cancelled" },
        shiftDate: {
          gte: startOfMonth,
          lt: endOfMonth,
        },
      },
      status: { not: "declined" },
    },
    orderBy: [
      { worker: { fullName: "asc" } },
      { order: { shiftDate: "asc" } },
      { order: { startTime: "asc" } },
    ],
    include: {
      worker: {
        select: {
          id: true,
          fullName: true,
          birthDate: true,
          socialSecurityNumber: true,
          qualification: true,
          employmentType: true,
          requiredHours: true,
        },
      },
      order: {
        select: {
          shiftDate: true,
          startTime: true,
          endTime: true,
          breakMinutes: true,
          requiredQualification: true,
        },
      },
    },
  });

  // Group assignments by worker and cluster consecutive/nearby shifts
  // Cluster gap threshold: <= 4 days between shifts belongs to same deployment block
  type WorkerShift = {
    date: Date;
    isoDate: string;
    startTime: string;
    endTime: string;
    breakMinutes: number;
    qualification: string;
    worker: (typeof assignments)[0]["worker"];
  };

  const shiftsByWorker = new Map<string, WorkerShift[]>();
  for (const a of assignments) {
    const list = shiftsByWorker.get(a.worker.id) || [];
    list.push({
      date: a.order.shiftDate,
      isoDate: a.order.shiftDate.toISOString().slice(0, 10),
      startTime: a.order.startTime,
      endTime: a.order.endTime,
      breakMinutes: a.order.breakMinutes,
      qualification: a.order.requiredQualification || a.worker.qualification,
      worker: a.worker,
    });
    shiftsByWorker.set(a.worker.id, list);
  }

  const kklRows: KklRow[] = [];

  for (const [, workerShifts] of shiftsByWorker.entries()) {
    // Sort chronologically
    workerShifts.sort((a, b) => a.date.getTime() - b.date.getTime());

    let currentCluster: WorkerShift[] = [];

    for (const shift of workerShifts) {
      if (currentCluster.length === 0) {
        currentCluster.push(shift);
        continue;
      }

      const prevShift = currentCluster[currentCluster.length - 1];
      const diffMs = shift.date.getTime() - prevShift.date.getTime();
      const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

      // Same qualification and gap <= 4 days -> group into same deployment period
      if (diffDays <= 4 && shift.qualification === prevShift.qualification) {
        currentCluster.push(shift);
      } else {
        // Finalize previous cluster
        kklRows.push(buildKklRow(currentCluster, rates));
        currentCluster = [shift];
      }
    }

    if (currentCluster.length > 0) {
      kklRows.push(buildKklRow(currentCluster, rates));
    }
  }

  // Sort all rows chronologically by startDate
  kklRows.sort((a, b) => a.startDateRaw.localeCompare(b.startDateRaw));

  // Determine client company & address representation
  let clientCompanyAndAddress = client.facilityName;
  if (client.billingInfo && client.billingInfo.trim()) {
    const lines = client.billingInfo
      .split("\n")
      .map((l) => l.trim().replace(/\r/g, ""))
      .filter(Boolean);
    clientCompanyAndAddress = lines.join(", ");
  } else if (client.address) {
    clientCompanyAndAddress = `${client.facilityName}, ${client.address.replace(/\r?\n/g, ", ")}`;
  }

  const monthLabel = new Intl.DateTimeFormat("de-DE", {
    month: "long",
    year: "numeric",
    timeZone: "Europe/Berlin",
  }).format(new Date(Date.UTC(year, month - 1, 1)));

  return {
    company: {
      name: companyConfig.name,
      street: companyConfig.street,
      city: companyConfig.city,
    },
    client: {
      id: client.id,
      facilityName: client.facilityName,
      companyAndAddress: clientCompanyAndAddress,
    },
    year,
    month,
    monthLabel,
    rows: kklRows,
    generatedAt: new Intl.DateTimeFormat("de-DE", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Europe/Berlin",
    }).format(new Date()),
  };
}

function buildKklRow(
  cluster: Array<{
    date: Date;
    isoDate: string;
    startTime: string;
    endTime: string;
    breakMinutes: number;
    qualification: string;
    worker: {
      fullName: string;
      birthDate: Date | null;
      socialSecurityNumber: string | null;
      requiredHours: number;
      employmentType: string;
    };
  }>,
  rates: ReturnType<typeof resolveRates>,
): KklRow {
  const first = cluster[0];
  const last = cluster[cluster.length - 1];

  const qualCode = mapQualificationToShort(first.qualification);
  const hourlyRate = rateFor(first.qualification, rates);
  const hourlyRateFormatted = hourlyRate
    ? `${hourlyRate.toFixed(2).replace(".", ",")} €`
    : "-";

  // Shift codes (FD, SD, ND)
  const shiftCodeSet = new Set<string>();
  let totalNetClusterHours = 0;

  for (const s of cluster) {
    const shiftInfo = getShiftTypeInfo(s.startTime, s.endTime);
    if (shiftInfo?.shiftCode) {
      shiftCodeSet.add(shiftInfo.shiftCode);
    }
    totalNetClusterHours += netHours(s.startTime, s.endTime, s.breakMinutes);
  }

  // Ordered list of shift codes
  const preferredOrder = ["FD", "SD", "ND", "TD"];
  const shiftCodesFormatted = Array.from(shiftCodeSet)
    .sort((a, b) => preferredOrder.indexOf(a) - preferredOrder.indexOf(b))
    .join(", ");

  // Weekly hours:
  // If multi-day deployment (> 2 shifts or spans > 2 days) or fulltime -> standard 35
  // If single shift or short deployment -> net shift hours
  const daySpan = Math.round((last.date.getTime() - first.date.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  let weeklyHours: number;
  if (cluster.length >= 3 || daySpan >= 3) {
    weeklyHours = 35;
  } else if (cluster.length === 1) {
    weeklyHours = totalNetClusterHours;
  } else {
    // 2 shifts: if total hours small (e.g. 4.75 each) show total or 35
    weeklyHours = totalNetClusterHours <= 10 ? totalNetClusterHours : 35;
  }

  return {
    workerName: first.worker.fullName,
    birthDate: formatDateDe(first.worker.birthDate),
    socialSecurityNumber: first.worker.socialSecurityNumber || "",
    qualificationCode: qualCode,
    hourlyRateFormatted,
    startDateFormatted: formatDateDe(first.date),
    endDateFormatted: formatDateDe(last.date),
    weeklyHoursFormatted: formatHours(weeklyHours),
    shiftCodesFormatted,
    startDateRaw: first.isoDate,
  };
}

export function kklToCsv(data: KklReportData): string {
  const headerLines = [
    `Anlage zum Arbeitnehmerüberlassungsvertrag`,
    `Zwischen;${data.company.name};${data.company.street};${data.company.city};(nachfolgend: Personaldienstleister)`,
    `und;${data.client.companyAndAddress};(nachfolgend: Kundenunternehmen)`,
    `Einrichtung:;${data.client.facilityName}`,
    ``,
    `Name, Vorname;Geburtsdatum;SV-Nummer;Tätigkeitsbereich;VS netto;Beginn;Ende;Stunden, Woche;HÜL`,
  ];

  const rowLines = data.rows.map((r) => {
    return [
      `"${r.workerName.replace(/"/g, '""')}"`,
      r.birthDate,
      r.socialSecurityNumber,
      r.qualificationCode,
      r.hourlyRateFormatted,
      r.startDateFormatted,
      r.endDateFormatted,
      r.weeklyHoursFormatted,
      r.shiftCodesFormatted,
    ].join(";");
  });

  return "\uFEFF" + [...headerLines, ...rowLines].join("\r\n");
}
