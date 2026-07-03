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

export type UnavailBlockLite = {
  startTime: string | null; // null = whole day
  endTime: string | null;
};

// Availability letters for one day from its unavailability blocks. No blocks
// → "FSN" (fully available, the sheet's old "0"); a whole-day block → "";
// otherwise the letters of the windows no block touches.
export function availabilityLetters(blocks: UnavailBlockLite[]): string {
  if (blocks.some((b) => b.startTime === null || b.endTime === null)) return "";
  let letters = "";
  for (const key of SHIFT_KEYS) {
    const w = SHIFT_PRESETS[key];
    const blocked = blocks.some(
      (b) =>
        b.startTime !== null &&
        b.endTime !== null &&
        overlapsWindow(b.startTime, b.endTime, w.start, w.end),
    );
    if (!blocked) letters += w.letter;
  }
  return letters;
}

// Letters (available windows) → unavailability blocks to persist for that day.
// All available → no rows; none → one whole-day row; else one row per blocked window.
export function lettersToBlocks(
  letters: string,
): { startTime: string | null; endTime: string | null }[] {
  const avail = new Set(letters.toUpperCase().split(""));
  const blocked = SHIFT_KEYS.filter((k) => !avail.has(SHIFT_PRESETS[k].letter));
  if (blocked.length === 0) return [];
  if (blocked.length === SHIFT_KEYS.length) return [{ startTime: null, endTime: null }];
  return blocked.map((k) => ({
    startTime: SHIFT_PRESETS[k].start,
    endTime: SHIFT_PRESETS[k].end,
  }));
}

// Fallback grid code for facilities the admin has not given a Kürzel yet:
// first two letters of the facility name, uppercased.
export function facilityCode(shortCode: string | null, facilityName: string): string {
  if (shortCode) return shortCode.toUpperCase();
  return (
    facilityName.replace(/[^a-z0-9äöüß]/gi, "").slice(0, 2).toUpperCase() || "??"
  );
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
};

export type GridDay = {
  avail: string; // "FSN" … "" (fully unavailable)
  hasBlocks: boolean; // any explicit unavailability saved for the day
  jobs: GridJob[];
};

export type GridWorkerRow = {
  workerId: string;
  name: string;
  days: GridDay[]; // index = day-1
};

export type GridFacility = {
  clientId: string;
  code: string;
  name: string;
  hasCode: boolean; // false = derived fallback, admin should set one
};

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
