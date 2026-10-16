export type FacilityTypeItem = {
  code: string;
  nameDe: string;
  nameEn: string;
  nameAr: string;
  active: boolean;
  sortOrder: number;
  clientCount?: number;
  updatedAt?: Date | string;
};

export function facilityTypeName(
  item: { nameDe: string; nameEn?: string | null; nameAr?: string | null },
  locale: string
): string {
  if (locale === "ar" && item.nameAr) return item.nameAr;
  if (locale === "en" && item.nameEn) return item.nameEn;
  return item.nameDe;
}
