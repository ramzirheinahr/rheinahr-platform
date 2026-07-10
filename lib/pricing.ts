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

// Fallback break (minutes) for callers without a persisted per-shift break
// (orders store their own `breakMinutes` since 2026-07).
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

// The individual surcharges that can apply to one hour. They are NOT mutually
// exclusive: when several coincide, their percentages are SUMMED (agency ↔ client
// agreement) — e.g. a public holiday on a Sunday = Sunday + holiday, and a
// Sunday-night hour = Sunday + night. (Saturday and Sunday can't both apply since
// an hour belongs to a single calendar day.)
export type SurchargeComponent = "sat" | "sun" | "holiday" | "night";
// Display order when several coincide.
export const SURCHARGE_COMPONENTS: SurchargeComponent[] = ["holiday", "sun", "sat", "night"];

function surchargeValue(c: SurchargeComponent, sc: Surcharges): number {
  switch (c) {
    case "sat":
      return sc.sat;
    case "sun":
      return sc.sun;
    case "holiday":
      return sc.holiday;
    case "night":
      return sc.night;
  }
}

// Combined multiplier for a set of coinciding surcharges (1 = base rate). The
// component fractions are ADDED, e.g. holiday(1.0) + sun(0.5) → ×2.5.
export function comboMultiplier(components: SurchargeComponent[], sc: Surcharges): number {
  return 1 + components.reduce((sum, c) => sum + surchargeValue(c, sc), 0);
}

// Stable key for a set of surcharges ("base" when none apply).
export function comboKey(components: SurchargeComponent[]): string {
  return components.length ? components.join("+") : "base";
}

// Is a minute-of-day inside the (overnight-aware) night window?
function nightContains(min: number, w: { s: number; e: number }): boolean {
  if (w.s === w.e) return false; // empty window → no night hours
  return w.s < w.e ? min >= w.s && min < w.e : min >= w.s || min < w.e;
}

export type SurchargeGroup = { components: SurchargeComponent[]; hours: number };

// Split one shift's NET hours by the SET of surcharges that apply, minute by
// minute. Overnight shifts are handled PER CALENDAR DAY (Sat 20:00–Sun 06:00 →
// Saturday hours until midnight, Sunday hours after), and coinciding surcharges
// are grouped together so they can be summed. The break is spread proportionally
// so the grouped hours sum to netShiftHours(start, end, break). Keyed by comboKey.
export function shiftSurchargeHours(
  shiftDate: string, // YYYY-MM-DD — the shift's START day (UTC)
  start: string,
  end: string,
  breakMin: number,
  isHoliday: (dateStr: string) => boolean,
  night: NightWindow = DEFAULT_NIGHT_WINDOW,
): Map<string, SurchargeGroup> {
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

  // Gross minutes per surcharge combination.
  const grossByKey = new Map<string, { components: SurchargeComponent[]; minutes: number }>();
  for (let i = 0; i < dur; i++) {
    const abs = startMin + i;
    const meta = dayMeta[Math.floor(abs / 1440)];
    const mod = abs % 1440;
    const components: SurchargeComponent[] = [];
    if (meta.holiday) components.push("holiday");
    if (meta.dow === 0) components.push("sun");
    else if (meta.dow === 6) components.push("sat");
    if (nightContains(mod, w)) components.push("night");
    const key = comboKey(components);
    const entry = grossByKey.get(key);
    if (entry) entry.minutes += 1;
    else grossByKey.set(key, { components, minutes: 1 });
  }

  const factor = dur > 0 ? Math.max(0, dur - breakMin) / dur : 0;
  const out = new Map<string, SurchargeGroup>();
  for (const [key, v] of grossByKey) {
    out.set(key, { components: v.components, hours: (v.minutes / 60) * factor });
  }
  return out;
}

// Net order value (EUR) for a set of persisted shifts — mirrors the price the
// builder shows live: per-hour net hours × headcount × qualification rate,
// uplifted by the SUM of that hour's coinciding Zuschläge (Sat/Sun/holiday/night).
export function requestNetTotal(
  shifts: {
    shiftDate: Date;
    startTime: string;
    endTime: string;
    breakMinutes?: number;
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
    const groups = shiftSurchargeHours(
      date,
      s.startTime,
      s.endTime,
      s.breakMinutes ?? DEFAULT_BREAK_MIN,
      isHoliday,
      night,
    );
    const rate = rateFor(s.requiredQualification, rates);
    let perWorker = 0;
    for (const g of groups.values()) {
      perWorker += g.hours * comboMultiplier(g.components, sc);
    }
    total += perWorker * s.quantity * rate;
  }
  return total;
}
