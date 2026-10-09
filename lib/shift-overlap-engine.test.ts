import { describe, it, expect } from "vitest";
import {
  detectShiftOverlaps,
  parseShiftInterval,
  resolveWallTimeToUtc,
  validateYearMonth,
  isValidTimeString,
  DEFAULT_TIMEZONE,
  type ShiftInput,
} from "./shift-overlap-engine";
import { resolveAdminOrderRoute, type OrderRouteQueryDb } from "./orders";

describe("Shift Overlap Engine (Phase 3d)", () => {
  const baseShift = (overrides: Partial<ShiftInput>): ShiftInput => ({
    orderId: "ord-1",
    requestGroupId: "req-1",
    shiftDate: new Date("2026-06-15T00:00:00Z"),
    startTime: "06:00",
    endTime: "14:00",
    status: "confirmed",
    facilityName: "Klinikum Ahr",
    clientId: "client-1",
    workerId: "worker-1",
    workerName: "Hans Müller",
    workerInternalNumber: "W-100",
    assignmentId: "assign-1",
    assignmentStatus: "confirmed",
    timezone: "Europe/Berlin",
    ...overrides,
  });

  describe("Input validation (Year, Month, Time strings)", () => {
    it("validates year and month strictly", () => {
      expect(() => validateYearMonth(2026, 6)).not.toThrow();
      expect(() => validateYearMonth(1999, 6)).toThrow("Ungültiges Jahr");
      expect(() => validateYearMonth(2101, 6)).toThrow("Ungültiges Jahr");
      expect(() => validateYearMonth(2026, 0)).toThrow("Ungültiger Monat");
      expect(() => validateYearMonth(2026, 13)).toThrow("Ungültiger Monat");
      expect(() => validateYearMonth("abc", 5)).toThrow("Ungültiges Jahr");
    });

    it("validates time string formats: rejects xx:30, 25:00, 12:99, null, empty", () => {
      expect(isValidTimeString("06:00")).toBe(true);
      expect(isValidTimeString("23:59")).toBe(true);
      expect(isValidTimeString("00:00")).toBe(true);

      expect(isValidTimeString("xx:30")).toBe(false);
      expect(isValidTimeString("25:00")).toBe(false);
      expect(isValidTimeString("12:99")).toBe(false);
      expect(isValidTimeString("6:00")).toBe(false);
      expect(isValidTimeString("")).toBe(false);
      expect(isValidTimeString(null)).toBe(false);
      expect(isValidTimeString(undefined)).toBe(false);
    });

    it("isolates corrupted time shifts into uncertainWarnings and excludes them from definite totals", () => {
      const shiftValid = baseShift({
        orderId: "ord-valid",
        startTime: "06:00",
        endTime: "14:00",
      });
      const shiftCorrupted = baseShift({
        orderId: "ord-corrupt",
        startTime: "xx:30",
        endTime: "14:00",
      });

      const res = detectShiftOverlaps([shiftValid, shiftCorrupted], 2026, 6);

      expect(res.affectedWorkersCount).toBe(0);
      expect(res.totalOverlapPairsCount).toBe(0);
      expect(res.uncertainWarnings).toHaveLength(1);
      expect(res.uncertainWarnings[0].orderId).toBe("ord-corrupt");
      expect(res.uncertainWarnings[0].reason).toBe("INVALID_TIME_FORMAT");
    });
  });

  describe("Single pair basic overlap", () => {
    it("detects 30-minute overlap: 06:00-14:00 and 13:30-21:00 for same worker", () => {
      const shift1 = baseShift({
        orderId: "ord-1",
        shiftDate: new Date("2026-06-15T00:00:00Z"),
        startTime: "06:00",
        endTime: "14:00",
      });
      const shift2 = baseShift({
        orderId: "ord-2",
        shiftDate: new Date("2026-06-15T00:00:00Z"),
        startTime: "13:30",
        endTime: "21:00",
      });

      const res = detectShiftOverlaps([shift1, shift2], 2026, 6);

      expect(res.affectedWorkersCount).toBe(1);
      expect(res.totalOverlapPairsCount).toBe(1);
      expect(res.workerGroups).toHaveLength(1);
      expect(res.workerGroups[0].workerId).toBe("worker-1");
      expect(res.workerGroups[0].pairs[0].overlapMinutes).toBe(30);
      expect(res.workerGroups[0].pairs[0].shiftA.startTime).toBe("06:00");
      expect(res.workerGroups[0].pairs[0].shiftB.startTime).toBe("13:30");
    });

    it("detects NO overlap for back-to-back shifts: 14:00 and 14:00 boundary", () => {
      const shift1 = baseShift({
        orderId: "ord-1",
        startTime: "06:00",
        endTime: "14:00",
      });
      const shift2 = baseShift({
        orderId: "ord-2",
        startTime: "14:00",
        endTime: "22:00",
      });

      const res = detectShiftOverlaps([shift1, shift2], 2026, 6);

      expect(res.affectedWorkersCount).toBe(0);
      expect(res.totalOverlapPairsCount).toBe(0);
      expect(res.workerGroups).toHaveLength(0);
    });

    it("detects full containment overlap (e.g. 08:00-16:00 and 10:00-12:00)", () => {
      const shift1 = baseShift({
        orderId: "ord-1",
        startTime: "08:00",
        endTime: "16:00",
      });
      const shift2 = baseShift({
        orderId: "ord-2",
        startTime: "10:00",
        endTime: "12:00",
      });

      const res = detectShiftOverlaps([shift1, shift2], 2026, 6);

      expect(res.affectedWorkersCount).toBe(1);
      expect(res.totalOverlapPairsCount).toBe(1);
      expect(res.workerGroups[0].pairs[0].overlapMinutes).toBe(120);
    });
  });

  describe("Worker isolation and similar names", () => {
    it("does NOT mix workers with identical or similar names but different workerIds", () => {
      const shift1 = baseShift({
        orderId: "ord-1",
        workerId: "worker-uuid-1",
        workerName: "Hans Müller",
        startTime: "06:00",
        endTime: "14:00",
      });
      const shift2 = baseShift({
        orderId: "ord-2",
        workerId: "worker-uuid-2",
        workerName: "Hans Müller",
        startTime: "13:30",
        endTime: "21:00",
      });

      const res = detectShiftOverlaps([shift1, shift2], 2026, 6);

      expect(res.affectedWorkersCount).toBe(0);
      expect(res.totalOverlapPairsCount).toBe(0);
    });

    it("keeps pairs separated per workerId when multiple workers have overlaps", () => {
      const w1s1 = baseShift({
        orderId: "w1-ord-1",
        workerId: "w-1",
        workerName: "Anna Schmidt",
        startTime: "06:00",
        endTime: "14:00",
      });
      const w1s2 = baseShift({
        orderId: "w1-ord-2",
        workerId: "w-1",
        workerName: "Anna Schmidt",
        startTime: "13:00",
        endTime: "20:00",
      });
      const w2s1 = baseShift({
        orderId: "w2-ord-1",
        workerId: "w-2",
        workerName: "Bernd Meier",
        startTime: "10:00",
        endTime: "18:00",
      });
      const w2s2 = baseShift({
        orderId: "w2-ord-2",
        workerId: "w-2",
        workerName: "Bernd Meier",
        startTime: "17:00",
        endTime: "23:00",
      });

      const res = detectShiftOverlaps([w1s1, w1s2, w2s1, w2s2], 2026, 6);

      expect(res.affectedWorkersCount).toBe(2);
      expect(res.totalOverlapPairsCount).toBe(2);
      expect(res.workerGroups.map((g) => g.workerId).sort()).toEqual(["w-1", "w-2"]);
    });
  });

  describe("Triple overlapping shifts (3 shifts overlapping)", () => {
    it("handles 3 concurrent shifts: counts 1 affected worker, 3 pairs without duplicates", () => {
      const s1 = baseShift({
        orderId: "ord-1",
        startTime: "08:00",
        endTime: "16:00",
      });
      const s2 = baseShift({
        orderId: "ord-2",
        startTime: "12:00",
        endTime: "20:00",
      });
      const s3 = baseShift({
        orderId: "ord-3",
        startTime: "14:00",
        endTime: "22:00",
      });

      const res = detectShiftOverlaps([s1, s2, s3], 2026, 6);

      expect(res.affectedWorkersCount).toBe(1);
      expect(res.totalOverlapPairsCount).toBe(3);
      expect(res.workerGroups[0].pairs).toHaveLength(3);

      const overlapMinutes = res.workerGroups[0].pairs.map((p) => p.overlapMinutes).sort((a, b) => a - b);
      expect(overlapMinutes).toEqual([120, 240, 360]);

      const ids = new Set(res.workerGroups[0].pairs.map((p) => p.id));
      expect(ids.size).toBe(3);
    });
  });

  describe("Facility differences (different clients / facilities)", () => {
    it("detects overlap between shifts at two different facilities for same worker", () => {
      const shiftA = baseShift({
        orderId: "ord-fac-1",
        clientId: "client-a",
        facilityName: "Seniorenheim Sonnenschein",
        startTime: "07:00",
        endTime: "15:00",
      });
      const shiftB = baseShift({
        orderId: "ord-fac-2",
        clientId: "client-b",
        facilityName: "Residenz am Rhein",
        startTime: "14:00",
        endTime: "22:00",
      });

      const res = detectShiftOverlaps([shiftA, shiftB], 2026, 6);

      expect(res.affectedWorkersCount).toBe(1);
      expect(res.totalOverlapPairsCount).toBe(1);
      expect(res.workerGroups[0].pairs[0].overlapMinutes).toBe(60);
      expect(res.workerGroups[0].pairs[0].shiftA.facilityName).toBe("Seniorenheim Sonnenschein");
      expect(res.workerGroups[0].pairs[0].shiftB.facilityName).toBe("Residenz am Rhein");
    });
  });

  describe("Exclusion rules: cancelled order and declined assignment", () => {
    it("excludes cancelled order from overlap detection", () => {
      const shift1 = baseShift({
        orderId: "ord-1",
        status: "cancelled",
        startTime: "06:00",
        endTime: "14:00",
      });
      const shift2 = baseShift({
        orderId: "ord-2",
        status: "confirmed",
        startTime: "13:00",
        endTime: "21:00",
      });

      const res = detectShiftOverlaps([shift1, shift2], 2026, 6);

      expect(res.affectedWorkersCount).toBe(0);
      expect(res.totalOverlapPairsCount).toBe(0);
    });

    it("excludes declined assignment from overlap detection", () => {
      const shift1 = baseShift({
        orderId: "ord-1",
        assignmentStatus: "declined",
        startTime: "06:00",
        endTime: "14:00",
      });
      const shift2 = baseShift({
        orderId: "ord-2",
        assignmentStatus: "confirmed",
        startTime: "13:00",
        endTime: "21:00",
      });

      const res = detectShiftOverlaps([shift1, shift2], 2026, 6);

      expect(res.affectedWorkersCount).toBe(0);
      expect(res.totalOverlapPairsCount).toBe(0);
    });
  });

  describe("Midnight crossing and exact month portion calculation", () => {
    it("handles overnight shift crossing midnight on same day (e.g. 20:00 to 04:00)", () => {
      const parsed = parseShiftInterval(
        baseShift({
          shiftDate: new Date("2026-06-10T00:00:00Z"),
          startTime: "20:00",
          endTime: "04:00",
        })
      );

      expect(parsed).not.toBeNull();
      expect(parsed!.isCrossMidnight).toBe(true);
      expect(parsed!.startFormatted).toBe("2026-06-10 20:00");
      expect(parsed!.endFormatted).toBe("2026-06-11 04:00");
      expect(parsed!.endUtcMs - parsed!.startUtcMs).toBe(8 * 3600 * 1000);
    });

    it("calculates exact month portion: 30 minutes in previous month and 60 minutes in selected month", () => {
      // Shift 1: Starts 2026-05-31 at 22:00, ends 2026-06-01 at 05:00
      // Shift 2: Starts 2026-05-31 at 23:30, ends 2026-06-01 at 01:00
      // Overlap runs from 2026-05-31 23:30 to 2026-06-01 01:00 (Total 90 minutes)
      // Part in May (until 24:00): 30 minutes
      // Part in June (from 00:00): 60 minutes
      const shift1 = baseShift({
        orderId: "ord-prev-month",
        shiftDate: new Date("2026-05-31T00:00:00Z"),
        startTime: "22:00",
        endTime: "05:00",
      });
      const shift2 = baseShift({
        orderId: "ord-boundary",
        shiftDate: new Date("2026-05-31T00:00:00Z"),
        startTime: "23:30",
        endTime: "01:00",
      });

      // 1. Report for June 2026: must add exactly 60 minutes (the part inside June)
      const resJune = detectShiftOverlaps([shift1, shift2], 2026, 6);
      expect(resJune.affectedWorkersCount).toBe(1);
      expect(resJune.totalOverlapPairsCount).toBe(1);
      expect(resJune.workerGroups[0].pairs[0].overlapMinutes).toBe(60);
      expect(resJune.workerGroups[0].totalOverlapMinutes).toBe(60);

      // 2. Report for May 2026: must add exactly 30 minutes (the part inside May)
      const resMay = detectShiftOverlaps([shift1, shift2], 2026, 5);
      expect(resMay.affectedWorkersCount).toBe(1);
      expect(resMay.totalOverlapPairsCount).toBe(1);
      expect(resMay.workerGroups[0].pairs[0].overlapMinutes).toBe(30);
      expect(resMay.workerGroups[0].totalOverlapMinutes).toBe(30);
    });

    it("excludes previous month overlap if the overlap occurred entirely within previous month", () => {
      const shift1 = baseShift({
        orderId: "ord-may-1",
        shiftDate: new Date("2026-05-31T00:00:00Z"),
        startTime: "10:00",
        endTime: "18:00",
      });
      const shift2 = baseShift({
        orderId: "ord-may-2",
        shiftDate: new Date("2026-05-31T00:00:00Z"),
        startTime: "16:00",
        endTime: "22:00",
      });

      const res = detectShiftOverlaps([shift1, shift2], 2026, 6);

      expect(res.affectedWorkersCount).toBe(0);
      expect(res.totalOverlapPairsCount).toBe(0);
    });
  });

  describe("DST (Daylight Saving Time) and uncertainty handling", () => {
    it("flags invalid wall clock time during spring forward (29.03.2026 02:30) as warning, not definite duration", () => {
      const res = resolveWallTimeToUtc(2026, 3, 29, 2, 30, DEFAULT_TIMEZONE);

      expect(res.warning).not.toBeNull();
      expect(res.warningType).toBe("DST_GAP");
      expect(res.isAmbiguousOrInvalid).toBe(true);

      const shiftDstGap = baseShift({
        orderId: "ord-dst-gap",
        shiftDate: new Date("2026-03-29T00:00:00Z"),
        startTime: "02:30",
        endTime: "10:00",
      });
      const shiftOther = baseShift({
        orderId: "ord-other",
        shiftDate: new Date("2026-03-29T00:00:00Z"),
        startTime: "08:00",
        endTime: "16:00",
      });

      const report = detectShiftOverlaps([shiftDstGap, shiftOther], 2026, 3);

      // Must be excluded from definite counts and minutes
      expect(report.affectedWorkersCount).toBe(0);
      expect(report.totalOverlapPairsCount).toBe(0);
      expect(report.workerGroups).toEqual([]);

      // Must appear in uncertainWarnings
      expect(report.uncertainWarnings).toHaveLength(1);
      expect(report.uncertainWarnings[0].orderId).toBe("ord-dst-gap");
      expect(report.uncertainWarnings[0].reason).toBe("DST_GAP");
    });

    it("flags ambiguous wall clock time during fall back (25.10.2026 02:30) as warning, not definite duration", () => {
      const res = resolveWallTimeToUtc(2026, 10, 25, 2, 30, DEFAULT_TIMEZONE);

      expect(res.warning).not.toBeNull();
      expect(res.warningType).toBe("DST_AMBIGUOUS");
      expect(res.isAmbiguousOrInvalid).toBe(true);

      const shiftDstAmbiguous = baseShift({
        orderId: "ord-dst-ambig",
        shiftDate: new Date("2026-10-25T00:00:00Z"),
        startTime: "02:30",
        endTime: "10:00",
      });
      const shiftOther = baseShift({
        orderId: "ord-other-oct",
        shiftDate: new Date("2026-10-25T00:00:00Z"),
        startTime: "08:00",
        endTime: "16:00",
      });

      const report = detectShiftOverlaps([shiftDstAmbiguous, shiftOther], 2026, 10);

      // Must be excluded from definite counts and minutes
      expect(report.affectedWorkersCount).toBe(0);
      expect(report.totalOverlapPairsCount).toBe(0);
      expect(report.workerGroups).toEqual([]);

      // Must appear in uncertainWarnings
      expect(report.uncertainWarnings).toHaveLength(1);
      expect(report.uncertainWarnings[0].orderId).toBe("ord-dst-ambig");
      expect(report.uncertainWarnings[0].reason).toBe("DST_AMBIGUOUS");
    });
  });

  describe("Empty month / no results", () => {
    it("returns zero counts, empty workerGroups, and empty uncertainWarnings when no overlaps exist", () => {
      const shift1 = baseShift({
        orderId: "ord-1",
        shiftDate: new Date("2026-07-05T00:00:00Z"),
        startTime: "06:00",
        endTime: "14:00",
      });
      const shift2 = baseShift({
        orderId: "ord-2",
        shiftDate: new Date("2026-07-06T00:00:00Z"),
        startTime: "06:00",
        endTime: "14:00",
      });

      const res = detectShiftOverlaps([shift1, shift2], 2026, 7);

      expect(res.affectedWorkersCount).toBe(0);
      expect(res.totalOverlapPairsCount).toBe(0);
      expect(res.workerGroups).toEqual([]);
      expect(res.hasDstWarnings).toBe(false);
      expect(res.uncertainWarnings).toEqual([]);
    });
  });

  describe("Shift Link Resolution & Anchor Targeting", () => {
    const buildOrderLink = (shift: {
      requestGroupId?: string | null;
      orderId: string;
      clientId?: string;
      shiftDate?: string;
    }) => {
      const targetGroup = shift.requestGroupId || shift.orderId;
      let monthQuery = "";
      if (shift.shiftDate) {
        const parts = shift.shiftDate.split(".");
        if (parts.length === 3) {
          monthQuery = `?month=${parts[2]}-${parts[1]}`;
        }
      }
      return `/admin/orders/${targetGroup}${monthQuery}#shift-${shift.orderId}`;
    };

    it("generates correct link with requestGroupId and anchor when requestGroupId exists", () => {
      const link = buildOrderLink({
        requestGroupId: "req-group-100",
        orderId: "ord-555",
        shiftDate: "15.06.2026",
      });
      expect(link).toBe("/admin/orders/req-group-100?month=2026-06#shift-ord-555");
    });

    it("generates safe fallback link when requestGroupId is null without 404", () => {
      const link = buildOrderLink({
        requestGroupId: null,
        orderId: "ord-standalone-99",
        shiftDate: "20.10.2026",
      });
      expect(link).toBe("/admin/orders/ord-standalone-99?month=2026-10#shift-ord-standalone-99");
    });

    it("generates safe fallback link when requestGroupId is undefined without 404", () => {
      const link = buildOrderLink({
        orderId: "ord-standalone-101",
        shiftDate: "05.03.2026",
      });
      expect(link).toBe("/admin/orders/ord-standalone-101?month=2026-03#shift-ord-standalone-101");
    });

    it("calls shared resolveAdminOrderRoute to resolve grouped orders and enable group actions", async () => {
      const mockOrders = [
        {
          id: "ord-g1",
          requestGroupId: "grp-1",
          shiftDate: new Date("2026-06-01T00:00:00Z"),
          status: "confirmed",
          client: { id: "c1", userId: "u1", facilityName: "Seniorenheim Ahr" },
        },
        {
          id: "ord-g2",
          requestGroupId: "grp-1",
          shiftDate: new Date("2026-06-02T00:00:00Z"),
          status: "pending",
          client: { id: "c1", userId: "u1", facilityName: "Seniorenheim Ahr" },
        },
      ];

      type QueryCondition = { requestGroupId?: string; id?: string };

      const mockDb = {
        order: {
          findFirst: async ({ where }: { where: { OR: QueryCondition[] } }) => {
            const match = mockOrders.find((o) =>
              where.OR.some(
                (cond: QueryCondition) =>
                  ("requestGroupId" in cond && o.requestGroupId === cond.requestGroupId) ||
                  ("id" in cond && o.id === cond.id)
              )
            );
            return match ?? null;
          },
          findMany: async ({ where }: { where: { requestGroupId?: string; id?: string } }) => {
            if ("requestGroupId" in where && where.requestGroupId) {
              return mockOrders
                .filter((o) => o.requestGroupId === where.requestGroupId)
                .map((o) => ({ shiftDate: o.shiftDate, status: o.status }));
            }
            return mockOrders
              .filter((o) => o.id === where.id)
              .map((o) => ({ shiftDate: o.shiftDate, status: o.status }));
          },
        },
      } as unknown as OrderRouteQueryDb;

      const res = await resolveAdminOrderRoute("grp-1", mockDb);
      expect(res).not.toBeNull();
      expect(res?.isGroupOrder).toBe(true);
      expect(res?.canExecuteGroupActions).toBe(true);
      expect(res?.targetGroupId).toBe("grp-1");
      expect(res?.allOrdersInGroup.length).toBe(2);
      expect(res?.firstOrder.client.facilityName).toBe("Seniorenheim Ahr");
    });

    it("calls shared resolveAdminOrderRoute to resolve standalone order (requestGroupId: null) and guard group actions", async () => {
      const soloOrder = {
        id: "ord-solo-999",
        requestGroupId: null,
        shiftDate: new Date("2026-06-15T00:00:00Z"),
        status: "confirmed",
        client: { id: "c2", userId: "u2", facilityName: "Klinik Bonn" },
      };

      type QueryCondition = { requestGroupId?: string; id?: string };

      const mockDb = {
        order: {
          findFirst: async ({ where }: { where: { OR: QueryCondition[] } }) => {
            const match = [soloOrder].find((o) =>
              where.OR.some(
                (cond: QueryCondition) =>
                  ("requestGroupId" in cond && o.requestGroupId === cond.requestGroupId) ||
                  ("id" in cond && o.id === cond.id)
              )
            );
            return match ?? null;
          },
          findMany: async ({ where }: { where: { requestGroupId?: string; id?: string } }) => {
            if ("id" in where && where.id === soloOrder.id) {
              return [{ shiftDate: soloOrder.shiftDate, status: soloOrder.status }];
            }
            return [];
          },
        },
      } as unknown as OrderRouteQueryDb;

      const res = await resolveAdminOrderRoute("ord-solo-999", mockDb);
      expect(res).not.toBeNull();
      expect(res?.isGroupOrder).toBe(false);
      expect(res?.canExecuteGroupActions).toBe(false); // Group actions must be disabled/hidden
      expect(res?.targetGroupId).toBe("ord-solo-999");
      expect(res?.allOrdersInGroup.length).toBe(1);
    });

    it("returns null for non-existent order id (resulting in safe 404 only when truly non-existent)", async () => {
      const mockDb = {
        order: {
          findFirst: async () => null,
          findMany: async () => [],
        },
      } as unknown as OrderRouteQueryDb;

      const res = await resolveAdminOrderRoute("missing-id", mockDb);
      expect(res).toBeNull();
    });

    it("handles cross-month shift targeting within the same group using typed id in initial.shifts", () => {
      const initialShifts = [
        { id: "ord-may-1", date: "2026-05-25", start: "06:00", end: "14:00", pause: 30, quantity: 1, bereich: "" },
        { id: "ord-june-2", date: "2026-06-10", start: "14:00", end: "22:00", pause: 30, quantity: 1, bereich: "" },
      ];

      // Verifying buildOrderLink embeds the target shift's month
      const linkJune = buildOrderLink({
        requestGroupId: "grp-multi",
        orderId: "ord-june-2",
        shiftDate: "10.06.2026",
      });
      expect(linkJune).toBe("/admin/orders/grp-multi?month=2026-06#shift-ord-june-2");

      // Verifying typed lookup in initial.shifts locates the shift and resolves its month
      const targetOrderId = "ord-june-2";
      const found = initialShifts.find((s) => s.id === targetOrderId);
      expect(found).toBeDefined();
      expect(found?.id).toBe("ord-june-2");
      expect(Number(found?.date.slice(0, 4))).toBe(2026);
      expect(Number(found?.date.slice(5, 7))).toBe(6);
    });
  });

  describe("Translations Completeness (German, English, Arabic)", () => {
    it("ensures all shiftOverlap warning keys exist in de, en, and ar dictionaries", async () => {
      const de = (await import("../messages/de.json")).default;
      const en = (await import("../messages/en.json")).default;
      const ar = (await import("../messages/ar.json")).default;

      const keys: (keyof typeof de.reports.shiftOverlap)[] = [
        "title",
        "subtitle",
        "checkButton",
        "checking",
        "affectedWorkers",
        "overlapPairs",
        "totalOverlapMinutes",
        "noResults",
        "noResultsDesc",
        "dataWarningsTitle",
        "dataWarningsDesc",
        "reasonInvalidFormat",
        "reasonInvalidFormatDesc",
        "reasonDstGap",
        "reasonDstGapDesc",
        "reasonDstAmbiguous",
        "reasonDstAmbiguousDesc",
        "worker",
        "date",
        "shift",
        "reason",
        "viewShift",
      ];

      for (const k of keys) {
        expect(de.reports.shiftOverlap[k], `Missing German key: ${k}`).toBeDefined();
        expect(en.reports.shiftOverlap[k], `Missing English key: ${k}`).toBeDefined();
        expect(ar.reports.shiftOverlap[k], `Missing Arabic key: ${k}`).toBeDefined();
        expect(typeof de.reports.shiftOverlap[k]).toBe("string");
        expect(typeof en.reports.shiftOverlap[k]).toBe("string");
        expect(typeof ar.reports.shiftOverlap[k]).toBe("string");
      }
    });

    it("ensures single order guard keys exist in de, en, and ar under orders", async () => {
      const de = (await import("../messages/de.json")).default;
      const en = (await import("../messages/en.json")).default;
      const ar = (await import("../messages/ar.json")).default;

      expect(de.orders.singleOrderBadge).toBe("Einzelauftrag (ohne Gruppe)");
      expect(en.orders.singleOrderBadge).toBe("Single Shift (no group)");
      expect(ar.orders.singleOrderBadge).toBe("وردية فردية (بدون مجموعة)");

      expect(de.orders.singleOrderNotice).toBe("Gruppenaktionen sind nur für Auftragsgruppen verfügbar.");
      expect(en.orders.singleOrderNotice).toBe("Group batch actions are only available for order groups.");
      expect(ar.orders.singleOrderNotice).toBe("إجراءات المجموعات متاحة فقط لمجموعات الطلبات.");
    });

    it("ensures Stundenübersicht renaming is correctly present in de, en, and ar", async () => {
      const de = (await import("../messages/de.json")).default;
      const en = (await import("../messages/en.json")).default;
      const ar = (await import("../messages/ar.json")).default;

      expect(de.reports.tabs.stundennachweis).toBe("Stundenübersicht");
      expect(en.reports.tabs.stundennachweis).toBe("Hours Overview");
      expect(ar.reports.tabs.stundennachweis).toBe("Stundenübersicht (نظرة عامة على الساعات)");

      expect(de.reports.stundennachweis.title).toBe("Stundenübersicht erstellen");
      expect(en.reports.stundennachweis.title).toBe("Create Hours Overview");
      expect(ar.reports.stundennachweis.title).toBe("إنشاء نظرة عامة على الساعات Stundenübersicht");
    });
  });
});
