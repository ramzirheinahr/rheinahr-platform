import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { getWorkerHoursAccount, getMultipleWorkersHoursAccount } from "@/lib/hours-account";
import { getDrivingDistanceKm } from "@/lib/geocoding";

// Helper to format Date to YYYY-MM-DD
export function formatDate(d: Date | null | undefined): string {
  if (!d || isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

// Split full name into first and last
export function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: "", lastName: parts[0] };
  const lastName = parts.pop() || "";
  const firstName = parts.join(" ");
  return { firstName, lastName };
}

export async function getReportsMetadata() {
  const [workers, clients] = await Promise.all([
    prisma.worker.findMany({
      select: {
        id: true,
        fullName: true,
        internalNumber: true,
        qualification: true,
        employedSince: true,
        employmentStartDate: true,
        employmentEndDate: true,
        requiredHours: true,
        carryoverHours: true,
        address: true,
        phone: true,
        travelAllowancePerKm: true,
        user: { select: { email: true } },
      },
      orderBy: { fullName: "asc" },
    }),
    prisma.client.findMany({
      select: {
        id: true,
        facilityName: true,
        internalNumber: true,
        shortCode: true,
        address: true,
        facilityType: true,
        contactPerson: true,
      },
      orderBy: { facilityName: "asc" },
    }),
  ]);

  return { workers, clients };
}

// 1. Stundennachweis Data
export type StundennachweisRow = {
  id: string;
  shiftDate: string; // DD.MM.YYYY
  rawDate: string; // YYYY-MM-DD
  isSunday: boolean;
  workerName: string;
  workerNumber: string | null;
  livingArea: string;
  startTime: string;
  endTime: string;
  hours: number;
  hoursWithoutPause: number;
};

export async function getStundennachweisData(params: {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  qualification?: string;
  clientId?: string;
}) {
  const startD = new Date(`${params.startDate}T00:00:00Z`);
  const endD = new Date(`${params.endDate}T23:59:59Z`);

  const client = params.clientId
    ? await prisma.client.findUnique({
        where: { id: params.clientId },
        select: {
          id: true,
          facilityName: true,
          internalNumber: true,
          address: true,
          contactPerson: true,
        },
      })
    : null;

  const whereClause: Prisma.OrderWhereInput = {
    shiftDate: { gte: startD, lte: endD },
    ...(params.clientId ? { clientId: params.clientId } : {}),
  };

  if (params.qualification && params.qualification !== "alle" && params.qualification !== "all") {
    whereClause.requiredQualification = params.qualification;
  }

  const orders = await prisma.order.findMany({
    where: whereClause,
    include: {
      client: true,
      assignments: {
        where: { status: "confirmed" },
        include: {
          worker: true,
          serviceConfirmation: true,
        },
      },
    },
    orderBy: [{ shiftDate: "asc" }, { startTime: "asc" }],
  });

  const rows: StundennachweisRow[] = [];

  for (const order of orders) {
    const shiftD = new Date(order.shiftDate);
    const dayOfWeek = shiftD.getUTCDay(); // 0 is Sunday
    const isSunday = dayOfWeek === 0;

    const formattedDate = `${String(shiftD.getUTCDate()).padStart(2, "0")}.${String(
      shiftD.getUTCMonth() + 1
    ).padStart(2, "0")}.${shiftD.getUTCFullYear()}`;

    // Gross hours
    const st = new Date(`1970-01-01T${order.startTime}Z`).getTime();
    const et = new Date(`1970-01-01T${order.endTime}Z`).getTime();
    let diffMins = (et - st) / 60000;
    if (diffMins < 0) diffMins += 24 * 60;
    const grossHours = Math.round((diffMins / 60) * 100) / 100;

    if (order.assignments.length === 0) {
      // Unassigned or pending shift in period
      const netHours = Math.max(0, Math.round(((diffMins - order.breakMinutes) / 60) * 100) / 100);
      rows.push({
        id: order.id,
        shiftDate: formattedDate,
        rawDate: shiftD.toISOString().slice(0, 10),
        isSunday,
        workerName: "—",
        workerNumber: null,
        livingArea: order.notes?.slice(0, 20) || "—",
        startTime: order.startTime,
        endTime: order.endTime,
        hours: grossHours,
        hoursWithoutPause: netHours,
      });
    } else {
      for (const assign of order.assignments) {
        let netHours = 0;
        if (assign.serviceConfirmation?.hoursWorked != null) {
          netHours = Number(assign.serviceConfirmation.hoursWorked);
        } else {
          netHours = Math.max(0, Math.round(((diffMins - order.breakMinutes) / 60) * 100) / 100);
        }

        rows.push({
          id: `${order.id}-${assign.id}`,
          shiftDate: formattedDate,
          rawDate: shiftD.toISOString().slice(0, 10),
          isSunday,
          workerName: assign.worker.fullName,
          workerNumber: assign.worker.internalNumber,
          livingArea: order.notes?.slice(0, 20) || "—",
          startTime: order.startTime,
          endTime: order.endTime,
          hours: grossHours,
          hoursWithoutPause: netHours,
        });
      }
    }
  }

  return {
    client,
    startDate: params.startDate,
    endDate: params.endDate,
    rows,
  };
}

// 2. Monatsliste Data
export type MonatslisteShift = {
  kommt: string;
  geht: string;
  pause: string;
};

export type MonatslisteRow = {
  date: string; // DD.MM.YYYY
  dayOfMonth: number;
  shift1: MonatslisteShift;
  shift2: MonatslisteShift;
  hours: number;
  customerName: string;
};

export async function getMonatslisteData(params: {
  year: number;
  month: number;
  workerId: string;
  clientId?: string;
}) {
  const worker = await prisma.worker.findUnique({
    where: { id: params.workerId },
    select: { id: true, fullName: true, internalNumber: true },
  });

  if (!worker) throw new Error("Worker not found");

  const startD = new Date(Date.UTC(params.year, params.month - 1, 1));
  const endD = new Date(Date.UTC(params.year, params.month, 0, 23, 59, 59));

  const whereClause: Prisma.AssignmentWhereInput = {
    workerId: params.workerId,
    status: "confirmed",
    order: {
      shiftDate: { gte: startD, lte: endD },
      ...(params.clientId && params.clientId !== "all" ? { clientId: params.clientId } : {}),
    },
  };

  const assignments = await prisma.assignment.findMany({
    where: whereClause,
    include: {
      order: { include: { client: true } },
      serviceConfirmation: true,
    },
    orderBy: [{ order: { shiftDate: "asc" } }, { order: { startTime: "asc" } }],
  });

  // Group by date
  const byDate = new Map<string, typeof assignments>();
  for (const assign of assignments) {
    const dStr = assign.order.shiftDate.toISOString().slice(0, 10);
    const list = byDate.get(dStr) || [];
    list.push(assign);
    byDate.set(dStr, list);
  }

  const rows: MonatslisteRow[] = [];
  const daysInMonth = new Date(Date.UTC(params.year, params.month, 0)).getUTCDate();

  for (let d = 1; d <= daysInMonth; d++) {
    const dayStr = `${params.year}-${String(params.month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const dayList = byDate.get(dayStr) || [];

    if (dayList.length === 0) continue; // Show days with activity

    const formattedDate = `${String(d).padStart(2, "0")}.${String(params.month).padStart(2, "0")}.${params.year}`;

    const assign1 = dayList[0];
    const assign2 = dayList[1] || null;

    let net1 = 0;
    if (assign1) {
      if (assign1.serviceConfirmation?.hoursWorked != null) {
        net1 = Number(assign1.serviceConfirmation.hoursWorked);
      } else {
        const st = new Date(`1970-01-01T${assign1.order.startTime}Z`).getTime();
        const et = new Date(`1970-01-01T${assign1.order.endTime}Z`).getTime();
        let diffMins = (et - st) / 60000;
        if (diffMins < 0) diffMins += 24 * 60;
        net1 = Math.max(0, (diffMins - assign1.order.breakMinutes) / 60);
      }
    }

    let net2 = 0;
    if (assign2) {
      if (assign2.serviceConfirmation?.hoursWorked != null) {
        net2 = Number(assign2.serviceConfirmation.hoursWorked);
      } else {
        const st = new Date(`1970-01-01T${assign2.order.startTime}Z`).getTime();
        const et = new Date(`1970-01-01T${assign2.order.endTime}Z`).getTime();
        let diffMins = (et - st) / 60000;
        if (diffMins < 0) diffMins += 24 * 60;
        net2 = Math.max(0, (diffMins - assign2.order.breakMinutes) / 60);
      }
    }

    const totalHours = Math.round((net1 + net2) * 100) / 100;
    const clientNames = [assign1?.order.client.facilityName, assign2?.order.client.facilityName]
      .filter(Boolean)
      .join(", ");

    rows.push({
      date: formattedDate,
      dayOfMonth: d,
      shift1: assign1
        ? {
            kommt: assign1.order.startTime,
            geht: assign1.order.endTime,
            pause: `${assign1.order.breakMinutes},00`,
          }
        : { kommt: "-----", geht: "-----", pause: "0,00" },
      shift2: assign2
        ? {
            kommt: assign2.order.startTime,
            geht: assign2.order.endTime,
            pause: `${assign2.order.breakMinutes},00`,
          }
        : { kommt: "-----", geht: "-----", pause: "0,00" },
      hours: totalHours,
      customerName: clientNames || "—",
    });
  }

  return {
    worker,
    year: params.year,
    month: params.month,
    rows,
  };
}

// 3. Liste für AÜG Data
export type AuegRow = {
  internalNumber: string;
  fullName: string;
  lastName: string;
  firstName: string;
  birthDate: string;
  entryDate: string;
  exitDate: string;
  qualification: string;
  employmentType: string;
  deployments: Array<{
    period: string;
    clientName: string;
    industry: string;
  }>;
};

export async function getAuegData(params: {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
}) {
  const startD = new Date(`${params.startDate}T00:00:00Z`);
  const endD = new Date(`${params.endDate}T23:59:59Z`);

  const workers = await prisma.worker.findMany({
    where: {
      OR: [
        { employmentStartDate: { lte: endD } },
        { employedSince: { lte: endD } },
        { createdAt: { lte: endD } },
      ],
    },
    include: {
      assignments: {
        where: {
          status: "confirmed",
          order: { shiftDate: { gte: startD, lte: endD } },
        },
        include: {
          order: { include: { client: true } },
        },
        orderBy: { order: { shiftDate: "asc" } },
      },
    },
    orderBy: { fullName: "asc" },
  });

  const rows: AuegRow[] = [];

  for (const w of workers) {
    const { firstName, lastName } = splitName(w.fullName);
    const entry = w.employmentStartDate || w.employedSince || w.createdAt;
    const exit = w.employmentEndDate;

    const formattedBirth = w.birthDate
      ? `${String(w.birthDate.getUTCDate()).padStart(2, "0")}.${String(
          w.birthDate.getUTCMonth() + 1
        ).padStart(2, "0")}.${w.birthDate.getUTCFullYear()}`
      : "—";

    const formattedEntry = entry
      ? `${String(entry.getUTCDate()).padStart(2, "0")}.${String(
          entry.getUTCMonth() + 1
        ).padStart(2, "0")}.${entry.getUTCFullYear()}`
      : "—";

    const formattedExit = exit
      ? `${String(exit.getUTCDate()).padStart(2, "0")}.${String(
          exit.getUTCMonth() + 1
        ).padStart(2, "0")}.${exit.getUTCFullYear()}`
      : "—";

    // Group deployments by client
    const deployments: Array<{ period: string; clientName: string; industry: string }> = [];
    const clientDeployMap = new Map<
      string,
      { minD: Date; maxD: Date; client: { facilityName: string; facilityType: string | null } }
    >();

    for (const a of w.assignments) {
      const d = a.order.shiftDate;
      const cId = a.order.clientId;
      const existing = clientDeployMap.get(cId);
      if (!existing) {
        clientDeployMap.set(cId, { minD: d, maxD: d, client: a.order.client });
      } else {
        if (d < existing.minD) existing.minD = d;
        if (d > existing.maxD) existing.maxD = d;
      }
    }

    for (const [, item] of clientDeployMap.entries()) {
      const minS = `${String(item.minD.getUTCDate()).padStart(2, "0")}.${String(
        item.minD.getUTCMonth() + 1
      ).padStart(2, "0")}.${String(item.minD.getUTCFullYear()).slice(2)}`;
      const maxS = `${String(item.maxD.getUTCDate()).padStart(2, "0")}.${String(
        item.maxD.getUTCMonth() + 1
      ).padStart(2, "0")}.${String(item.maxD.getUTCFullYear()).slice(2)}`;

      deployments.push({
        period: `${minS} - ${maxS}`,
        clientName: item.client.facilityName,
        industry: item.client.facilityType || "Pflegedienst",
      });
    }

    if (deployments.length === 0) {
      deployments.push({
        period: "—",
        clientName: "—",
        industry: "—",
      });
    }

    rows.push({
      internalNumber: w.internalNumber || "—",
      fullName: w.fullName,
      lastName,
      firstName,
      birthDate: formattedBirth,
      entryDate: formattedEntry,
      exitDate: formattedExit,
      qualification: w.qualification,
      employmentType: w.employmentType.toUpperCase(),
      deployments,
    });
  }

  return {
    startDate: params.startDate,
    endDate: params.endDate,
    rows,
  };
}

// 4. Liste der Mitarbeiter Data
export type MitarbeiterListeRow = {
  internalNumber: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  gender: string;
  address: string;
  phone: string;
  email: string;
};

export async function getMitarbeiterListeData(params: {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  clientId: string;
  qualification?: string;
}) {
  const startD = new Date(`${params.startDate}T00:00:00Z`);
  const endD = new Date(`${params.endDate}T23:59:59Z`);

  const client = await prisma.client.findUnique({
    where: { id: params.clientId },
    select: { id: true, facilityName: true, address: true },
  });

  if (!client) throw new Error("Client not found");

  const whereClause: Prisma.AssignmentWhereInput = {
    order: {
      clientId: params.clientId,
      shiftDate: { gte: startD, lte: endD },
    },
    status: "confirmed",
  };

  if (params.qualification && params.qualification !== "alle" && params.qualification !== "all") {
    whereClause.worker = { qualification: params.qualification };
  }

  const assignments = await prisma.assignment.findMany({
    where: whereClause,
    include: {
      worker: {
        include: { user: { select: { email: true } } },
      },
    },
  });

  // Extract unique workers
  const workerMap = new Map<string, typeof assignments[0]["worker"]>();
  for (const a of assignments) {
    if (!workerMap.has(a.workerId)) {
      workerMap.set(a.workerId, a.worker);
    }
  }

  const rows: MitarbeiterListeRow[] = [];
  for (const w of workerMap.values()) {
    const { firstName, lastName } = splitName(w.fullName);
    const formattedBirth = w.birthDate
      ? `${String(w.birthDate.getUTCDate()).padStart(2, "0")}.${String(
          w.birthDate.getUTCMonth() + 1
        ).padStart(2, "0")}.${w.birthDate.getUTCFullYear()}`
      : "—";

    rows.push({
      internalNumber: w.internalNumber || "—",
      firstName,
      lastName,
      birthDate: formattedBirth,
      gender: "Männlich", // default or profile gender
      address: w.address || "—",
      phone: w.phone || "—",
      email: w.user.email || "—",
    });
  }

  return {
    client,
    startDate: params.startDate,
    endDate: params.endDate,
    rows,
  };
}

// 5. Arbeitszeitkonto Data with Notes
export async function getArbeitszeitkontoData(params: {
  workerId: string;
  startMonth?: string;
  endMonth?: string;
  zeiterfassungInsgesamt?: boolean;
  withPrevBalance?: boolean;
}) {
  const worker = await prisma.worker.findUnique({
    where: { id: params.workerId },
    include: { sollHoursHistory: true },
  });

  if (!worker) throw new Error("Worker not found");

  const now = new Date();
  const currentMonthStr = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  let startMonth = params.startMonth || currentMonthStr;
  let endMonth = params.endMonth || currentMonthStr;

  if (params.zeiterfassungInsgesamt) {
    const startDate = worker.employmentStartDate || worker.employedSince || worker.createdAt;
    const startY = startDate.getUTCFullYear();
    const startM = String(startDate.getUTCMonth() + 1).padStart(2, "0");
    startMonth = `${startY}-${startM}`;
    endMonth = currentMonthStr;
  }

  const result = await getWorkerHoursAccount(params.workerId, startMonth, endMonth);

  // Fetch notes stored in SystemSetting
  const monthKeys = result.months.map((m) => `azk.note.${params.workerId}.${m.month}`);
  const settings = await prisma.systemSetting.findMany({
    where: { key: { in: monthKeys } },
  });
  const noteMap = new Map<string, string>();
  for (const s of settings) {
    const m = s.key.replace(`azk.note.${params.workerId}.`, "");
    noteMap.set(m, s.value);
  }

  const monthsWithNotes = result.months.map((m) => ({
    ...m,
    notes: noteMap.get(m.month) || "",
  }));

  const initialCarryover = params.withPrevBalance ? result.initialCarryover : 0;

  return {
    worker,
    startMonth,
    endMonth,
    initialCarryover,
    months: monthsWithNotes,
  };
}

export async function saveAzkNotes(params: {
  workerId: string;
  notes: Record<string, string>; // month -> note
}) {
  const operations = Object.entries(params.notes).map(([month, note]) => {
    const key = `azk.note.${params.workerId}.${month}`;
    return prisma.systemSetting.upsert({
      where: { key },
      create: { key, value: note },
      update: { value: note },
    });
  });

  await prisma.$transaction(operations);
  return { success: true };
}

// 6. Reisespesen Data
export type ReisespesenRow = {
  id: string;
  index: number;
  date: string; // DD.MM.YYYY
  fromTime: string;
  toTime: string;
  customerName: string;
  addressFrom: string;
  addressTo: string;
  distanceKm: number;
  totalCost: number;
};

export async function getReisespesenData(params: {
  year: number;
  month: number;
  workerId: string;
}) {
  const worker = await prisma.worker.findUnique({
    where: { id: params.workerId },
    select: {
      id: true,
      fullName: true,
      internalNumber: true,
      address: true,
      travelAllowancePerKm: true,
    },
  });

  if (!worker) throw new Error("Worker not found");

  const startD = new Date(Date.UTC(params.year, params.month - 1, 1));
  const endD = new Date(Date.UTC(params.year, params.month, 0, 23, 59, 59));

  const assignments = await prisma.assignment.findMany({
    where: {
      workerId: params.workerId,
      status: "confirmed",
      order: { shiftDate: { gte: startD, lte: endD } },
    },
    include: {
      order: { include: { client: true } },
    },
    orderBy: [{ order: { shiftDate: "asc" } }, { order: { startTime: "asc" } }],
  });

  const ratePerKm = worker.travelAllowancePerKm ?? 0.3; // standard 0.30 €/km

  const rows: ReisespesenRow[] = [];
  let totalDistance = 0;
  let totalCost = 0;

  for (let i = 0; i < assignments.length; i++) {
    const a = assignments[i];
    const prevA = i > 0 ? assignments[i - 1] : null;

    const shiftD = a.order.shiftDate;
    const formattedDate = `${String(shiftD.getUTCDate()).padStart(2, "0")}.${String(
      shiftD.getUTCMonth() + 1
    ).padStart(2, "0")}.${shiftD.getUTCFullYear()}`;

    let addressFrom = "Home";
    const addressTo = a.order.client.address || a.order.client.facilityName;

    // Check if shift is on the same day as previous shift at same facility
    const isSameDayAsPrev =
      prevA &&
      prevA.order.shiftDate.toISOString().slice(0, 10) ===
        shiftD.toISOString().slice(0, 10);

    let distance = 0;

    if (isSameDayAsPrev && prevA.order.clientId === a.order.clientId) {
      addressFrom = addressTo;
      distance = 0;
    } else {
      addressFrom = "Home";
      if (worker.address && a.order.client.address) {
        const d = await getDrivingDistanceKm(worker.address, a.order.client.address);
        distance = d ?? 25.0; // fallback if geocoding cannot calculate
      } else {
        distance = 20.0;
      }
    }

    const cost = Math.round(distance * ratePerKm * 100) / 100;
    totalDistance += distance;
    totalCost += cost;

    rows.push({
      id: a.id,
      index: i + 1,
      date: formattedDate,
      fromTime: a.order.startTime,
      toTime: a.order.endTime,
      customerName: a.order.client.facilityName,
      addressFrom,
      addressTo,
      distanceKm: Math.round(distance * 100) / 100,
      totalCost: cost,
    });
  }

  return {
    worker,
    year: params.year,
    month: params.month,
    ratePerKm,
    rows,
    totalDistance: Math.round(totalDistance * 100) / 100,
    totalCost: Math.round(totalCost * 100) / 100,
  };
}

// 7. Urlaub Berechnung Data
export function calculateUrlaubEntitlement(params: {
  contractDaysPerWeek: number; // e.g. 5
  actualDaysPerWeek: number; // e.g. 5
  periodStart: string; // YYYY-MM-DD
  periodEnd: string; // YYYY-MM-DD
  takenDays: number; // e.g. 0
  annualVacationDays?: number; // e.g. 27
}) {
  const dStart = new Date(params.periodStart);
  const dEnd = new Date(params.periodEnd);

  const annualDays = params.annualVacationDays ?? 27;

  // Calculate difference in months
  const diffTime = Math.abs(dEnd.getTime() - dStart.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  const months = Math.max(0, Math.round((diffDays / 30.4375) * 100) / 100);

  const daysRatio =
    params.contractDaysPerWeek > 0
      ? params.actualDaysPerWeek / params.contractDaysPerWeek
      : 1;

  const monthsRatio = months / 12;

  const rawEntitlement = daysRatio * annualDays * monthsRatio - params.takenDays;
  const entitlement = Math.max(0, Math.round(rawEntitlement * 100) / 100);

  return {
    annualDays,
    months,
    daysRatio,
    monthsRatio,
    takenDays: params.takenDays,
    entitlement,
  };
}

// 8. AZK-Stand Data
export async function getAzkStandData(year: number, month: number) {
  const monthStr = `${year}-${String(month).padStart(2, "0")}`;

  const allWorkers = await prisma.worker.findMany({
    select: {
      id: true,
      fullName: true,
      internalNumber: true,
      employedSince: true,
      employmentStartDate: true,
      employmentEndDate: true,
    },
    orderBy: { fullName: "asc" },
  });

  const activeWorkers = allWorkers.filter((w) => {
    const startM = (w.employmentStartDate || w.employedSince)
      ? (w.employmentStartDate || w.employedSince)!.toISOString().slice(0, 7)
      : null;
    if (startM && startM > monthStr) return false;

    const endM = w.employmentEndDate
      ? w.employmentEndDate.toISOString().slice(0, 7)
      : null;
    if (endM && endM < monthStr) return false;

    return true;
  });

  const workerIds = activeWorkers.map((w) => w.id);
  const allAccounts = await getMultipleWorkersHoursAccount(workerIds, monthStr, monthStr);

  const rows = activeWorkers.map((w, idx) => {
    const { firstName, lastName } = splitName(w.fullName);
    let standAlt = 0;
    let zuAbgang = 0;
    let standNeu = 0;

    const acc = allAccounts[w.id];
    if (acc) {
      standAlt = acc.initialCarryover;
      if (acc.months.length > 0) {
        const lastM = acc.months[acc.months.length - 1];
        zuAbgang = lastM.monthBalance;
        standNeu = lastM.cumulativeBalance;
      } else {
        standNeu = standAlt;
      }
    }

    return {
      index: idx + 1,
      id: w.id,
      internalNumber: w.internalNumber || "—",
      fullName: w.fullName,
      lastName,
      firstName,
      standAlt: Math.round(standAlt * 100) / 100,
      zuAbgang: Math.round(zuAbgang * 100) / 100,
      standNeu: Math.round(standNeu * 100) / 100,
    };
  });

  return {
    year,
    month,
    monthStr,
    rows,
  };
}

// 9. Zeiterfassung Transfer & Copy
export async function transferOrCopyShifts(params: {
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
  const startD = new Date(Date.UTC(params.source.year, params.source.month - 1, 1));
  const endD = new Date(Date.UTC(params.source.year, params.source.month, 0, 23, 59, 59));

  const sourceAssignments = await prisma.assignment.findMany({
    where: {
      workerId: params.source.workerId,
      order: {
        shiftDate: { gte: startD, lte: endD },
        ...(params.source.clientId ? { clientId: params.source.clientId } : {}),
      },
    },
    include: {
      order: true,
      serviceConfirmation: true,
    },
  });

  if (sourceAssignments.length === 0) {
    return { success: true, count: 0 };
  }

  let count = 0;

  for (const assign of sourceAssignments) {
    if (params.mode === "copy") {
      // Create duplicate shift in target month / for target worker
      const sourceDate = new Date(assign.order.shiftDate);
      const targetDay = Math.min(
        sourceDate.getUTCDate(),
        new Date(Date.UTC(params.target.year, params.target.month, 0)).getUTCDate()
      );
      const targetDate = new Date(Date.UTC(params.target.year, params.target.month - 1, targetDay));

      const newOrder = await prisma.order.create({
        data: {
          clientId: params.target.clientId || assign.order.clientId,
          shiftDate: targetDate,
          startTime: assign.order.startTime,
          endTime: assign.order.endTime,
          breakMinutes: assign.order.breakMinutes,
          requiredQualification: assign.order.requiredQualification,
          status: "confirmed",
          notes: assign.order.notes,
        },
      });

      await prisma.assignment.create({
        data: {
          orderId: newOrder.id,
          workerId: params.target.workerId,
          status: "confirmed",
        },
      });
      count++;
    } else if (params.mode === "transfer") {
      // Reassign assignment to target worker / client
      await prisma.assignment.update({
        where: { id: assign.id },
        data: {
          workerId: params.target.workerId,
        },
      });
      if (params.target.clientId && params.target.clientId !== assign.order.clientId) {
        await prisma.order.update({
          where: { id: assign.orderId },
          data: { clientId: params.target.clientId },
        });
      }
      count++;
    }
  }

  return { success: true, count };
}
