import { qualifications } from "@/lib/validations";

type Qualification = (typeof qualifications)[number];

// Hourly billing rates (EUR, netto — 19 % USt added on the invoice) per
// qualification for Arbeitnehmerüberlassung. Single source of truth for the
// price shown while building an order and, later, the generated invoice.
export const HOURLY_RATES: Record<Qualification, number> = {
  pflegefachkraft: 54.9,
  altenpfleger: 54.9,
  gesundheitspfleger: 54.9,
  betreuungskraft: 54.9,
  pflegehelfer: 36.9,
  pflegedienstleitung: 65.9,
};

// German statutory VAT applied to staffing services.
export const VAT_RATE = 0.19;

// Surcharges on the base hourly rate. A holiday always wins over the weekend
// (a holiday that falls on Sat/Sun is billed as a holiday).
export const SURCHARGES = {
  saturday: 0.25, // Samstag +25 %
  sunday: 0.5, // Sonntag +50 %
  holiday: 1.0, // Feiertag +100 %
} as const;

export function rateFor(qual: string): number {
  return HOURLY_RATES[qual as Qualification] ?? 0;
}

// Effective surcharge fractions for one client — its overrides, else defaults.
export type Surcharges = { sat: number; sun: number; holiday: number };

export const DEFAULT_SURCHARGES: Surcharges = {
  sat: SURCHARGES.saturday,
  sun: SURCHARGES.sunday,
  holiday: SURCHARGES.holiday,
};

export function resolveSurcharges(
  o?: {
    surchargeSat?: number | null;
    surchargeSun?: number | null;
    surchargeHoliday?: number | null;
  } | null,
): Surcharges {
  return {
    sat: o?.surchargeSat ?? DEFAULT_SURCHARGES.sat,
    sun: o?.surchargeSun ?? DEFAULT_SURCHARGES.sun,
    holiday: o?.surchargeHoliday ?? DEFAULT_SURCHARGES.holiday,
  };
}

// Surcharge fraction (0 = none) for a given day. `dow` is 0=Sun … 6=Sat.
export function surchargeFor(
  { isHoliday, dow }: { isHoliday: boolean; dow: number },
  s: Surcharges = DEFAULT_SURCHARGES,
): number {
  if (isHoliday) return s.holiday;
  if (dow === 0) return s.sun;
  if (dow === 6) return s.sat;
  return 0;
}
