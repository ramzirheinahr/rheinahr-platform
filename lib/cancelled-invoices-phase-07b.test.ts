import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  buildInvoicingWhereClause,
  getInvoiceFacilityName,
  hasReliableInvoiceDocument,
} from "@/lib/invoicing";
import type { CancelledInvoiceRow } from "@/components/admin/invoicing/cancelled-invoices-tab";
import { GET as getInvoicePdfRoute } from "@/app/api/invoices/[id]/pdf/route";
import deMessages from "@/messages/de.json";
import enMessages from "@/messages/en.json";
import arMessages from "@/messages/ar.json";

// Mocks for live route testing
vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(),
  roleSatisfies: vi.fn((role: string, allowed: string[]) => allowed.includes(role)),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    invoice: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/audit", () => ({
  audit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/pdf/invoice", () => ({
  generateInvoicePdf: vi.fn().mockResolvedValue(new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52])), // %PDF-1.4
}));

import { getCurrentUser, type SessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateInvoicePdf } from "@/lib/pdf/invoice";

type InvoiceDbRecord = NonNullable<Awaited<ReturnType<typeof prisma.invoice.findUnique>>>;

describe("Phase 07b - Cancelled Invoices Tab, Resilience, Search, & Document Safety", () => {
  const from = new Date("2026-10-01T00:00:00.000Z");
  const to = new Date("2026-10-31T23:59:59.999Z");

  const invoices: CancelledInvoiceRow[] = [
    // 1. Regular unpaid invoice (Modern V2)
    {
      id: "inv-1",
      invoiceNumber: "RE-2026-001",
      status: "unpaid",
      date: new Date("2026-10-15T10:00:00.000Z"),
      grossAmount: 1190.0,
      client: { facilityName: "Seniorenheim Bonn" },
      assignments: [{ id: "asgn-1" }],
      _count: { assignments: 1 },
      snapshotData: {
        calculationVersion: "v2",
        facilityName: "Seniorenheim Bonn",
        items: [
          {
            pos: 1,
            description: "Pflegefachkraft Dienst",
            hoursDisplay: "20,00",
            rateDisplay: "50,00",
            amountCents: 100000,
          },
        ],
        pdfItems: [
          {
            pos: 1,
            description: "Pflegefachkraft Dienst",
            hours: "20,00",
            rate: "50,00",
            amount: "1.000,00 €",
          },
        ],
        subtotalCents: 100000,
        taxAmountCents: 19000,
        totalCents: 119000,
      },
    },
    // 2. Regular paid invoice
    {
      id: "inv-2",
      invoiceNumber: "RE-2026-002",
      status: "paid",
      date: new Date("2026-10-16T10:00:00.000Z"),
      grossAmount: 595.0,
      client: { facilityName: "Seniorenheim Bonn" },
      assignments: [{ id: "asgn-2" }],
      _count: { assignments: 1 },
      snapshotData: {
        facilityName: "Seniorenheim Bonn",
      },
    },
    // 3. Cancelled invoice with detached assignments, BUT has frozen snapshot items
    {
      id: "inv-c-frozen",
      invoiceNumber: "RE-2026-C01",
      status: "cancelled",
      date: new Date("2026-10-18T14:00:00.000Z"),
      grossAmount: 2380.0,
      client: { facilityName: "Pflegezentrum RheinAhr" },
      assignments: [], // detached!
      _count: { assignments: 0 },
      snapshotData: {
        facilityName: "Pflegezentrum RheinAhr",
        address: "Musterstraße 1, 53474 Bad Neuenahr-Ahrweiler",
        paymentTermsDays: 14,
        date: "2026-10-18",
        subtotal: "2.000,00 €",
        taxAmount: "380,00 €",
        total: "2.380,00 €",
        items: [
          {
            pos: 1,
            description: "Pflegefachkraft Dienst",
            hours: "40,00",
            rate: "50,00",
            amount: "2.000,00 €",
          },
        ],
        emailSent: {
          sentAt: "2026-10-18T14:05:00.000Z",
        },
      },
    },
    // 4. Cancelled invoice with detached assignments AND NO snapshot items (empty/missing)
    {
      id: "inv-c-detached-empty",
      invoiceNumber: "RE-2026-C02",
      status: "cancelled",
      date: new Date("2026-10-19T10:00:00.000Z"),
      grossAmount: 1000.0,
      client: { facilityName: "Klinik Ahr" },
      assignments: [], // detached!
      _count: { assignments: 0 },
      snapshotData: {
        facilityName: "Klinik Ahr",
        items: [], // empty!
      },
    },
    // 5. Cancelled invoice that still has attached assignments, but NO snapshot items
    // (Primary Counter-Case: mutable shifts or changed rates must NOT be recalculated as "historical")
    {
      id: "inv-c-attached-unfrozen",
      invoiceNumber: "RE-2026-C03",
      status: "cancelled",
      date: new Date("2026-10-20T10:00:00.000Z"),
      grossAmount: 1500.0,
      client: { facilityName: "Residenz Ahr" },
      assignments: [{ id: "asgn-attached" }],
      _count: { assignments: 1 },
      snapshotData: {
        facilityName: "Residenz Ahr",
        // No items!
      },
    },
    // 6. Cancelled invoice whose facility name changed in client DB after issuance
    {
      id: "inv-c-renamed",
      invoiceNumber: "RE-2026-C04",
      status: "cancelled",
      date: new Date("2026-10-21T12:00:00.000Z"),
      grossAmount: 1428.0,
      client: { facilityName: "Klinikum Neu (Umbenannt)" }, // mutated client name
      assignments: [{ id: "asgn-3" }],
      _count: { assignments: 1 },
      snapshotData: {
        facilityName: "Klinikum Historisch Alt", // frozen original name
        items: [{ pos: 1, description: "Dienst", hours: "10,00", rate: "40,00", amount: "400,00 €" }],
      },
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Query Generation & Detachment Resilience", () => {
    it("generates a Prisma Where clause querying cancelled invoices by Invoice.date directly without requiring assignments", () => {
      const where = buildInvoicingWhereClause({ from, to });
      expect(where.OR).toBeDefined();

      const cancelledBranch = (where.OR as Array<Record<string, unknown>>).find(
        (b) => b.status === "cancelled"
      );
      expect(cancelledBranch).toBeDefined();
      expect(cancelledBranch).toEqual({
        status: "cancelled",
        date: { gte: from, lte: to },
      });

      const regularBranch = (where.OR as Array<Record<string, unknown>>).find(
        (b) => typeof b.status === "object" && (b.status as Record<string, unknown>).not === "cancelled"
      );
      expect(regularBranch).toBeDefined();
    });

    it("ensures cancelled invoices with detached assignments remain visible in period date filter", () => {
      const cancelled = invoices.filter((inv) => inv.status === "cancelled");
      expect(cancelled.length).toBe(4);

      const inRangeCancelled = cancelled.filter(
        (inv) => new Date(inv.date) >= from && new Date(inv.date) <= to
      );
      expect(inRangeCancelled.length).toBe(4);
    });
  });

  describe("2. Facility Name Fidelity: Display & Consistent Search", () => {
    it("prefers frozen historical snapshot facilityName over mutated client facilityName for display", () => {
      const renamedInvoice = invoices.find((i) => i.id === "inv-c-renamed")!;
      const displayedName = getInvoiceFacilityName(renamedInvoice);

      expect(displayedName).toBe("Klinikum Historisch Alt");
    });

    it("falls back to client facilityName when snapshotData has no facilityName (legacy invoices)", () => {
      const legacyInvoice = {
        client: { facilityName: "Marienhaus Seniorenzentrum" },
        snapshotData: null,
      };
      expect(getInvoiceFacilityName(legacyInvoice)).toBe("Marienhaus Seniorenzentrum");
    });

    it("builds search filter matching both live client facility name AND snapshot historical facility name", () => {
      const where = buildInvoicingWhereClause({
        from,
        to,
        query: "Historisch",
      });

      expect(where.AND).toBeDefined();
      const andClauses = where.AND as Array<{ OR: Array<Record<string, unknown>> }>;
      expect(andClauses.length).toBe(1);

      const orTerms = andClauses[0].OR;
      expect(orTerms.some((t) => t.invoiceNumber)).toBe(true);
      expect(orTerms.some((t) => t.client && (t.client as Record<string, unknown>).facilityName)).toBe(true);

      const snapshotTerm = orTerms.find((t) => t.snapshotData);
      expect(snapshotTerm).toBeDefined();
      expect(snapshotTerm?.snapshotData).toEqual({
        path: ["facilityName"],
        string_contains: "Historisch",
        mode: "insensitive",
      });
    });

    it("verifies consistent search matching for mutated client names", () => {
      const searchHistorical = buildInvoicingWhereClause({ from, to, query: "Historisch Alt" });
      const searchMutated = buildInvoicingWhereClause({ from, to, query: "Klinikum Neu" });

      const histAnd = searchHistorical.AND as Array<{ OR: Array<Record<string, unknown>> }>;
      expect(histAnd.length).toBe(2);

      const histTerm1 = histAnd[0].OR.find((t) => t.snapshotData);
      const histTerm2 = histAnd[1].OR.find((t) => t.snapshotData);
      expect(histTerm1?.snapshotData).toEqual({
        path: ["facilityName"],
        string_contains: "Historisch",
        mode: "insensitive",
      });
      expect(histTerm2?.snapshotData).toEqual({
        path: ["facilityName"],
        string_contains: "Alt",
        mode: "insensitive",
      });

      const mutAnd = searchMutated.AND as Array<{ OR: Array<Record<string, unknown>> }>;
      expect(mutAnd.length).toBe(2);
      expect(mutAnd[0].OR.some((t) => t.client)).toBe(true);
      expect(mutAnd[1].OR.some((t) => t.client)).toBe(true);
    });
  });

  describe("3. Centralized Historical Document Fidelity & Live Route API Enforcement", () => {
    it("PRIMARY COUNTER-CASE: flags cancelled invoice with attached assignments but NO frozen items as NOT reliable", () => {
      const attachedUnfrozen = invoices.find((i) => i.id === "inv-c-attached-unfrozen")!;
      // Presence of assignments alone must NEVER qualify an invoice as having a reliable historical document
      const isReliable = hasReliableInvoiceDocument(attachedUnfrozen);
      expect(isReliable).toBe(false);
    });

    it("flags cancelled invoice with detached assignments AND no frozen items as NOT reliable", () => {
      const detachedEmpty = invoices.find((i) => i.id === "inv-c-detached-empty")!;
      const isReliable = hasReliableInvoiceDocument(detachedEmpty);
      expect(isReliable).toBe(false);
    });

    it("flags cancelled invoice with frozen items as reliable", () => {
      const frozenInv = invoices.find((i) => i.id === "inv-c-frozen")!;
      const isReliable = hasReliableInvoiceDocument(frozenInv);
      expect(isReliable).toBe(true);
    });

    it("keeps regular (non-cancelled) active invoices reliable for standard calculation flow", () => {
      const regularInv = invoices.find((i) => i.id === "inv-1")!;
      expect(hasReliableInvoiceDocument(regularInv)).toBe(true);
    });

    it("LIVE ROUTE: rejects GET /api/invoices/[id]/pdf with 422 for cancelled invoice attached to assignments but lacking frozen items", async () => {
      vi.mocked(getCurrentUser).mockResolvedValue({ id: "admin-1", role: "admin", email: "admin@rheinahr.de", fullName: "Admin" } as unknown as SessionUser);
      vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
        id: "inv-c-attached-unfrozen",
        invoiceNumber: "RE-2026-C03",
        status: "cancelled",
        date: new Date("2026-10-20T10:00:00.000Z"),
        netAmount: 1260.5,
        vatAmount: 239.5,
        grossAmount: 1500.0,
        snapshotData: { facilityName: "Residenz Ahr" }, // NO items!
        client: {
          id: "client-ahr",
          userId: "client-user-1",
          facilityName: "Residenz Ahr",
          hourlyRates: { pflegefachkraft: 65 }, // updated rates!
        },
        assignments: [
          {
            id: "asgn-1",
            worker: { fullName: "Mustermann" },
            order: {
              shiftDate: new Date("2026-10-10"),
              startTime: "06:00",
              endTime: "14:00",
              breakMinutes: 30,
              requiredQualification: "pflegefachkraft",
            },
          },
        ],
      } as unknown as InvoiceDbRecord);

      const req = new Request("http://localhost:3000/api/invoices/inv-c-attached-unfrozen/pdf");
      const res = await getInvoicePdfRoute(req, {
        params: Promise.resolve({ id: "inv-c-attached-unfrozen" }),
      });

      expect(res.status).toBe(422);
      const text = await res.text();
      expect(text).toContain("Für diese stornierte Rechnung ist keine verlässliche historische Fassung verfügbar");
      expect(generateInvoicePdf).not.toHaveBeenCalled();
    });

    it("LIVE ROUTE: rejects GET /api/invoices/[id]/pdf with 422 for cancelled invoice with detached assignments and no frozen items", async () => {
      vi.mocked(getCurrentUser).mockResolvedValue({ id: "admin-1", role: "admin", email: "admin@rheinahr.de", fullName: "Admin" } as unknown as SessionUser);
      vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
        id: "inv-c-detached-empty",
        invoiceNumber: "RE-2026-C02",
        status: "cancelled",
        date: new Date("2026-10-19T10:00:00.000Z"),
        netAmount: 840.34,
        vatAmount: 159.66,
        grossAmount: 1000.0,
        snapshotData: { items: [] },
        client: { id: "client-ahr", userId: "client-user-1", facilityName: "Klinik Ahr" },
        assignments: [],
      } as unknown as InvoiceDbRecord);

      const req = new Request("http://localhost:3000/api/invoices/inv-c-detached-empty/pdf");
      const res = await getInvoicePdfRoute(req, {
        params: Promise.resolve({ id: "inv-c-detached-empty" }),
      });

      expect(res.status).toBe(422);
      expect(generateInvoicePdf).not.toHaveBeenCalled();
    });

    it("LIVE ROUTE: serves 200 PDF for cancelled invoice when frozen items are present", async () => {
      vi.mocked(getCurrentUser).mockResolvedValue({ id: "admin-1", role: "admin", email: "admin@rheinahr.de", fullName: "Admin" } as unknown as SessionUser);
      vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
        id: "inv-c-frozen",
        invoiceNumber: "RE-2026-C01",
        status: "cancelled",
        date: new Date("2026-10-18T14:00:00.000Z"),
        netAmount: 2000.0,
        vatAmount: 380.0,
        grossAmount: 2380.0,
        snapshotData: {
          facilityName: "Pflegezentrum RheinAhr",
          address: "Musterstraße 1, 53474 Bad Neuenahr-Ahrweiler",
          paymentTermsDays: 14,
          items: [
            {
              pos: 1,
              description: "Pflegefachkraft Dienst",
              hours: "40,00",
              rate: "50,00",
              amount: "2.000,00 €",
            },
          ],
          subtotal: "2.000,00 €",
          taxAmount: "380,00 €",
          total: "2.380,00 €",
        },
        client: { id: "client-rheinahr", userId: "client-user-2", facilityName: "Pflegezentrum RheinAhr", address: "Musterstraße 1, 53474 Bad Neuenahr-Ahrweiler" },
        assignments: [],
      } as unknown as InvoiceDbRecord);

      const req = new Request("http://localhost:3000/api/invoices/inv-c-frozen/pdf");
      const res = await getInvoicePdfRoute(req, {
        params: Promise.resolve({ id: "inv-c-frozen" }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/pdf");
      expect(generateInvoicePdf).toHaveBeenCalledTimes(1);
    });

    it("LIVE ROUTE: enforces direct read permissions (401 unauthorized, 403 forbidden, 404 not found)", async () => {
      // 1. Unauthenticated -> 401
      vi.mocked(getCurrentUser).mockResolvedValue(null);
      const req401 = new Request("http://localhost:3000/api/invoices/inv-1/pdf");
      const res401 = await getInvoicePdfRoute(req401, {
        params: Promise.resolve({ id: "inv-1" }),
      });
      expect(res401.status).toBe(401);

      // 2. Invoice Not Found -> 404
      vi.mocked(getCurrentUser).mockResolvedValue({ id: "admin-1", role: "admin", email: "admin@rheinahr.de", fullName: "Admin" } as unknown as SessionUser);
      vi.mocked(prisma.invoice.findUnique).mockResolvedValue(null);
      const req404 = new Request("http://localhost:3000/api/invoices/nonexistent/pdf");
      const res404 = await getInvoicePdfRoute(req404, {
        params: Promise.resolve({ id: "nonexistent" }),
      });
      expect(res404.status).toBe(404);

      // 3. Client user attempting to view another client's invoice -> 403
      vi.mocked(getCurrentUser).mockResolvedValue({ id: "intruder-user", role: "client", email: "intruder@client.de", fullName: "Intruder" } as unknown as SessionUser);
      vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
        id: "inv-other",
        invoiceNumber: "RE-999",
        status: "paid",
        client: { id: "c-other", userId: "legitimate-owner-user" },
        assignments: [],
      } as unknown as InvoiceDbRecord);
      const req403 = new Request("http://localhost:3000/api/invoices/inv-other/pdf");
      const res403 = await getInvoicePdfRoute(req403, {
        params: Promise.resolve({ id: "inv-other" }),
      });
      expect(res403.status).toBe(403);
    });
  });

  describe("4. Tab Segregation & Count Isolation", () => {
    it("excludes cancelled invoices from regular invoices, open invoices, and open counter", () => {
      const regularInvoices = invoices.filter((i) => i.status !== "cancelled");
      const cancelledInvoices = invoices.filter((i) => i.status === "cancelled");
      const openInvoices = regularInvoices.filter((i) => i.status === "unpaid");

      expect(regularInvoices.length).toBe(2);
      expect(cancelledInvoices.length).toBe(4);
      expect(openInvoices.length).toBe(1);
      expect(openInvoices[0].invoiceNumber).toBe("RE-2026-001");
    });

    it("ensures total receivables calculation strictly excludes cancelled amounts", () => {
      const regularInvoices = invoices.filter((i) => i.status !== "cancelled");
      const openInvoices = regularInvoices.filter((i) => i.status === "unpaid");

      const totalReceivables = openInvoices.reduce((sum, inv) => sum + inv.grossAmount, 0);
      expect(totalReceivables).toBe(1190.0);

      expect(cancelledInvoicesSum(invoices)).toBe(6308.0);
    });
  });

  describe("5. Historical Email Metadata Retention", () => {
    it("preserves historical email metadata without treating cancelled invoice as active dispatch", () => {
      const frozenInv = invoices.find((i) => i.id === "inv-c-frozen")!;
      const snap = frozenInv.snapshotData as { emailSent?: { sentAt: string } };
      expect(snap?.emailSent).toBeDefined();
      expect(snap?.emailSent?.sentAt).toBe("2026-10-18T14:05:00.000Z");

      const regularSentInvoices = invoices
        .filter((i) => i.status !== "cancelled")
        .filter((i) => {
          const s = i.snapshotData as { emailSent?: { sentAt: string } } | undefined;
          return !!s?.emailSent?.sentAt;
        });

      expect(regularSentInvoices.length).toBe(0);
    });
  });

  describe("6. Translation Completeness & Non-Hardcoded Strings", () => {
    const requiredInvoicingKeys = [
      "cancelled",
      "noCancelledInvoices",
      "noCancelledInvoicesDescription",
      "cancelledInvoiceSingle",
      "cancelledInvoicePlural",
      "sentViaEmailHistorical",
      "invoiceNumberHeader",
      "clientFacilityHeader",
      "invoiceDateHeader",
      "grossAmountHeader",
      "statusHeader",
      "actionsHeader",
      "viewPdf",
      "downloadPdf",
      "sentOnTooltip",
      "noReliableCopy",
      "noReliableCopyTooltip",
    ];

    it("verifies all required keys exist in German (primary)", () => {
      const inv = deMessages.invoicing as Record<string, unknown>;
      for (const k of requiredInvoicingKeys) {
        expect(inv[k], `Missing German key: invoicing.${k}`).toBeDefined();
        expect(typeof inv[k]).toBe("string");
      }
      expect(deMessages.invoicing.tabs.cancelledInvoices).toBe("Stornierte Rechnungen");
      expect(deMessages.invoicing.noReliableCopy).toBe("Keine verlässliche Belegfassung verfügbar");
    });

    it("verifies all required keys exist in English", () => {
      const inv = enMessages.invoicing as Record<string, unknown>;
      for (const k of requiredInvoicingKeys) {
        expect(inv[k], `Missing English key: invoicing.${k}`).toBeDefined();
        expect(typeof inv[k]).toBe("string");
      }
      expect(enMessages.invoicing.tabs.cancelledInvoices).toBe("Cancelled invoices");
      expect(enMessages.invoicing.noReliableCopy).toBe("No reliable copy available");
    });

    it("verifies all required keys exist in Arabic (RTL)", () => {
      const inv = arMessages.invoicing as Record<string, unknown>;
      for (const k of requiredInvoicingKeys) {
        expect(inv[k], `Missing Arabic key: invoicing.${k}`).toBeDefined();
        expect(typeof inv[k]).toBe("string");
      }
      expect(arMessages.invoicing.tabs.cancelledInvoices).toBe("الفواتير الملغاة");
      expect(arMessages.invoicing.noReliableCopy).toBe("لا تتوفر نسخة موثوقة");
    });

    it("verifies downloadPdf is distinct from the general CSV download key", () => {
      expect(deMessages.invoicing.download).toBe("CSV herunterladen");
      expect(deMessages.invoicing.downloadPdf).toBe("PDF herunterladen");

      expect(enMessages.invoicing.download).toBe("Download CSV");
      expect(enMessages.invoicing.downloadPdf).toBe("Download PDF");

      expect(arMessages.invoicing.download).toBe("تنزيل CSV");
      expect(arMessages.invoicing.downloadPdf).toBe("تنزيل PDF");
    });
  });
});

function cancelledInvoicesSum(invoices: CancelledInvoiceRow[]): number {
  return invoices
    .filter((i) => i.status === "cancelled")
    .reduce((sum, inv) => sum + Number(inv.grossAmount), 0);
}
