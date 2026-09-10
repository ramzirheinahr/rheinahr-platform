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

export async function fetchReisespesenAction(params: {
  year: number;
  month: number;
  workerId: string;
}) {
  await requireRole("de", "admin");
  return await getReisespesenData(params);
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
