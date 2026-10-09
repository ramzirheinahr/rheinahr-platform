import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildInvoicePdfData } from "@/lib/invoice-pdf-builder";
import { generateOrderInvoices } from "@/app/[locale]/admin/orders/[id]/invoice-actions";
import { generateMonthInvoices } from "@/app/[locale]/admin/clients/[id]/schedule/invoice-actions";
import {
  CALCULATION_VERSIONS,
  isLegacyCalculationVersion,
  isV2CalculationVersion,
  resolveInvoiceCalculationVersion,
} from "@/lib/invoice-calculation-version";
import {
  sendEmailToRecipients,
  sendEmailToRecipientsWithReport,
  sendEmailToUsers,
} from "@/lib/email";

// Type definitions matching buildInvoicePdfData parameters
type PdfInvoice = Parameters<typeof buildInvoicePdfData>[0];
type PdfClient = Parameters<typeof buildInvoicePdfData>[1];
type PdfAssignments = Parameters<typeof buildInvoicePdfData>[2];
type InvoicePdfData = ReturnType<typeof buildInvoicePdfData>;

// In-memory persistent database store to test stateful operations
interface StoredInvoice {
  id: string;
  clientId: string;
  invoiceNumber: string;
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
  status: string;
  date: Date;
  snapshotData: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const dbStore = new Map<string, StoredInvoice>();

// In-memory users and outgoing email logs for realistic email testing
interface TestUser {
  id: string;
  email: string | null;
  fullName: string;
  active: boolean;
  receiveEmails: boolean;
}

const testUsers = new Map<string, TestUser>();
const loggedOutgoingEmails: Array<Record<string, unknown>> = [];

// Boundary mocks: only external I/O (Nodemailer transport, Prisma DB) is mocked
const smtpMocks = vi.hoisted(() => ({
  sendMail: vi.fn(),
  createTransport: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({
      sendMail: smtpMocks.sendMail,
    }),
  },
}));

const mocks = vi.hoisted(() => ({
  prisma: {
    invoice: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    assignment: { findMany: vi.fn(), updateMany: vi.fn() },
    client: { findUnique: vi.fn() },
    notification: { create: vi.fn() },
    systemSetting: { findMany: vi.fn() },
    user: { findMany: vi.fn(), findUnique: vi.fn() },
    outgoingEmail: { create: vi.fn() },
  },
  pdf: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireRole: vi.fn(async () => ({ id: "audit-admin" })) }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/pdf/invoice", () => ({ generateInvoicePdf: mocks.pdf }));
vi.mock("@/lib/pdf/generate-timesheets-pdf", () => ({
  generateLeistungsnachweisePdf: vi.fn(async () => null),
}));
vi.mock("@/lib/invoicing", () => ({
  qualLabel: { pflegefachkraft: "Pflegefachkraft", pflegehelfer: "Pflegehilfskraft" },
  generateUniqueInvoiceNumber: vi.fn(async () => "PHASE01-TEST"),
}));

const testClient = {
  id: "client-p1",
  userId: "user-p1",
  shortCode: "P01",
  internalNumber: "INT-01",
  facilityName: "Test Facility P1",
  address: "Test Street 1, 12345 City",
  billingEmail: "billing@client-p1.invalid",
  billingInfo: "VAT ID DE123456789",
  hourlyRates: { pflegefachkraft: 52.8, pflegehelfer: 30.0 },
  surchargeSat: 0.3,
  surchargeSun: 0.5,
  surchargeHoliday: 1.0,
  surchargeNight: 0.25,
  nightStart: "22:00",
  nightEnd: "06:00",
  paymentTermsDays: 14,
};

function createAssignment(
  id: string,
  dateStr: string,
  start: string,
  end: string,
  breakMin = 0,
  qual = "pflegefachkraft"
) {
  return {
    id,
    workerId: "worker-1",
    status: "confirmed",
    invoiceId: null,
    worker: { id: "worker-1", fullName: "Oso, Majed" },
    order: {
      requiredQualification: qual,
      shiftDate: new Date(`${dateStr}T00:00:00Z`),
      startTime: start,
      endTime: end,
      breakMinutes: breakMin,
      client: testClient,
      clientId: testClient.id,
      requestGroupId: "req-group-p1",
    },
  };
}

const assignments = [
  createAssignment("as-1", "2026-07-11", "06:05", "12:53"),
  createAssignment("as-2", "2026-07-12", "15:19", "21:08"),
];

describe("Phase 1 Acceptance Criteria Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbStore.clear();
    testUsers.clear();
    loggedOutgoingEmails.length = 0;

    // Reset SMTP environment variables to valid defaults
    process.env.SMTP_HOST = "smtp.test.invalid";
    process.env.SMTP_PORT = "465";
    process.env.SMTP_USER = "test-smtp-user";
    process.env.SMTP_PASSWORD = "test-smtp-password";
    process.env.EMAIL_FROM = "info@rheinahr-gmbh.de";

    // Reset client live rates
    testClient.hourlyRates = { pflegefachkraft: 52.8, pflegehelfer: 30.0 };

    // Default primary test user
    testUsers.set("user-p1", {
      id: "user-p1",
      email: "billing@client-p1.invalid",
      fullName: "Billing Contact P1",
      active: true,
      receiveEmails: true,
    });

    // Stateful Prisma user mocks
    mocks.prisma.user.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) => {
      const ids = where?.id?.in || [];
      return ids.map((id) => testUsers.get(id)).filter(Boolean);
    });

    mocks.prisma.user.findUnique.mockImplementation(async ({ where }: { where: { email?: string; id?: string } }) => {
      if (where.email) {
        for (const u of testUsers.values()) {
          if (u.email?.toLowerCase() === where.email.toLowerCase()) return u;
        }
        return null;
      }
      if (where.id) return testUsers.get(where.id) || null;
      return null;
    });

    // Stateful Prisma system setting mock: empty by default (relies on env)
    mocks.prisma.systemSetting.findMany.mockResolvedValue([]);

    // Outgoing email log mock
    mocks.prisma.outgoingEmail.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      loggedOutgoingEmails.push(data);
      return { id: `log-${loggedOutgoingEmails.length}`, ...data };
    });

    // Stateful Prisma invoice create mock: returns complete Invoice record
    mocks.prisma.invoice.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      const inv: StoredInvoice = {
        id: "inv-created-id",
        clientId: data.clientId as string,
        invoiceNumber: data.invoiceNumber as string,
        netAmount: data.netAmount as number,
        vatAmount: data.vatAmount as number,
        grossAmount: data.grossAmount as number,
        status: data.status as string,
        date: data.date as Date,
        snapshotData: JSON.parse(JSON.stringify(data.snapshotData)),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      dbStore.set(inv.id, inv);
      return inv;
    });

    // Stateful Prisma invoice update mock: returns complete Invoice record on success
    mocks.prisma.invoice.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const existing = dbStore.get(where.id);
      if (!existing) throw new Error(`Invoice not found: ${where.id}`);
      const updated: StoredInvoice = {
        ...existing,
        ...data,
        snapshotData: data.snapshotData
          ? JSON.parse(JSON.stringify(data.snapshotData))
          : existing.snapshotData,
        updatedAt: new Date(),
      };
      dbStore.set(where.id, updated);
      return updated;
    });

    mocks.prisma.client.findUnique.mockResolvedValue(testClient);
    mocks.prisma.assignment.findMany.mockResolvedValue(assignments);
    mocks.prisma.assignment.updateMany.mockResolvedValue({ count: assignments.length });
    mocks.pdf.mockResolvedValue(Buffer.from("mock-pdf-buffer"));
    smtpMocks.sendMail.mockResolvedValue({ messageId: "msg-default" });
  });

  it("Criterion 1: Absence of snapshot or absence of calculationVersion is treated as legacy-v1 without explicit tag", () => {
    const historicalInvoices = [
      { id: "inv-1", snapshotData: null },
      { id: "inv-2", snapshotData: undefined },
      { id: "inv-3", snapshotData: {} },
      { id: "inv-4", snapshotData: { items: [] } },
      { id: "inv-5", snapshotData: { calculationVersion: undefined } },
    ];

    for (const inv of historicalInvoices) {
      const res = resolveInvoiceCalculationVersion(inv.snapshotData);
      expect(res.status).toBe("resolved");
      if (res.status === "resolved") {
        expect(res.version).toBe("legacy-v1");
        expect(res.isLegacy).toBe(true);
        expect(res.isExplicit).toBe(false);
      }
      expect(isLegacyCalculationVersion(inv.snapshotData)).toBe(true);
      expect(isV2CalculationVersion(inv.snapshotData)).toBe(false);
    }
  });

  it("Criterion 2: Historical snapshot with mathematically incorrect numbers is returned as-is without repair", () => {
    const incorrectHistoricalSnapshot = {
      isFrozen: true,
      items: [
        {
          pos: 1,
          description: "Oso, Majed (Pflegefachkraft)",
          hours: "12,62",
          rate: "52,80",
          amount: "666,16 €", // Historical defective amount (math would be 666,34 €)
        },
      ],
      subtotal: "666,16 €",
      taxAmount: "126,57 €",
      total: "792,73 €",
      periodStart: "11.07.2026",
      periodEnd: "12.07.2026",
    };

    const inv = {
      invoiceNumber: "HIST-001",
      date: new Date("2026-07-15T12:00:00Z"),
      netAmount: 666.16,
      vatAmount: 126.57,
      grossAmount: 792.73,
      snapshotData: incorrectHistoricalSnapshot,
    };

    const pdfData = buildInvoicePdfData(
      inv as unknown as PdfInvoice,
      testClient as unknown as PdfClient,
      assignments as unknown as PdfAssignments
    );

    expect(pdfData.items).toHaveLength(1);
    expect(pdfData.items[0].hours).toBe("12,62");
    expect(pdfData.items[0].rate).toBe("52,80");
    expect(pdfData.items[0].amount).toBe("666,16 €");
    expect(pdfData.subtotal).toBe("666,16 €");
    expect(pdfData.taxAmount).toBe("126,57 €");
    expect(pdfData.total).toBe("792,73 €");
  });

  it("Criterion 3: Frozen historical snapshot returns exact saved values even if live shifts and rates change; no write", () => {
    const originalSnapshot = {
      isFrozen: true,
      date: "15.07.2026",
      periodStart: "01.07.2026",
      periodEnd: "31.07.2026",
      items: [
        {
          pos: 1,
          description: "Frozen item",
          hours: "10,00",
          rate: "40,00",
          amount: "400,00 €",
        },
      ],
      subtotal: "400,00 €",
      taxAmount: "76,00 €",
      total: "476,00 €",
    };

    const inv = {
      invoiceNumber: "FROZEN-001",
      date: new Date("2026-07-15T12:00:00Z"),
      netAmount: 400.0,
      vatAmount: 76.0,
      grossAmount: 476.0,
      snapshotData: originalSnapshot,
    };

    const modifiedClient = {
      ...testClient,
      hourlyRates: { pflegefachkraft: 99.0 },
    };
    const modifiedAssignments = [
      createAssignment("as-mod", "2026-07-01", "08:00", "20:00", 0),
    ];

    const pdfData = buildInvoicePdfData(
      inv as unknown as PdfInvoice,
      modifiedClient as unknown as PdfClient,
      modifiedAssignments as unknown as PdfAssignments
    );

    expect(pdfData.subtotal).toBe("400,00 €");
    expect(pdfData.total).toBe("476,00 €");
    expect(pdfData.items[0].rate).toBe("40,00");
    expect(pdfData.items[0].hours).toBe("10,00");
    expect(pdfData.periodStart).toBe("01.07.2026");
    expect(pdfData.periodEnd).toBe("31.07.2026");

    expect(mocks.prisma.invoice.update).not.toHaveBeenCalled();
    expect(mocks.prisma.invoice.create).not.toHaveBeenCalled();
  });

  it("Criterion 4: Corrupt tag, invalid structure, or unknown tag does NOT activate v2 and returns unsupported", () => {
    // 4a: Explicit corrupt tags in calculationVersion
    const corruptTags = [null, "", "   ", "\t", "v3", "future-v2.1", 99, false, true, {}, []];
    for (const tag of corruptTags) {
      const resolution = resolveInvoiceCalculationVersion({ calculationVersion: tag });
      expect(resolution.status).toBe("unsupported");
      expect(isV2CalculationVersion({ calculationVersion: tag })).toBe(false);
      expect(isLegacyCalculationVersion({ calculationVersion: tag })).toBe(false);
    }

    // 4b: Invalid non-null snapshot structures
    const invalidStructures = ["broken-string", 42, true, false, [], ["array-item"]];
    for (const invalid of invalidStructures) {
      const resolution = resolveInvoiceCalculationVersion(invalid);
      expect(resolution.status).toBe("unsupported");
      expect(isV2CalculationVersion(invalid)).toBe(false);
      expect(isLegacyCalculationVersion(invalid)).toBe(false);
    }
  });

  it("Criterion 5: Order invoice generation with email preserves frozen snapshot in final write and returns sent_and_recorded", async () => {
    const res = await generateOrderInvoices(
      assignments.map((a) => a.id),
      "ORD-TEST-01",
      ["target@example.invalid"],
      true,
      true
    );

    expect(res).toEqual({
      ok: true,
      invoiceId: "inv-created-id",
      emailDispatchStatus: "sent_and_recorded",
      emailDispatchReport: expect.objectContaining({
        acceptedCount: 1,
        failedCount: 0,
        acceptedRecipients: ["target@example.invalid"],
      }),
    });

    expect(smtpMocks.sendMail).toHaveBeenCalledOnce();
    expect(mocks.prisma.invoice.update).toHaveBeenCalledTimes(2);

    const freezeUpdate = mocks.prisma.invoice.update.mock.calls[0][0].data.snapshotData;
    const emailMetaUpdate = mocks.prisma.invoice.update.mock.calls[1][0].data.snapshotData;

    expect(emailMetaUpdate.items).toBeDefined();
    expect(emailMetaUpdate.items.length).toBeGreaterThan(0);
    expect(emailMetaUpdate.items).toEqual(freezeUpdate.items);
    expect(emailMetaUpdate.subtotal).toBe(freezeUpdate.subtotal);
    expect(emailMetaUpdate.taxAmount).toBe(freezeUpdate.taxAmount);
    expect(emailMetaUpdate.total).toBe(freezeUpdate.total);
    expect(emailMetaUpdate.periodStart).toBe(freezeUpdate.periodStart);
    expect(emailMetaUpdate.periodEnd).toBe(freezeUpdate.periodEnd);
    expect(emailMetaUpdate.isFrozen).toBe(true);
    expect(emailMetaUpdate.frozenAt).toBe(freezeUpdate.frozenAt);
    expect(emailMetaUpdate.calculationVersion).toBe(CALCULATION_VERSIONS.LEGACY_V1);
    expect(emailMetaUpdate.hourlyRates).toEqual(freezeUpdate.hourlyRates);
    expect(emailMetaUpdate.emailSent).toBeDefined();
    expect(emailMetaUpdate.emailSent.recipients).toEqual(["target@example.invalid"]);
    expect(emailMetaUpdate.emailSent.status).toBe("sent");

    // Verify stored state in persistent dbStore
    const stored = dbStore.get("inv-created-id");
    expect(stored?.snapshotData.isFrozen).toBe(true);
    expect(stored?.snapshotData.items).toEqual(freezeUpdate.items);
    expect(stored?.snapshotData.emailSent).toBeDefined();
  });

  it("Criterion 6: Monthly invoice generation with email preserves the same fields and verifies exact salutation", async () => {
    const res = await generateMonthInvoices(
      testClient.id,
      2026,
      7,
      "MON-TEST-01",
      ["target-month@example.invalid"],
      true,
      true
    );

    expect(res).toEqual({
      ok: true,
      invoiceId: "inv-created-id",
      emailDispatchStatus: "sent_and_recorded",
      emailDispatchReport: expect.objectContaining({
        acceptedCount: 1,
        failedCount: 0,
        acceptedRecipients: ["target-month@example.invalid"],
      }),
    });

    expect(smtpMocks.sendMail).toHaveBeenCalledOnce();
    const mailArgs = smtpMocks.sendMail.mock.calls[0][0];
    expect(mailArgs.text).toContain("Sehr geehrte Damen und Herren,\n\nanbei erhalten Sie die offizielle Rechnung");

    expect(mocks.prisma.invoice.update).toHaveBeenCalledTimes(2);

    const freezeUpdate = mocks.prisma.invoice.update.mock.calls[0][0].data.snapshotData;
    const emailMetaUpdate = mocks.prisma.invoice.update.mock.calls[1][0].data.snapshotData;

    expect(emailMetaUpdate.items).toBeDefined();
    expect(emailMetaUpdate.items.length).toBeGreaterThan(0);
    expect(emailMetaUpdate.items).toEqual(freezeUpdate.items);
    expect(emailMetaUpdate.subtotal).toBe(freezeUpdate.subtotal);
    expect(emailMetaUpdate.taxAmount).toBe(freezeUpdate.taxAmount);
    expect(emailMetaUpdate.total).toBe(freezeUpdate.total);
    expect(emailMetaUpdate.periodStart).toBe(freezeUpdate.periodStart);
    expect(emailMetaUpdate.periodEnd).toBe(freezeUpdate.periodEnd);
    expect(emailMetaUpdate.isFrozen).toBe(true);
    expect(emailMetaUpdate.frozenAt).toBe(freezeUpdate.frozenAt);
    expect(emailMetaUpdate.calculationVersion).toBe(CALCULATION_VERSIONS.LEGACY_V1);
    expect(emailMetaUpdate.emailSent).toBeDefined();
    expect(emailMetaUpdate.emailSent.recipients).toEqual(["target-month@example.invalid"]);
  });

  it.each(["order", "month"])(
    "Criterion 7: %s email attachment data comes directly from frozen version and detects regression if stale invoice is used",
    async (kind) => {
      let capturedPdfData: InvoicePdfData | null = null;
      mocks.pdf.mockImplementation(async (pdfData: unknown) => {
        capturedPdfData = pdfData as InvoicePdfData;
        return Buffer.from("pdf-rendered-content");
      });

      // Hook into the freeze update: return a complete invoice with a distinct frozen fingerprint in items & period,
      // and simulate live rates changing immediately after the freeze step
      const originalUpdate = mocks.prisma.invoice.update.getMockImplementation();
      mocks.prisma.invoice.update.mockImplementation(async (args: { where: { id: string }; data?: Record<string, unknown> }) => {
        const result = (await originalUpdate!(args)) as StoredInvoice;
        const snapshot = args.data?.snapshotData as Record<string, unknown> | undefined;
        // If this is the freeze update (has items but no emailSent yet)
        if (snapshot?.isFrozen && !snapshot?.emailSent) {
          const items = result.snapshotData.items as Array<Record<string, unknown>>;
          items[0].description = "DISTINCT_FROZEN_ITEM_FINGERPRINT_VERIFIED";
          result.snapshotData.periodStart = "01.07.2026-FROZEN-DISTINCT";
          dbStore.set(result.id, result);

          // Change live inputs to verify they are NOT used by the email renderer
          testClient.hourlyRates = { pflegefachkraft: 999.0, pflegehelfer: 999.0 };
        }
        return result;
      });

      if (kind === "order") {
        await generateOrderInvoices(assignments.map((a) => a.id), "REGRESS-ORD-01", undefined, false, true);
      } else {
        await generateMonthInvoices(testClient.id, 2026, 7, "REGRESS-MON-01", undefined, false, true);
      }

      expect(mocks.pdf).toHaveBeenCalledTimes(1);
      expect(capturedPdfData).not.toBeNull();
      const pdf = capturedPdfData as unknown as InvoicePdfData;

      // The captured PDF data passed to renderer must match the frozen invoice's distinct data
      expect(pdf.items[0].description).toBe("DISTINCT_FROZEN_ITEM_FINGERPRINT_VERIFIED");
      expect(pdf.periodStart).toBe("01.07.2026-FROZEN-DISTINCT");
      expect(pdf.subtotal).toBe("927,70 €");
      expect(pdf.taxAmount).toBe("176,26 €");
      expect(pdf.total).toBe("1103,96 €");
      expect(pdf.invoiceNumber).toBe("PHASE01-TEST");

      // Verify email attachment was built and passed to real SMTP transporter
      expect(smtpMocks.sendMail).toHaveBeenCalledOnce();
      const mailOptions = smtpMocks.sendMail.mock.calls[0][0];
      expect(mailOptions.attachments).toHaveLength(1);
      expect(mailOptions.attachments[0].filename).toBe("PHASE01-TEST.pdf");
    }
  );

  it.each(["order", "month"])(
    "Criterion 8 (%s): All email integration dispatch states are determined by actual transport report without assuming fulfillment",
    async (kind) => {
      const runAction = async (sendEmail: boolean, customRecipients?: string[]) => {
        if (kind === "order") {
          return generateOrderInvoices(assignments.map((a) => a.id), "STATUS-ORD-01", customRecipients, false, sendEmail);
        } else {
          return generateMonthInvoices(testClient.id, 2026, 7, "STATUS-MON-01", customRecipients, false, sendEmail);
        }
      };

      // State 1: not_requested (sendEmail = false)
      {
        dbStore.clear();
        vi.clearAllMocks();
        const res = await runAction(false);
        expect(res.emailDispatchStatus).toBe("not_requested");
        expect(smtpMocks.sendMail).not.toHaveBeenCalled();
        const stored = dbStore.get("inv-created-id");
        expect(stored?.snapshotData.isFrozen).toBe(true);
        expect(stored?.snapshotData.emailSent).toBeUndefined();
      }

      // State 2a: send_failed due to missing SMTP configuration (returns normally without throwing)
      {
        dbStore.clear();
        vi.clearAllMocks();
        delete process.env.SMTP_HOST;
        delete process.env.SMTP_USER;
        delete process.env.SMTP_PASSWORD;

        const res = await runAction(true);
        expect(res.emailDispatchStatus).toBe("send_failed");
        expect(res.emailDispatchReport?.smtpConfigured).toBe(false);
        expect(smtpMocks.sendMail).not.toHaveBeenCalled();
        const stored = dbStore.get("inv-created-id");
        expect(stored?.snapshotData.isFrozen).toBe(true);
        expect(stored?.snapshotData.emailSent).toBeUndefined(); // Never writes success on missing SMTP!

        // Restore env vars
        process.env.SMTP_HOST = "smtp.test.invalid";
        process.env.SMTP_USER = "test-smtp-user";
        process.env.SMTP_PASSWORD = "test-smtp-password";
      }

      // State 2b: send_failed due to SMTP rejection (mailer catches and logs, fulfilled without throwing)
      {
        dbStore.clear();
        vi.clearAllMocks();
        smtpMocks.sendMail.mockRejectedValueOnce(new Error("SMTP 550 Mailbox does not exist"));

        const res = await runAction(true);
        expect(res.emailDispatchStatus).toBe("send_failed");
        expect(res.emailDispatchReport?.failedCount).toBe(1);
        expect(res.emailDispatchReport?.acceptedCount).toBe(0);
        expect(smtpMocks.sendMail).toHaveBeenCalledTimes(1);
        const stored = dbStore.get("inv-created-id");
        expect(stored?.snapshotData.isFrozen).toBe(true);
        expect(stored?.snapshotData.items).toBeDefined();
        expect(stored?.snapshotData.emailSent).toBeUndefined(); // Zero accepted -> NO emailSent metadata
      }

      // State 3: sent_and_recorded (all recipients accepted by SMTP)
      {
        dbStore.clear();
        vi.clearAllMocks();
        smtpMocks.sendMail.mockResolvedValueOnce({ messageId: "msg-success-all" });

        const res = await runAction(true);
        expect(res.emailDispatchStatus).toBe("sent_and_recorded");
        expect(res.emailDispatchReport?.acceptedCount).toBe(1);
        expect(smtpMocks.sendMail).toHaveBeenCalledTimes(1);
        const stored = dbStore.get("inv-created-id");
        expect(stored?.snapshotData.isFrozen).toBe(true);
        expect(stored?.snapshotData.emailSent).toBeDefined();
        const emailSent = stored?.snapshotData.emailSent as Record<string, unknown>;
        expect(emailSent.status).toBe("sent");
        expect(emailSent.recipients).toEqual(["billing@client-p1.invalid"]);
      }

      // State 4: partially_sent_and_recorded (one recipient accepted, one rejected)
      {
        dbStore.clear();
        vi.clearAllMocks();
        smtpMocks.sendMail.mockImplementation(async ({ to }: { to: string }) => {
          if (to === "fail@client-p1.invalid") {
            throw new Error("SMTP 552 Quota exceeded");
          }
          return { messageId: `msg-${to}` };
        });

        const res = await runAction(true, ["billing@client-p1.invalid", "fail@client-p1.invalid"]);
        expect(res.emailDispatchStatus).toBe("partially_sent_and_recorded");
        expect(res.emailDispatchReport?.acceptedCount).toBe(1);
        expect(res.emailDispatchReport?.failedCount).toBe(1);
        expect(smtpMocks.sendMail).toHaveBeenCalledTimes(2);

        const stored = dbStore.get("inv-created-id");
        expect(stored?.snapshotData.isFrozen).toBe(true);
        expect(stored?.snapshotData.emailSent).toBeDefined();
        const emailSent = stored?.snapshotData.emailSent as Record<string, unknown>;
        expect(emailSent.status).toBe("partial");
        // Crucial invariant: only accepted recipient is recorded in recipients array!
        expect(emailSent.recipients).toEqual(["billing@client-p1.invalid"]);
        expect(emailSent.failedRecipients).toEqual([
          { recipient: "fail@client-p1.invalid", error: "SMTP 552 Quota exceeded" },
        ]);
      }

      // State 5: no_eligible_recipients due to inactive account or preference
      {
        dbStore.clear();
        vi.clearAllMocks();
        testUsers.get("user-p1")!.active = false;

        const res = await runAction(true, ["user-p1"]);
        expect(res.emailDispatchStatus).toBe("no_eligible_recipients");
        expect(res.emailDispatchReport?.skippedCount).toBe(1);
        expect(smtpMocks.sendMail).not.toHaveBeenCalled();
        const stored = dbStore.get("inv-created-id");
        expect(stored?.snapshotData.isFrozen).toBe(true);
        expect(stored?.snapshotData.emailSent).toBeUndefined();

        // Restore user
        testUsers.get("user-p1")!.active = true;
      }

      // State 6: no_eligible_recipients due to invalid or unresolvable recipients
      {
        dbStore.clear();
        vi.clearAllMocks();

        const res = await runAction(true, ["", "   ", "non-existent-user-id"]);
        expect(res.emailDispatchStatus).toBe("no_eligible_recipients");
        expect(res.emailDispatchReport?.unresolvedCount).toBe(3);
        expect(smtpMocks.sendMail).not.toHaveBeenCalled();
        const stored = dbStore.get("inv-created-id");
        expect(stored?.snapshotData.isFrozen).toBe(true);
        expect(stored?.snapshotData.emailSent).toBeUndefined();
      }

      // State 7: sent_but_record_failed (SMTP transport succeeds, subsequent DB write of metadata fails)
      {
        dbStore.clear();
        vi.clearAllMocks();
        smtpMocks.sendMail.mockResolvedValueOnce({ messageId: "msg-record-fail" });

        // Allow freeze update to succeed, but reject the emailSent update
        let updateCount = 0;
        mocks.prisma.invoice.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          updateCount++;
          if (updateCount === 2) {
            throw new Error("DB deadlock on metadata write");
          }
          const existing = dbStore.get(where.id);
          const updated: StoredInvoice = {
            ...existing!,
            ...data,
            snapshotData: data.snapshotData
              ? JSON.parse(JSON.stringify(data.snapshotData))
              : existing!.snapshotData,
            updatedAt: new Date(),
          };
          dbStore.set(where.id, updated);
          return updated;
        });

        const res = await runAction(true);
        expect(res.emailDispatchStatus).toBe("sent_but_record_failed");
        expect(res.ok).toBe(true);
        expect(res.invoiceId).toBe("inv-created-id");

        // Crucial verification: Email transport was called exactly ONCE (no duplicate send attempt)
        expect(smtpMocks.sendMail).toHaveBeenCalledTimes(1);

        // Crucial verification: In-memory stored data retains the frozen snapshot intact!
        const stored = dbStore.get("inv-created-id");
        expect(stored?.snapshotData.isFrozen).toBe(true);
        expect(stored?.snapshotData.items).toBeDefined();
        expect(stored?.snapshotData.subtotal).toBe("927,70 €");
        expect(stored?.snapshotData.emailSent).toBeUndefined(); // Failed update did NOT modify DB store
      }

      // State 8: Duplicate recipients with case variation (e.g. billing@ vs BILLING@) produces sent_and_recorded, not partial
      {
        dbStore.clear();
        vi.clearAllMocks();
        smtpMocks.sendMail.mockResolvedValueOnce({ messageId: "msg-dedup-case" });

        const res = await runAction(true, ["billing@client-p1.invalid", "BILLING@client-p1.invalid"]);
        expect(res.emailDispatchStatus).toBe("sent_and_recorded");
        expect(res.emailDispatchReport?.rawInputCount).toBe(2);
        expect(res.emailDispatchReport?.distinctTargetCount).toBe(1);
        expect(res.emailDispatchReport?.totalRequested).toBe(1);
        expect(res.emailDispatchReport?.acceptedCount).toBe(1);
        expect(res.emailDispatchReport?.failedCount).toBe(0);
        expect(res.emailDispatchReport?.skippedCount).toBe(0);
        expect(res.emailDispatchReport?.unresolvedCount).toBe(0);
        expect(smtpMocks.sendMail).toHaveBeenCalledTimes(1);

        const stored = dbStore.get("inv-created-id");
        expect(stored?.snapshotData.isFrozen).toBe(true);
        expect(stored?.snapshotData.emailSent).toBeDefined();
        const emailSent = stored?.snapshotData.emailSent as Record<string, unknown>;
        expect(emailSent.status).toBe("sent");
        expect(emailSent.recipients).toEqual(["billing@client-p1.invalid"]);
      }

      // State 9: Duplicate recipient spanning userId and direct email resolves to single distinct target
      {
        dbStore.clear();
        vi.clearAllMocks();
        smtpMocks.sendMail.mockResolvedValueOnce({ messageId: "msg-dedup-user-email" });

        const res = await runAction(true, ["user-p1", "billing@client-p1.invalid"]);
        expect(res.emailDispatchStatus).toBe("sent_and_recorded");
        expect(res.emailDispatchReport?.rawInputCount).toBe(2);
        expect(res.emailDispatchReport?.distinctTargetCount).toBe(1);
        expect(res.emailDispatchReport?.totalRequested).toBe(1);
        expect(res.emailDispatchReport?.acceptedCount).toBe(1);
        expect(smtpMocks.sendMail).toHaveBeenCalledTimes(1);

        const stored = dbStore.get("inv-created-id");
        const emailSent = stored?.snapshotData.emailSent as Record<string, unknown>;
        expect(emailSent.status).toBe("sent");
        expect(emailSent.recipients).toEqual(["billing@client-p1.invalid"]);
      }

      // State 10: Duplicate billingEmail in client record collapses cleanly into a single send
      {
        dbStore.clear();
        vi.clearAllMocks();
        smtpMocks.sendMail.mockResolvedValueOnce({ messageId: "msg-dedup-client-billing" });

        const originalBillingEmail = testClient.billingEmail;
        testClient.billingEmail = "billing@client-p1.invalid, BILLING@client-p1.invalid";

        const res = await runAction(true);
        expect(res.emailDispatchStatus).toBe("sent_and_recorded");
        expect(res.emailDispatchReport?.acceptedCount).toBe(1);
        expect(smtpMocks.sendMail).toHaveBeenCalledTimes(1);

        testClient.billingEmail = originalBillingEmail;
      }
    }
  );

  it("Criterion 9: Path without email maintains previous behavior and totals", async () => {
    const res = await generateOrderInvoices(assignments.map((a) => a.id), "NO-MAIL-01", undefined, false, false);

    expect(res).toEqual({
      ok: true,
      invoiceId: "inv-created-id",
      emailDispatchStatus: "not_requested",
      emailDispatchReport: undefined,
    });

    expect(smtpMocks.sendMail).not.toHaveBeenCalled();
    expect(mocks.prisma.invoice.update).toHaveBeenCalledTimes(1);

    const snapshot = mocks.prisma.invoice.update.mock.calls[0][0].data.snapshotData;
    expect(snapshot.isFrozen).toBe(true);
    expect(snapshot.subtotal).toBe("927,70 €");
    expect(snapshot.taxAmount).toBe("176,26 €");
    expect(snapshot.total).toBe("1103,96 €");
    expect(snapshot.calculationVersion).toBe(CALCULATION_VERSIONS.LEGACY_V1);
    expect(snapshot.emailSent).toBeUndefined();
  });

  it("Criterion 10: DB/PDF totals are mathematically identical to pre-phase baseline", () => {
    const rawInv = {
      invoiceNumber: "TC1-PRE-POST",
      date: new Date("2026-10-08T12:00:00Z"),
      netAmount: 927.432,
      vatAmount: 176.21208,
      grossAmount: 1103.64408,
      snapshotData: {},
    };

    const pdfData = buildInvoicePdfData(
      rawInv as unknown as PdfInvoice,
      testClient as unknown as PdfClient,
      assignments as unknown as PdfAssignments
    );

    expect(pdfData.subtotal).toBe("927,70 €");
    expect(pdfData.taxAmount).toBe("176,26 €");
    expect(pdfData.total).toBe("1103,96 €");
    expect(pdfData.items.map((i) => i.amount)).toEqual(["666,34 €", "107,71 €", "153,65 €"]);
  });

  it("Criterion 11: Other email callers retain full backward compatibility", async () => {
    // 11a: sendEmailToRecipients returns EmailDispatchReport directly
    const report = await sendEmailToRecipients(["billing@client-p1.invalid"], {
      subject: "Test Subject",
      body: "Test Body",
    });
    expect(report.acceptedCount).toBe(1);
    expect(report.failedCount).toBe(0);
    expect(report.smtpConfigured).toBe(true);

    // 11b: sendEmailToRecipientsWithReport returns the exact same contract
    const report2 = await sendEmailToRecipientsWithReport(["billing@client-p1.invalid"], {
      subject: "Test Subject 2",
      body: "Test Body 2",
    });
    expect(report2.acceptedCount).toBe(1);

    // 11c: sendEmailToUsers returns Promise<void> and runs cleanly
    const usersRes = await sendEmailToUsers(["user-p1"], {
      subject: "Test User Subject",
      body: "Test User Body",
    });
    expect(usersRes).toBeUndefined();
  });
});
