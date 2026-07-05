// Master schedule (Dienstplan) — pure grid logic, dependency-free so it can be
// unit-tested and imported from client components. The DB layer lives in
// lib/master-schedule.ts.
//
// The grid is the digital successor of the company's Excel sheet: one grid per
// qualification, one column per day, two lines per worker. Line 1 =
// availability as shift letters (F/S/N, all three = FSN); once the client has
// signed the Leistungsnachweis it flips to the ward number (or 0) on green.
// Line 2 = what was worked: shift letter + facility short code (e.g. FWB =
// Früh at Limbachstift Wachtberg).

// The three canonical shift windows (same presets as the availability builder
// and the order request builder).
export const SHIFT_PRESETS = {
  early: { letter: "F", start: "06:30", end: "14:00" },
  late: { letter: "S", start: "13:30", end: "21:00" },
  night: { letter: "N", start: "20:30", end: "07:00" },
} as const;

export type ShiftKey = keyof typeof SHIFT_PRESETS;
export const SHIFT_KEYS = ["early", "late", "night"] as const satisfies readonly ShiftKey[];

const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

// Classify an arbitrary shift start time into F/S/N. Orders keep free-form
// times, so the grid letter is derived from where the shift starts:
// mornings → F, midday/afternoon → S, evening/night → N.
export function shiftLetterForStart(startTime: string): "F" | "S" | "N" {
  const m = toMin(startTime);
  if (m >= toMin("04:00") && m < toMin("11:00")) return "F";
  if (m >= toMin("11:00") && m < toMin("17:30")) return "S";
  return "N";
}

// The preset windows themselves overlap by 30 min at the handovers
// (F ends 14:00, S starts 13:30; S ends 21:00, N starts 20:30) — so a block
// only counts against a window when it eats past that handover overlap.
const HANDOVER_MIN = 30;

// Same-day range overlap in minutes. The night window runs past midnight; for
// grid purposes it is clamped to its calendar day at 24:00 (mirrors the
// same-day comparison the matching engine uses).
const overlapsWindow = (
  blockStart: string,
  blockEnd: string,
  winStart: string,
  winEnd: string,
) => {
  const we = toMin(winEnd) <= toMin(winStart) ? 24 * 60 : toMin(winEnd);
  const be = toMin(blockEnd) <= toMin(blockStart) ? 24 * 60 : toMin(blockEnd);
  const overlap = Math.min(we, be) - Math.max(toMin(winStart), toMin(blockStart));
  return overlap > HANDOVER_MIN;
};

export type AvailBlockLite = {
  startTime: string | null; // null = whole day available
  endTime: string | null;
};

// Availability letters for one day from its POSITIVE availability blocks.
// Availability is opt-in: no declaration → "" (empty cell, not offered). A
// whole-day block → "FSN"; otherwise the letters of the declared windows.
export function availabilityLetters(blocks: AvailBlockLite[]): string {
  if (blocks.length === 0) return "";
  if (blocks.some((b) => b.startTime === null || b.endTime === null)) return "FSN";
  let letters = "";
  for (const key of SHIFT_KEYS) {
    const w = SHIFT_PRESETS[key];
    const declared = blocks.some(
      (b) =>
        b.startTime !== null &&
        b.endTime !== null &&
        overlapsWindow(b.startTime, b.endTime, w.start, w.end),
    );
    if (declared) letters += w.letter;
  }
  return letters;
}

// Letters (declared-available windows) → availability blocks to persist for
// that day. Empty selection → no rows (undeclared / not available); otherwise
// one row per available window.
export function lettersToBlocks(
  letters: string,
): { startTime: string | null; endTime: string | null }[] {
  const avail = new Set(letters.toUpperCase().split(""));
  return SHIFT_KEYS.filter((k) => avail.has(SHIFT_PRESETS[k].letter)).map((k) => ({
    startTime: SHIFT_PRESETS[k].start,
    endTime: SHIFT_PRESETS[k].end,
  }));
}

// Suggested Kürzel from a facility name: the first letter of each word
// (e.g. "Newcare Home" → "NH", "Haus am Stadtwald" → "HAS"), capped at 3,
// uppercased. Single-word names fall back to their first two letters.
export function suggestShortCode(facilityName: string): string {
  const words = facilityName
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9äöüß]/gi, ""))
    .filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words
    .map((w) => w[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

// Fallback grid code for facilities the admin has not given a Kürzel yet:
// derived from the name (first letter of each word).
export function facilityCode(shortCode: string | null, facilityName: string): string {
  if (shortCode) return shortCode.toUpperCase();
  return suggestShortCode(facilityName) || "??";
}

export type GridJob = {
  assignmentId: string;
  orderId: string;
  letter: "F" | "S" | "N";
  code: string;
  facilityName: string;
  startTime: string;
  endTime: string;
  ward: string | null; // Wohnbereich/Station from Order.notes
  status: "pending" | "confirmed";
  clientConfirmed: boolean; // Leistungsnachweis signed
  cancelRequested: boolean; // worker asked to be taken off (awaiting admin)
  cancelNote: string | null;
};

export type GridDay = {
  avail: string; // "FSN" … "" (fully unavailable)
  hasBlocks: boolean; // any explicit unavailability saved for the day
  jobs: GridJob[];
  leave?: {
    status: "pending" | "approved" | "rejected";
    hours: number;
  };
};

export type GridWorkerRow = {
  workerId: string;
  name: string;
  requiredHours: number;
  // Signed hours-account balance carried from earlier months (see Worker model).
  carryoverHours: number;
  confirmedHours: number;
  days: GridDay[]; // index = day-1
};

export type GridFacility = {
  clientId: string;
  code: string;
  name: string;
  hasCode: boolean; // false = derived fallback, admin should set one
};

// A requested shift that still needs a worker (open headcount) — the grey
// "not yet dispatched" section at the bottom of the sheet.
export type UnassignedShift = {
  orderId: string;
  day: number; // 1-based day of month
  letter: "F" | "S" | "N";
  code: string;
  facilityName: string;
  startTime: string;
  endTime: string;
  ward: string | null;
  remaining: number; // still-open headcount (quantity − non-declined assignments)
};

// Arrange the open shifts into as few grid rows as possible: for each day the
// n-th open shift goes on row n. Result[row][day-1] is the cell (or null).
export function layoutUnassigned(
  shifts: UnassignedShift[],
  daysInMonth: number,
): (UnassignedShift | null)[][] {
  const byDay = new Map<number, UnassignedShift[]>();
  for (const s of shifts) {
    const list = byDay.get(s.day) ?? [];
    list.push(s);
    byDay.set(s.day, list);
  }
  byDay.forEach((list) => list.sort((a, b) => a.startTime.localeCompare(b.startTime)));
  const rowCount = Math.max(0, ...Array.from(byDay.values(), (l) => l.length));
  const rows: (UnassignedShift | null)[][] = [];
  for (let r = 0; r < rowCount; r++) {
    rows.push(
      Array.from({ length: daysInMonth }, (_, i) => byDay.get(i + 1)?.[r] ?? null),
    );
  }
  return rows;
}

// What a day cell shows on each of its two lines (shared by grid, CSV, PDF).
// Line 1: ward number (or 0) once the client signed, otherwise the letters.
export function availCellText(cell: GridDay): { text: string; confirmed: boolean } {
  const confirmedJob = cell.jobs.find((j) => j.clientConfirmed);
  if (confirmedJob) return { text: confirmedJob.ward || "0", confirmed: true };
  return { text: cell.avail, confirmed: false };
}
// Line 2: one shift-letter + facility-code token per deployment.
export function workCellText(cell: GridDay): string {
  return cell.jobs.map((j) => `${j.letter}${j.code}`).join(" ");
}

function csvCell(value: string): string {
  return /[";\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// Excel-friendly CSV mirror of the grid (BOM + semicolons, like the other
// exports): two lines per worker — availability/confirmed ward, then worked
// codes — and the facility legend below. German labels: business export.
export function masterScheduleCsv(
  rows: GridWorkerRow[],
  facilities: GridFacility[],
  daysInMonth: number,
): string {
  const header = ["Name", ...Array.from({ length: daysInMonth }, (_, i) => `${String(i + 1).padStart(2, "0")}.`)];
  const lines = [header.join(";")];
  for (const r of rows) {
    lines.push(
      [r.name, ...r.days.map((d) => availCellText(d).text)].map(csvCell).join(";"),
    );
    lines.push(["", ...r.days.map((d) => workCellText(d))].map(csvCell).join(";"));
  }
  lines.push("");
  lines.push("Legende");
  for (const f of facilities) {
    lines.push([f.code, f.name].map(csvCell).join(";"));
  }
  return "﻿" + lines.join("\r\n");
}
