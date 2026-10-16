import { getGermanHolidaysForYear, isValidGregorianCalendarDate, type HolidayRecord } from "./german-holidays";

/** Contractual invoice calendar. It does not assert statutory holiday status. */
export type BillingHoliday = {
  date: string;
  name: string;
  start: string;
  end: string;
  active: boolean;
};

export type BillingHolidayCalendar = { version: 1; years: Record<string, BillingHoliday[]> };

const timeMinutes = (value: string): number => {
  if (value === "24:00") return 1440;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return -1;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
};

export function defaultBillingHolidays(year: number): BillingHoliday[] {
  const statutory = [...getGermanHolidaysForYear({ year, federalState: "NW" }).values()]
    .map((item) => ({ date: item.date, name: item.name, start: "00:00", end: "24:00", active: true }));
  return [
    ...statutory,
    { date: `${year}-12-24`, name: "Heiligabend (nach Vereinbarung)", start: "00:00", end: "24:00", active: false },
    { date: `${year}-12-31`, name: "Silvester (nach Vereinbarung)", start: "00:00", end: "24:00", active: false },
  ].sort((a, b) => a.date.localeCompare(b.date));
}

export function parseBillingHolidayCalendar(value: unknown): BillingHolidayCalendar {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { version: 1, years: {} };
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1 || !candidate.years || typeof candidate.years !== "object" || Array.isArray(candidate.years)) {
    return { version: 1, years: {} };
  }
  const years: Record<string, BillingHoliday[]> = {};
  for (const [year, rows] of Object.entries(candidate.years)) {
    if (!/^\d{4}$/.test(year) || !Array.isArray(rows)) continue;
    try { years[year] = validateBillingHolidays(Number(year), rows); } catch { /* invalid legacy data is never billed */ }
  }
  return { version: 1, years };
}

export function validateBillingHolidays(year: number, input: unknown): BillingHoliday[] {
  if (!Number.isInteger(year) || year < 2020 || year > 2200 || !Array.isArray(input) || input.length > 100) {
    throw new Error("Ungültiges Jahr oder zu viele Feiertagszeilen.");
  }
  const rows: BillingHoliday[] = [];
  const spans = new Map<string, Array<[number, number]>>();
  for (const raw of input) {
    if (!raw || typeof raw !== "object") throw new Error("Ungültiger Feiertagseintrag.");
    const row = raw as Record<string, unknown>;
    const { date, name, start, end, active } = row;
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number(date.slice(0, 4)) !== year) {
      throw new Error("Das Datum muss im gewählten Jahr liegen.");
    }
    const [, month, day] = date.split("-").map(Number);
    if (!isValidGregorianCalendarDate(year, month, day)) throw new Error(`Ungültiges Datum: ${date}`);
    if (typeof name !== "string" || !name.trim() || name.length > 120 || typeof start !== "string" || typeof end !== "string" || typeof active !== "boolean") {
      throw new Error(`Ungültige Angaben für ${date}.`);
    }
    const from = timeMinutes(start);
    const to = timeMinutes(end);
    if (from < 0 || from >= 1440 || to <= from || to > 1440) throw new Error(`Ungültige Uhrzeit für ${date}.`);
    if (active) {
      const existing = spans.get(date) ?? [];
      if (existing.some(([a, b]) => from < b && a < to)) throw new Error(`Überlappende Feiertagszeiten am ${date}.`);
      existing.push([from, to]);
      spans.set(date, existing);
    }
    rows.push({ date, name: name.trim(), start, end, active });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
}

export function billingHolidaysForYear(calendar: BillingHolidayCalendar, year: number): BillingHoliday[] {
  return calendar.years[String(year)] ?? defaultBillingHolidays(year);
}

export function billingHolidayAtMinute(rows: BillingHoliday[], date: string, minute: number): BillingHoliday | null {
  return rows.find((row) => row.active && row.date === date && minute >= timeMinutes(row.start) && minute < timeMinutes(row.end)) ?? null;
}

export function billingHolidayRecord(row: BillingHoliday): HolidayRecord {
  return { date: row.date, name: row.name, federalState: "NW", legalBasis: "Kundenspezifische Feiertagsregelung für Rechnungen", isNationwide: false };
}
