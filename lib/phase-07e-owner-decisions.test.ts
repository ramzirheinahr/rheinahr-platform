/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { GET as getInvoicePdfRoute } from "@/app/api/invoices/[id]/pdf/route";
import { GET as getBulkPdfRoute } from "@/app/api/invoices/bulk-pdf/route";
import {
  validateFacilitySurchargePolicyIntake,
  type FacilitySurchargePolicyIntakeInput,
} from "@/lib/facility-surcharge-policy-template";
import {
  validateQualificationConflictResolution,
  SYNTHETIC_PILOT_QUALIFICATION_CONFLICT_EXAMPLES,
  extractQualificationConflictsFromAssignments,
} from "@/lib/qualification-conflict-review";
import {
  verifyStoredHistoricalPdf,
  buildFrozenClientFromSnapshot,
  isCompleteFrozenSnapshot,
} from "@/lib/invoice-v2-refresh-service";
import {
  hasReliableInvoiceDocument,
  normalizeHistoricalItem,
  resolveStoredPdfCandidatePath,
  resolveStoredPdfExpectedChecksum,
  validateSnapshotMonetaryTotals,
} from "@/lib/invoicing";
import {
  sendInvoiceEmail,
  deleteInvoice,
} from "@/app/[locale]/admin/orders/[id]/invoice-actions";
import { deleteClient } from "@/app/[locale]/admin/clients/actions";
import { deleteWorker } from "@/app/[locale]/admin/workers/actions";
import { deleteOpenOrderFromGrid } from "@/app/[locale]/admin/schedule/actions";
import { cancelOrderRequestAsAdmin } from "@/app/[locale]/admin/orders/actions";
import { buildInvoicePdfData } from "@/lib/invoice-pdf-builder";
import fs from "fs";
import path from "path";
import zlib from "node:zlib";

vi.mock("server-only", () => ({}));

// Mocks for Auth & DB
vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(),
  roleSatisfies: vi.fn((role: string, allowed: string[]) => allowed.includes(role)),
  requireRole: vi.fn().mockResolvedValue({ id: "admin-1", role: "admin" }),
  assertAdmin: vi.fn().mockResolvedValue({ id: "admin-1", role: "admin" }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    qualificationCatalog: {
      count: vi.fn().mockResolvedValue(6),
      findMany: vi.fn().mockResolvedValue([
        "pflegefachkraft", "pflegehelfer", "betreuungskraft",
        "pflegedienstleitung", "kuechenhilfe", "hausmeister",
      ].map((code) => ({ code, active: true, defaultClientRateCents: 3690 }))),
    },
    qualificationDefaultRateVersion: {
      count: vi.fn().mockResolvedValue(1),
    },
    invoice: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(0),
      delete: vi.fn().mockResolvedValue({}),
    },
    invoiceRevision: {
      findUnique: vi.fn(),
    },
    client: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
      delete: vi.fn().mockResolvedValue({}),
    },
    worker: {
      findUnique: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
      delete: vi.fn().mockResolvedValue({}),
    },
    assignment: {
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      delete: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    user: {
      delete: vi.fn().mockResolvedValue({}),
    },
    order: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      delete: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    serviceConfirmation: {
      count: vi.fn().mockResolvedValue(0),
    },
    notification: {
      create: vi.fn().mockResolvedValue({ id: "notif-1" }),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({ id: "audit-1" }),
    },
    $transaction: vi.fn(async (arg: any) => {
      if (typeof arg === "function") {
        return await arg(prisma);
      }
      return Promise.all(arg);
    }),
  },
}));

vi.mock("@/lib/audit", () => ({
  audit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/email", () => ({
  sendEmailToRecipients: vi.fn().mockResolvedValue({ success: true, count: 1 }),
}));

vi.mock("@/lib/pdf/generate-timesheets-pdf", () => ({
  generateLeistungsnachweisePdf: vi.fn().mockResolvedValue(null),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/pdf/invoice", async () => {
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.addPage([100, 100]);
  const bytes = await doc.save();
  return {
    generateInvoicePdf: vi.fn().mockResolvedValue(bytes),
  };
});

vi.mock("@/lib/invoice-v2-refresh-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/invoice-v2-refresh-service")>();
  return {
    ...actual,
    verifyStoredHistoricalPdf: vi.fn(actual.verifyStoredHistoricalPdf),
  };
});

const actualRefresh = await vi.importActual<typeof import("@/lib/invoice-v2-refresh-service")>(
  "@/lib/invoice-v2-refresh-service"
);

const actualPdfModule = await vi.importActual<typeof import("@/lib/pdf/invoice")>(
  "@/lib/pdf/invoice"
);

function extractTextFromPdf(pdfBytes: Uint8Array | Buffer): string {
  const buf = Buffer.from(pdfBytes);
  let text = buf.toString("latin1");
  const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
  let match: RegExpExecArray | null;
  while ((match = streamRegex.exec(buf.toString("latin1"))) !== null) {
    try {
      const decompressed = zlib.inflateSync(Buffer.from(match[1], "latin1")).toString("latin1");
      text += "\n" + decompressed;

      // Reconstruct strings inside TJ arrays
      const tjRegex = /\[([\s\S]*?)\]\s*TJ/g;
      let tjMatch: RegExpExecArray | null;
      while ((tjMatch = tjRegex.exec(decompressed)) !== null) {
        let reconstructed = "";
        const hexInTj = /<([0-9a-fA-F]+)>/g;
        let hMatch: RegExpExecArray | null;
        while ((hMatch = hexInTj.exec(tjMatch[1])) !== null) {
          try {
            reconstructed += Buffer.from(hMatch[1], "hex").toString("latin1");
          } catch {
            // ignore
          }
        }
        if (reconstructed) {
          text += "\n" + reconstructed;
        }
      }

      // Also match standalone hex Tj
      const tjSingleRegex = /<([0-9a-fA-F]+)>\s*Tj/g;
      let singleMatch: RegExpExecArray | null;
      while ((singleMatch = tjSingleRegex.exec(decompressed)) !== null) {
        try {
          text += "\n" + Buffer.from(singleMatch[1], "hex").toString("latin1");
        } catch {
          // ignore
        }
      }
    } catch {
      // not a flate stream, ignore
    }
  }
  return text;
}

import { getCurrentUser, type SessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateInvoicePdf } from "@/lib/pdf/invoice";
import { sendEmailToRecipients } from "@/lib/email";

type InvoiceDbRecord = NonNullable<Awaited<ReturnType<typeof prisma.invoice.findUnique>>>;

describe("Phase 07e: Owner & Management Accounting Decisions", () => {
  const adminUser = {
    id: "admin-1",
    role: "admin",
    email: "admin@rheinahr.de",
    fullName: "Admin",
  } as unknown as SessionUser;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyStoredHistoricalPdf).mockImplementation(actualRefresh.verifyStoredHistoricalPdf);
    vi.mocked(prisma.$transaction).mockImplementation(async (arg: any) => {
      if (typeof arg === "function") {
        return await arg(prisma);
      }
      return Promise.all(arg);
    });
  });

  describe("1. Historical Invoices: Fail-Closed Live Generation Prevention (Option A)", () => {
    it("fails closed with 422 and Buchhaltungsarchiv notice when neither stored PDF nor complete snapshot exists", async () => {
      vi.mocked(getCurrentUser).mockResolvedValue(adminUser);

      // Historical un-refreshed invoice without stored PDF and with empty/missing snapshotData
      vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
        id: "inv-hist-unreliable",
        invoiceNumber: "RE-2025-099",
        status: "unpaid",
        date: new Date("2025-11-10T10:00:00.000Z"),
        netAmount: 1500.0,
        vatAmount: 285.0,
        grossAmount: 1785.0,
        pdfUrl: null,
        snapshotData: null, // No frozen snapshot
        client: {
          id: "c-1",
          userId: "u-1",
          facilityName: "Seniorenresidenz Ahr",
          address: "Hauptstr. 12",
        },
        assignments: [
          {
            id: "asgn-1",
            order: {
              shiftDate: new Date("2025-11-01T08:00:00.000Z"),
              startTime: "08:00",
              endTime: "16:00",
              breakMinutes: 30,
              requiredQualification: "pflegefachkraft",
            },
            worker: { fullName: "Worker 1" },
          },
        ],
      } as unknown as InvoiceDbRecord);

      const req = new Request("http://localhost:3000/api/invoices/inv-hist-unreliable/pdf");
      const res = await getInvoicePdfRoute(req, {
        params: Promise.resolve({ id: "inv-hist-unreliable" }),
      });

      expect(res.status).toBe(422);
      expect(res.headers.get("X-Invoice-Missing-Origin")).toBe("true");
      expect(res.headers.get("X-Error-Code")).toBe("HISTORICAL_ORIGIN_UNAVAILABLE");
      const text = await res.text();
      expect(text).toContain("Buchhaltungsarchiv");
      expect(text).toContain("dynamische Neugenerierung aus Live-Daten ist zur Wahrung der Revisionssicherheit gesperrt");
      expect(generateInvoicePdf).not.toHaveBeenCalled();
    });

    it("serves 200 PDF when historical invoice has a complete verified frozen snapshot", async () => {
      vi.mocked(getCurrentUser).mockResolvedValue(adminUser);

      vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
        id: "inv-hist-frozen",
        invoiceNumber: "RE-2025-100",
        status: "unpaid",
        date: new Date("2025-11-10T10:00:00.000Z"),
        netAmount: 1000.0,
        vatAmount: 190.0,
        grossAmount: 1190.0,
        pdfUrl: null,
        snapshotData: {
          facilityName: "Seniorenresidenz Ahr",
          address: "Hauptstr. 12, 53474 Bad Neuenahr",
          paymentTermsDays: 14,
          items: [
            {
              pos: 1,
              description: "Pflegedienst",
              hours: "20,00",
              rate: "50,00",
              amount: "1.000,00 €",
            },
          ],
          subtotal: "1.000,00 €",
          taxAmount: "190,00 €",
          total: "1.190,00 €",
        },
        client: {
          id: "c-1",
          userId: "u-1",
          facilityName: "Seniorenresidenz Ahr",
          address: "Hauptstr. 12, 53474 Bad Neuenahr",
        },
        assignments: [],
      } as unknown as InvoiceDbRecord);

      const req = new Request("http://localhost:3000/api/invoices/inv-hist-frozen/pdf");
      const res = await getInvoicePdfRoute(req, {
        params: Promise.resolve({ id: "inv-hist-frozen" }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/pdf");
      expect(generateInvoicePdf).toHaveBeenCalledTimes(1);
    });

    it("opens a historical invoice with a recorded 0% surcharge using only its frozen snapshot", async () => {
      vi.mocked(getCurrentUser).mockResolvedValue(adminUser);
      vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
        id: "inv-hist-zero-surcharge",
        invoiceNumber: "RE-2026-588",
        status: "unpaid",
        date: new Date("2026-10-07T13:50:33.000Z"),
        netAmount: 3320.1,
        vatAmount: 630.819,
        grossAmount: 3950.919,
        pdfUrl: null,
        snapshotData: {
          isFrozen: true,
          facilityName: "Testeinrichtung",
          address: "Teststraße 1, 53111 Bonn",
          paymentTermsDays: 14,
          items: [
            { description: "Grundvergütung", hours: "63,00", rate: "51,00", amount: "3.213,00 €" },
            { description: "Samstagszuschlag (+0%)", hours: "7,00", rate: "0,00", amount: "0,00 €" },
            { description: "Sonntagszuschlag (+30%)", hours: "7,00", rate: "15,30", amount: "107,10 €" },
          ],
          subtotal: "3.320,10 €",
          taxAmount: "630,82 €",
          total: "3.950,92 €",
        },
        client: { id: "c-zero", facilityName: "Live-Daten dürfen nicht einfließen", address: "Andere Straße 2" },
        assignments: [],
      } as unknown as InvoiceDbRecord);

      const res = await getInvoicePdfRoute(
        new Request("http://localhost:3000/api/invoices/inv-hist-zero-surcharge/pdf"),
        { params: Promise.resolve({ id: "inv-hist-zero-surcharge" }) }
      );

      expect(res.status).toBe(200);
      expect(res.headers.get("X-Document-Source")).toBe("frozen_snapshot");
      const pdfData = vi.mocked(generateInvoicePdf).mock.calls[0][0];
      expect(pdfData.items[1]).toMatchObject({ rate: "0,00", amount: "0,00 €" });
      expect(pdfData.subtotal).toBe("3.320,10 €");
    });

    it("serves 200 PDF with line items when historical invoice snapshotData contains pdfItems only (no items key)", async () => {
      vi.mocked(getCurrentUser).mockResolvedValue(adminUser);

      vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
        id: "inv-hist-pdfitems-only",
        invoiceNumber: "RE-2025-PDFITEMS",
        status: "unpaid",
        date: new Date("2025-11-10T10:00:00.000Z"),
        netAmount: 1000.0,
        vatAmount: 190.0,
        grossAmount: 1190.0,
        pdfUrl: null,
        snapshotData: {
          facilityName: "Seniorenresidenz Ahr",
          address: "Hauptstr. 12, 53474 Bad Neuenahr",
          paymentTermsDays: 14,
          pdfItems: [
            {
              pos: 1,
              description: "Pflegedienst aus pdfItems",
              hours: "20,00",
              rate: "50,00",
              amount: "1.000,00 €",
            },
          ],
          subtotal: "1.000,00 €",
          taxAmount: "190,00 €",
          total: "1.190,00 €",
        },
        client: {
          id: "c-1",
          userId: "u-1",
          facilityName: "Seniorenresidenz Ahr",
          address: "Hauptstr. 12, 53474 Bad Neuenahr",
        },
        assignments: [],
      } as unknown as InvoiceDbRecord);

      const req = new Request("http://localhost:3000/api/invoices/inv-hist-pdfitems-only/pdf");
      const res = await getInvoicePdfRoute(req, {
        params: Promise.resolve({ id: "inv-hist-pdfitems-only" }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/pdf");
      expect(generateInvoicePdf).toHaveBeenCalledTimes(1);
      const passedPdfData = vi.mocked(generateInvoicePdf).mock.calls[0][0];
      expect(passedPdfData.items).toHaveLength(1);
      expect(passedPdfData.items[0].description).toBe("Pflegedienst aus pdfItems");
      expect(passedPdfData.items[0].hours).toBe("20,00");
      expect(passedPdfData.items[0].rate).toBe("50,00");
      expect(passedPdfData.items[0].amount).toBe("1.000,00 €");
      expect(passedPdfData.subtotal).toBe("1.000,00 €");
      expect(passedPdfData.taxAmount).toBe("190,00 €");
      expect(passedPdfData.total).toBe("1.190,00 €");
    });

    it("ADVERSARIAL: Live client mutation does NOT leak into historical PDF generation", async () => {
      vi.mocked(getCurrentUser).mockResolvedValue(adminUser);

      // Snapshot stores frozen historical client information
      const frozenSnapshot = {
        facilityName: "Historische Residenz Ahr e.V.",
        address: "Historische Strasse 10, 53474 Bad Neuenahr",
        internalNumber: "HIST-K-100",
        shortCode: "HRA",
        billingInfo: "Historische Rechnungsabteilung",
        paymentTermsDays: 30,
        items: [
          {
            pos: 1,
            description: "Historische Pflegeleistung",
            hours: "10,00",
            rate: "50,00",
            amount: "500,00 €",
          },
        ],
        subtotal: "500,00 €",
        taxAmount: "95,00 €",
        total: "595,00 €",
      };

      // Live Client record has been heavily MUTATED in the database
      const mutatedLiveClient = {
        id: "c-1",
        userId: "u-1",
        facilityName: "MUTIERTE NEUE GESELLSCHAFT GMBH",
        address: "MUTIERTER NEUER WEG 99, 99999 BERLIN",
        internalNumber: "MUTATED-999",
        shortCode: "MNG",
        billingInfo: "Mutierte Buchhaltung",
        paymentTermsDays: 7,
      };

      vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
        id: "inv-hist-adversarial",
        invoiceNumber: "RE-2025-ADV-1",
        status: "unpaid",
        date: new Date("2025-10-01T10:00:00.000Z"),
        netAmount: 500.0,
        vatAmount: 95.0,
        grossAmount: 595.0,
        pdfUrl: null,
        snapshotData: frozenSnapshot,
        client: mutatedLiveClient,
        assignments: [],
      } as unknown as InvoiceDbRecord);

      const req = new Request("http://localhost:3000/api/invoices/inv-hist-adversarial/pdf");
      const res = await getInvoicePdfRoute(req, {
        params: Promise.resolve({ id: "inv-hist-adversarial" }),
      });

      expect(res.status).toBe(200);
      expect(generateInvoicePdf).toHaveBeenCalledTimes(1);

      // Inspect what was passed to generateInvoicePdf
      const calledPdfData = vi.mocked(generateInvoicePdf).mock.calls[0][0];

      // Verifies that client data passed to the PDF matches the frozen snapshot, NOT the mutated live client
      expect(calledPdfData.clientName).toBe("Historische Residenz Ahr e.V.");
      expect(calledPdfData.clientAddress).toBe("Historische Strasse 10, 53474 Bad Neuenahr");
      expect(calledPdfData.clientId).toBe("HIST-K-100");
      expect(calledPdfData.billingInfo).toBe("Historische Rechnungsabteilung");

      // Verify zero leakage from mutated live client
      expect(calledPdfData.clientName).not.toContain("MUTIERTE");
      expect(calledPdfData.clientAddress).not.toContain("BERLIN");
      expect(calledPdfData.clientId).not.toBe("MUTATED-999");
    });

    it("rejects with 422 when historical invoice snapshot contains conflicting item amount representations (COUNTER-TEST: conflicting amountCents vs amount in route)", async () => {
      vi.mocked(getCurrentUser).mockResolvedValue(adminUser);

      vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
        id: "inv-hist-conflict-amount",
        invoiceNumber: "RE-2025-CONFLICT-AMT",
        status: "unpaid",
        date: new Date("2025-10-01T10:00:00.000Z"),
        netAmount: 500.0,
        vatAmount: 95.0,
        grossAmount: 595.0,
        pdfUrl: null,
        snapshotData: {
          facilityName: "Seniorenresidenz Ahr",
          address: "Hauptstr. 12, 53474 Bad Neuenahr",
          paymentTermsDays: 14,
          items: [
            {
              pos: 1,
              description: "Dienst mit Betragskonflikt",
              hours: "10,00",
              rate: "50,00",
              amountCents: 50000, // 500,00 €
              amount: "600,00 €", // 600,00 € -> CONFLICT!
            },
          ],
          subtotal: "500,00 €",
          taxAmount: "95,00 €",
          total: "595,00 €",
        },
        client: {
          id: "c-1",
          userId: "u-1",
          facilityName: "Seniorenresidenz Ahr",
          address: "Hauptstr. 12, 53474 Bad Neuenahr",
        },
        assignments: [],
      } as unknown as InvoiceDbRecord);

      const req = new Request("http://localhost:3000/api/invoices/inv-hist-conflict-amount/pdf");
      const res = await getInvoicePdfRoute(req, {
        params: Promise.resolve({ id: "inv-hist-conflict-amount" }),
      });

      expect(res.status).toBe(422);
      expect(res.headers.get("X-Invoice-Missing-Origin")).toBe("true");
      expect(generateInvoicePdf).not.toHaveBeenCalled();
    });

    it("serves 200 exact original bytes when stored PDF is located via snapshotData.pdfFilePath only (no pdfUrl or originalPdfPath)", async () => {
      vi.mocked(getCurrentUser).mockResolvedValue(adminUser);

      const fakePdfBuffer = Buffer.from("%PDF-1.4\n" + "2".repeat(150) + "\n%%EOF");
      const fakeSha256 = "f3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b899";

      vi.mocked(verifyStoredHistoricalPdf).mockResolvedValueOnce({
        reliable: true,
        buffer: fakePdfBuffer,
        sha256: fakeSha256,
        byteLength: fakePdfBuffer.length,
      });

      vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
        id: "inv-hist-filepath-only",
        invoiceNumber: "RE-2025-FILEPATH-ONLY",
        status: "paid",
        date: new Date("2025-08-01T10:00:00.000Z"),
        netAmount: 1500.0,
        vatAmount: 285.0,
        grossAmount: 1785.0,
        pdfUrl: null, // No pdfUrl!
        snapshotData: {
          pdfFilePath: "/storage/invoices/RE-2025-FILEPATH-ONLY.pdf",
          pdfSha256: fakeSha256,
        },
        client: {
          id: "c-1",
          userId: "u-1",
          facilityName: "Seniorenresidenz Ahr",
        },
        assignments: [],
      } as unknown as InvoiceDbRecord);

      const req = new Request("http://localhost:3000/api/invoices/inv-hist-filepath-only/pdf");
      const res = await getInvoicePdfRoute(req, {
        params: Promise.resolve({ id: "inv-hist-filepath-only" }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("X-Document-Source")).toBe("stored_historical_file");
      expect(verifyStoredHistoricalPdf).toHaveBeenCalledWith(
        "/storage/invoices/RE-2025-FILEPATH-ONLY.pdf",
        expect.anything(),
        expect.anything()
      );
    });

    it("serves 200 exact original bytes when stored PDF is verified against pre-recorded reference checksum", async () => {
      vi.mocked(getCurrentUser).mockResolvedValue(adminUser);

      const fakePdfBuffer = Buffer.from("%PDF-1.4\n" + "1".repeat(150) + "\n%%EOF");
      const fakeSha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

      vi.mocked(verifyStoredHistoricalPdf).mockResolvedValueOnce({
        reliable: true,
        buffer: fakePdfBuffer,
        sha256: fakeSha256,
        byteLength: fakePdfBuffer.length,
      });

      vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
        id: "inv-hist-stored",
        invoiceNumber: "RE-2025-050",
        status: "paid",
        date: new Date("2025-08-01T10:00:00.000Z"),
        netAmount: 2000.0,
        vatAmount: 380.0,
        grossAmount: 2380.0,
        pdfUrl: "/storage/invoices/RE-2025-050.pdf",
        snapshotData: { pdfSha256: fakeSha256 },
        client: {
          id: "c-1",
          userId: "u-1",
          facilityName: "Seniorenresidenz Ahr",
        },
        assignments: [],
      } as unknown as InvoiceDbRecord);

      const req = new Request("http://localhost:3000/api/invoices/inv-hist-stored/pdf");
      const res = await getInvoicePdfRoute(req, {
        params: Promise.resolve({ id: "inv-hist-stored" }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("X-Document-Source")).toBe("stored_historical_file");
      expect(res.headers.get("X-Document-Checksum")).toBe(fakeSha256);
      const bytes = await res.arrayBuffer();
      expect(bytes.byteLength).toBe(fakePdfBuffer.length);
      expect(generateInvoicePdf).not.toHaveBeenCalled();
    });

    it("fails closed with 409 Conflict when stored PDF checksum does NOT match registered checksum (tamper protection)", async () => {
      vi.mocked(getCurrentUser).mockResolvedValue(adminUser);

      vi.mocked(verifyStoredHistoricalPdf).mockResolvedValueOnce({
        reliable: false,
        status: 409,
        errorCode: "CHECKSUM_MISMATCH",
        reason: "Das hinterlegte historische Rechnungsdokument wurde auf dem Server verändert oder stimmt nicht mit der registrierten Prüfsumme überein (Checksum-Mismatch).",
      });

      vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
        id: "inv-hist-tampered",
        invoiceNumber: "RE-2025-052",
        status: "paid",
        date: new Date("2025-08-01T10:00:00.000Z"),
        netAmount: 2000.0,
        vatAmount: 380.0,
        grossAmount: 2380.0,
        pdfUrl: "/storage/invoices/RE-2025-052.pdf",
        snapshotData: { pdfSha256: "original-expected-checksum" },
        client: {
          id: "c-1",
          userId: "u-1",
          facilityName: "Seniorenresidenz Ahr",
        },
        assignments: [],
      } as unknown as InvoiceDbRecord);

      const req = new Request("http://localhost:3000/api/invoices/inv-hist-tampered/pdf");
      const res = await getInvoicePdfRoute(req, {
        params: Promise.resolve({ id: "inv-hist-tampered" }),
      });

      expect(res.status).toBe(409);
      expect(res.headers.get("X-Error-Code")).toBe("CHECKSUM_MISMATCH");
      const text = await res.text();
      expect(text).toContain("Checksum-Mismatch");
    });

    it("fails closed with 422 when stored PDF has no registered reference checksum (UNVERIFIED_STORED_FILE)", async () => {
      vi.mocked(getCurrentUser).mockResolvedValue(adminUser);

      vi.mocked(verifyStoredHistoricalPdf).mockResolvedValueOnce({
        reliable: false,
        status: 422,
        errorCode: "UNVERIFIED_STORED_FILE",
        reason: "Das hinterlegte historische Rechnungsdokument besitzt keine registrierte Prüfsumme (unverified stored file) und kann nicht als verlässliches Originaldokument ausgegeben werden. Bitte prüfen Sie das Buchhaltungsarchiv.",
      });

      vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
        id: "inv-hist-unverified-file",
        invoiceNumber: "RE-2025-053",
        status: "paid",
        date: new Date("2025-08-01T10:00:00.000Z"),
        netAmount: 2000.0,
        vatAmount: 380.0,
        grossAmount: 2380.0,
        pdfUrl: "/storage/invoices/RE-2025-053.pdf",
        snapshotData: null, // No reference checksum
        client: {
          id: "c-1",
          userId: "u-1",
          facilityName: "Seniorenresidenz Ahr",
        },
        assignments: [],
      } as unknown as InvoiceDbRecord);

      const req = new Request("http://localhost:3000/api/invoices/inv-hist-unverified-file/pdf");
      const res = await getInvoicePdfRoute(req, {
        params: Promise.resolve({ id: "inv-hist-unverified-file" }),
      });

      expect(res.status).toBe(422);
      expect(res.headers.get("X-Error-Code")).toBe("UNVERIFIED_STORED_FILE");
      const text = await res.text();
      expect(text).toContain("unverified stored file");
    });

    it("bulk-pdf route rejects historical invoices lacking origin with 422 and does NOT recalculate", async () => {
      vi.mocked(getCurrentUser).mockResolvedValue(adminUser);

      vi.mocked(prisma.invoice.findMany).mockResolvedValue([
        {
          id: "inv-bulk-1",
          invoiceNumber: "RE-2025-BULK-1",
          status: "unpaid",
          date: new Date("2025-09-01T10:00:00.000Z"),
          netAmount: 500.0,
          vatAmount: 95.0,
          grossAmount: 595.0,
          pdfUrl: null,
          snapshotData: null, // No origin
          client: {
            id: "c-1",
            userId: "u-1",
            facilityName: "Seniorenresidenz Ahr",
          },
          assignments: [],
        },
      ] as unknown as InvoiceDbRecord[]);

      const req = new Request("http://localhost:3000/api/invoices/bulk-pdf?from=2025-09-01&to=2025-09-30");

      const res = await getBulkPdfRoute(req);
      expect(res.status).toBe(422);
      expect(res.headers.get("X-Invoice-Missing-Origin")).toBe("true");
      expect(res.headers.get("X-Error-Code")).toBe("HISTORICAL_ORIGIN_UNAVAILABLE");
      const text = await res.text();
      expect(text).toContain("Buchhaltungsarchiv");
    });

    it("downloads available invoices and reports missing numbers only when partial export is requested", async () => {
      vi.mocked(getCurrentUser).mockResolvedValue(adminUser);
      vi.mocked(prisma.invoice.findMany).mockResolvedValue([
        {
          id: "inv-bulk-unreliable",
          invoiceNumber: "RE-OLD-MISSING",
          status: "unpaid",
          date: new Date("2026-09-01T10:00:00.000Z"),
          netAmount: 500,
          vatAmount: 95,
          grossAmount: 595,
          pdfUrl: null,
          snapshotData: null,
          client: { id: "c-1", facilityName: "Live client" },
          assignments: [],
        },
        {
          id: "inv-bulk-frozen-valid",
          invoiceNumber: "RE-AVAILABLE",
          status: "unpaid",
          date: new Date("2026-09-02T10:00:00.000Z"),
          netAmount: 100,
          vatAmount: 19,
          grossAmount: 119,
          pdfUrl: null,
          snapshotData: {
            facilityName: "Frozen client",
            address: "Teststraße 1, 53111 Bonn",
            paymentTermsDays: 14,
            items: [{ description: "Dienst", hours: "2,00", rate: "50,00", amount: "100,00 €" }],
            subtotal: "100,00 €",
            taxAmount: "19,00 €",
            total: "119,00 €",
          },
          client: { id: "c-2", facilityName: "Live client" },
          assignments: [],
        },
      ] as unknown as InvoiceDbRecord[]);

      const res = await getBulkPdfRoute(new Request("http://localhost:3000/api/invoices/bulk-pdf?allowPartial=true"));
      expect(res.status).toBe(200);
      expect(res.headers.get("X-Invoice-Export-Incomplete")).toBe("true");
      expect(res.headers.get("X-Skipped-Invoice-Count")).toBe("1");
      expect(JSON.parse(decodeURIComponent(res.headers.get("X-Skipped-Invoices")!))).toEqual(["RE-OLD-MISSING"]);
      expect(res.headers.get("Content-Disposition")).toContain("_TEILWEISE.pdf");
      expect(generateInvoicePdf).toHaveBeenCalledTimes(1);
    });

    it("does not offer an empty partial PDF when every invoice is unavailable", async () => {
      vi.mocked(getCurrentUser).mockResolvedValue(adminUser);
      vi.mocked(prisma.invoice.findMany).mockResolvedValue([{
        id: "inv-bulk-unreliable",
        invoiceNumber: "RE-OLD-MISSING",
        status: "unpaid",
        date: new Date("2026-09-01T10:00:00.000Z"),
        netAmount: 500,
        vatAmount: 95,
        grossAmount: 595,
        pdfUrl: null,
        snapshotData: null,
        client: { id: "c-1", facilityName: "Live client" },
        assignments: [],
      }] as unknown as InvoiceDbRecord[]);

      const res = await getBulkPdfRoute(new Request("http://localhost:3000/api/invoices/bulk-pdf?allowPartial=true"));
      expect(res.status).toBe(422);
      expect(res.headers.get("X-Skipped-Invoice-Count")).toBe("1");
      expect(generateInvoicePdf).not.toHaveBeenCalled();
    });

    it("bulk-pdf route serves 200 PDF with line items when historical invoice snapshotData contains pdfItems only", async () => {
      vi.mocked(getCurrentUser).mockResolvedValue(adminUser);

      vi.mocked(prisma.invoice.findMany).mockResolvedValue([
        {
          id: "inv-bulk-pdfitems",
          invoiceNumber: "RE-2025-BULK-PDFITEMS",
          status: "unpaid",
          date: new Date("2025-09-01T10:00:00.000Z"),
          netAmount: 1000.0,
          vatAmount: 190.0,
          grossAmount: 1190.0,
          pdfUrl: null,
          snapshotData: {
            facilityName: "Seniorenresidenz Ahr",
            address: "Hauptstr. 12, 53474 Bad Neuenahr",
            paymentTermsDays: 14,
            pdfItems: [
              {
                pos: 1,
                description: "Pflegedienst Leistung",
                hours: "20,00",
                rate: "50,00",
                amount: "1.000,00 €",
              },
            ],
            subtotal: "1.000,00 €",
            taxAmount: "190,00 €",
            total: "1.190,00 €",
          },
          client: {
            id: "c-1",
            userId: "u-1",
            facilityName: "Seniorenresidenz Ahr",
            address: "Hauptstr. 12, 53474 Bad Neuenahr",
          },
          assignments: [],
        },
      ] as unknown as InvoiceDbRecord[]);

      const req = new Request("http://localhost:3000/api/invoices/bulk-pdf?from=2025-09-01&to=2025-09-30");
      const res = await getBulkPdfRoute(req);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/pdf");
      expect(generateInvoicePdf).toHaveBeenCalledTimes(1);
      const passedPdfData = vi.mocked(generateInvoicePdf).mock.calls[0][0];
      expect(passedPdfData.items).toHaveLength(1);
      expect(passedPdfData.items[0].description).toBe("Pflegedienst Leistung");
      expect(passedPdfData.subtotal).toBe("1.000,00 €");
      expect(passedPdfData.total).toBe("1.190,00 €");
    });
  });

  describe("2. Strict Stored PDF Verification Logic (Pure Unit Tests)", () => {
    const validBuffer = Buffer.from("%PDF-1.4\n" + "X".repeat(150) + "\n%%EOF");
    const validHash = "hash123456789";

    it("validates successfully when file exists and checksum matches reference", async () => {
      const mockVerifier = () => ({
        exists: true,
        buffer: validBuffer,
        sha256: validHash,
        byteLength: validBuffer.length,
      });

      const res = await actualRefresh.verifyStoredHistoricalPdf(
        "/storage/invoices/test.pdf",
        { pdfSha256: validHash },
        mockVerifier
      );

      expect(res.reliable).toBe(true);
      if (res.reliable) {
        expect(res.sha256).toBe(validHash);
        expect(res.byteLength).toBe(validBuffer.length);
      }
    });

    it("rejects with 409 CHECKSUM_MISMATCH when file checksum differs from reference", async () => {
      const mockVerifier = () => ({
        exists: true,
        buffer: validBuffer,
        sha256: "tampered_hash",
        byteLength: validBuffer.length,
      });

      const res = await actualRefresh.verifyStoredHistoricalPdf(
        "/storage/invoices/test.pdf",
        { pdfSha256: "original_hash" },
        mockVerifier
      );

      expect(res.reliable).toBe(false);
      if (!res.reliable) {
        expect(res.status).toBe(409);
        expect(res.errorCode).toBe("CHECKSUM_MISMATCH");
      }
    });

    it("rejects with 422 UNVERIFIED_STORED_FILE when snapshot contains no reference checksum", async () => {
      const mockVerifier = () => ({
        exists: true,
        buffer: validBuffer,
        sha256: validHash,
        byteLength: validBuffer.length,
      });

      const res = await actualRefresh.verifyStoredHistoricalPdf(
        "/storage/invoices/test.pdf",
        {}, // Empty snapshot, no checksum
        mockVerifier
      );

      expect(res.reliable).toBe(false);
      if (!res.reliable) {
        expect(res.status).toBe(422);
        expect(res.errorCode).toBe("UNVERIFIED_STORED_FILE");
      }
    });

    it("rejects with 422 FILE_MISSING_OR_CORRUPT when verifier reports file missing", async () => {
      const mockVerifier = () => ({
        exists: false,
        reason: "File not found",
      });

      const res = await actualRefresh.verifyStoredHistoricalPdf(
        "/storage/invoices/test.pdf",
        { pdfSha256: validHash },
        mockVerifier
      );

      expect(res.reliable).toBe(false);
      if (!res.reliable) {
        expect(res.status).toBe(422);
        expect(res.errorCode).toBe("FILE_MISSING_OR_CORRUPT");
      }
    });

    it("rejects with 409 SIZE_MISMATCH when file byte length differs from pre-registered byte length", async () => {
      const mockVerifier = () => ({
        exists: true,
        buffer: validBuffer,
        sha256: validHash,
        byteLength: 200,
      });

      const res = await actualRefresh.verifyStoredHistoricalPdf(
        "/storage/invoices/test.pdf",
        { pdfSha256: validHash, pdfByteLength: 500 }, // Size mismatch!
        mockVerifier
      );

      expect(res.reliable).toBe(false);
      if (!res.reliable) {
        expect(res.status).toBe(409);
        expect(res.errorCode).toBe("SIZE_MISMATCH");
      }
    });

    it("resolveStoredPdfCandidatePath resolves all recognized legacy and modern path locations", () => {
      // 1. Top-level pdfUrl
      expect(
        resolveStoredPdfCandidatePath({ pdfUrl: "/storage/invoices/top.pdf" })
      ).toBe("/storage/invoices/top.pdf");

      // 2. snapshotData.pdfUrl
      expect(
        resolveStoredPdfCandidatePath({
          pdfUrl: null,
          snapshotData: { pdfUrl: "/storage/invoices/snap-url.pdf" },
        })
      ).toBe("/storage/invoices/snap-url.pdf");

      // 3. snapshotData.pdfFilePath (specifically required by fifth review finding)
      expect(
        resolveStoredPdfCandidatePath({
          pdfUrl: null,
          snapshotData: { pdfFilePath: "/storage/invoices/snap-file-path.pdf" },
        })
      ).toBe("/storage/invoices/snap-file-path.pdf");

      // 4. snapshotData.originalPdfPath
      expect(
        resolveStoredPdfCandidatePath({
          pdfUrl: null,
          snapshotData: { originalPdfPath: "/storage/invoices/orig.pdf" },
        })
      ).toBe("/storage/invoices/orig.pdf");

      // 5. snapshotData.storedPdfInfo.path or filePath
      expect(
        resolveStoredPdfCandidatePath({
          pdfUrl: null,
          snapshotData: { storedPdfInfo: { filePath: "/storage/invoices/nested.pdf" } },
        })
      ).toBe("/storage/invoices/nested.pdf");

      // 6. snapshotData.archivedPdfRecord.path
      expect(
        resolveStoredPdfCandidatePath({
          pdfUrl: null,
          snapshotData: { archivedPdfRecord: { path: "/storage/invoices/archived.pdf" } },
        })
      ).toBe("/storage/invoices/archived.pdf");

      // 7. Non-string or whitespace-only is rejected
      expect(
        resolveStoredPdfCandidatePath({
          pdfUrl: "   ",
          snapshotData: { pdfFilePath: "" },
        })
      ).toBeNull();
      expect(resolveStoredPdfCandidatePath(null)).toBeNull();
      expect(resolveStoredPdfCandidatePath(undefined)).toBeNull();
    });

    it("resolveStoredPdfExpectedChecksum resolves all recognized checksum locations", () => {
      expect(resolveStoredPdfExpectedChecksum({ pdfSha256: "hash-1" })).toBe("hash-1");
      expect(resolveStoredPdfExpectedChecksum({ sha256: "hash-2" })).toBe("hash-2");
      expect(
        resolveStoredPdfExpectedChecksum({ storedPdfInfo: { sha256: "hash-3" } })
      ).toBe("hash-3");
      expect(
        resolveStoredPdfExpectedChecksum({ archivedPdfRecord: { sha256: "hash-4" } })
      ).toBe("hash-4");
      expect(resolveStoredPdfExpectedChecksum({})).toBeNull();
      expect(resolveStoredPdfExpectedChecksum(null)).toBeNull();
      expect(resolveStoredPdfExpectedChecksum({ pdfSha256: "   " })).toBeNull();
    });
  });

  describe("3. Frozen Client Building Isolation", () => {
    it("builds frozen client strictly from snapshotData", () => {
      const snapshot = {
        facilityName: "Test Facility",
        address: "Test Street 1",
        internalNumber: "INT-1",
        shortCode: "TF",
        billingInfo: "Test Billing",
        paymentTermsDays: 14,
      };

      const client = buildFrozenClientFromSnapshot(snapshot);
      expect(client).not.toBeNull();
      expect(client?.facilityName).toBe("Test Facility");
      expect(client?.address).toBe("Test Street 1");
      expect(client?.internalNumber).toBe("INT-1");
      expect(client?.shortCode).toBe("TF");
      expect(client?.billingInfo).toBe("Test Billing");
      expect(client?.paymentTermsDays).toBe(14);
    });

    it("returns null if facilityName or address is missing from snapshot", () => {
      expect(buildFrozenClientFromSnapshot(null)).toBeNull();
      expect(buildFrozenClientFromSnapshot({})).toBeNull();
      expect(buildFrozenClientFromSnapshot({ facilityName: "Test" })).toBeNull(); // Missing address
      expect(buildFrozenClientFromSnapshot({ address: "Test St" })).toBeNull(); // Missing facilityName
    });

    it("strictly returns null if paymentTermsDays is missing, zero, or negative (no fallback to default 14)", () => {
      const base = { facilityName: "Test Facility", address: "Test Street 1" };
      expect(buildFrozenClientFromSnapshot(base)).toBeNull();
      expect(buildFrozenClientFromSnapshot({ ...base, paymentTermsDays: 0 })).toBeNull();
      expect(buildFrozenClientFromSnapshot({ ...base, paymentTermsDays: -14 })).toBeNull();
      expect(buildFrozenClientFromSnapshot({ ...base, paymentTermsDays: "14" })).toBeNull();
      expect(buildFrozenClientFromSnapshot({ ...base, paymentTermsDays: null })).toBeNull();
    });

    it("isCompleteFrozenSnapshot mandates paymentTermsDays > 0", async () => {
      const completeSnapshotData = {
        facilityName: "Test Facility",
        address: "Test Street 1",
        paymentTermsDays: 14,
        date: "2026-01-01",
        items: [{ description: "Pflegeleistung", hours: "10,00", rate: "50,00", amount: "500,00 €" }],
        subtotal: "500,00 €",
        taxAmount: "95,00 €",
        total: "595,00 €",
      };

      const resultOk = await isCompleteFrozenSnapshot(
        completeSnapshotData,
        { netAmount: 500, vatAmount: 95, grossAmount: 595, date: "2026-01-01" },
        { skipPdfSimulation: true }
      );
      expect(resultOk.complete).toBe(true);

      const resultMissingTerms = await isCompleteFrozenSnapshot(
        { ...completeSnapshotData, paymentTermsDays: undefined },
        { netAmount: 500, vatAmount: 95, grossAmount: 595, date: "2026-01-01" },
        { skipPdfSimulation: true }
      );
      expect(resultMissingTerms.complete).toBe(false);
      expect(resultMissingTerms.reason).toContain("Zahlungsziel");

      const resultZeroTerms = await isCompleteFrozenSnapshot(
        { ...completeSnapshotData, paymentTermsDays: 0 },
        { netAmount: 500, vatAmount: 95, grossAmount: 595, date: "2026-01-01" },
        { skipPdfSimulation: true }
      );
      expect(resultZeroTerms.complete).toBe(false);
      expect(resultZeroTerms.reason).toContain("Zahlungsziel");
    });

    it("buildInvoicePdfData generates sanitized items from snapshotData.pdfItems when snapshotData.items is absent", () => {
      const mockInvoice = {
        invoiceNumber: "RE-2025-HIST-1",
        date: new Date("2025-10-01"),
        netAmount: 1000,
        vatAmount: 190,
        grossAmount: 1190,
        snapshotData: {
          facilityName: "Residenz Ahr",
          address: "Hauptstr. 1, 53474 Bad Neuenahr",
          paymentTermsDays: 14,
          pdfItems: [
            {
              pos: 1,
              description: "Pflegedienst Leistung",
              hours: "20,00",
              rate: "50,00",
              amount: "1.000,00 €",
            },
          ],
          subtotal: "1.000,00 €",
          taxAmount: "190,00 €",
          total: "1.190,00 €",
        },
      };

      const client = {
        id: "c-1",
        facilityName: "Residenz Ahr",
        address: "Hauptstr. 1, 53474 Bad Neuenahr",
        paymentTermsDays: 14,
      };

      const result = buildInvoicePdfData(mockInvoice as any, client as any, []);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].description).toBe("Pflegedienst Leistung");
      expect(result.items[0].hours).toBe("20,00");
      expect(result.items[0].rate).toBe("50,00");
      expect(result.items[0].amount).toBe("1.000,00 €");
      expect(result.subtotal).toBe("1.000,00 €");
      expect(result.taxAmount).toBe("190,00 €");
      expect(result.total).toBe("1.190,00 €");
    });

    it("buildInvoicePdfData normalizes alternate historical item formats (hoursDecimal, rateDecimal, lineTotal) into valid non-empty display strings", () => {
      const mockInvoice = {
        invoiceNumber: "RE-2025-ALT-1",
        date: new Date("2025-10-01"),
        netAmount: 500,
        vatAmount: 95,
        grossAmount: 595,
        snapshotData: {
          facilityName: "Residenz Ahr",
          address: "Hauptstr. 1, 53474 Bad Neuenahr",
          paymentTermsDays: 14,
          items: [
            {
              pos: 1,
              description: "Dienst",
              hoursDecimal: "10.00",
              rateDecimal: "50.00",
              lineTotal: "500,00 €",
            },
          ],
          subtotal: "500,00 €",
          taxAmount: "95,00 €",
          total: "595,00 €",
        },
      };

      const client = {
        id: "c-1",
        facilityName: "Residenz Ahr",
        address: "Hauptstr. 1, 53474 Bad Neuenahr",
        paymentTermsDays: 14,
      };

      const result = buildInvoicePdfData(mockInvoice as any, client as any, []);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].description).toBe("Dienst");
      expect(result.items[0].hours).toBe("10,00");
      expect(result.items[0].rate).toBe("50,00");
      expect(result.items[0].amount).toBe("500,00 €");
      expect(result.items[0].hours.length).toBeGreaterThan(0);
      expect(result.items[0].rate.length).toBeGreaterThan(0);
      expect(result.items[0].amount.length).toBeGreaterThan(0);
    });

    it("isCompleteFrozenSnapshot accepts snapshotData with alternate item formats (hoursDecimal, rateDecimal, lineTotal)", async () => {
      const snapshotData = {
        facilityName: "Residenz Ahr",
        address: "Hauptstr. 1, 53474 Bad Neuenahr",
        paymentTermsDays: 14,
        date: "2025-10-01",
        items: [
          {
            pos: 1,
            description: "Dienst",
            hoursDecimal: "10.00",
            rateDecimal: "50.00",
            lineTotal: "500,00 €",
          },
        ],
        subtotal: "500,00 €",
        taxAmount: "95,00 €",
        total: "595,00 €",
      };

      const result = await isCompleteFrozenSnapshot(
        snapshotData,
        { netAmount: 500, vatAmount: 95, grossAmount: 595, date: "2025-10-01" },
        { skipPdfSimulation: true }
      );
      expect(result.complete).toBe(true);
    });

    it("isCompleteFrozenSnapshot rejects snapshotData when item lacks valid hours (COUNTER-TEST: missing hours)", async () => {
      const badSnapshot = {
        facilityName: "Residenz Ahr",
        address: "Hauptstr. 1, 53474 Bad Neuenahr",
        paymentTermsDays: 14,
        date: "2025-10-01",
        items: [
          {
            pos: 1,
            description: "Dienst ohne Stunden",
            rateDecimal: "50.00",
            amount: "500,00 €",
          },
        ],
        subtotal: "500,00 €",
        taxAmount: "95,00 €",
        total: "595,00 €",
      };

      const result = await isCompleteFrozenSnapshot(
        badSnapshot,
        { netAmount: 500, vatAmount: 95, grossAmount: 595, date: "2025-10-01" },
        { skipPdfSimulation: true }
      );
      expect(result.complete).toBe(false);
      expect(result.reason).toContain("Stunden");
    });

    it("buildInvoicePdfData throws fail-closed error if any historical item cannot be normalized (COUNTER-TEST: unparseable item)", () => {
      const corruptInvoice = {
        invoiceNumber: "RE-2025-CORRUPT",
        date: new Date("2025-10-01"),
        netAmount: 500,
        vatAmount: 95,
        grossAmount: 595,
        snapshotData: {
          facilityName: "Residenz Ahr",
          address: "Hauptstr. 1, 53474 Bad Neuenahr",
          paymentTermsDays: 14,
          items: [
            {
              pos: 1,
              description: "Korrupter Posten",
              // hours and rate are missing completely!
              amount: "500,00 €",
            },
          ],
          subtotal: "500,00 €",
          taxAmount: "95,00 €",
          total: "595,00 €",
        },
      };

      const client = {
        id: "c-1",
        facilityName: "Residenz Ahr",
        address: "Hauptstr. 1, 53474 Bad Neuenahr",
        paymentTermsDays: 14,
      };

      expect(() => buildInvoicePdfData(corruptInvoice as any, client as any, [])).toThrow(
        "Historischer Rechnungsposten #1 ist unvollständig oder ungültig"
      );
    });

    it("normalizeHistoricalItem strictly rejects item when amountCents conflicts with amount string (COUNTER-TEST: amount conflict)", () => {
      const conflictingItem = {
        description: "Dienst",
        hours: "10,00",
        rate: "50,00",
        amountCents: 50000, // 500,00 €
        amount: "600,00 €", // 600,00 € -> CONFLICT!
      };
      expect(normalizeHistoricalItem(conflictingItem)).toBeNull();
    });

    it("normalizeHistoricalItem strictly rejects item when totalCents conflicts with lineTotal", () => {
      const conflictingItem = {
        description: "Dienst",
        hours: "10,00",
        rate: "50,00",
        totalCents: 50000,
        lineTotal: "700,00 €",
      };
      expect(normalizeHistoricalItem(conflictingItem)).toBeNull();
    });

    it("normalizeHistoricalItem strictly rejects item with unparseable or negative amount", () => {
      expect(normalizeHistoricalItem({ description: "Dienst", hours: "10,00", rate: "50,00", amount: "ungueltig" })).toBeNull();
      expect(normalizeHistoricalItem({ description: "Dienst", hours: "10,00", rate: "50,00", amount: "-100,00 €" })).toBeNull();
      expect(normalizeHistoricalItem({ description: "Dienst", hours: "10,00", rate: "50,00", amountCents: -5000 })).toBeNull();
    });

    it("accepts an explicitly zero-priced historical surcharge but rejects unexplained or conflicting zero amounts", () => {
      const zeroSurcharge = {
        description: "Samstagszuschlag (+0%)",
        hours: "7,00",
        rate: "0,00",
        amount: "0,00 €",
      };
      expect(normalizeHistoricalItem(zeroSurcharge)).toMatchObject({
        hoursNum: 7,
        rateNum: 0,
        amountCents: 0,
      });
      expect(normalizeHistoricalItem({ ...zeroSurcharge, rate: "15,30" })).toBeNull();
      expect(normalizeHistoricalItem({ ...zeroSurcharge, rate: undefined })).toBeNull();
      expect(normalizeHistoricalItem({ ...zeroSurcharge, amountCents: 1 })).toBeNull();
      expect(normalizeHistoricalItem({ ...zeroSurcharge, amount: "1,00 €" })).toBeNull();
    });

    it("normalizeHistoricalItem does NOT fabricate rate from amount/hours when rate is absent", () => {
      const itemWithoutRate = {
        description: "Pauschalleistung",
        hours: "10,00",
        amount: "500,00 €",
      };
      const result = normalizeHistoricalItem(itemWithoutRate);
      expect(result).not.toBeNull();
      expect(result?.rate).toBe("");
      expect(result?.rateNum).toBeNull();
    });

    it("isCompleteFrozenSnapshot strictly rejects snapshotData when an item has conflicting amount representations (COUNTER-TEST: snapshot amount conflict)", async () => {
      const snapshotWithConflict = {
        facilityName: "Residenz Ahr",
        address: "Hauptstr. 1, 53474 Bad Neuenahr",
        paymentTermsDays: 14,
        date: "2025-10-01",
        items: [
          {
            pos: 1,
            description: "Dienst",
            hours: "10,00",
            rate: "50,00",
            amountCents: 50000,
            amount: "600,00 €", // Mismatch!
          },
        ],
        subtotal: "500,00 €",
        taxAmount: "95,00 €",
        total: "595,00 €",
      };

      const result = await isCompleteFrozenSnapshot(
        snapshotWithConflict,
        { netAmount: 500, vatAmount: 95, grossAmount: 595, date: "2025-10-01" },
        { skipPdfSimulation: true }
      );
      expect(result.complete).toBe(false);
      expect(result.reason).toContain("Rechnungsposten #1 ist unvollständig");
    });

    it("buildInvoicePdfData throws fail-closed error if an item has conflicting amount representations (COUNTER-TEST: builder amount conflict)", () => {
      const conflictInvoice = {
        invoiceNumber: "RE-2025-BUILDER-CONFLICT",
        date: new Date("2025-10-01"),
        netAmount: 500,
        vatAmount: 95,
        grossAmount: 595,
        snapshotData: {
          facilityName: "Residenz Ahr",
          address: "Hauptstr. 1, 53474 Bad Neuenahr",
          paymentTermsDays: 14,
          items: [
            {
              pos: 1,
              description: "Dienst",
              hours: "10,00",
              rate: "50,00",
              amountCents: 50000,
              amount: "600,00 €", // Mismatch!
            },
          ],
          subtotal: "500,00 €",
          taxAmount: "95,00 €",
          total: "595,00 €",
        },
      };

      const client = {
        id: "c-1",
        facilityName: "Residenz Ahr",
        address: "Hauptstr. 1, 53474 Bad Neuenahr",
        paymentTermsDays: 14,
      };

      expect(() => buildInvoicePdfData(conflictInvoice as any, client as any, [])).toThrow(
        "Historischer Rechnungsposten #1 ist unvollständig oder ungültig"
      );
    });
  });

  describe("3b. hasReliableInvoiceDocument UI & Hub Availability Check", () => {
    it("returns true for V2 invoice with valid V2 snapshot containing pdfItems, items, and matching cent totals", () => {
      const v2Invoice = {
        id: "inv-v2-1",
        status: "unpaid",
        netAmount: 500,
        vatAmount: 95,
        grossAmount: 595,
        snapshotData: {
          calculationVersion: "v2",
          items: [{ pos: 1, description: "Pflege", hoursDisplay: "10,00", rateDisplay: "50,00", amountCents: 50000 }],
          pdfItems: [{ pos: 1, description: "Pflege", hours: "10,00", rate: "50,00", amount: "500,00 €" }],
          subtotalCents: 50000,
          taxAmountCents: 9500,
          totalCents: 59500,
        },
      };
      expect(hasReliableInvoiceDocument(v2Invoice)).toBe(true);
    });

    it("returns false for V2 invoice lacking pdfItems (COUNTER-TEST: V2 without pdfItems)", () => {
      const badV2 = {
        id: "inv-v2-no-pdfitems",
        status: "unpaid",
        snapshotData: {
          calculationVersion: "v2",
          items: [{ pos: 1, description: "Pflege", hoursDisplay: "10,00", rateDisplay: "50,00", amountCents: 50000 }],
          // pdfItems missing!
          subtotalCents: 50000,
          taxAmountCents: 9500,
          totalCents: 59500,
        },
      };
      expect(hasReliableInvoiceDocument(badV2)).toBe(false);
    });

    it("returns true for historical invoice with verified stored PDF and registered checksum", () => {
      const storedInvoice = {
        id: "inv-stored-1",
        status: "unpaid",
        pdfUrl: "/storage/invoices/RE-2025-001.pdf",
        snapshotData: { pdfSha256: "abcdef1234567890" },
        storedPdfVerified: true,
      };
      expect(hasReliableInvoiceDocument(storedInvoice)).toBe(true);
    });

    it("returns false for stored PDF when unverified by server in actual UI call (COUNTER-TEST: unverified stored file in UI)", () => {
      const storedUnverified = {
        id: "inv-stored-unverified-ui",
        status: "unpaid",
        pdfUrl: "/storage/invoices/unverified.pdf",
        snapshotData: { pdfSha256: "hash12345" },
        // storedPdfVerified is undefined!
      };
      // Actual UI call: no second parameter passed!
      expect(hasReliableInvoiceDocument(storedUnverified)).toBe(false);
    });

    it("returns false for stored PDF when file is missing in actual UI call (COUNTER-TEST: fileMissing in UI)", () => {
      const storedMissingUI = {
        id: "inv-stored-missing-ui",
        status: "unpaid",
        pdfUrl: "/storage/invoices/missing.pdf",
        snapshotData: { pdfSha256: "hash12345" },
        fileMissing: true,
        storedPdfVerified: false,
      };
      // Actual UI call: no second parameter passed!
      expect(hasReliableInvoiceDocument(storedMissingUI)).toBe(false);
    });

    it("returns false for stored PDF when verifier reports file missing (COUNTER-TEST: missing stored file)", () => {
      const storedMissing = {
        id: "inv-stored-missing",
        status: "unpaid",
        pdfUrl: "/storage/invoices/missing.pdf",
        snapshotData: { pdfSha256: "hash12345" },
      };
      expect(
        hasReliableInvoiceDocument(storedMissing, {
          fileVerifier: () => ({ exists: false }),
        })
      ).toBe(false);
    });

    it("returns false for stored PDF when verifier reports checksum mismatch (COUNTER-TEST: checksum mismatch)", () => {
      const storedTampered = {
        id: "inv-stored-tampered",
        status: "unpaid",
        pdfUrl: "/storage/invoices/tampered.pdf",
        snapshotData: { pdfSha256: "expected_hash" },
      };
      expect(
        hasReliableInvoiceDocument(storedTampered, {
          fileVerifier: () => ({ exists: true, sha256: "different_tampered_hash" }),
        })
      ).toBe(false);
    });

    it("returns true for historical invoice with verified stored PDF specified via snapshotData.pdfFilePath only", () => {
      const storedPdfFilePathInvoice = {
        id: "inv-stored-filepath",
        status: "unpaid",
        pdfUrl: null, // No pdfUrl!
        snapshotData: {
          pdfFilePath: "/storage/invoices/RE-2025-FILEPATH.pdf",
          pdfSha256: "abcdef1234567890",
        },
        storedPdfVerified: true,
      };
      // Actual UI call: no second parameter passed!
      expect(hasReliableInvoiceDocument(storedPdfFilePathInvoice)).toBe(true);
    });

    it("returns false for stored PDF in pdfFilePath when unverified by server in actual UI call (COUNTER-TEST: unverified pdfFilePath in UI)", () => {
      const storedPdfFilePathUnverified = {
        id: "inv-stored-filepath-unverif",
        status: "unpaid",
        pdfUrl: null,
        snapshotData: {
          pdfFilePath: "/storage/invoices/RE-2025-FILEPATH.pdf",
          pdfSha256: "abcdef1234567890",
        },
        // storedPdfVerified is undefined!
      };
      // Actual UI call: no second parameter passed!
      expect(hasReliableInvoiceDocument(storedPdfFilePathUnverified)).toBe(false);
    });

    it("returns false for historical snapshot when any item has conflicting amount representations (COUNTER-TEST: UI amount conflict)", () => {
      const conflictItemInvoice = {
        id: "inv-conflict-ui",
        status: "unpaid",
        netAmount: 500,
        vatAmount: 95,
        grossAmount: 595,
        snapshotData: {
          facilityName: "Historische Residenz Ahr",
          address: "Hauptstr. 12, 53474 Bad Neuenahr",
          paymentTermsDays: 14,
          items: [
            {
              pos: 1,
              description: "Pflege",
              hours: "10,00",
              rate: "50,00",
              amountCents: 50000,
              amount: "600,00 €", // Conflicting!
            },
          ],
          subtotal: "500,00 €",
          taxAmount: "95,00 €",
          total: "595,00 €",
        },
      };
      expect(hasReliableInvoiceDocument(conflictItemInvoice)).toBe(false);
    });

    it("returns true for historical invoice with complete frozen snapshot", () => {
      const frozenInvoice = {
        id: "inv-frozen-1",
        status: "unpaid",
        netAmount: 500,
        vatAmount: 95,
        grossAmount: 595,
        snapshotData: {
          facilityName: "Historische Residenz Ahr",
          address: "Hauptstr. 12, 53474 Bad Neuenahr",
          paymentTermsDays: 14,
          items: [{ pos: 1, description: "Pflegedienst", hours: "10,00", rate: "50,00", amount: "500,00 €" }],
          subtotal: "500,00 €",
          taxAmount: "95,00 €",
          total: "595,00 €",
        },
      };
      expect(hasReliableInvoiceDocument(frozenInvoice)).toBe(true);
    });

    it("returns false for historical snapshot when any item lacks description (COUNTER-TEST: item without description)", () => {
      const missingDescInvoice = {
        id: "inv-missing-desc",
        status: "unpaid",
        snapshotData: {
          facilityName: "Historische Residenz Ahr",
          address: "Hauptstr. 12, 53474 Bad Neuenahr",
          paymentTermsDays: 14,
          items: [{ pos: 1, description: "", hours: "10,00", rate: "50,00", amount: "500,00 €" }],
          subtotal: "500,00 €",
          taxAmount: "95,00 €",
          total: "595,00 €",
        },
      };
      expect(hasReliableInvoiceDocument(missingDescInvoice)).toBe(false);
    });

    it("returns false when snapshot totals do not match DB invoice amounts (COUNTER-TEST: mismatched totals)", () => {
      const mismatchInvoice = {
        id: "inv-mismatch",
        status: "unpaid",
        netAmount: 600, // DB has 600
        vatAmount: 114,
        grossAmount: 714,
        snapshotData: {
          facilityName: "Historische Residenz Ahr",
          address: "Hauptstr. 12, 53474 Bad Neuenahr",
          paymentTermsDays: 14,
          items: [{ pos: 1, description: "Pflege", hours: "10,00", rate: "50,00", amount: "500,00 €" }],
          subtotal: "500,00 €", // Snapshot has 500 -> Mismatch!
          taxAmount: "95,00 €",
          total: "595,00 €",
        },
      };
      expect(hasReliableInvoiceDocument(mismatchInvoice)).toBe(false);
    });

    it("returns false for historical invoice lacking both stored PDF and complete snapshot", () => {
      const unverifiedInvoice = {
        id: "inv-hist-unreliable",
        status: "unpaid",
        pdfUrl: null,
        snapshotData: null,
      };
      expect(hasReliableInvoiceDocument(unverifiedInvoice)).toBe(false);
    });

    it("returns false for historical invoice with unverified stored file (missing checksum)", () => {
      const unverifiedStored = {
        id: "inv-unverified-stored",
        status: "unpaid",
        pdfUrl: "/storage/invoices/RE-2025-002.pdf",
        snapshotData: {}, // No checksum
      };
      expect(hasReliableInvoiceDocument(unverifiedStored)).toBe(false);
    });

    it("returns false for historical invoice with incomplete snapshot (missing paymentTermsDays)", () => {
      const missingTermsSnapshot = {
        id: "inv-missing-terms",
        status: "unpaid",
        snapshotData: {
          facilityName: "Historische Residenz Ahr",
          address: "Hauptstr. 12, 53474 Bad Neuenahr",
          // paymentTermsDays missing!
          items: [{ description: "Pflege", hours: "10,00", rate: "50,00", amount: "500,00 €" }],
        },
      };
      expect(hasReliableInvoiceDocument(missingTermsSnapshot)).toBe(false);
    });
  });

  describe("3c. sendInvoiceEmail Action: Fail-Closed Protection (Option A)", () => {
    it("fails closed and dispatches zero emails when historical invoice lacks reliable origin", async () => {
      vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
        id: "inv-email-unreliable",
        invoiceNumber: "RE-2025-EMAIL-FAIL",
        status: "unpaid",
        date: new Date("2025-11-10T10:00:00.000Z"),
        netAmount: 1500.0,
        vatAmount: 285.0,
        grossAmount: 1785.0,
        pdfUrl: null,
        snapshotData: null,
        client: {
          id: "c-1",
          userId: "u-1",
          facilityName: "Seniorenresidenz Ahr",
          address: "Hauptstr. 12",
          billingEmail: "rechnung@ahr.de",
        },
        assignments: [],
      } as unknown as InvoiceDbRecord);

      await expect(
        sendInvoiceEmail({ invoiceId: "inv-email-unreliable" })
      ).rejects.toThrow("E-Mail-Versand abgebrochen: Für diese historische Rechnung ist weder ein verifiziertes Originaldokument noch ein vollständiger eingefrorener Snapshot hinterlegt");

      expect(sendEmailToRecipients).not.toHaveBeenCalled();
      expect(generateInvoicePdf).not.toHaveBeenCalled();
    });

    it("fails closed when stored historical PDF has no registered checksum", async () => {
      vi.mocked(verifyStoredHistoricalPdf).mockResolvedValueOnce({
        reliable: false,
        status: 422,
        errorCode: "UNVERIFIED_STORED_FILE",
        reason: "Das hinterlegte historische Rechnungsdokument besitzt keine registrierte Prüfsumme",
      });

      vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
        id: "inv-email-unverified-file",
        invoiceNumber: "RE-2025-EMAIL-UNVERIFIED",
        status: "paid",
        date: new Date("2025-08-01T10:00:00.000Z"),
        netAmount: 2000.0,
        vatAmount: 380.0,
        grossAmount: 2380.0,
        pdfUrl: "/storage/invoices/RE-2025-053.pdf",
        snapshotData: {},
        client: {
          id: "c-1",
          userId: "u-1",
          facilityName: "Seniorenresidenz Ahr",
          address: "Hauptstr. 12",
          billingEmail: "rechnung@ahr.de",
        },
        assignments: [],
      } as unknown as InvoiceDbRecord);

      await expect(
        sendInvoiceEmail({ invoiceId: "inv-email-unverified-file" })
      ).rejects.toThrow("Das hinterlegte Rechnungsdokument ist nicht verlässlich");

      expect(sendEmailToRecipients).not.toHaveBeenCalled();
    });

    it("dispatches email strictly using frozen snapshot data without live client or live assignment recalculation", async () => {
      const frozenSnapshot = {
        facilityName: "Historische Residenz Ahr e.V.",
        address: "Historische Strasse 10, 53474 Bad Neuenahr",
        internalNumber: "HIST-K-100",
        shortCode: "HRA",
        billingInfo: "Historische Rechnungsabteilung",
        paymentTermsDays: 30,
        items: [
          {
            pos: 1,
            description: "Historische Pflegeleistung",
            hours: "10,00",
            rate: "50,00",
            amount: "500,00 €",
          },
        ],
        subtotal: "500,00 €",
        taxAmount: "95,00 €",
        total: "595,00 €",
      };

      const mutatedLiveClient = {
        id: "c-1",
        userId: "u-1",
        facilityName: "MUTIERTE NEUE GESELLSCHAFT GMBH",
        address: "MUTIERTER NEUER WEG 99, 99999 BERLIN",
        billingEmail: "mutiert@berlin.de",
      };

      vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
        id: "inv-email-frozen-success",
        invoiceNumber: "RE-2025-EMAIL-OK",
        status: "unpaid",
        date: new Date("2025-10-01T10:00:00.000Z"),
        netAmount: 500.0,
        vatAmount: 95.0,
        grossAmount: 595.0,
        pdfUrl: null,
        snapshotData: frozenSnapshot,
        client: mutatedLiveClient,
        assignments: [
          {
            id: "live-asgn-should-be-ignored",
            order: { shiftDate: new Date("2026-10-01") },
            worker: { fullName: "Live Worker" },
          },
        ],
      } as unknown as InvoiceDbRecord);

      await sendInvoiceEmail({ invoiceId: "inv-email-frozen-success" });

      expect(generateInvoicePdf).toHaveBeenCalledTimes(1);
      const passedPdfData = vi.mocked(generateInvoicePdf).mock.calls[0][0];
      expect(passedPdfData.clientName).toBe("Historische Residenz Ahr e.V.");
      expect(passedPdfData.clientAddress).toBe("Historische Strasse 10, 53474 Bad Neuenahr");
      expect(passedPdfData.clientId).toBe("HIST-K-100");
      expect(passedPdfData.clientName).not.toContain("MUTIERTE");

      expect(sendEmailToRecipients).toHaveBeenCalledTimes(1);
      const callArgs = vi.mocked(sendEmailToRecipients).mock.calls[0];
      expect(callArgs[1].attachments).toHaveLength(1);
      expect(callArgs[1].attachments?.[0]?.filename).toBe("RE-2025-EMAIL-OK.pdf");
    });

    it("dispatches email with line items when historical invoice snapshotData contains pdfItems only", async () => {
      const frozenSnapshot = {
        facilityName: "Historische Residenz Ahr e.V.",
        address: "Historische Strasse 10, 53474 Bad Neuenahr",
        internalNumber: "HIST-K-100",
        shortCode: "HRA",
        billingInfo: "Historische Rechnungsabteilung",
        paymentTermsDays: 14,
        pdfItems: [
          {
            pos: 1,
            description: "Pflege aus pdfItems",
            hours: "15,00",
            rate: "50,00",
            amount: "750,00 €",
          },
        ],
        subtotal: "750,00 €",
        taxAmount: "142,50 €",
        total: "892,50 €",
      };

      vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
        id: "inv-email-pdfitems-success",
        invoiceNumber: "RE-2025-EMAIL-PDFITEMS",
        status: "unpaid",
        date: new Date("2025-10-01T10:00:00.000Z"),
        netAmount: 750.0,
        vatAmount: 142.5,
        grossAmount: 892.5,
        pdfUrl: null,
        snapshotData: frozenSnapshot,
        client: {
          id: "c-1",
          userId: "u-1",
          facilityName: "Historische Residenz Ahr e.V.",
          address: "Historische Strasse 10, 53474 Bad Neuenahr",
          billingEmail: "rechnung@ahr.de",
        },
        assignments: [],
      } as unknown as InvoiceDbRecord);

      await sendInvoiceEmail({ invoiceId: "inv-email-pdfitems-success" });

      expect(generateInvoicePdf).toHaveBeenCalledTimes(1);
      const passedPdfData = vi.mocked(generateInvoicePdf).mock.calls[0][0];
      expect(passedPdfData.items).toHaveLength(1);
      expect(passedPdfData.items[0].description).toBe("Pflege aus pdfItems");
      expect(passedPdfData.subtotal).toBe("750,00 €");
      expect(passedPdfData.total).toBe("892,50 €");
      expect(sendEmailToRecipients).toHaveBeenCalledTimes(1);
    });

    it("fails closed and dispatches zero emails when historical invoice snapshot contains conflicting item amount representations (COUNTER-TEST: conflicting amounts in email action)", async () => {
      const conflictSnapshot = {
        facilityName: "Historische Residenz Ahr e.V.",
        address: "Historische Strasse 10, 53474 Bad Neuenahr",
        paymentTermsDays: 14,
        items: [
          {
            pos: 1,
            description: "Pflege mit Betragskonflikt",
            hours: "10,00",
            rate: "50,00",
            amountCents: 50000, // 500,00 €
            amount: "600,00 €", // 600,00 € -> Conflict!
          },
        ],
        subtotal: "500,00 €",
        taxAmount: "95,00 €",
        total: "595,00 €",
      };

      vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
        id: "inv-email-conflict-amt",
        invoiceNumber: "RE-2025-EMAIL-CONFLICT",
        status: "unpaid",
        date: new Date("2025-10-01T10:00:00.000Z"),
        netAmount: 500.0,
        vatAmount: 95.0,
        grossAmount: 595.0,
        pdfUrl: null,
        snapshotData: conflictSnapshot,
        client: {
          id: "c-1",
          userId: "u-1",
          facilityName: "Historische Residenz Ahr e.V.",
          address: "Historische Strasse 10, 53474 Bad Neuenahr",
          billingEmail: "rechnung@ahr.de",
        },
        assignments: [],
      } as unknown as InvoiceDbRecord);

      await expect(
        sendInvoiceEmail({ invoiceId: "inv-email-conflict-amt" })
      ).rejects.toThrow("E-Mail-Versand abgebrochen: Für diese historische Rechnung ist weder ein verifiziertes Originaldokument noch ein vollständiger eingefrorener Snapshot hinterlegt");

      expect(sendEmailToRecipients).not.toHaveBeenCalled();
      expect(generateInvoicePdf).not.toHaveBeenCalled();
    });
  });

  describe("3d. Real Unmocked PDF Generation & Decompressed Stream Verification", () => {
    it("renders real PDF via @react-pdf/renderer and verifies decompressed stream contains line items, hours, rate, and amount", async () => {
      const mockInvoice = {
        invoiceNumber: "RE-2025-REAL-PDF",
        date: new Date("2025-10-15T00:00:00.000Z"),
        netAmount: 500,
        vatAmount: 95,
        grossAmount: 595,
        snapshotData: {
          facilityName: "Seniorenresidenz Ahrblick",
          address: "Burgstraße 45, 53474 Bad Neuenahr",
          billingInfo: "Seniorenresidenz Ahrblick\nFinanzbuchhaltung\nBurgstraße 45",
          paymentTermsDays: 14,
          periodStart: "01.10.2025",
          periodEnd: "31.10.2025",
          items: [
            {
              pos: 1,
              description: "Pflegeeinsatz Spätdienst",
              hoursDecimal: "10.00",
              rateDecimal: "50.00",
              lineTotal: "500,00 €",
            },
          ],
          subtotal: "500,00 €",
          taxAmount: "95,00 €",
          total: "595,00 €",
        },
      };

      const frozenClient = buildFrozenClientFromSnapshot(mockInvoice.snapshotData);
      expect(frozenClient).not.toBeNull();

      const pdfData = buildInvoicePdfData(mockInvoice as any, frozenClient as any, []);
      expect(pdfData.items[0].description).toBe("Pflegeeinsatz Spätdienst");
      expect(pdfData.items[0].hours).toBe("10,00");
      expect(pdfData.items[0].rate).toBe("50,00");
      expect(pdfData.items[0].amount).toBe("500,00 €");

      // Generate actual unmocked PDF bytes
      const pdfBuffer = await actualPdfModule.generateInvoicePdf(pdfData);
      expect(pdfBuffer).toBeInstanceOf(Buffer);
      expect(pdfBuffer.length).toBeGreaterThan(1000);

      // Decompress and verify text content in stream
      const extractedText = extractTextFromPdf(pdfBuffer);
      expect(extractedText).toContain("RE-2025-REAL-PDF");
      expect(extractedText).toContain("Seniorenresidenz Ahrblick");
      expect(extractedText).toContain("Pflegeeinsatz Spätdienst");
      expect(extractedText).toContain("10,00");
      expect(extractedText).toContain("50,00");
      expect(extractedText).toContain("500,00");
      expect(extractedText).toContain("595,00");
      expect(extractedText).toMatch(/14[\s\S]*?Tagen/);
    });
  });

  describe("4. Facility Surcharge Policy Intake Decision Template & Validation", () => {
    const validPolicyInput: FacilitySurchargePolicyIntakeInput = {
      clientId: "client-ahr-01",
      clientContractId: "contract-2026-001",
      policyVersion: 1,
      federalState: "RP",
      municipality: "Bad Neuenahr-Ahrweiler",
      districtLocality: "Ahrweiler",
      surchargeSat: 0.25,
      surchargeSun: 0.50,
      surchargeHoliday: 1.00,
      surchargeNight: 0.25,
      nightStart: "22:00",
      nightEnd: "06:00",
      combinationRule: "highest_non_night_plus_night",
      sourceType: "contract",
      sourceReference: "Rahmenvertrag 2026 §4 Abs. 2",
      effectiveFrom: "2026-01-01",
      effectiveTo: "2026-12-31",
      verifiedByUserId: "admin-1",
      verifiedAt: "2026-01-02T10:00:00Z",
      isFrozen: true,
    };

    it("accepts a completely specified contractual policy", () => {
      const result = validateFacilitySurchargePolicyIntake(validPolicyInput);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.sanitizedPolicy?.isFrozen).toBe(true);
      expect(result.sanitizedPolicy?.federalState).toBe("RP");
    });

    it("rejects policy with missing mandatory clientId", () => {
      const result = validateFacilitySurchargePolicyIntake({
        ...validPolicyInput,
        clientId: "",
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("clientId"))).toBe(true);
    });

    it("rejects invalid federal state code", () => {
      const result = validateFacilitySurchargePolicyIntake({
        ...validPolicyInput,
        federalState: "INVALID_STATE",
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("federalState"))).toBe(true);
    });

    it("strictly rejects 0% surcharge without contractual zero-rate rationale", () => {
      const result = validateFacilitySurchargePolicyIntake({
        ...validPolicyInput,
        surchargeSat: 0.0, // Implicit zero attempt
        zeroRateRationale: undefined,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("surchargeSat") && e.includes("Null-Zuschlag"))).toBe(true);
    });

    it("accepts 0% surcharge when supported by explicit contractual rationale", () => {
      const result = validateFacilitySurchargePolicyIntake({
        ...validPolicyInput,
        surchargeSat: 0.0,
        zeroRateRationale: {
          surchargeSat: "Vertrag §4.3 schließt Samstagszuschläge ausdrücklich aus.",
        },
      });
      expect(result.valid).toBe(true);
      expect(result.sanitizedPolicy?.surchargeSat).toBe(0.0);
    });

    it("rejects invalid date bounds (effectiveFrom > effectiveTo)", () => {
      const result = validateFacilitySurchargePolicyIntake({
        ...validPolicyInput,
        effectiveFrom: "2026-12-31",
        effectiveTo: "2026-01-01",
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("effectiveFrom"))).toBe(true);
    });

    it("rejects unfrozen policy (isFrozen: false) to prevent POLICY_NOT_FROZEN failure", () => {
      const result = validateFacilitySurchargePolicyIntake({
        ...validPolicyInput,
        isFrozen: false,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("isFrozen"))).toBe(true);
    });
  });

  describe("5. Qualification Conflict Administrative Review & Audit Trail", () => {
    it("contains synthetic pilot qualification conflict cases with blocking status and no PII leak", () => {
      expect(SYNTHETIC_PILOT_QUALIFICATION_CONFLICT_EXAMPLES.length).toBeGreaterThanOrEqual(2);

      for (const item of SYNTHETIC_PILOT_QUALIFICATION_CONFLICT_EXAMPLES) {
        expect(item.blockingCode).toBe("QUALIFICATION_CONFLICT");
        expect(item.status).toBe("BLOCKED_PENDING_REVIEW");
        expect(item.resolutionProtocol.automaticConversionAllowed).toBe(false);
        // Guarantee no personal names leaked in structural audit item
        expect((item as unknown as Record<string, unknown>).workerName).toBeUndefined();
        expect((item as unknown as Record<string, unknown>).clientName).toBeUndefined();
      }
    });

    it("strictly rejects resolution attempting automatic conversion between betreuungskraft and pflegehelfer", () => {
      const result = validateQualificationConflictResolution({
        auditId: "QC-2026-PILOT-001",
        orderId: "ord-hist-pilot-3",
        workerId: "wrk-hist-pilot-3",
        chosenAction: "AUTOMATIC_CONVERSION", // Prohibited
        documentReference: "None",
        verifiedByAdminId: "admin-1",
      });

      expect(result.accepted).toBe(false);
      expect(result.reason).toContain("strikt verboten");
    });

    it("rejects resolution without documentary evidence", () => {
      const result = validateQualificationConflictResolution({
        auditId: "QC-2026-PILOT-001",
        orderId: "ord-hist-pilot-3",
        workerId: "wrk-hist-pilot-3",
        chosenAction: "VERIFY_CONTRACTUAL_AMENDMENT",
        documentReference: "", // Empty!
        verifiedByAdminId: "admin-1",
      });

      expect(result.accepted).toBe(false);
      expect(result.reason).toContain("documentReference");
    });

    it("accepts compliant resolution with verified contractual amendment and admin sign-off", () => {
      const result = validateQualificationConflictResolution({
        auditId: "QC-2026-PILOT-001",
        orderId: "ord-hist-pilot-3",
        workerId: "wrk-hist-pilot-3",
        chosenAction: "VERIFY_CONTRACTUAL_AMENDMENT",
        documentReference: "Zusatzvereinbarung Rahmenvertrag Nr. 2026-Z1 vom 10.10.2026",
        verifiedByAdminId: "admin-1",
        verificationNotes: "Kunde hat Einsatz von Pflegehelfer mit Vergütungsgruppe 2 genehmigt.",
      });

      expect(result.accepted).toBe(true);
    });

    it("extractQualificationConflictsFromAssignments extracts actual conflicts safely without PII", () => {
      const extracted = extractQualificationConflictsFromAssignments([
        {
          id: "asgn-10",
          order: {
            id: "ord-100",
            shiftDate: new Date("2026-09-15"),
            requiredQualification: "betreuungskraft",
          },
          worker: {
            id: "wrk-200",
            qualification: "pflegehelfer",
          },
        },
        {
          id: "asgn-11",
          order: {
            id: "ord-101",
            shiftDate: "2026-09-16",
            requiredQualification: "pflegefachkraft",
          },
          worker: {
            id: "wrk-201",
            qualification: "pflegefachkraft", // No conflict
          },
        },
      ]);

      expect(extracted).toHaveLength(1);
      expect(extracted[0].orderId).toBe("ord-100");
      expect(extracted[0].workerId).toBe("wrk-200");
      expect(extracted[0].requiredQualification).toBe("betreuungskraft");
      expect(extracted[0].workerQualification).toBe("pflegehelfer");
      expect(extracted[0].status).toBe("BLOCKED_PENDING_REVIEW");
      expect((extracted[0] as unknown as Record<string, unknown>).workerName).toBeUndefined();
    });
  });

  describe("6. Localization Completeness (DE, EN, AR)", () => {
    it("ensures financial retention and immutability error keys exist in all languages", () => {
      const de = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "messages/de.json"), "utf8"));
      const en = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "messages/en.json"), "utf8"));
      const ar = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "messages/ar.json"), "utf8"));

      expect(de.invoicing.historicalArchiveNotice).toBeDefined();
      expect(de.invoicing.historicalArchiveNotice.length).toBeGreaterThan(0);
      expect(de.invoicing.historicalPdfUnavailableTooltip).toBeDefined();
      expect(de.invoicing.historicalPdfUnavailableTooltip.length).toBeGreaterThan(0);
      expect(de.workers.hasFinancialRecords).toBeDefined();
      expect(de.clients.hasFinancialRecords).toBeDefined();
      expect(de.orders.lockedInvoiced).toBeDefined();
      expect(de.orders.invoiced).toBeDefined();

      expect(en.invoicing.historicalArchiveNotice).toBeDefined();
      expect(en.invoicing.historicalArchiveNotice.length).toBeGreaterThan(0);
      expect(en.invoicing.historicalPdfUnavailableTooltip).toBeDefined();
      expect(en.invoicing.historicalPdfUnavailableTooltip.length).toBeGreaterThan(0);
      expect(en.workers.hasFinancialRecords).toBeDefined();
      expect(en.clients.hasFinancialRecords).toBeDefined();
      expect(en.orders.lockedInvoiced).toBeDefined();
      expect(en.orders.invoiced).toBeDefined();

      expect(ar.invoicing.historicalArchiveNotice).toBeDefined();
      expect(ar.invoicing.historicalArchiveNotice.length).toBeGreaterThan(0);
      expect(ar.invoicing.historicalPdfUnavailableTooltip).toBeDefined();
      expect(ar.invoicing.historicalPdfUnavailableTooltip.length).toBeGreaterThan(0);
      expect(ar.workers.hasFinancialRecords).toBeDefined();
      expect(ar.clients.hasFinancialRecords).toBeDefined();
      expect(ar.orders.lockedInvoiced).toBeDefined();
      expect(ar.orders.invoiced).toBeDefined();
    });
  });

  describe("7. Server-side Deletion Guards & Financial Immutability (§ 147 AO / GoBD)", () => {
    it("deleteInvoice throws permanent fail-closed exception and never deletes invoice rows", async () => {
      const { prisma } = await import("@/lib/prisma");
      await expect(deleteInvoice("inv-del-1")).rejects.toThrow(
        "Das physische Löschen von Rechnungen ist serverseitig permanent verboten (GoBD- und Revisionskonformität)"
      );
      expect(prisma.invoice.delete).not.toHaveBeenCalled();
    });

    it("deleteClient blocks deletion with hasFinancialRecords when invoices exist", async () => {
      const { prisma } = await import("@/lib/prisma");
      vi.mocked(prisma.client.findUnique).mockResolvedValueOnce({
        id: "client-1",
        userId: "user-1",
      } as any);
      vi.mocked(prisma.invoice.count).mockResolvedValueOnce(2);
      vi.mocked(prisma.assignment.count).mockResolvedValueOnce(0);

      const res = await deleteClient("client-1");
      expect(res.ok).toBe(false);
      expect(res.error).toBe("hasFinancialRecords");
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it("deleteClient blocks deletion with hasFinancialRecords when invoiced assignments exist", async () => {
      const { prisma } = await import("@/lib/prisma");
      vi.mocked(prisma.client.findUnique).mockResolvedValueOnce({
        id: "client-1",
        userId: "user-1",
      } as any);
      vi.mocked(prisma.invoice.count).mockResolvedValueOnce(0);
      vi.mocked(prisma.assignment.count).mockResolvedValueOnce(3);

      const res = await deleteClient("client-1");
      expect(res.ok).toBe(false);
      expect(res.error).toBe("hasFinancialRecords");
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it("deleteClient succeeds when client has zero invoices and zero invoiced assignments", async () => {
      const { prisma } = await import("@/lib/prisma");
      vi.mocked(prisma.client.findUnique).mockResolvedValueOnce({
        id: "client-clean",
        userId: "user-clean",
      } as any);
      vi.mocked(prisma.invoice.count).mockResolvedValueOnce(0);
      vi.mocked(prisma.assignment.count).mockResolvedValueOnce(0);
      vi.mocked(prisma.user.delete).mockResolvedValueOnce({} as any);

      const res = await deleteClient("client-clean");
      expect(res.ok).toBe(true);
      expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: "user-clean" } });
    });

    it("deleteWorker blocks deletion with hasFinancialRecords when invoiced assignments exist", async () => {
      const { prisma } = await import("@/lib/prisma");
      vi.mocked(prisma.worker.findUnique).mockResolvedValueOnce({
        id: "wrk-1",
        userId: "usr-w-1",
      } as any);
      vi.mocked(prisma.assignment.count).mockResolvedValueOnce(4);

      const res = await deleteWorker("wrk-1");
      expect(res.ok).toBe(false);
      expect(res.error).toBe("hasFinancialRecords");
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it("deleteWorker succeeds when worker has zero invoiced assignments", async () => {
      const { prisma } = await import("@/lib/prisma");
      vi.mocked(prisma.worker.findUnique).mockResolvedValueOnce({
        id: "wrk-clean",
        userId: "usr-w-clean",
      } as any);
      vi.mocked(prisma.assignment.count).mockResolvedValueOnce(0);
      vi.mocked(prisma.user.delete).mockResolvedValueOnce({} as any);

      const res = await deleteWorker("wrk-clean");
      expect(res.ok).toBe(true);
      expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: "usr-w-clean" } });
    });

    it("deleteOpenOrderFromGrid blocks deletion with lockedInvoiced when invoiced assignments exist", async () => {
      const { prisma } = await import("@/lib/prisma");
      const validUuid = "11111111-1111-4111-8111-111111111111";
      vi.mocked(prisma.order.findUnique)
        .mockResolvedValueOnce({
          id: validUuid,
          status: "pending",
          shiftDate: new Date(),
          startTime: "08:00",
          endTime: "16:00",
          requiredQualification: "pflegefachkraft",
          quantity: 1,
          client: { id: "cl-1", userId: "u-1", facilityName: "Klinik" },
        } as any)
        .mockResolvedValueOnce({
          status: "pending",
        } as any);
      vi.mocked(prisma.assignment.count).mockResolvedValueOnce(1);

      const res = await deleteOpenOrderFromGrid(validUuid);
      expect(res.ok).toBe(false);
      expect(res.error).toBe("lockedInvoiced");
      expect(prisma.order.delete).not.toHaveBeenCalled();
    });

    it("cancelOrderRequestAsAdmin blocks deletion with lockedInvoiced when invoiced assignments exist", async () => {
      const { prisma } = await import("@/lib/prisma");
      vi.mocked(prisma.order.findMany).mockResolvedValueOnce([
        {
          id: "ord-grp-1",
          clientId: "cl-1",
          status: "pending",
          shiftDate: new Date(),
          startTime: "08:00",
          endTime: "16:00",
          requiredQualification: "pflegefachkraft",
          quantity: 1,
          notes: null,
        },
      ] as any);
      vi.mocked(prisma.assignment.count).mockResolvedValueOnce(1);

      const res = await cancelOrderRequestAsAdmin("req-grp-1");
      expect(res.ok).toBe(false);
      expect(res.error).toBe("lockedInvoiced");
    });
  });

  describe("8. Monetary Totals Conflict (Subtotal, Tax, Total) Fail-Closed Protection", () => {
    const validSnapshot = {
      facilityName: "Residenz Ahr",
      address: "Hauptstr. 1, 53474 Bad Neuenahr",
      paymentTermsDays: 14,
      date: "2025-10-01",
      items: [
        {
          pos: 1,
          description: "Dienst",
          hours: "10,00",
          rate: "50,00",
          amount: "500,00 €",
        },
      ],
      subtotalCents: 50000,
      subtotal: "500,00 €",
      taxAmountCents: 9500,
      taxAmount: "95,00 €",
      totalCents: 59500,
      total: "595,00 €",
    };

    it("validateSnapshotMonetaryTotals validates matching integer cents and formatted strings successfully", () => {
      const result = validateSnapshotMonetaryTotals(validSnapshot);
      expect(result).not.toBeNull();
      expect(result?.subtotalCents).toBe(50000);
      expect(result?.taxAmountCents).toBe(9500);
      expect(result?.totalCents).toBe(59500);
      expect(result?.subtotalDisplay).toBe("500,00 €");
      expect(result?.taxAmountDisplay).toBe("95,00 €");
      expect(result?.totalDisplay).toBe("595,00 €");
    });

    it("validateSnapshotMonetaryTotals returns null when subtotalCents conflicts with subtotal text string", () => {
      const conflictSnapshot = {
        ...validSnapshot,
        subtotalCents: 50000,
        subtotal: "600,00 €", // 60000 != 50000
      };
      const result = validateSnapshotMonetaryTotals(conflictSnapshot);
      expect(result).toBeNull();
    });

    it("validateSnapshotMonetaryTotals returns null when taxAmountCents conflicts with taxAmount text string", () => {
      const conflictSnapshot = {
        ...validSnapshot,
        taxAmountCents: 9500,
        taxAmount: "120,00 €", // 12000 != 9500
      };
      const result = validateSnapshotMonetaryTotals(conflictSnapshot);
      expect(result).toBeNull();
    });

    it("validateSnapshotMonetaryTotals returns null when totalCents conflicts with total text string", () => {
      const conflictSnapshot = {
        ...validSnapshot,
        totalCents: 59500,
        total: "720,00 €", // 72000 != 59500
      };
      const result = validateSnapshotMonetaryTotals(conflictSnapshot);
      expect(result).toBeNull();
    });

    it("hasReliableInvoiceDocument returns false when snapshot has monetary totals conflict", () => {
      const invoice = {
        id: "inv-tot-conflict",
        snapshotData: {
          ...validSnapshot,
          subtotalCents: 50000,
          subtotal: "600,00 €",
        },
      };
      expect(hasReliableInvoiceDocument(invoice)).toBe(false);
    });

    it("isCompleteFrozenSnapshot returns complete: false with descriptive reason on monetary totals conflict", async () => {
      const conflictSnapshot = {
        ...validSnapshot,
        subtotalCents: 50000,
        subtotal: "600,00 €",
      };
      const result = await isCompleteFrozenSnapshot(
        conflictSnapshot,
        { netAmount: 500, vatAmount: 95, grossAmount: 595, date: "2025-10-01" },
        { skipPdfSimulation: true }
      );
      expect(result.complete).toBe(false);
      expect(result.reason).toContain("widersprüchliche");
    });

    it("buildInvoicePdfData throws fail-closed error on monetary totals conflict in historical snapshot", () => {
      const conflictInvoice = {
        invoiceNumber: "RE-2025-BUILDER-TOT-CONFLICT",
        date: new Date("2025-10-01"),
        netAmount: 500,
        vatAmount: 95,
        grossAmount: 595,
        snapshotData: {
          ...validSnapshot,
          subtotalCents: 50000,
          subtotal: "600,00 €",
        },
      };
      const client = {
        id: "c-1",
        facilityName: "Residenz Ahr",
        address: "Hauptstr. 1, 53474 Bad Neuenahr",
        paymentTermsDays: 14,
      };
      expect(() => buildInvoicePdfData(conflictInvoice as any, client as any, [])).toThrow(
        /widersprüchliche Gesamtbeträge/
      );
    });

    it("PDF route GET /api/invoices/[id]/pdf returns 422 when historical snapshot has monetary totals conflict", async () => {
      const { prisma } = await import("@/lib/prisma");
      const { getCurrentUser } = await import("@/lib/auth");
      vi.mocked(getCurrentUser).mockResolvedValueOnce({
        id: "admin-1",
        role: "admin",
      } as any);

      vi.mocked(prisma.invoice.findUnique).mockResolvedValueOnce({
        id: "inv-pdf-tot-conflict",
        invoiceNumber: "RE-2025-PDF-TOT-CONFLICT",
        date: new Date("2025-10-01"),
        netAmount: 500,
        vatAmount: 95,
        grossAmount: 595,
        status: "sent",
        pdfUrl: null,
        snapshotData: {
          ...validSnapshot,
          subtotalCents: 50000,
          subtotal: "600,00 €",
        },
        client: {
          id: "client-1",
          facilityName: "Residenz Ahr",
          address: "Hauptstr. 1, 53474 Bad Neuenahr",
          paymentTermsDays: 14,
        },
        assignments: [],
      } as any);

      const req = new Request("http://localhost:3000/api/invoices/inv-pdf-tot-conflict/pdf");
      const res = await getInvoicePdfRoute(req, { params: Promise.resolve({ id: "inv-pdf-tot-conflict" }) });
      expect(res.status).toBe(422);
    });

    it("Bulk PDF route GET /api/invoices/bulk-pdf returns 422 when historical snapshot has monetary totals conflict", async () => {
      const { prisma } = await import("@/lib/prisma");
      const { getCurrentUser } = await import("@/lib/auth");
      vi.mocked(getCurrentUser).mockResolvedValueOnce({
        id: "admin-1",
        role: "admin",
      } as any);

      vi.mocked(prisma.invoice.findMany).mockResolvedValueOnce([
        {
          id: "inv-bulk-tot-conflict",
          invoiceNumber: "RE-2025-BULK-TOT-CONFLICT",
          date: new Date("2025-10-01"),
          netAmount: 500,
          vatAmount: 95,
          grossAmount: 595,
          status: "sent",
          pdfUrl: null,
          snapshotData: {
            ...validSnapshot,
            subtotalCents: 50000,
            subtotal: "600,00 €",
          },
          client: {
            id: "client-1",
            facilityName: "Residenz Ahr",
            address: "Hauptstr. 1, 53474 Bad Neuenahr",
            paymentTermsDays: 14,
          },
          assignments: [],
        },
      ] as any);

      const req = new Request("http://localhost:3000/api/invoices/bulk-pdf?ids=inv-bulk-tot-conflict");
      const res = await getBulkPdfRoute(req);
      expect(res.status).toBe(422);
    });

    it("sendInvoiceEmail fails closed and dispatches zero emails when snapshot has monetary totals conflict", async () => {
      const { prisma } = await import("@/lib/prisma");
      const { sendEmailToRecipients } = await import("@/lib/email");
      vi.mocked(sendEmailToRecipients).mockClear();

      vi.mocked(prisma.invoice.findUnique).mockResolvedValueOnce({
        id: "inv-email-tot-conflict",
        invoiceNumber: "RE-2025-EMAIL-TOT-CONFLICT",
        date: new Date("2025-10-01"),
        netAmount: 500,
        vatAmount: 95,
        grossAmount: 595,
        status: "sent",
        pdfUrl: null,
        snapshotData: {
          ...validSnapshot,
          subtotalCents: 50000,
          subtotal: "600,00 €",
        },
        client: {
          id: "client-1",
          facilityName: "Residenz Ahr",
          address: "Hauptstr. 1, 53474 Bad Neuenahr",
          billingEmail: "buchhaltung@example.com",
          paymentTermsDays: 14,
          user: null,
          subUsers: [],
        },
        assignments: [],
      } as any);

      await expect(
        sendInvoiceEmail({ invoiceId: "inv-email-tot-conflict" })
      ).rejects.toThrow(
        "E-Mail-Versand abgebrochen: Für diese historische Rechnung ist weder ein verifiziertes Originaldokument noch ein vollständiger eingefrorener Snapshot hinterlegt"
      );

      expect(sendEmailToRecipients).not.toHaveBeenCalled();
    });
  });

  describe("Phase 07e Review Remediation - Atomic Cancellation, Historical Links, Seed Purge, Migration Hardening", () => {
    it("cancelInvoice runs an atomic transaction that creates an in-transaction audit log and preserves historical references", async () => {
      const { cancelInvoice } = await import("@/app/[locale]/admin/orders/[id]/invoice-actions");
      const { prisma } = await import("@/lib/prisma");

      const mockInvoice = {
        id: "inv-to-cancel-1",
        status: "unpaid",
        snapshotData: {
          items: [{ line: 1, amountCents: 10000 }],
        },
        assignments: [
          { id: "asgn-c-1", workerId: "worker-c-1", orderId: "order-c-1" },
          { id: "asgn-c-2", workerId: "worker-c-2", orderId: "order-c-1" },
        ],
      };

      vi.mocked(prisma.invoice.findUnique).mockResolvedValueOnce(mockInvoice as any);

      let txAssignmentUpdateManyCalled = false;
      let txInvoiceUpdateCalled = false;
      let txAuditLogCreateCalled = false;
      let capturedInvoiceUpdateData: any = null;
      let capturedAuditLogData: any = null;

      const mockTx = {
        assignment: {
          updateMany: vi.fn().mockImplementation(async (args) => {
            txAssignmentUpdateManyCalled = true;
            expect(args.where.invoiceId).toBe("inv-to-cancel-1");
            expect(args.data.invoiceId).toBeNull();
            return { count: 2 };
          }),
        },
        invoice: {
          findUnique: vi.fn().mockResolvedValue(mockInvoice),
          update: vi.fn().mockImplementation(async (args) => {
            txInvoiceUpdateCalled = true;
            capturedInvoiceUpdateData = args.data;
            return { id: "inv-to-cancel-1", ...args.data };
          }),
        },
        auditLog: {
          create: vi.fn().mockImplementation(async (args) => {
            txAuditLogCreateCalled = true;
            capturedAuditLogData = args.data;
            return { id: "audit-1", ...args.data };
          }),
        },
      };

      vi.mocked(prisma.$transaction).mockImplementationOnce(async (callback: any) => {
        if (typeof callback === "function") {
          return await callback(mockTx);
        }
        throw new Error("Expected interactive transaction callback");
      });

      await cancelInvoice("inv-to-cancel-1");

      expect(txAssignmentUpdateManyCalled).toBe(true);
      expect(txInvoiceUpdateCalled).toBe(true);
      expect(txAuditLogCreateCalled).toBe(true);

      expect(capturedInvoiceUpdateData.status).toBe("cancelled");
      expect(capturedInvoiceUpdateData.snapshotData.historicalAssignmentIds).toEqual([
        "asgn-c-1",
        "asgn-c-2",
      ]);
      expect(capturedInvoiceUpdateData.snapshotData.historicalWorkerIds).toEqual([
        "worker-c-1",
        "worker-c-2",
      ]);
      expect(capturedInvoiceUpdateData.snapshotData.historicalOrderIds).toEqual([
        "order-c-1",
      ]);
      expect(capturedInvoiceUpdateData.snapshotData.cancellationHistory).toBeDefined();
      expect(capturedInvoiceUpdateData.snapshotData.cancellationHistory.releasedAssignmentCount).toBe(2);

      expect(capturedAuditLogData.action).toBe("invoice.cancel");
      expect(capturedAuditLogData.entity).toBe("Invoice");
      expect(capturedAuditLogData.entityId).toBe("inv-to-cancel-1");
      expect(capturedAuditLogData.metadata.assignmentCount).toBe(2);
    });

    it("cancelInvoice rejects already cancelled invoice and prevents duplicate cancellationHistory or audit log (idempotency guard)", async () => {
      const { cancelInvoice } = await import("@/app/[locale]/admin/orders/[id]/invoice-actions");
      const { prisma } = await import("@/lib/prisma");

      const alreadyCancelledInvoice = {
        id: "inv-already-cancelled",
        status: "cancelled",
        snapshotData: {
          cancellationHistory: {
            cancelledAt: "2026-10-10T10:00:00.000Z",
            cancelledByUserId: "admin-prior",
          },
        },
        assignments: [],
      };

      const mockTx = {
        invoice: {
          findUnique: vi.fn().mockResolvedValue(alreadyCancelledInvoice),
          update: vi.fn(),
        },
        assignment: { updateMany: vi.fn() },
        auditLog: { create: vi.fn() },
      };

      vi.mocked(prisma.$transaction).mockImplementationOnce(async (callback: any) => {
        return await callback(mockTx);
      });

      await expect(cancelInvoice("inv-already-cancelled")).rejects.toThrow(
        "Rechnung ist bereits storniert."
      );

      expect(mockTx.assignment.updateMany).not.toHaveBeenCalled();
      expect(mockTx.invoice.update).not.toHaveBeenCalled();
      expect(mockTx.auditLog.create).not.toHaveBeenCalled();
    });

    it("cancelInvoice fails closed if the in-transaction audit log creation fails (zero cancellation without audit)", async () => {
      const { cancelInvoice } = await import("@/app/[locale]/admin/orders/[id]/invoice-actions");
      const { prisma } = await import("@/lib/prisma");

      const mockInvoice = {
        id: "inv-to-cancel-fail-audit",
        status: "unpaid",
        snapshotData: {},
        assignments: [{ id: "asgn-f-1", workerId: "worker-f-1", orderId: "order-f-1" }],
      };

      vi.mocked(prisma.invoice.findUnique).mockResolvedValueOnce(mockInvoice as any);

      const mockTx = {
        assignment: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        invoice: {
          findUnique: vi.fn().mockResolvedValue(mockInvoice),
          update: vi.fn().mockResolvedValue({ id: "inv-to-cancel-fail-audit" }),
        },
        auditLog: {
          create: vi.fn().mockRejectedValue(new Error("Audit log database failure")),
        },
      };

      vi.mocked(prisma.$transaction).mockImplementationOnce(async (callback: any) => {
        return await callback(mockTx);
      });

      await expect(cancelInvoice("inv-to-cancel-fail-audit")).rejects.toThrow(
        "Audit log database failure"
      );
    });

    it("cancelInvoice fails closed if tx.auditLog.create is missing or undefined (strictly requires in-transaction auditLog)", async () => {
      const { cancelInvoice } = await import("@/app/[locale]/admin/orders/[id]/invoice-actions");
      const { prisma } = await import("@/lib/prisma");

      const mockInvoice = {
        id: "inv-to-cancel-missing-audit",
        status: "unpaid",
        snapshotData: {},
        assignments: [{ id: "asgn-m-1", workerId: "worker-m-1", orderId: "order-m-1" }],
      };

      vi.mocked(prisma.invoice.findUnique).mockResolvedValueOnce(mockInvoice as any);

      const mockTx = {
        assignment: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        invoice: {
          findUnique: vi.fn().mockResolvedValue(mockInvoice),
          update: vi.fn().mockResolvedValue({ id: "inv-to-cancel-missing-audit" }),
        },
        auditLog: undefined,
      };

      vi.mocked(prisma.$transaction).mockImplementationOnce(async (callback: any) => {
        return await callback(mockTx);
      });

      await expect(cancelInvoice("inv-to-cancel-missing-audit")).rejects.toThrow(
        "Audit-Log-Delegate fehlt in der Transaktion"
      );
      expect(mockTx.assignment.updateMany).not.toHaveBeenCalled();
      expect(mockTx.invoice.update).not.toHaveBeenCalled();
    });

    it("updateOrderRequestAsAdmin blocks deleting shifts with lockedInvoiced when order or its assignment has historical invoice record in snapshotData", async () => {
      const { updateOrderRequestAsAdmin } = await import("@/app/[locale]/admin/orders/actions");
      const { prisma } = await import("@/lib/prisma");

      const requestGroupId = "req-hist-1";
      const clientId = "client-hist-1";
      const orderIdToDelete = "ord-hist-to-delete";

      // 1. Existing orders for requestGroupId
      vi.mocked(prisma.order.findMany).mockResolvedValueOnce([
        {
          id: orderIdToDelete,
          clientId,
          status: "pending",
          shiftDate: new Date("2026-10-15T00:00:00.000Z"),
          requiredQualification: "pflegefachkraft",
          startTime: "08:00",
          endTime: "16:00",
          breakMinutes: 30,
          quantity: 1,
          notes: null,
        },
      ] as any);

      // 2. deletedOrders findMany
      vi.mocked(prisma.order.findMany).mockResolvedValueOnce([
        {
          id: orderIdToDelete,
          shiftDate: new Date("2026-10-15T00:00:00.000Z"),
          startTime: "08:00",
          endTime: "16:00",
          requiredQualification: "pflegefachkraft",
          notes: null,
          quantity: 1,
          client: { id: clientId, facilityName: "Seniorenresidenz" },
        },
      ] as any);

      // 3. assignments of deletedOrders
      vi.mocked(prisma.assignment.findMany).mockResolvedValueOnce([
        {
          id: "asgn-hist-to-delete",
          worker: { userId: "user-w-1" },
          order: {
            shiftDate: new Date("2026-10-15T00:00:00.000Z"),
            startTime: "08:00",
            endTime: "16:00",
            requiredQualification: "pflegefachkraft",
            notes: null,
            client: { facilityName: "Seniorenresidenz" },
          },
        },
      ] as any);

      // Interactive transaction mock for deletion with historical invoice:
      const mockTx = {
        assignment: {
          findMany: vi.fn().mockResolvedValueOnce([{ id: "asgn-hist-to-delete" }]),
          count: vi.fn().mockResolvedValueOnce(0),
          findUnique: vi.fn().mockResolvedValueOnce({ invoiceId: null }),
        },
        order: {
          deleteMany: vi.fn(),
          update: vi.fn(),
          createMany: vi.fn(),
          updateMany: vi.fn(),
        },
        invoice: {
          findMany: vi.fn().mockResolvedValueOnce([
            {
              snapshotData: {
                status: "cancelled",
                historicalAssignmentIds: ["asgn-hist-to-delete"],
              },
            },
          ]),
        },
        $queryRaw: vi.fn().mockResolvedValue([{ id: "asgn-hist-to-delete" }]),
      };

      vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => {
        return await cb(mockTx);
      });

      // Input has a new shift, omitting orderIdToDelete
      const res = await updateOrderRequestAsAdmin(requestGroupId, {
        shifts: [
          {
            date: "2026-10-16",
            requiredQualification: "pflegefachkraft",
            startTime: "09:00",
            endTime: "17:00",
            pause: 30,
            quantity: 1,
          },
        ],
      });

      expect(res).toEqual({ ok: false, error: "lockedInvoiced" });
      expect(mockTx.order.deleteMany).not.toHaveBeenCalled();
    });

    it("updateOrderRequestAsAdmin aborts and rolls back with lockedInvoiced when concurrent process invoices assignment during transaction (race condition guard)", async () => {
      const { updateOrderRequestAsAdmin } = await import("@/app/[locale]/admin/orders/actions");
      const { prisma } = await import("@/lib/prisma");

      const requestGroupId = "req-race-1";
      const clientId = "client-race-1";
      const orderIdToDelete = "ord-race-to-delete";

      vi.mocked(prisma.order.findMany).mockResolvedValueOnce([
        {
          id: orderIdToDelete,
          clientId,
          status: "pending",
          shiftDate: new Date("2026-10-15T00:00:00.000Z"),
          requiredQualification: "pflegefachkraft",
          startTime: "08:00",
          endTime: "16:00",
          breakMinutes: 30,
          quantity: 1,
          notes: null,
        },
      ] as any);

      vi.mocked(prisma.order.findMany).mockResolvedValueOnce([
        {
          id: orderIdToDelete,
          shiftDate: new Date("2026-10-15T00:00:00.000Z"),
          startTime: "08:00",
          endTime: "16:00",
          requiredQualification: "pflegefachkraft",
          notes: null,
          quantity: 1,
          client: { id: clientId, facilityName: "Seniorenresidenz" },
        },
      ] as any);

      vi.mocked(prisma.assignment.findMany).mockResolvedValueOnce([
        {
          id: "asgn-race-2",
          worker: { userId: "user-w-race" },
          order: {
            shiftDate: new Date("2026-10-15T00:00:00.000Z"),
            startTime: "08:00",
            endTime: "16:00",
            requiredQualification: "pflegefachkraft",
            notes: null,
            client: { facilityName: "Seniorenresidenz" },
          },
        },
      ] as any);

      const mockTx = {
        assignment: {
          findMany: vi.fn().mockResolvedValueOnce([{ id: "asgn-race-2" }]),
          count: vi.fn().mockResolvedValueOnce(1), // Concurrently invoiced!
        },
        order: {
          deleteMany: vi.fn(),
          update: vi.fn(),
          createMany: vi.fn(),
          updateMany: vi.fn(),
        },
        invoice: { findMany: vi.fn().mockResolvedValue([]) },
        $queryRaw: vi.fn().mockResolvedValue([{ id: "asgn-race-2" }]),
      };

      vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => {
        return await cb(mockTx);
      });

      const res = await updateOrderRequestAsAdmin(requestGroupId, {
        shifts: [
          {
            date: "2026-10-16",
            requiredQualification: "pflegefachkraft",
            startTime: "09:00",
            endTime: "17:00",
            pause: 30,
            quantity: 1,
          },
        ],
      });

      expect(res).toEqual({ ok: false, error: "lockedInvoiced" });
      expect(mockTx.order.deleteMany).not.toHaveBeenCalled();
    });

    it("deleteOpenOrderFromGrid blocks order deletion with lockedInvoiced when order or its assignment is preserved in cancelled invoice snapshotData", async () => {
      const { deleteOpenOrderFromGrid } = await import("@/app/[locale]/admin/schedule/actions");
      const { prisma } = await import("@/lib/prisma");

      const validUuid = "33333333-3333-4333-8333-333333333333";
      vi.mocked(prisma.order.findUnique).mockResolvedValueOnce({
        id: validUuid,
        status: "pending",
        shiftDate: new Date(),
        startTime: "08:00",
        endTime: "16:00",
        requiredQualification: "pflegefachkraft",
        quantity: 1,
        client: { id: "cl-1", userId: "u-1", facilityName: "Klinik" },
      } as any);

      const mockTx = {
        assignment: {
          findMany: vi.fn().mockResolvedValueOnce([{ id: "asgn-del-1" }]),
          count: vi.fn().mockResolvedValueOnce(0),
          findUnique: vi.fn().mockResolvedValueOnce({ invoiceId: null }),
        },
        order: {
          findUnique: vi.fn().mockResolvedValueOnce({ status: "pending" }),
          delete: vi.fn(),
        },
        invoice: {
          findMany: vi.fn().mockResolvedValueOnce([
            {
              snapshotData: {
                status: "cancelled",
                historicalOrderIds: [validUuid],
              },
            },
          ]),
        },
        $queryRaw: vi.fn().mockResolvedValue([{ id: "asgn-del-1" }]),
      };

      vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => {
        return await cb(mockTx);
      });

      const res = await deleteOpenOrderFromGrid(validUuid);
      expect(res.ok).toBe(false);
      expect(res.error).toBe("lockedInvoiced");
      expect(mockTx.order.delete).not.toHaveBeenCalled();
    });

    it("deleteOpenOrderFromGrid aborts and rolls back with lockedInvoiced when concurrent process invoices assignment during transaction (race condition guard)", async () => {
      const { deleteOpenOrderFromGrid } = await import("@/app/[locale]/admin/schedule/actions");
      const { prisma } = await import("@/lib/prisma");

      const validUuid = "44444444-4444-4444-8444-444444444444";
      vi.mocked(prisma.order.findUnique).mockResolvedValueOnce({
        id: validUuid,
        status: "pending",
        shiftDate: new Date(),
        startTime: "08:00",
        endTime: "16:00",
        requiredQualification: "pflegefachkraft",
        quantity: 1,
        client: { id: "cl-1", userId: "u-1", facilityName: "Klinik" },
      } as any);

      const mockTx = {
        assignment: {
          findMany: vi.fn().mockResolvedValueOnce([{ id: "asgn-race-1" }]),
          count: vi.fn().mockResolvedValueOnce(1), // Concurrently invoiced!
        },
        order: {
          findUnique: vi.fn().mockResolvedValueOnce({ status: "pending" }),
          delete: vi.fn(),
        },
        invoice: { findMany: vi.fn().mockResolvedValue([]) },
        $queryRaw: vi.fn().mockResolvedValue([{ id: "asgn-race-1" }]),
      };

      vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => {
        return await cb(mockTx);
      });

      const res = await deleteOpenOrderFromGrid(validUuid);
      expect(res.ok).toBe(false);
      expect(res.error).toBe("lockedInvoiced");
    });

    it("deleteWorker is prevented with hasFinancialRecords when worker is preserved in cancelled invoice snapshotData (even after invoiceId is detached)", async () => {
      const { deleteWorker } = await import("@/app/[locale]/admin/workers/actions");
      const { prisma } = await import("@/lib/prisma");

      vi.mocked(prisma.worker.findUnique).mockResolvedValueOnce({
        id: "worker-historically-cancelled",
        userId: "user-w-1",
      } as any);

      // Active invoiced assignments are 0 because invoice was cancelled and invoiceId cleared
      vi.mocked(prisma.assignment.count).mockResolvedValueOnce(0);

      // But invoice snapshotData preserves the worker in historicalWorkerIds
      vi.mocked(prisma.invoice.findMany).mockResolvedValueOnce([
        {
          snapshotData: {
            status: "cancelled",
            historicalWorkerIds: ["worker-historically-cancelled"],
          },
        },
      ] as any);

      const res = await deleteWorker("worker-historically-cancelled");
      expect(res).toEqual({ ok: false, error: "hasFinancialRecords" });
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it("hasHistoricalInvoiceRecordForAssignment returns true when assignment is preserved in cancelled invoice snapshotData", async () => {
      const { hasHistoricalInvoiceRecordForAssignment } = await import("@/lib/invoicing");
      const { prisma } = await import("@/lib/prisma");

      // Assignment has invoiceId: null
      vi.mocked(prisma.assignment.findUnique).mockResolvedValueOnce({
        invoiceId: null,
      } as any);

      // But invoice snapshotData preserves the assignment in historicalAssignmentIds
      vi.mocked(prisma.invoice.findMany).mockResolvedValueOnce([
        {
          snapshotData: {
            historicalAssignmentIds: ["asgn-historically-cancelled-99"],
          },
        },
      ] as any);

      const hasHistory = await hasHistoricalInvoiceRecordForAssignment(
        "asgn-historically-cancelled-99"
      );
      expect(hasHistory).toBe(true);
    });

    it("deleteClient catches database foreign key constraint violation (P2003 / P2014) and safely returns hasFinancialRecords", async () => {
      const { deleteClient } = await import("@/app/[locale]/admin/clients/actions");
      const { prisma } = await import("@/lib/prisma");

      vi.mocked(prisma.client.findUnique).mockResolvedValueOnce({
        id: "client-fk-race",
        userId: "user-client-fk-race",
      } as any);

      // Pre-check count returns 0 (e.g. race condition where an invoice is inserted concurrently right after)
      vi.mocked(prisma.invoice.count).mockResolvedValueOnce(0);
      vi.mocked(prisma.assignment.count).mockResolvedValueOnce(0);

      // PostgreSQL ON DELETE RESTRICT raises foreign key violation
      const fkError = new Error("Foreign key constraint failed on the field: `invoices_client_id_fkey`");
      (fkError as any).code = "P2003";
      vi.mocked(prisma.user.delete).mockRejectedValueOnce(fkError);

      const res = await deleteClient("client-fk-race");
      expect(res).toEqual({ ok: false, error: "hasFinancialRecords" });
    });

    it("scripts/seed-demo.mjs contains zero destructive logic, zero deleteMany calls, and zero Supabase user deletion", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const seedContent = fs.readFileSync(
        path.join(process.cwd(), "scripts/seed-demo.mjs"),
        "utf8"
      );

      expect(seedContent).not.toContain("deleteMany");
      expect(seedContent).not.toContain("deleteUser");
      expect(seedContent).not.toContain("PrismaClient");
      expect(seedContent).not.toContain("createClient");
      expect(seedContent).toContain("process.exit(1)");
    });

    it("verifies migration SQL for invoices.client_id enforces ON DELETE RESTRICT", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const migrationSql = fs.readFileSync(
        path.join(
          process.cwd(),
          "prisma/migrations/20261012_phase_07e_invoice_client_delete_restrict/migration.sql"
        ),
        "utf8"
      );

      expect(migrationSql).toContain('ALTER TABLE "invoices"');
      expect(migrationSql).toContain('DROP CONSTRAINT IF EXISTS "invoices_client_id_fkey"');
      expect(migrationSql).toContain('ADD CONSTRAINT "invoices_client_id_fkey"');
      expect(migrationSql).toContain('REFERENCES "clients"("id")');
      expect(migrationSql).toContain("ON DELETE RESTRICT");
      expect(migrationSql).toContain("ON UPDATE CASCADE");
    });
  });
});
