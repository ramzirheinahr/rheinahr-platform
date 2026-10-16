import "server-only";

import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { HOURLY_RATES } from "@/lib/pricing";

export type QualificationItem = {
  code: string;
  nameDe: string;
  nameEn: string;
  nameAr: string;
  defaultClientRateCents: number | null;
  active: boolean;
  sortOrder: number;
};

const initialNames: Array<Omit<QualificationItem, "defaultClientRateCents" | "active">> = [
  { code: "pflegefachkraft", nameDe: "Pflegefachkraft", nameEn: "Qualified care professional", nameAr: "أخصائي رعاية", sortOrder: 10 },
  { code: "pflegehelfer", nameDe: "Pflegehilfskraft", nameEn: "Care assistant", nameAr: "مساعد رعاية", sortOrder: 20 },
  { code: "betreuungskraft", nameDe: "Pflegefachassistent*in", nameEn: "Care support worker", nameAr: "مساعد رعاية متخصص", sortOrder: 30 },
  { code: "pflegedienstleitung", nameDe: "Pflegedienstleitung (PDL)", nameEn: "Care service manager", nameAr: "مدير خدمات الرعاية", sortOrder: 40 },
  { code: "kuechenhilfe", nameDe: "Küchenhilfe", nameEn: "Kitchen assistant", nameAr: "مساعد مطبخ", sortOrder: 50 },
  { code: "hausmeister", nameDe: "Hausmeister", nameEn: "Caretaker", nameAr: "مسؤول صيانة", sortOrder: 60 },
];
const initialRates: Record<string, number> = HOURLY_RATES;

export function qualificationName(item: Pick<QualificationItem, "nameDe" | "nameEn" | "nameAr">, locale: string): string {
  return locale === "ar" ? item.nameAr : locale === "en" ? item.nameEn : item.nameDe;
}

export function hashDefaultRate(input: {
  qualificationCode: string;
  version: number;
  hourlyRateInCents: number;
  effectiveFrom: string;
  sourceReference: string;
  verifiedByUserId: string;
}): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

/** Idempotent bootstrap after the additive migration; no historic price is invented. */
export async function ensureQualificationCatalog(): Promise<void> {
  const [existing, seededVersions] = await Promise.all([
    prisma.qualificationCatalog.count(),
    prisma.qualificationDefaultRateVersion.count({ where: { qualificationCode: "pflegefachkraft" } }),
  ]);
  if (existing > 0 && seededVersions > 0) return;

  const [workers, orders, rates] = await Promise.all([
    prisma.worker.findMany({ distinct: ["qualification"], select: { qualification: true } }),
    prisma.order.findMany({ distinct: ["requiredQualification"], select: { requiredQualification: true } }),
    prisma.clientHourlyRateVersion.findMany({ distinct: ["qualification"], select: { qualification: true } }),
  ]);
  const known = new Set(initialNames.map((item) => item.code));
  const historical = new Set([
    ...workers.map((item) => item.qualification),
    ...orders.map((item) => item.requiredQualification),
    ...rates.map((item) => item.qualification),
  ].filter((code) => code && !known.has(code)));

  await prisma.qualificationCatalog.createMany({
    data: [
      ...initialNames.map((item) => ({ ...item, defaultClientRateCents: Math.round(initialRates[item.code] * 100) })),
      ...[...historical].map((code, index) => ({
        code, nameDe: code, nameEn: code, nameAr: code,
        defaultClientRateCents: null, active: false, sortOrder: 1000 + index,
      })),
    ],
    skipDuplicates: true,
  });

  const effectiveFrom = "2026-10-15";
  const sourceReference = "Erstübernahme der bisherigen Plattform-Standardsätze";
  const verifiedByUserId = "system-migration";
  await prisma.qualificationDefaultRateVersion.createMany({
    data: initialNames.map((item) => {
      const hourlyRateInCents = Math.round(initialRates[item.code] * 100);
      const terms = { qualificationCode: item.code, version: 1, hourlyRateInCents, effectiveFrom, sourceReference, verifiedByUserId };
      return { ...terms, effectiveFrom: new Date(`${effectiveFrom}T00:00:00.000Z`), frozenHash: hashDefaultRate(terms) };
    }),
    skipDuplicates: true,
  });
}

export async function getQualificationCatalog(options?: { includeArchived?: boolean }): Promise<QualificationItem[]> {
  await ensureQualificationCatalog();
  return prisma.qualificationCatalog.findMany({
    where: options?.includeArchived ? undefined : { active: true },
    orderBy: [{ sortOrder: "asc" }, { nameDe: "asc" }],
    select: { code: true, nameDe: true, nameEn: true, nameAr: true, defaultClientRateCents: true, active: true, sortOrder: true },
  });
}

export function catalogRateMap(items: QualificationItem[]): Record<string, number> {
  return Object.fromEntries(items.flatMap((item) =>
    item.defaultClientRateCents === null ? [] : [[item.code, item.defaultClientRateCents / 100]],
  ));
}

/** Archived codes are accepted only when the same existing order keeps them. */
export async function requestQualificationsAreSelectable(
  shifts: Array<{ id?: string; requiredQualification: string }>,
  existing: Array<{ id: string; requiredQualification: string }> = [],
): Promise<boolean> {
  const prior = new Map(existing.map((item) => [item.id, item.requiredQualification]));
  if (shifts.every((shift) => shift.id !== undefined && prior.get(shift.id) === shift.requiredQualification)) {
    return true;
  }
  const catalog = await getQualificationCatalog();
  const active = new Set(catalog.filter((item) => item.defaultClientRateCents !== null).map((item) => item.code));
  return shifts.every((shift) => active.has(shift.requiredQualification) ||
    (shift.id !== undefined && prior.get(shift.id) === shift.requiredQualification));
}
