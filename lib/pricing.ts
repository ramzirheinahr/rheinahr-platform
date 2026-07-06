import { qualifications } from "@/lib/validations";
import { germanHolidays } from "@/lib/holidays";

type Qualification = (typeof qualifications)[number];

// Platform-default hourly billing rates (EUR, netto — 19 % USt added on the
// invoice) per qualification for Arbeitnehmerüberlassung. Each facility may
// override any of these (Client.hourlyRates); missing keys fall back here.
export const HOURLY_RATES: Record<Qualification, number> = {
  pflegefachkraft: 54.9,
  pflegehelfer: 36.9,
  betreuungskraft: 39.9,
  pflegedienstleitung: 64.9,
};

export type Rates = Record<Qualification, number>;
export const DEFAULT_RATES: Rates = HOURLY_RATES;

// Effective hourly rates for one client — its per-qualification overrides
// (stored as a JSON map), else the platform default for each qualification.
export function resolveRates(o?: { hourlyRates?: unknown } | null): Rates {
  const override =
    o && typeof o.hourlyRates === "object" && o.hourlyRates !== null
      ? (o.hourlyRates as Record<string, unknown>)
      : {};
  const out = { ...HOURLY_RATES };
  for (const q of qualifications) {
    const v = override[q];
    if (typeof v === "number" && v >= 0) out[q] = v;
  }
  return out;
}

// German statutory VAT applied to staffing services.
export const VAT_RATE = 0.19;

// Surcharges on the base hourly rate. Priority (a higher one wins per hour):
// holiday > Sunday > Saturday > night > base — so a holiday that falls on a
// weekend is billed as a holiday, and a plain weekday night gets the night rate.
export const SURCHARGES = {
  saturday: 0.25, // Samstag +25 %
  sunday: 0.5, // Sonntag +50 %
  holiday: 1.0, // Feiertag +100 %
  night: 0.25, // Nacht +25 %
} as const;

export function rateFor(qual: string, rates: Rates = HOURLY_RATES): number {
  return rates[qual as Qualification] ?? 0;
}

// Effective surcharge fractions for one client — its overrides, else defaults.
export type Surcharges = { sat: number; sun: number; holiday: number; night: number };

export const DEFAULT_SURCHARGES: Surcharges = {
  sat: SURCHARGES.saturday,
  sun: SURCHARGES.sunday,
  holiday: SURCHARGES.holiday,
  night: SURCHARGES.night,
};

export function resolveSurcharges(
  o?: {
    surchargeSat?: number | null;
    surchargeSun?: number | null;
    surchargeHoliday?: number | null;
    surchargeNight?: number | null;
  } | null,
): Surcharges {
  return {
    sat: o?.surchargeSat ?? DEFAULT_SURCHARGES.sat,
    sun: o?.surchargeSun ?? DEFAULT_SURCHARGES.sun,
    holiday: o?.surchargeHoliday ?? DEFAULT_SURCHARGES.holiday,
    night: o?.surchargeNight ?? DEFAULT_SURCHARGES.night,
  };
}

// The window (HH:mm, overnight-aware) the night surcharge applies to.
export type NightWindow = { start: string; end: string };
export const DEFAULT_NIGHT_WINDOW: NightWindow = { start: "20:00", end: "06:00" };

export function resolveNightWindow(
  o?: { nightStart?: string | null; nightEnd?: string | null } | null,
): NightWindow {
  return {
    start: o?.nightStart || DEFAULT_NIGHT_WINDOW.start,
    end: o?.nightEnd || DEFAULT_NIGHT_WINDOW.end,
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

// The mutually-exclusive surcharge buckets one hour can fall into.
export type SurchargeCategory = "base" | "sat" | "sun" | "holiday" | "night";
export const SURCHARGE_CATEGORIES: SurchargeCategory[] = [
  "base",
  "sat",
  "sun",
  "holiday",
  "night",
];

// Rate multiplier for a category given a client's surcharges (1 = base rate).
export function categoryMultiplier(cat: SurchargeCategory, sc: Surcharges): number {
  switch (cat) {
    case "sat":
      return 1 + sc.sat;
    case "sun":
      return 1 + sc.sun;
    case "holiday":
      return 1 + sc.holiday;
    case "night":
      return 1 + sc.night;
    default:
      return 1;
  }
}

// Is a minute-of-day inside the (overnight-aware) night window?
function nightContains(min: number, w: { s: number; e: number }): boolean {
  if (w.s === w.e) return false; // empty window → no night hours
  return w.s < w.e ? min >= w.s && min < w.e : min >= w.s || min < w.e;
}

// Split one shift's NET hours across surcharge categories, minute by minute, so
// overnight shifts are billed correctly PER CALENDAR DAY: e.g. Sat 20:00–Sun
// 06:00 is Saturday hours until midnight and SUNDAY hours after midnight, and a
// plain weekday night gets the night surcharge. Priority per minute:
// holiday > Sunday > Saturday > night > base. The break is spread proportionally
// so the category hours always sum to netShiftHours(start, end, break).
export function shiftCategoryHours(
  shiftDate: string, // YYYY-MM-DD — the shift's START day (UTC)
  start: string,
  end: string,
  breakMin: number,
  isHoliday: (dateStr: string) => boolean,
  night: NightWindow = DEFAULT_NIGHT_WINDOW,
): Record<SurchargeCategory, number> {
  const out: Record<SurchargeCategory, number> = {
    base: 0,
    sat: 0,
    sun: 0,
    holiday: 0,
    night: 0,
  };
  const startMin = toMin(start);
  let dur = (toMin(end) - startMin + 1440) % 1440;
  if (dur === 0) dur = 1440;

  const w = { s: toMin(night.start), e: toMin(night.end) };
  // Per calendar-day metadata (weekday + holiday) for each day the shift touches.
  const baseDate = new Date(`${shiftDate}T00:00:00.000Z`);
  const maxOffset = Math.floor((startMin + dur - 1) / 1440);
  const dayMeta: { dow: number; holiday: boolean }[] = [];
  for (let o = 0; o <= maxOffset; o++) {
    const d = new Date(baseDate);
    d.setUTCDate(d.getUTCDate() + o);
    dayMeta.push({
      dow: d.getUTCDay(),
      holiday: isHoliday(d.toISOString().slice(0, 10)),
    });
  }

  const gross: Record<SurchargeCategory, number> = {
    base: 0,
    sat: 0,
    sun: 0,
    holiday: 0,
    night: 0,
  };
  for (let i = 0; i < dur; i++) {
    const abs = startMin + i;
    const meta = dayMeta[Math.floor(abs / 1440)];
    const mod = abs % 1440;
    let cat: SurchargeCategory;
    if (meta.holiday) cat = "holiday";
    else if (meta.dow === 0) cat = "sun";
    else if (meta.dow === 6) cat = "sat";
    else if (nightContains(mod, w)) cat = "night";
    else cat = "base";
    gross[cat] += 1;
  }

  const factor = dur > 0 ? Math.max(0, dur - breakMin) / dur : 0;
  for (const cat of SURCHARGE_CATEGORIES) out[cat] = (gross[cat] / 60) * factor;
  return out;
}

// Net order value (EUR) for a set of persisted shifts — mirrors the price the
// builder shows live: per-category net hours × headcount × qualification rate,
// each uplifted by its Zuschlag (Sat/Sun/holiday/night, computed per hour).
export function requestNetTotal(
  shifts: {
    shiftDate: Date;
    startTime: string;
    endTime: string;
    quantity: number;
    requiredQualification: string;
  }[],
  sc: Surcharges = DEFAULT_SURCHARGES,
  rates: Rates = DEFAULT_RATES,
  night: NightWindow = DEFAULT_NIGHT_WINDOW,
): number {
  const holidayCache = new Map<number, Map<string, string>>();
  const isHoliday = (dateStr: string) => {
    const year = Number(dateStr.slice(0, 4));
    let hol = holidayCache.get(year);
    if (!hol) {
      hol = germanHolidays(year);
      holidayCache.set(year, hol);
    }
    return hol.has(dateStr);
  };

  let total = 0;
  for (const s of shifts) {
    const date = s.shiftDate.toISOString().slice(0, 10);
    const cats = shiftCategoryHours(
      date,
      s.startTime,
      s.endTime,
      DEFAULT_BREAK_MIN,
      isHoliday,
      night,
    );
    const rate = rateFor(s.requiredQualification, rates);
    let perWorker = 0;
    for (const cat of SURCHARGE_CATEGORIES) {
      perWorker += cats[cat] * categoryMultiplier(cat, sc);
    }
    total += perWorker * s.quantity * rate;
  }
  return total;
}
