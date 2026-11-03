import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    worker: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    assignment: {
      findMany: vi.fn(),
    },
    leaveDay: {
      findMany: vi.fn(),
    },
    workerHoursAdjustment: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import { getWorkerHoursAccount, getMultipleWorkersHoursAccount } from "./hours-account";

describe("hours-account - current month asOfDate filtering", () => {
  const mockWorker = {
    id: "w-1",
    fullName: "Samara, Nail",
    internalNumber: "233",
    requiredHours: 151.67,
    carryoverHours: 0,
    employmentStartDate: new Date("2026-07-01T00:00:00Z"),
    employedSince: null,
    employmentEndDate: null,
    createdAt: new Date("2026-07-01T00:00:00Z"),
    sollHoursHistory: [],
    monthlySalary: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("counts only shifts up to asOfDate in the current month while past months count in full", async () => {
    (prisma.worker.findUnique as any).mockResolvedValue(mockWorker);
    (prisma.leaveDay.findMany as any).mockResolvedValue([]);
    (prisma.workerHoursAdjustment.findMany as any).mockResolvedValue([]);

    const mockAssignments = [
      // September shift (past month)
      {
        workerId: "w-1",
        bonusHours: 0,
        order: {
          shiftDate: new Date("2026-09-10T00:00:00Z"),
          startTime: "07:00",
          endTime: "15:00",
          breakMinutes: 30, // 7.5 hrs
        },
        serviceConfirmation: { hoursWorked: 7.5 },
        hoursCorrections: [],
      },
      // October shift 1: on Oct 05 (before asOfDate Oct 15) -> SHOULD be counted
      {
        workerId: "w-1",
        bonusHours: 0,
        order: {
          shiftDate: new Date("2026-10-05T00:00:00Z"),
          startTime: "06:00",
          endTime: "14:00",
          breakMinutes: 30, // 7.5 hrs
        },
        serviceConfirmation: { hoursWorked: 7.5 },
        hoursCorrections: [],
      },
      // October shift 2: on Oct 15 (on asOfDate Oct 15) -> SHOULD be counted
      {
        workerId: "w-1",
        bonusHours: 0,
        order: {
          shiftDate: new Date("2026-10-15T00:00:00Z"),
          startTime: "06:00",
          endTime: "14:00",
          breakMinutes: 30, // 7.5 hrs
        },
        serviceConfirmation: null,
        hoursCorrections: [],
      },
      // October shift 3: on Oct 25 (after asOfDate Oct 15) -> SHOULD NOT be counted yet!
      {
        workerId: "w-1",
        bonusHours: 0,
        order: {
          shiftDate: new Date("2026-10-25T00:00:00Z"),
          startTime: "06:00",
          endTime: "14:00",
          breakMinutes: 30, // 7.5 hrs
        },
        serviceConfirmation: null,
        hoursCorrections: [],
      },
    ];

    (prisma.assignment.findMany as any).mockResolvedValue(mockAssignments);

    // Call as of 2026-10-15
    const res = await getWorkerHoursAccount("w-1", "2026-09", "2026-10", "2026-10-15");

    const sep = res.months.find((m) => m.month === "2026-09");
    expect(sep).toBeDefined();
    expect(sep?.workedHours).toBe(7.5);

    const oct = res.months.find((m) => m.month === "2026-10");
    expect(oct).toBeDefined();
    // Oct 5 (7.5h) + Oct 15 (7.5h) = 15.0h. Oct 25 (7.5h) is excluded!
    expect(oct?.workedHours).toBe(15.0);
  });

  it("applies the same asOfDate logic in getMultipleWorkersHoursAccount", async () => {
    (prisma.worker.findMany as any).mockResolvedValue([mockWorker]);
    (prisma.leaveDay.findMany as any).mockResolvedValue([]);
    (prisma.workerHoursAdjustment.findMany as any).mockResolvedValue([]);

    const mockAssignments = [
      {
        workerId: "w-1",
        bonusHours: 0,
        order: {
          shiftDate: new Date("2026-10-10T00:00:00Z"),
          startTime: "07:00",
          endTime: "15:00",
          breakMinutes: 30,
        },
        serviceConfirmation: { hoursWorked: 7.5 },
        hoursCorrections: [],
      },
      {
        workerId: "w-1",
        bonusHours: 0,
        order: {
          shiftDate: new Date("2026-10-20T00:00:00Z"), // future shift
          startTime: "07:00",
          endTime: "15:00",
          breakMinutes: 30,
        },
        serviceConfirmation: null,
        hoursCorrections: [],
      },
    ];

    (prisma.assignment.findMany as any).mockResolvedValue(mockAssignments);

    const res = await getMultipleWorkersHoursAccount(["w-1"], "2026-10", "2026-10", "2026-10-15");
    const workerAcc = res["w-1"];
    expect(workerAcc).toBeDefined();
    expect(workerAcc.months[0].workedHours).toBe(7.5); // Only Oct 10, not Oct 20
  });

  it("accurately accounts for DST transition night shift (+1 hour in October)", async () => {
    (prisma.worker.findUnique as any).mockResolvedValue(mockWorker);
    (prisma.leaveDay.findMany as any).mockResolvedValue([]);
    (prisma.workerHoursAdjustment.findMany as any).mockResolvedValue([]);

    const mockAssignments = [
      {
        workerId: "w-1",
        bonusHours: 0,
        order: {
          shiftDate: new Date("2026-10-24T00:00:00Z"),
          startTime: "20:45",
          endTime: "06:45",
          breakMinutes: 45,
        },
        serviceConfirmation: null,
        hoursCorrections: [],
      },
    ];

    (prisma.assignment.findMany as any).mockResolvedValue(mockAssignments);

    const res = await getWorkerHoursAccount("w-1", "2026-10", "2026-10", "2026-10-31");
    const oct = res.months.find((m) => m.month === "2026-10");
    expect(oct).toBeDefined();
    // 20:45 to 06:45 normally 10h - 45m = 9.25h.
    // On 2026-10-24 to 2026-10-25 DST transition: 11h - 45m = 10.25h.
    expect(oct?.workedHours).toBe(10.25);
  });
});
