import { describe, it, expect, vi, beforeEach } from "vitest";
import { PDFDocument } from "pdf-lib";

vi.mock("server-only", () => ({}));

// Mock Supabase storage
const mockDownload = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    storage: {
      from: () => ({
        download: mockDownload,
      }),
    },
  }),
}));

// Mock Prisma
const mockFindMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    assignment: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
    },
  },
}));

// Helper to create a minimal valid 1-page PDF
async function createSamplePdf(text: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  // Just empty or with some content
  const bytes = await doc.save();
  return Buffer.from(bytes);
}

describe("generateLeistungsnachweisePdf - Timesheet Deduplication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when assignmentIds is empty or no assignments match", async () => {
    const { generateLeistungsnachweisePdf } = await import("./generate-timesheets-pdf");

    const resEmpty = await generateLeistungsnachweisePdf([]);
    expect(resEmpty).toBeNull();

    mockFindMany.mockResolvedValueOnce([]);
    const resNotFound = await generateLeistungsnachweisePdf(["assign-none"]);
    expect(resNotFound).toBeNull();
  });

  it("deduplicates uploaded paper timesheet when multiple shifts share the same documentUrl", async () => {
    const { generateLeistungsnachweisePdf } = await import("./generate-timesheets-pdf");

    const samplePdfBuffer = await createSamplePdf("Katrin Kowal Oct 10 & 11");

    mockDownload.mockImplementation(async (path: string) => {
      return {
        data: {
          type: "application/pdf",
          arrayBuffer: async () => samplePdfBuffer.buffer.slice(
            samplePdfBuffer.byteOffset,
            samplePdfBuffer.byteOffset + samplePdfBuffer.byteLength
          ),
        },
        error: null,
      };
    });

    const shiftDate1 = new Date("2026-10-10T06:00:00Z");
    const shiftDate2 = new Date("2026-10-11T06:00:00Z");

    mockFindMany.mockResolvedValueOnce([
      {
        id: "assign-1",
        status: "confirmed",
        worker: { fullName: "Katrin Kowal", qualification: "exam_pflegefachkraft", userId: "w-1" },
        serviceConfirmation: {
          method: "upload",
          documentUrl: "signed-confirmations/worker-w-1/timesheet-oct-10-11.pdf",
          hoursWorked: 8,
          ipAddress: "127.0.0.1",
          confirmedAt: shiftDate1,
          signatureData: null,
          signerName: "Sr. Hildegard",
          confirmedBy: { email: "admin@rheinahr.de" },
        },
        confirmationDocuments: [],
        order: {
          id: "order-1",
          requestGroupId: "rg-1",
          shiftDate: shiftDate1,
          startTime: "06:00",
          endTime: "14:30",
          breakMinutes: 30,
          requiredQualification: "exam_pflegefachkraft",
          client: { facilityName: "Marienhaus Klinikum", userId: "c-1" },
        },
      },
      {
        id: "assign-2",
        status: "confirmed",
        worker: { fullName: "Katrin Kowal", qualification: "exam_pflegefachkraft", userId: "w-1" },
        serviceConfirmation: {
          method: "upload",
          documentUrl: "signed-confirmations/worker-w-1/timesheet-oct-10-11.pdf",
          hoursWorked: 8,
          ipAddress: "127.0.0.1",
          confirmedAt: shiftDate2,
          signatureData: null,
          signerName: "Sr. Hildegard",
          confirmedBy: { email: "admin@rheinahr.de" },
        },
        confirmationDocuments: [],
        order: {
          id: "order-2",
          requestGroupId: "rg-1",
          shiftDate: shiftDate2,
          startTime: "06:00",
          endTime: "14:30",
          breakMinutes: 30,
          requiredQualification: "exam_pflegefachkraft",
          client: { facilityName: "Marienhaus Klinikum", userId: "c-1" },
        },
      },
    ]);

    const resultBuffer = await generateLeistungsnachweisePdf(["assign-1", "assign-2"]);
    expect(resultBuffer).not.toBeNull();

    // Verify download was called only ONCE because the second assignment had identical documentUrl
    expect(mockDownload).toHaveBeenCalledTimes(1);

    // Verify resulting PDF has only 1 page (the single uploaded timesheet) instead of 2 duplicate pages
    const parsed = await PDFDocument.load(resultBuffer!);
    expect(parsed.getPageCount()).toBe(1);
  });

  it("deduplicates uploaded paper timesheet when separate uploads share the exact same file content hash", async () => {
    const { generateLeistungsnachweisePdf } = await import("./generate-timesheets-pdf");

    const samplePdfBuffer = await createSamplePdf("Identical Content in different uploads");

    mockDownload.mockImplementation(async (path: string) => {
      return {
        data: {
          type: "application/pdf",
          arrayBuffer: async () => samplePdfBuffer.buffer.slice(
            samplePdfBuffer.byteOffset,
            samplePdfBuffer.byteOffset + samplePdfBuffer.byteLength
          ),
        },
        error: null,
      };
    });

    const shiftDate1 = new Date("2026-10-10T06:00:00Z");
    const shiftDate2 = new Date("2026-10-11T06:00:00Z");

    // Two different paths in storage because user uploaded separately
    mockFindMany.mockResolvedValueOnce([
      {
        id: "assign-1",
        status: "confirmed",
        worker: { fullName: "Katrin Kowal", qualification: "exam_pflegefachkraft", userId: "w-1" },
        serviceConfirmation: {
          method: "upload",
          documentUrl: "signed-confirmations/worker-w-1/upload1-timesheet.pdf",
          hoursWorked: 8,
          ipAddress: "127.0.0.1",
          confirmedAt: shiftDate1,
          signatureData: null,
          signerName: "Sr. Hildegard",
          confirmedBy: { email: "admin@rheinahr.de" },
        },
        confirmationDocuments: [],
        order: {
          id: "order-1",
          requestGroupId: "rg-1",
          shiftDate: shiftDate1,
          startTime: "06:00",
          endTime: "14:30",
          breakMinutes: 30,
          requiredQualification: "exam_pflegefachkraft",
          client: { facilityName: "Marienhaus Klinikum", userId: "c-1" },
        },
      },
      {
        id: "assign-2",
        status: "confirmed",
        worker: { fullName: "Katrin Kowal", qualification: "exam_pflegefachkraft", userId: "w-1" },
        serviceConfirmation: {
          method: "upload",
          documentUrl: "signed-confirmations/worker-w-1/upload2-timesheet.pdf",
          hoursWorked: 8,
          ipAddress: "127.0.0.1",
          confirmedAt: shiftDate2,
          signatureData: null,
          signerName: "Sr. Hildegard",
          confirmedBy: { email: "admin@rheinahr.de" },
        },
        confirmationDocuments: [],
        order: {
          id: "order-2",
          requestGroupId: "rg-1",
          shiftDate: shiftDate2,
          startTime: "06:00",
          endTime: "14:30",
          breakMinutes: 30,
          requiredQualification: "exam_pflegefachkraft",
          client: { facilityName: "Marienhaus Klinikum", userId: "c-1" },
        },
      },
    ]);

    const resultBuffer = await generateLeistungsnachweisePdf(["assign-1", "assign-2"]);
    expect(resultBuffer).not.toBeNull();

    // The second document has identical SHA-256 hash, so it should not be appended twice!
    const parsed = await PDFDocument.load(resultBuffer!);
    expect(parsed.getPageCount()).toBe(1);
  });

  it("includes distinct paper timesheets when they are different documents", async () => {
    const { generateLeistungsnachweisePdf } = await import("./generate-timesheets-pdf");

    const pdfA = await createSamplePdf("Worker A Sheet");
    const docB = await PDFDocument.create();
    docB.addPage([595.28, 841.89]);
    docB.addPage([595.28, 841.89]); // doc B has 2 pages
    const pdfB = Buffer.from(await docB.save());

    mockDownload.mockImplementation(async (path: string) => {
      const buf = path.includes("worker-A") ? pdfA : pdfB;
      return {
        data: {
          type: "application/pdf",
          arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        },
        error: null,
      };
    });

    const shiftDate = new Date("2026-10-10T06:00:00Z");

    mockFindMany.mockResolvedValueOnce([
      {
        id: "assign-A",
        status: "confirmed",
        worker: { fullName: "Worker A", qualification: "pflegehelfer", userId: "w-a" },
        serviceConfirmation: {
          method: "upload",
          documentUrl: "signed-confirmations/worker-A/sheet-A.pdf",
          hoursWorked: 7.5,
          ipAddress: null,
          confirmedAt: shiftDate,
          signatureData: null,
          signerName: null,
          confirmedBy: null,
        },
        confirmationDocuments: [],
        order: {
          id: "order-A",
          requestGroupId: "rg-1",
          shiftDate,
          startTime: "06:00",
          endTime: "14:00",
          breakMinutes: 30,
          requiredQualification: "pflegehelfer",
          client: { facilityName: "Klinikum", userId: "c-1" },
        },
      },
      {
        id: "assign-B",
        status: "confirmed",
        worker: { fullName: "Worker B", qualification: "pflegehelfer", userId: "w-b" },
        serviceConfirmation: {
          method: "upload",
          documentUrl: "signed-confirmations/worker-B/sheet-B.pdf",
          hoursWorked: 7.5,
          ipAddress: null,
          confirmedAt: shiftDate,
          signatureData: null,
          signerName: null,
          confirmedBy: null,
        },
        confirmationDocuments: [],
        order: {
          id: "order-B",
          requestGroupId: "rg-1",
          shiftDate,
          startTime: "06:00",
          endTime: "14:00",
          breakMinutes: 30,
          requiredQualification: "pflegehelfer",
          client: { facilityName: "Klinikum", userId: "c-1" },
        },
      },
    ]);

    const resultBuffer = await generateLeistungsnachweisePdf(["assign-A", "assign-B"]);
    expect(resultBuffer).not.toBeNull();

    // 1 page from sheet-A + 2 pages from sheet-B = 3 pages total
    const parsed = await PDFDocument.load(resultBuffer!);
    expect(parsed.getPageCount()).toBe(3);
  });
});
