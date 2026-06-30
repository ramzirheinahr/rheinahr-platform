// German public holidays (Nordrhein-Westfalen — company HQ is Bonn/NRW).
// Pure date math (no external API). Returns a Map of "YYYY-MM-DD" → holiday name.

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function iso(y: number, m: number, d: number) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

// Anonymous Gregorian algorithm (Meeus/Jones/Butcher) → Easter Sunday.
function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

function addDays(y: number, m: number, d: number, days: number): string {
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// NRW public holidays for a given year.
export function germanHolidays(year: number): Map<string, string> {
  const easter = easterSunday(year);
  const e = (offset: number) => addDays(year, easter.month, easter.day, offset);

  const days: Record<string, string> = {
    [iso(year, 1, 1)]: "Neujahr",
    [e(-2)]: "Karfreitag",
    [e(1)]: "Ostermontag",
    [iso(year, 5, 1)]: "Tag der Arbeit",
    [e(39)]: "Christi Himmelfahrt",
    [e(50)]: "Pfingstmontag",
    [e(60)]: "Fronleichnam",
    [iso(year, 10, 3)]: "Tag der Deutschen Einheit",
    [iso(year, 11, 1)]: "Allerheiligen",
    [iso(year, 12, 25)]: "1. Weihnachtstag",
    [iso(year, 12, 26)]: "2. Weihnachtstag",
  };
  return new Map(Object.entries(days));
}
