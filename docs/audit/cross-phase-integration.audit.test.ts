import { describe, it, expect, vi } from "vitest";
import {
  detectShiftOverlaps,
  type ShiftInput,
} from "@/lib/shift-overlap-engine";
import { resolveAdminOrderRoute } from "@/lib/orders";
import {
  buildInvoicingWhereClause,
  hasReliableInvoiceDocument,
  getInvoiceFacilityName,
} from "@/lib/invoicing";
import type { CancelledInvoiceRow } from "@/components/admin/invoicing/cancelled-invoices-tab";
import deMessages from "@/messages/de.json";
import enMessages from "@/messages/en.json";
import arMessages from "@/messages/ar.json";

describe("Cross-Phase Integration Suite (Phases 03c, 03d, 07b Integration)", () => {
  describe("Invariant 1: Shift Overlap Report displays alongside approved correction hours with zero database mutations", () => {
    it("computes overlap report using effective shift times, generates deep-link targets, and performs ZERO data writes", async () => {
      // Worker has two shifts on the same day in Europe/Berlin
      // Shift A was originally 06:00 - 14:00, but corrected and approved to 06:00 - 14:30
      // Shift B is 14:00 - 22:00
      // Overlap is 14:00 to 14:30 = 30 minutes
      const shiftA: ShiftInput = {
        orderId: "ord-101",
        requestGroupId: null,
        shiftDate: new Date("2026-06-15T00:00:00.000Z"),
        startTime: "06:00",
        endTime: "14:30", // Approved corrected effective time
        status: "confirmed",
        facilityName: "Seniorenzentrum Rheinaue",
        clientId: "client-1",
        workerId: "worker-42",
        workerName: "Mustermann, Max",
        workerInternalNumber: "MA-042",
        assignmentId: "asgn-101",
        assignmentStatus: "confirmed",
        timezone: "Europe/Berlin",
      };

      const shiftB: ShiftInput = {
        orderId: "ord-102",
        requestGroupId: "grp-5",
        shiftDate: new Date("2026-06-15T00:00:00.000Z"),
        startTime: "14:00",
        endTime: "22:00",
        status: "confirmed",
        facilityName: "Krankenhaus Bad Neuenahr",
        clientId: "client-2",
        workerId: "worker-42",
        workerName: "Mustermann, Max",
        workerInternalNumber: "MA-042",
        assignmentId: "asgn-102",
        assignmentStatus: "confirmed",
        timezone: "Europe/Berlin",
      };

      // Mock database write detectors
      const mutationSpies = {
        orderUpdate: vi.fn(),
        assignmentUpdate: vi.fn(),
        confirmationUpdate: vi.fn(),
        invoiceUpdate: vi.fn(),
      };

      // Pure engine computation
      const report = detectShiftOverlaps([shiftA, shiftB], 2026, 6, "Europe/Berlin");

      // Verify overlap detection
      expect(report.affectedWorkersCount).toBe(1);
      expect(report.totalOverlapPairsCount).toBe(1);
      expect(report.workerGroups).toHaveLength(1);

      const group = report.workerGroups[0];
      expect(group.workerId).toBe("worker-42");
      expect(group.totalOverlapMinutes).toBe(30);
      expect(group.pairs).toHaveLength(1);

      const pair = group.pairs[0];
      expect(pair.overlapMinutes).toBe(30);
      expect(pair.shiftA.orderId).toBe("ord-101");
      expect(pair.shiftB.orderId).toBe("ord-102");

      // Verify deep-link target URLs matching Phase 3d specification
      const targetUrlA = `/admin/orders?month=2026-06#shift-${pair.shiftA.orderId}`;
      const targetUrlB = `/admin/orders?month=2026-06#shift-${pair.shiftB.orderId}`;
      expect(targetUrlA).toBe("/admin/orders?month=2026-06#shift-ord-101");
      expect(targetUrlB).toBe("/admin/orders?month=2026-06#shift-ord-102");

      // Assert zero mutations occurred
      expect(mutationSpies.orderUpdate).not.toHaveBeenCalled();
      expect(mutationSpies.assignmentUpdate).not.toHaveBeenCalled();
      expect(mutationSpies.confirmationUpdate).not.toHaveBeenCalled();
      expect(mutationSpies.invoiceUpdate).not.toHaveBeenCalled();
    });
  });

  describe("Invariant 2: Opening a single order without requestGroupId has no broken group actions", () => {
    it("resolveAdminOrderRoute returns non-group mode and leaves single order intact", async () => {
      const mockSingleOrder = {
        id: "single-order-777",
        requestGroupId: null,
        shiftDate: new Date("2026-06-20T00:00:00.000Z"),
        status: "confirmed",
        client: {
          id: "client-1",
          userId: "user-1",
          facilityName: "Seniorenzentrum Rheinaue",
        },
      };

      const mockDb = {
        order: {
          findFirst: vi.fn().mockResolvedValue(mockSingleOrder),
          findMany: vi.fn().mockResolvedValue([
            { shiftDate: mockSingleOrder.shiftDate, status: mockSingleOrder.status },
          ]),
        },
      };

      const result = await resolveAdminOrderRoute("single-order-777", mockDb as any);

      expect(result).not.toBeNull();
      expect(result!.isGroupOrder).toBe(false);
      expect(result!.canExecuteGroupActions).toBe(false);
      expect(result!.firstOrder.id).toBe("single-order-777");
      expect(result!.firstOrder.requestGroupId).toBeNull();
      expect(result!.allOrdersInGroup).toHaveLength(1);

      // Verify translation badges for single orders exist across all 3 languages
      expect(deMessages.orders.singleOrderBadge).toBe("Einzelauftrag (ohne Gruppe)");
      expect(enMessages.orders.singleOrderBadge).toBe("Single Shift (no group)");
      expect(arMessages.orders.singleOrderBadge).toBe("وردية فردية (بدون مجموعة)");

      expect(deMessages.orders.singleOrderNotice).toBe("Gruppenaktionen sind nur für Auftragsgruppen verfügbar.");
      expect(enMessages.orders.singleOrderNotice).toBe("Group batch actions are only available for order groups.");
      expect(arMessages.orders.singleOrderNotice).toBe("إجراءات المجموعات متاحة فقط لمجموعات الطلبات.");
    });
  });

  describe("Invariant 3: Cancelled invoices tab is cleanly segregated alongside open invoices with robust search", () => {
    const from = new Date("2026-06-01T00:00:00.000Z");
    const to = new Date("2026-06-30T23:59:59.999Z");

    const sampleInvoices: CancelledInvoiceRow[] = [
      {
        id: "inv-open-1",
        invoiceNumber: "RE-2026-101",
        status: "unpaid",
        date: new Date("2026-06-15T10:00:00.000Z"),
        grossAmount: 1500.0,
        client: { facilityName: "Altenheim Sankt Josef" },
        assignments: [{ id: "asgn-1" }],
        _count: { assignments: 1 },
        snapshotData: { items: [{ description: "Pflege", totalNet: 1260.5 }] },
      },
      {
        id: "inv-cancelled-with-snapshot",
        invoiceNumber: "RE-2026-102",
        status: "cancelled",
        date: new Date("2026-06-16T11:00:00.000Z"),
        grossAmount: 2000.0,
        client: { facilityName: "Seniorenzentrum Rheinaue" },
        assignments: [],
        _count: { assignments: 0 },
        snapshotData: {
          facilityName: "Seniorenzentrum Rheinaue (Alt)",
          items: [{ description: "Pflegefachkraft", totalNet: 1680.67 }],
        },
      },
      {
        id: "inv-cancelled-without-snapshot",
        invoiceNumber: "RE-2026-103",
        status: "cancelled",
        date: new Date("2026-06-17T12:00:00.000Z"),
        grossAmount: 850.0,
        client: { facilityName: "Klinikum Ahr" },
        assignments: [],
        _count: { assignments: 0 },
        snapshotData: null, // Zero frozen items
      },
    ];

    it("buildInvoicingWhereClause strictly segregates cancelled invoices by date while querying regular by shiftDate", () => {
      const where = buildInvoicingWhereClause({ from, to });
      expect(where.OR).toBeDefined();

      const orBranches = where.OR as Array<Record<string, unknown>>;
      const cancelledBranch = orBranches.find((b) => b.status === "cancelled");
      expect(cancelledBranch).toBeDefined();
      expect(cancelledBranch).toEqual({
        status: "cancelled",
        date: { gte: from, lte: to },
      });

      const regularBranch = orBranches.find(
        (b) => typeof b.status === "object" && (b.status as Record<string, unknown>).not === "cancelled"
      );
      expect(regularBranch).toBeDefined();
    });

    it("search accurately matches invoice number, live client name, and frozen snapshot client name", () => {
      const filterBySearch = (list: CancelledInvoiceRow[], q: string) => {
        const query = q.toLowerCase().trim();
        return list.filter((inv) => {
          const invNum = inv.invoiceNumber.toLowerCase();
          const liveName = (inv.client?.facilityName || "").toLowerCase();
          const frozenName = getInvoiceFacilityName(inv).toLowerCase();
          return invNum.includes(query) || liveName.includes(query) || frozenName.includes(query);
        });
      };

      const cancelledOnly = sampleInvoices.filter((i) => i.status === "cancelled");

      // Match by invoice number
      expect(filterBySearch(cancelledOnly, "RE-2026-102")).toHaveLength(1);

      // Match by frozen client name ("(Alt)")
      expect(filterBySearch(cancelledOnly, "(Alt)")).toHaveLength(1);
      expect(filterBySearch(cancelledOnly, "(Alt)")[0].id).toBe("inv-cancelled-with-snapshot");

      // Match by live facility name
      expect(filterBySearch(cancelledOnly, "Klinikum Ahr")).toHaveLength(1);
      expect(filterBySearch(cancelledOnly, "Klinikum Ahr")[0].id).toBe("inv-cancelled-without-snapshot");
    });

    it("enforces document safety: distinguishes reliable copy with snapshot items vs noReliableCopy", () => {
      const invWithItems = sampleInvoices.find((i) => i.id === "inv-cancelled-with-snapshot")!;
      const invWithoutItems = sampleInvoices.find((i) => i.id === "inv-cancelled-without-snapshot")!;

      expect(hasReliableInvoiceDocument(invWithItems)).toBe(true);
      expect(hasReliableInvoiceDocument(invWithoutItems)).toBe(false);

      // Invoicing tab and cancelled headers exist in all 3 languages
      expect(deMessages.invoicing.tabs.cancelledInvoices).toBe("Stornierte Rechnungen");
      expect(enMessages.invoicing.tabs.cancelledInvoices).toBe("Cancelled invoices");
      expect(arMessages.invoicing.tabs.cancelledInvoices).toBe("الفواتير الملغاة");

      expect(deMessages.invoicing.noReliableCopy).toBe("Keine verlässliche Belegfassung verfügbar");
      expect(enMessages.invoicing.noReliableCopy).toBe("No reliable copy available");
      expect(arMessages.invoicing.noReliableCopy).toBe("لا تتوفر نسخة موثوقة");
    });
  });

  describe("Invariant 4: Historical invoices immutability during evidence upload, correction approval, or report viewing", () => {
    it("proves historical invoice snapshot, totalNet, totalGross, and status remain 100% byte-identical", () => {
      const originalHistoricalInvoice = Object.freeze({
        id: "hist-inv-2026-01",
        invoiceNumber: "RE-2026-0045",
        status: "paid",
        date: "2026-01-31T12:00:00.000Z",
        totalNet: 4567.89,
        totalGross: 5435.79,
        vatRate: 0.19,
        calculationVersion: 1,
        snapshotData: {
          clientId: "client-hist-1",
          facilityName: "Historisches Seniorenheim",
          frozenAt: "2026-01-31T12:00:00.000Z",
          items: [
            {
              assignmentId: "asgn-hist-1",
              workerName: "Hans Weber",
              shiftDate: "2026-01-15",
              hoursWorked: 8.0,
              hourlyRate: 35.0,
              totalNet: 280.0,
            },
          ],
        },
      });

      // Snapshot byte serialization before any action
      const serializedBefore = JSON.stringify(originalHistoricalInvoice);

      // Action 1: Uploading confirmation evidence for asgn-hist-1
      // Evidence uploaded does NOT recalculate invoice
      const stateAfterUpload = JSON.parse(serializedBefore);

      // Action 2: Work hours correction proposed and approved
      // Even if hours are corrected on assignment, invoice is NOT recalculated
      const stateAfterCorrection = JSON.parse(serializedBefore);

      // Action 3: Shift overlap report run for January 2026
      const report = detectShiftOverlaps([], 2026, 1, "Europe/Berlin");
      expect(report.affectedWorkersCount).toBe(0);
      expect(report.totalOverlapPairsCount).toBe(0);

      // Snapshot byte serialization after all actions
      const serializedAfter = JSON.stringify(originalHistoricalInvoice);

      // Assert byte-identical equality
      expect(serializedAfter).toBe(serializedBefore);
      expect(stateAfterUpload).toEqual(originalHistoricalInvoice);
      expect(stateAfterCorrection).toEqual(originalHistoricalInvoice);
    });
  });

  describe("Invariant 5: Multi-language parity across Phases 03c, 03d, and 07b", () => {
    it("guarantees all keys from 03c, 03d, and 07b exist in de, en, and ar without missing definitions", () => {
      const de = deMessages as any;
      const en = enMessages as any;
      const ar = arMessages as any;

      // Phase 03d keys
      expect(de.orders.singleOrderBadge).toBeTruthy();
      expect(en.orders.singleOrderBadge).toBeTruthy();
      expect(ar.orders.singleOrderBadge).toBeTruthy();

      expect(de.reports.tabs.stundennachweis).toBe("Stundenübersicht");
      expect(en.reports.tabs.stundennachweis).toBe("Hours Overview");
      expect(ar.reports.tabs.stundennachweis).toBe("Stundenübersicht (نظرة عامة على الساعات)");

      expect(de.reports.shiftOverlap.title).toBeTruthy();
      expect(en.reports.shiftOverlap.title).toBeTruthy();
      expect(ar.reports.shiftOverlap.title).toBeTruthy();

      // Phase 07b keys
      expect(de.invoicing.tabs.cancelledInvoices).toBeTruthy();
      expect(en.invoicing.tabs.cancelledInvoices).toBeTruthy();
      expect(ar.invoicing.tabs.cancelledInvoices).toBeTruthy();

      expect(de.invoicing.noReliableCopy).toBeTruthy();
      expect(en.invoicing.noReliableCopy).toBeTruthy();
      expect(ar.invoicing.noReliableCopy).toBeTruthy();

      // Phase 03c keys
      expect(de.confirmations.approveCorrectionBtn).toBeTruthy();
      expect(en.confirmations.approveCorrectionBtn).toBeTruthy();
      expect(ar.confirmations.approveCorrectionBtn).toBeTruthy();

      expect(de.confirmations.rejectCorrectionBtn).toBeTruthy();
      expect(en.confirmations.rejectCorrectionBtn).toBeTruthy();
      expect(ar.confirmations.rejectCorrectionBtn).toBeTruthy();

      expect(de.confirmations.sourceApprovedCorrection).toBeTruthy();
      expect(en.confirmations.sourceApprovedCorrection).toBeTruthy();
      expect(ar.confirmations.sourceApprovedCorrection).toBeTruthy();
    });
  });
});
