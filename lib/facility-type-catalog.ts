import "server-only";

import { prisma } from "@/lib/prisma";
import { type FacilityTypeItem, facilityTypeName } from "@/lib/facility-type-shared";

export type { FacilityTypeItem };
export { facilityTypeName };

export const INITIAL_FACILITY_TYPES = [
  { code: "pflegeheim", nameDe: "Pflegeheim", nameEn: "Nursing home", nameAr: "دار رعاية تمريضية", sortOrder: 10 },
  { code: "seniorenheim", nameDe: "Seniorenheim", nameEn: "Retirement home", nameAr: "دار مسنين", sortOrder: 20 },
  { code: "ambulant", nameDe: "Ambulanter Pflegedienst", nameEn: "Outpatient care service", nameAr: "خدمة رعاية متنقلة", sortOrder: 30 },
  { code: "tagespflege", nameDe: "Tagespflege", nameEn: "Day care", nameAr: "رعاية نهارية", sortOrder: 40 },
  { code: "kurzzeitpflege", nameDe: "Kurzzeitpflege", nameEn: "Short-term care", nameAr: "رعاية قصيرة الأمد", sortOrder: 50 },
  { code: "klinik", nameDe: "Klinik / Krankenhaus", nameEn: "Clinic / Hospital", nameAr: "عيادة / مستشفى", sortOrder: 60 },
  { code: "reha", nameDe: "Rehaklinik / Rehazentrum", nameEn: "Rehabilitation clinic", nameAr: "مركز تأهيل طبي", sortOrder: 70 },
  { code: "hospiz", nameDe: "Hospiz", nameEn: "Hospice", nameAr: "دار رعاية تلطيفية", sortOrder: 80 },
  { code: "behindertenhilfe", nameDe: "Behindertenhilfe", nameEn: "Disability care facility", nameAr: "رعاية ذوي الاحتياجات الخاصة", sortOrder: 90 },
  { code: "betreutes_wohnen", nameDe: "Betreutes Wohnen", nameEn: "Assisted living", nameAr: "سكن رعاية مسنين", sortOrder: 100 },
  { code: "kinderpflege", nameDe: "Intensiv- / Kinderkrankenpflege", nameEn: "Intensive & pediatric care", nameAr: "رعاية تمريضية مركزة وأطفال", sortOrder: 110 },
  { code: "sport_freizeit", nameDe: "Sport- & Freizeiteinrichtung", nameEn: "Sports & leisure facility", nameAr: "منشأة رياضية وترفيهية", sortOrder: 120 },
  { code: "sonstige", nameDe: "Sonstige Einrichtung", nameEn: "Other facility", nameAr: "منشأة أخرى", sortOrder: 130 },
] as const;

/**
 * Idempotent bootstrap: Populates the initial standard care facility types
 * and registers any historical types currently in the Client table.
 */
export async function ensureFacilityTypeCatalog(): Promise<void> {
  const existingCount = await prisma.facilityTypeCatalog.count();
  if (existingCount > 0) return;

  const knownCodes = new Set<string>(INITIAL_FACILITY_TYPES.map((t) => t.code));

  // Discover any historical facilityType values already present on existing clients
  const historicalClients = await prisma.client.findMany({
    select: { facilityType: true },
    distinct: ["facilityType"],
  });

  const historicalTypes = historicalClients
    .map((c) => c.facilityType)
    .filter((type): type is string => Boolean(type && !knownCodes.has(type)));

  await prisma.facilityTypeCatalog.createMany({
    data: [
      ...INITIAL_FACILITY_TYPES.map((t) => ({
        code: t.code,
        nameDe: t.nameDe,
        nameEn: t.nameEn,
        nameAr: t.nameAr,
        active: true,
        sortOrder: t.sortOrder,
      })),
      ...historicalTypes.map((code, index) => ({
        code,
        nameDe: code,
        nameEn: code,
        nameAr: code,
        active: true,
        sortOrder: 200 + index * 10,
      })),
    ],
    skipDuplicates: true,
  });
}

export async function getFacilityTypeCatalog(options?: {
  includeArchived?: boolean;
  includeClientCount?: boolean;
}): Promise<FacilityTypeItem[]> {
  await ensureFacilityTypeCatalog();

  const where = options?.includeArchived ? undefined : { active: true };

  const [items, clientCounts] = await Promise.all([
    prisma.facilityTypeCatalog.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { nameDe: "asc" }],
      select: {
        code: true,
        nameDe: true,
        nameEn: true,
        nameAr: true,
        active: true,
        sortOrder: true,
        updatedAt: true,
      },
    }),
    options?.includeClientCount
      ? prisma.client.groupBy({
          by: ["facilityType"],
          _count: { id: true },
        })
      : Promise.resolve([]),
  ]);

  const countMap = new Map<string, number>();
  for (const c of clientCounts) {
    if (c.facilityType) {
      countMap.set(c.facilityType, c._count.id);
    }
  }

  return items.map((item) => ({
    ...item,
    clientCount: countMap.get(item.code) ?? 0,
  }));
}

export async function getFacilityTypeLabelMap(locale: string): Promise<Map<string, string>> {
  const items = await getFacilityTypeCatalog({ includeArchived: true });
  const map = new Map<string, string>();
  for (const item of items) {
    map.set(item.code, facilityTypeName(item, locale));
  }
  return map;
}
