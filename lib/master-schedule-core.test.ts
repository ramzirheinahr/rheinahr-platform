import { describe, it, expect } from "vitest";
import {
  availabilityLetters,
  lettersToBlocks,
  shiftLetterForStart,
  facilityCode,
  availCellText,
  workCellText,
  masterScheduleCsv,
  SHIFT_PRESETS,
  type GridDay,
  type GridJob,
} from "./master-schedule-core";

const job = (over: Partial<GridJob>): GridJob => ({
  assignmentId: "a",
  orderId: "o",
  letter: "F",
  code: "WB",
  facilityName: "Limbachstift Wachtberg",
  startTime: "06:30",
  endTime: "14:00",
  ward: null,
  status: "confirmed",
  clientConfirmed: false,
  ...over,
});

describe("shiftLetterForStart", () => {
  it("maps the three preset starts to their letters", () => {
    expect(shiftLetterForStart(SHIFT_PRESETS.early.start)).toBe("F");
    expect(shiftLetterForStart(SHIFT_PRESETS.late.start)).toBe("S");
    expect(shiftLetterForStart(SHIFT_PRESETS.night.start)).toBe("N");
  });

  it("classifies free-form times by their start", () => {
    expect(shiftLetterForStart("07:15")).toBe("F");
    expect(shiftLetterForStart("12:00")).toBe("S");
    expect(shiftLetterForStart("22:00")).toBe("N");
    expect(shiftLetterForStart("00:30")).toBe("N");
  });
});

describe("availabilityLetters", () => {
  it("no blocks → fully available (FSN)", () => {
    expect(availabilityLetters([])).toBe("FSN");
  });

  it("whole-day block → empty", () => {
    expect(availabilityLetters([{ startTime: null, endTime: null }])).toBe("");
  });

  it("an early-shift block removes only F", () => {
    expect(availabilityLetters([{ startTime: "06:30", endTime: "14:00" }])).toBe("SN");
  });

  it("a block spanning early+late removes F and S", () => {
    expect(availabilityLetters([{ startTime: "08:00", endTime: "18:00" }])).toBe("N");
  });

  it("multiple blocks accumulate", () => {
    expect(
      availabilityLetters([
        { startTime: "06:30", endTime: "14:00" },
        { startTime: "20:30", endTime: "07:00" },
      ]),
    ).toBe("S");
  });
});

describe("lettersToBlocks", () => {
  it("round-trips with availabilityLetters", () => {
    for (const letters of ["FSN", "FS", "FN", "SN", "F", "S", "N", ""]) {
      expect(availabilityLetters(lettersToBlocks(letters))).toBe(letters);
    }
  });

  it("all available → no blocks; none → whole-day block", () => {
    expect(lettersToBlocks("FSN")).toEqual([]);
    expect(lettersToBlocks("")).toEqual([{ startTime: null, endTime: null }]);
  });
});

describe("facilityCode", () => {
  it("prefers the admin-assigned code, uppercased", () => {
    expect(facilityCode("wb", "Limbachstift Wachtberg")).toBe("WB");
  });
  it("derives a fallback from the name", () => {
    expect(facilityCode(null, "St. Elisabeth Alfter")).toBe("ST");
  });
});

describe("cell text", () => {
  it("shows availability letters until the client confirms", () => {
    const cell: GridDay = { avail: "FS", hasBlocks: true, jobs: [job({})] };
    expect(availCellText(cell)).toEqual({ text: "FS", confirmed: false });
  });

  it("flips to the ward number (0 when unset) once confirmed", () => {
    const noWard: GridDay = {
      avail: "FSN",
      hasBlocks: false,
      jobs: [job({ clientConfirmed: true })],
    };
    expect(availCellText(noWard)).toEqual({ text: "0", confirmed: true });

    const withWard: GridDay = {
      avail: "FSN",
      hasBlocks: false,
      jobs: [job({ clientConfirmed: true, ward: "3" })],
    };
    expect(availCellText(withWard)).toEqual({ text: "3", confirmed: true });
  });

  it("renders worked shifts as letter+code tokens", () => {
    const cell: GridDay = {
      avail: "FSN",
      hasBlocks: false,
      jobs: [job({}), job({ assignmentId: "b", letter: "S", code: "PS" })],
    };
    expect(workCellText(cell)).toBe("FWB SPS");
  });
});

describe("masterScheduleCsv", () => {
  it("emits two lines per worker plus the legend", () => {
    const rows = [
      {
        workerId: "w1",
        name: "Akayezu, Diane",
        days: [
          { avail: "FSN", hasBlocks: false, jobs: [] },
          { avail: "F", hasBlocks: true, jobs: [job({})] },
        ] as GridDay[],
      },
    ];
    const facilities = [
      { clientId: "c1", code: "WB", name: "Limbachstift Wachtberg", hasCode: true },
    ];
    const csv = masterScheduleCsv(rows, facilities, 2);
    const lines = csv.replace("﻿", "").split("\r\n");
    expect(lines[0]).toBe("Name;01.;02.");
    expect(lines[1]).toBe("Akayezu, Diane;FSN;F");
    expect(lines[2]).toBe(";;FWB");
    expect(lines).toContain("Legende");
    expect(lines).toContain("WB;Limbachstift Wachtberg");
  });
});
