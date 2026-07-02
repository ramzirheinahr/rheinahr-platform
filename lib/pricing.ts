import { qualifications } from "@/lib/validations";
import { germanHolidays } from "@/lib/holidays";

type Qualification = (typeof qualifications)[number];

// Hourly billing rates (EUR, netto — 19 % USt added on the invoice) per
// qualification for Arbeitnehmerüberlassung. Single source of truth for the
// price shown while building an order and, later, the generated invoice.
export const HOURLY_RATES: Record<Qualification, number> = {
  pflegefachkraft: 54.9,
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

// Break (minutes) assumed for billing — per-shift breaks are not persisted, so
// pricing always uses the builder's default.
export const DEFAULT_BREAK_MIN = 30;

const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

// Net billable hours of one shift: overnight-aware duration minus the break.
export function netShiftHours(start: string, end: string, breakMin = DEFAULT_BREAK_MIN): number {
  let dur = (toMin(end) - toMin(start) + 1440) % 1440;
  if (dur === 0) dur = 1440;
  return Math.max(0, (dur - breakMin) / 60);
}

// Net order value (EUR) for a set of persisted shifts — mirrors the price the
// builder shows live: hours × headcount × qualification rate, uplifted by the
// day's Zuschlag (Sat/Sun/holiday, holiday wins).
export function requestNetTotal(
  shifts: {
    shiftDate: Date;
    startTime: string;
    endTime: string;
    quantity: number;
    requiredQualification: string;
  }[],
  sc: Surcharges = DEFAULT_SURCHARGES,
): number {
  const holidayCache = new Map<number, Map<string, string>>();
  let total = 0;
  for (const s of shifts) {
    const date = s.shiftDate.toISOString().slice(0, 10);
    const year = Number(date.slice(0, 4));
    let hol = holidayCache.get(year);
    if (!hol) {
      hol = germanHolidays(year);
      holidayCache.set(year, hol);
    }
    const mult =
      1 + surchargeFor({ isHoliday: hol.has(date), dow: s.shiftDate.getUTCDay() }, sc);
    total +=
      netShiftHours(s.startTime, s.endTime) *
      s.quantity *
      rateFor(s.requiredQualification) *
      mult;
  }
  return total;
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
