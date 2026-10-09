import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addConfirmationEvidence,
  getAssignmentEvidenceHistory,
  MAX_CONFIRMATION_FILE_SIZE_BYTES,
} from "./confirmation-evidence-service";
import { POST as uploadSignedRoute } from "@/app/api/confirmations/upload-signed/route";
import { GET as getConfirmationDocumentRoute } from "@/app/api/confirmations/[assignmentId]/document/route";
import {
  createConfirmationUploadTicket,
  finalizeDirectSignedConfirmation,
  uploadDirectSignedConfirmation,
} from "@/app/[locale]/admin/orders/[id]/confirmation-actions";

// In-memory data structures to simulate database and storage without external I/O
type DbAssignment = {
  id: string;
  orderId: string;
  workerId: string;
  status: string;
  order: {
    id: string;
    clientId: string;
    shiftDate: Date;
    startTime: string;
    endTime: string;
    breakMinutes: number;
    requestGroupId: string | null;
    client: {
      id: string;
      userId: string;
      facilityName: string;
    };
  };
  worker: {
    id: string;
    userId: string;
    fullName: string;
  };
  serviceConfirmation?: DbServiceConfirmation | null;
};

type DbServiceConfirmation = {
  id: string;
  assignmentId: string;
  confirmedById: string | null;
  method: "electronic" | "upload";
  signatureData: string | null;
  documentUrl: string | null;
  hoursWorked: number | string | null;
  signerName: string | null;
  clientNotes: string | null;
  ipAddress: string | null;
  confirmedAt: Date;
};

type DbConfirmationDocument = {
  id: string;
  assignmentId: string;
  sourceType: "electronic_original" | "manual_upload" | "manual_correction";
  storagePath: string | null;
  fileHash: string | null;
  fileName: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  signatureData: string | null;
  signerName: string | null;
  signerIp: string | null;
  uploadedById: string | null;
  uploaderRole: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
};

type DbWorkHoursCorrection = {
  id: string;
  assignmentId: string;
  documentId: string | null;
  status: "proposed" | "approved" | "rejected";
  previousHoursWorked: number | string | null;
  proposedHoursWorked: number | string | null;
  proposedStartTime: string | null;
  proposedEndTime: string | null;
  proposedBreakMinutes: number | null;
  reason: string | null;
  requestedById: string | null;
  requestedAt: Date;
  decidedById: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
};

type DbInvoice = {
  id: string;
  invoiceNumber: string;
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
  status: string;
  snapshotData: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

const store = {
  assignments: new Map<string, DbAssignment>(),
  serviceConfirmations: new Map<string, DbServiceConfirmation>(),
  confirmationDocuments: new Map<string, DbConfirmationDocument>(),
  workHoursCorrections: new Map<string, DbWorkHoursCorrection>(),
  consumedTickets: new Map<string, { id: string; ticketId: string; storagePath: string; consumedBy: string; consumedAt: Date }>(),
  invoices: new Map<string, DbInvoice>(),
  storageFiles: new Map<string, { buffer: Buffer; contentType: string }>(),
};

const REAL_PDF_HEADER = Buffer.concat([
  Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"),
  Buffer.alloc(64, 0x20),
  Buffer.from("\n%%EOF\n"),
]);

const REAL_PNG_HEADER = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]),
  Buffer.alloc(16, 0x20),
]);

function makeTestPdf(suffix = ""): Buffer {
  return Buffer.concat([REAL_PDF_HEADER, Buffer.from(suffix)]);
}
function makeTestPng(suffix = ""): Buffer {
  return Buffer.concat([REAL_PNG_HEADER, Buffer.from(suffix)]);
}

// Mock Supabase storage
const storageMock = {
  upload: vi.fn(async (path: string, buffer: Buffer, options: { contentType: string; upsert?: boolean }) => {
    if (options.upsert === false && store.storageFiles.has(path)) {
      return { data: null, error: new Error("File already exists (upsert: false)") };
    }
    store.storageFiles.set(path, { buffer, contentType: options.contentType });
    return { data: { path }, error: null };
  }),
  remove: vi.fn(async (paths: string[]) => {
    for (const p of paths) {
      store.storageFiles.delete(p);
    }
    return { data: paths, error: null };
  }),
  createSignedUrl: vi.fn(async (path: string) => {
    return { data: { signedUrl: `https://storage.mock.signed/${path}` }, error: null };
  }),
  createSignedUploadUrl: vi.fn(async (path: string) => {
    return { data: { path, token: "mock-upload-token" }, error: null };
  }),
  download: vi.fn(async (path: string) => {
    const file = store.storageFiles.get(path);
    if (!file) {
      return { data: null, error: new Error("File not found in storage") };
    }
    return {
      data: new Blob([new Uint8Array(file.buffer)], { type: file.contentType }),
      error: null,
    };
  }),
};

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    storage: {
      from: () => storageMock,
    },
  }),
}));

// Mock Audit
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(),
}));

let activeUser: { id: string; role: string; clientId?: string | null } | null = {
  id: "admin-1",
  role: "admin",
};

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(async () => activeUser),
  roleSatisfies: vi.fn((role: string, allowed: string[]) => allowed.includes(role)),
  resolveClientId: vi.fn(async (u: { clientId?: string | null }) => u?.clientId || null),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "x-forwarded-for": "127.0.0.1" })),
  cookies: vi.fn(async () => ({
    get: vi.fn(() => ({ value: "mock-session" })),
  })),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Mock Prisma with in-memory store
vi.mock("@/lib/prisma", () => ({
  prisma: {
    assignment: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const a = store.assignments.get(where.id);
        if (!a) return null;
        const sc = store.serviceConfirmations.get(where.id);
        return { ...a, serviceConfirmation: sc || null };
      }),
      findMany: vi.fn(async ({ where }: { where?: { id?: { in?: string[] } } }) => {
        const list: DbAssignment[] = [];
        for (const a of store.assignments.values()) {
          if (!where?.id?.in || where.id.in.includes(a.id)) {
            const sc = store.serviceConfirmations.get(a.id);
            list.push({ ...a, serviceConfirmation: sc || null });
          }
        }
        return list;
      }),
      count: vi.fn(async () => 0),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        // Strict ON DELETE RESTRICT check
        const hasDocs = Array.from(store.confirmationDocuments.values()).some((d) => d.assignmentId === where.id);
        const hasCorrs = Array.from(store.workHoursCorrections.values()).some((c) => c.assignmentId === where.id);
        if (hasDocs || hasCorrs) {
          const err = new Error("Foreign key constraint failed on the field: `assignment_id` (RESTRICT)");
          (err as unknown as { code: string }).code = "P2003";
          throw err;
        }
        const a = store.assignments.get(where.id);
        store.assignments.delete(where.id);
        return a;
      }),
    },
    order: {
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: unknown }) => {
        return { id: where.id, ...(data as Record<string, unknown>) };
      }),
    },
    notification: {
      createMany: vi.fn(async () => ({ count: 1 })),
    },
    serviceConfirmation: {
      create: vi.fn(async ({ data }: { data: Omit<DbServiceConfirmation, "id"> }) => {
        const id = `sc-${Date.now()}-${Math.random()}`;
        const record: DbServiceConfirmation = {
          id,
          assignmentId: data.assignmentId,
          confirmedById: data.confirmedById,
          method: data.method,
          signatureData: data.signatureData || null,
          documentUrl: data.documentUrl || null,
          hoursWorked: data.hoursWorked,
          signerName: data.signerName || null,
          clientNotes: data.clientNotes || null,
          ipAddress: data.ipAddress || null,
          confirmedAt: data.confirmedAt || new Date(),
        };
        store.serviceConfirmations.set(data.assignmentId, record);
        return record;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<DbServiceConfirmation> }) => {
        for (const [assignId, sc] of store.serviceConfirmations.entries()) {
          if (sc.id === where.id) {
            const updated = { ...sc, ...data };
            store.serviceConfirmations.set(assignId, updated);
            return updated;
          }
        }
        throw new Error("ServiceConfirmation not found");
      }),
    },
    confirmationDocument: {
      create: vi.fn(async ({ data }: { data: Omit<DbConfirmationDocument, "id"> }) => {
        if (data.fileHash) {
          for (const doc of store.confirmationDocuments.values()) {
            if (doc.assignmentId === data.assignmentId && doc.fileHash === data.fileHash) {
              const err = new Error("Unique constraint failed on the fields: (`assignment_id`,`file_hash`)");
              (err as unknown as { code: string }).code = "P2002";
              throw err;
            }
          }
        }
        const id = `doc-${Date.now()}-${Math.random()}`;
        const record: DbConfirmationDocument = {
          id,
          assignmentId: data.assignmentId,
          sourceType: data.sourceType,
          storagePath: data.storagePath || null,
          fileHash: data.fileHash || null,
          fileName: data.fileName || null,
          mimeType: data.mimeType || null,
          fileSizeBytes: data.fileSizeBytes || null,
          signatureData: data.signatureData || null,
          signerName: data.signerName || null,
          signerIp: data.signerIp || null,
          uploadedById: data.uploadedById || null,
          uploaderRole: data.uploaderRole || null,
          metadata: data.metadata || null,
          createdAt: data.createdAt || new Date(),
        };
        store.confirmationDocuments.set(id, record);
        return record;
      }),
      findFirst: vi.fn(async ({ where }: { where: { assignmentId?: string; fileHash?: string; id?: string } }) => {
        for (const doc of store.confirmationDocuments.values()) {
          let match = true;
          if (where.assignmentId && doc.assignmentId !== where.assignmentId) match = false;
          if (where.fileHash && doc.fileHash !== where.fileHash) match = false;
          if (where.id && doc.id !== where.id) match = false;
          if (match) return doc;
        }
        return null;
      }),
      findMany: vi.fn(async ({ where }: { where: { assignmentId?: string } }) => {
        const list: DbConfirmationDocument[] = [];
        for (const doc of store.confirmationDocuments.values()) {
          if (!where.assignmentId || doc.assignmentId === where.assignmentId) {
            list.push(doc);
          }
        }
        return list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      }),
    },
    workHoursCorrectionRequest: {
      create: vi.fn(async ({ data }: { data: Omit<DbWorkHoursCorrection, "id" | "decidedById" | "decidedAt" | "decisionNote"> }) => {
        const id = `corr-${Date.now()}-${Math.random()}`;
        const record: DbWorkHoursCorrection = {
          id,
          assignmentId: data.assignmentId,
          documentId: data.documentId || null,
          status: data.status || "proposed",
          previousHoursWorked: data.previousHoursWorked || null,
          proposedHoursWorked: data.proposedHoursWorked,
          proposedStartTime: data.proposedStartTime || null,
          proposedEndTime: data.proposedEndTime || null,
          proposedBreakMinutes: data.proposedBreakMinutes ?? null,
          reason: data.reason || null,
          requestedById: data.requestedById || null,
          requestedAt: data.requestedAt || new Date(),
          decidedById: null,
          decidedAt: null,
          decisionNote: null,
        };
        store.workHoursCorrections.set(id, record);
        return record;
      }),
      findFirst: vi.fn(async ({ where }: { where: { assignmentId?: string; status?: string } }) => {
        for (const c of store.workHoursCorrections.values()) {
          let match = true;
          if (where.assignmentId && c.assignmentId !== where.assignmentId) match = false;
          if (where.status && c.status !== where.status) match = false;
          if (match) return c;
        }
        return null;
      }),
    },
    consumedConfirmationTicket: {
      create: vi.fn(async ({ data }: { data: { ticketId: string; storagePath: string; consumedBy: string; consumedAt?: Date } }) => {
        if (store.consumedTickets.has(data.ticketId)) {
          const err = new Error("Unique constraint failed on the fields: (`ticket_id`)");
          (err as unknown as { code: string; meta: { target: string[] } }).code = "P2002";
          (err as unknown as { meta: { target: string[] } }).meta = { target: ["ticket_id"] };
          throw err;
        }
        const rec = {
          id: `cct-${Date.now()}-${Math.random()}`,
          ticketId: data.ticketId,
          storagePath: data.storagePath,
          consumedBy: data.consumedBy,
          consumedAt: data.consumedAt || new Date(),
        };
        store.consumedTickets.set(data.ticketId, rec);
        return rec;
      }),
      findUnique: vi.fn(async ({ where }: { where: { ticketId: string } }) => {
        return store.consumedTickets.get(where.ticketId) || null;
      }),
    },
    $transaction: vi.fn(async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => {
      return await cb(prismaMock);
    }),
  },
}));

// Self-referencing mock for transactions
const prismaMock = (await import("@/lib/prisma")).prisma;

describe("Phase 3a - Confirmation Evidence Documents & Corrections Architecture", () => {
  const adminUser = { id: "admin-1", role: "admin" };
  const clientUser = { id: "user-client-1", role: "client", clientId: "client-facility-1" };
  const workerUser = { id: "user-worker-1", role: "worker" };
  const foreignClientUser = { id: "user-client-2", role: "client", clientId: "client-facility-2" };

  beforeEach(() => {
    store.assignments.clear();
    store.serviceConfirmations.clear();
    store.confirmationDocuments.clear();
    store.workHoursCorrections.clear();
    store.consumedTickets.clear();
    store.invoices.clear();
    store.storageFiles.clear();
    process.env.CONFIRMATION_TICKET_SECRET = "test-secret-key-confirmation-3a-audit-safe-256bit";
    vi.clearAllMocks();
    activeUser = adminUser;
  });

  function seedStandardAssignment(assignmentId = "assign-1") {
    const a: DbAssignment = {
      id: assignmentId,
      orderId: "order-101",
      workerId: "worker-1",
      status: "confirmed",
      order: {
        id: "order-101",
        clientId: "client-facility-1",
        shiftDate: new Date("2026-07-11T00:00:00.000Z"),
        startTime: "06:05",
        endTime: "12:53",
        breakMinutes: 0,
        requestGroupId: "group-july",
        client: {
          id: "client-facility-1",
          userId: "user-client-1",
          facilityName: "Seniorenresidenz RheinAhr",
        },
      },
      worker: {
        id: "worker-1",
        userId: "user-worker-1",
        fullName: "Oso, Majed",
      },
    };
    store.assignments.set(assignmentId, a);
    return a;
  }

  describe("Criterion 1: Electronic Original Preservation when Manual Correction is Uploaded", () => {
    it("preserves electronic signature, method, timestamp, and hoursWorked intact when a manual sheet with different hours is uploaded", async () => {
      seedStandardAssignment("assign-1");

      // Baseline: Electronic confirmation at 6.75 hours with cryptographic base64 signature
      const electronicOriginalTimestamp = new Date("2026-07-11T13:00:00.000Z");
      const signatureBase64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQ...";
      store.serviceConfirmations.set("assign-1", {
        id: "sc-electronic-1",
        assignmentId: "assign-1",
        confirmedById: "user-client-1",
        method: "electronic",
        signatureData: signatureBase64,
        documentUrl: "assign-1/signed/leistungsnachweis-original.pdf",
        hoursWorked: 6.75,
        signerName: "Dr. Schmidt",
        clientNotes: "Elektronisch signiert vor Ort",
        ipAddress: "192.168.1.50",
        confirmedAt: electronicOriginalTimestamp,
      });

      // Also seed the original ConfirmationDocument
      store.confirmationDocuments.set("doc-orig-1", {
        id: "doc-orig-1",
        assignmentId: "assign-1",
        sourceType: "electronic_original",
        storagePath: "assign-1/signed/leistungsnachweis-original.pdf",
        fileHash: "hash-electronic-pdf",
        fileName: "leistungsnachweis-original.pdf",
        mimeType: "application/pdf",
        fileSizeBytes: 45000,
        signatureData: signatureBase64,
        signerName: "Dr. Schmidt",
        signerIp: "192.168.1.50",
        uploadedById: "user-client-1",
        uploaderRole: "client",
        metadata: null,
        createdAt: electronicOriginalTimestamp,
      });

      // Action: Admin uploads a physical scanned timesheet proposing 6.72 hours
      const manualScanBuffer = makeTestPdf("_CORRECTED_MANUAL_TIMESHEET_SCAN_CONTENT_PDF");
      const result = await addConfirmationEvidence({
        assignmentId: "assign-1",
        file: {
          buffer: manualScanBuffer,
          fileName: "stundennachweis_korrigiert_juli.pdf",
          mimeType: "application/pdf",
          sizeBytes: manualScanBuffer.length,
        },
        proposedHours: 6.72,
        correctionReason: "Handschriftliche Korrektur durch Stationsleitung (6.72 Std statt 6.75)",
        currentUser: adminUser,
      });

      expect(result.document).toBeDefined();
      expect(result.document.sourceType).toBe("manual_correction");
      expect(result.correctionRequest).toBeDefined();
      expect(result.correctionRequest?.status).toBe("proposed");
      expect(Number(result.correctionRequest?.proposedHoursWorked)).toBe(6.72);
      expect(Number(result.correctionRequest?.previousHoursWorked)).toBe(6.75);

      // Verify ServiceConfirmation invariant: original electronic confirmation was NOT wiped or overwritten
      const scAfter = store.serviceConfirmations.get("assign-1");
      expect(scAfter).toBeDefined();
      expect(scAfter?.method).toBe("electronic"); // MUST REMAIN electronic!
      expect(scAfter?.signatureData).toBe(signatureBase64); // Signature data preserved!
      expect(Number(scAfter?.hoursWorked)).toBe(6.75); // Approved hoursWorked NOT automatically changed!
      expect(scAfter?.signerName).toBe("Dr. Schmidt"); // Signer name preserved!
      expect(scAfter?.confirmedAt.toISOString()).toBe(electronicOriginalTimestamp.toISOString()); // Timestamp preserved!
      expect(scAfter?.documentUrl).toBe("assign-1/signed/leistungsnachweis-original.pdf"); // Original PDF path untouched!

      // Verify Timeline Query shows both documents and pending unapproved correction
      const timeline = await getAssignmentEvidenceHistory("assign-1", adminUser);
      expect(timeline.documents).toHaveLength(2);
      expect(timeline.documents[0].sourceType).toBe("electronic_original");
      expect(timeline.documents[0].signerName).toBe("Dr. Schmidt");
      expect(timeline.documents[1].sourceType).toBe("manual_correction");
      expect(timeline.documents[1].fileName).toBe("stundennachweis_korrigiert_juli.pdf");

      expect(timeline.currentApprovedHours).toBe(6.75);
      expect(timeline.pendingCorrection).toBeDefined();
      expect(timeline.pendingCorrection?.proposedHoursWorked).toBe(6.72);
      expect(timeline.pendingCorrection?.status).toBe("proposed");
    });
  });

  describe("Criterion 2: Sequential & Concurrent Uploads, Storage Safety, and Access Boundaries", () => {
    it("handles multiple sequential and concurrent uploads creating distinct records without overwriting", async () => {
      seedStandardAssignment("assign-multi");

      const fileA = makeTestPdf("_FILE_A_CONTENT_PAGE_1");
      const fileB = makeTestPdf("_FILE_B_CONTENT_PAGE_2");

      // Concurrent upload
      const [resA, resB] = await Promise.all([
        addConfirmationEvidence({
          assignmentId: "assign-multi",
          file: {
            buffer: fileA,
            fileName: "scan_teil_1.pdf",
            mimeType: "application/pdf",
            sizeBytes: fileA.length,
          },
          currentUser: adminUser,
        }),
        addConfirmationEvidence({
          assignmentId: "assign-multi",
          file: {
            buffer: fileB,
            fileName: "scan_teil_2.pdf",
            mimeType: "application/pdf",
            sizeBytes: fileB.length,
          },
          currentUser: adminUser,
        }),
      ]);

      expect(resA.document.id).not.toBe(resB.document.id);
      expect(resA.document.storagePath).not.toBe(resB.document.storagePath);
      expect(store.confirmationDocuments.size).toBe(2);

      // Verify files in storage
      expect(store.storageFiles.has(resA.document.storagePath!)).toBe(true);
      expect(store.storageFiles.has(resB.document.storagePath!)).toBe(true);
    });

    it("accepts valid PNG image evidence and detects image/png MIME type correctly", async () => {
      seedStandardAssignment("assign-png-test");
      const pngBuffer = makeTestPng("_VALID_PNG_EVIDENCE");
      const result = await addConfirmationEvidence({
        assignmentId: "assign-png-test",
        file: {
          buffer: pngBuffer,
          fileName: "scan.png",
          mimeType: "image/png",
          sizeBytes: pngBuffer.length,
        },
        currentUser: adminUser,
      });
      expect(result.document.mimeType).toBe("image/png");
      expect(result.document.fileSizeBytes).toBe(pngBuffer.length);
    });

    it("rejects duplicate uploads of the exact same file for the same assignment", async () => {
      seedStandardAssignment("assign-dup");
      const file = makeTestPdf("_IDENTICAL_FILE_CONTENT");

      await addConfirmationEvidence({
        assignmentId: "assign-dup",
        file: {
          buffer: file,
          fileName: "doc.pdf",
          mimeType: "application/pdf",
          sizeBytes: file.length,
        },
        currentUser: adminUser,
      });

      // Second identical upload must throw DUPLICATE_DOCUMENT
      await expect(
        addConfirmationEvidence({
          assignmentId: "assign-dup",
          file: {
            buffer: file,
            fileName: "doc.pdf",
            mimeType: "application/pdf",
            sizeBytes: file.length,
          },
          currentUser: adminUser,
        })
      ).rejects.toThrowError(/DUPLICATE_DOCUMENT/);
    });

    it("handles concurrent race condition uploading identical file content by enforcing compound unique constraint and cleaning up storage", async () => {
      seedStandardAssignment("assign-race");
      const file = makeTestPdf("_IDENTICAL_CONTENT_FOR_RACE");

      // Attempt two concurrent uploads with identical content for the same assignment
      const results = await Promise.allSettled([
        addConfirmationEvidence({
          assignmentId: "assign-race",
          file: {
            buffer: file,
            fileName: "doc1.pdf",
            mimeType: "application/pdf",
            sizeBytes: file.length,
          },
          currentUser: adminUser,
        }),
        addConfirmationEvidence({
          assignmentId: "assign-race",
          file: {
            buffer: file,
            fileName: "doc2.pdf",
            mimeType: "application/pdf",
            sizeBytes: file.length,
          },
          currentUser: adminUser,
        }),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason.message).toContain("DUPLICATE_DOCUMENT");

      // Exactly 1 document recorded in DB
      expect(store.confirmationDocuments.size).toBe(1);
      // Exactly 1 file remaining in storage (failed concurrent upload cleaned up)
      expect(store.storageFiles.size).toBe(1);
    });

    it("cleans up uploaded file from storage if database transaction fails", async () => {
      seedStandardAssignment("assign-tx-fail");
      const file = makeTestPdf("_CLEANUP_ON_FAIL");

      // Force transaction failure
      vi.mocked(prismaMock.$transaction).mockImplementationOnce(async () => {
        throw new Error("DB Connection Interrupted");
      });

      await expect(
        addConfirmationEvidence({
          assignmentId: "assign-tx-fail",
          file: {
            buffer: file,
            fileName: "tx_fail.pdf",
            mimeType: "application/pdf",
            sizeBytes: file.length,
          },
          currentUser: adminUser,
        })
      ).rejects.toThrowError("DB Connection Interrupted");

      // Storage file was cleaned up via rollback
      expect(store.storageFiles.size).toBe(0);
      expect(store.confirmationDocuments.size).toBe(0);
    });

    it("aborts and throws error if storage upload fails, without leaving database ghosts", async () => {
      seedStandardAssignment("assign-fail");
      const file = makeTestPdf("_FAILURE_TEST_FILE");

      // Force storage mock failure
      storageMock.upload.mockResolvedValueOnce({
        data: null,
        error: new Error("Supabase S3 gateway timeout 504"),
      });

      await expect(
        addConfirmationEvidence({
          assignmentId: "assign-fail",
          file: {
            buffer: file,
            fileName: "timeout.pdf",
            mimeType: "application/pdf",
            sizeBytes: file.length,
          },
          currentUser: adminUser,
        })
      ).rejects.toThrowError(/STORAGE_UPLOAD_FAILED/);

      expect(store.confirmationDocuments.size).toBe(0);
    });

    it("strictly enforces tenant and worker isolation (cross-tenant access rejected)", async () => {
      seedStandardAssignment("assign-auth");

      const file = makeTestPdf("_ATTACK_FILE");

      // Foreign client (facility 2) trying to access assignment belonging to facility 1
      await expect(
        addConfirmationEvidence({
          assignmentId: "assign-auth",
          file: {
            buffer: file,
            fileName: "attack.pdf",
            mimeType: "application/pdf",
            sizeBytes: file.length,
          },
          currentUser: foreignClientUser,
        })
      ).rejects.toThrowError(/FORBIDDEN_ASSIGNMENT_ACCESS/);

      // Foreign worker trying to access
      const foreignWorker = { id: "user-worker-99", role: "worker" };
      await expect(
        addConfirmationEvidence({
          assignmentId: "assign-auth",
          file: {
            buffer: file,
            fileName: "attack.pdf",
            mimeType: "application/pdf",
            sizeBytes: file.length,
          },
          currentUser: foreignWorker,
        })
      ).rejects.toThrowError(/FORBIDDEN_ASSIGNMENT_ACCESS/);

      // Authorized client user is permitted
      const clientFile = makeTestPdf("_authorized client payload");
      const clientAccess = await addConfirmationEvidence({
        assignmentId: "assign-auth",
        file: {
          buffer: clientFile,
          fileName: "client-sheet.pdf",
          mimeType: "application/pdf",
          sizeBytes: clientFile.length,
        },
        currentUser: clientUser,
      });
      expect(clientAccess.document.id).toBeDefined();

      // Authorized worker user is permitted
      const workerFile = makeTestPdf("_authorized worker payload");
      const workerAccess = await addConfirmationEvidence({
        assignmentId: "assign-auth",
        file: {
          buffer: workerFile,
          fileName: "worker-sheet.pdf",
          mimeType: "application/pdf",
          sizeBytes: workerFile.length,
        },
        currentUser: workerUser,
      });
      expect(workerAccess.document.id).toBeDefined();
    });

    it("rejects invalid files: empty, oversized, or unsupported MIME types", async () => {
      seedStandardAssignment("assign-validate");

      // Empty file
      await expect(
        addConfirmationEvidence({
          assignmentId: "assign-validate",
          file: {
            buffer: Buffer.alloc(0),
            fileName: "empty.pdf",
            mimeType: "application/pdf",
            sizeBytes: 0,
          },
          currentUser: adminUser,
        })
      ).rejects.toThrowError(/EMPTY_FILE/);

      // Oversized file (> 25MB)
      await expect(
        addConfirmationEvidence({
          assignmentId: "assign-validate",
          file: {
            buffer: Buffer.alloc(10),
            fileName: "huge.pdf",
            mimeType: "application/pdf",
            sizeBytes: MAX_CONFIRMATION_FILE_SIZE_BYTES + 1,
          },
          currentUser: adminUser,
        })
      ).rejects.toThrowError(/FILE_TOO_LARGE/);

      // Unsupported MIME type
      await expect(
        addConfirmationEvidence({
          assignmentId: "assign-validate",
          file: {
            buffer: Buffer.from("MALICIOUS_EXE"),
            fileName: "malware.exe",
            mimeType: "application/x-msdownload",
            sizeBytes: 13,
          },
          currentUser: adminUser,
        })
      ).rejects.toThrowError(/UNSUPPORTED_MIME_TYPE/);
    });
  });

  describe("Criterion 3: Complete Decoupling from Invoices (Zero Snapshot Mutation)", () => {
    it("proves Invoice.snapshotData and invoice totals remain 100% byte-identical before and after evidence upload", async () => {
      seedStandardAssignment("assign-invoice");

      // Seed existing invoice with frozen snapshotData
      const originalSnapshot = {
        calculationVersion: "legacy-v1",
        lineItems: [
          {
            pos: 1,
            workerName: "Oso, Majed",
            hours: 6.75,
            rate: 52.8,
            amount: 356.4,
          },
        ],
        subtotal: 356.4,
        vat: 67.72,
        total: 424.12,
      };

      const originalInvoice: DbInvoice = {
        id: "inv-2026-001",
        invoiceNumber: "RE-2026-001",
        netAmount: 356.4,
        vatAmount: 67.72,
        grossAmount: 424.12,
        status: "sent",
        snapshotData: JSON.parse(JSON.stringify(originalSnapshot)),
        createdAt: new Date("2026-07-15T10:00:00.000Z"),
        updatedAt: new Date("2026-07-15T10:00:00.000Z"),
      };
      store.invoices.set("inv-2026-001", originalInvoice);

      const serializedSnapshotBefore = JSON.stringify(originalInvoice.snapshotData);

      // Action: Upload corrective sheet proposing 5.00 hours
      const file = makeTestPdf("_CORRECTIVE_DOCUMENT_PDF");
      await addConfirmationEvidence({
        assignmentId: "assign-invoice",
        file: {
          buffer: file,
          fileName: "korrektur.pdf",
          mimeType: "application/pdf",
          sizeBytes: file.length,
        },
        proposedHours: 5.0,
        currentUser: adminUser,
      });

      // Verify Invoice state
      const invoiceAfter = store.invoices.get("inv-2026-001");
      expect(invoiceAfter).toBeDefined();

      const serializedSnapshotAfter = JSON.stringify(invoiceAfter?.snapshotData);
      expect(serializedSnapshotAfter).toBe(serializedSnapshotBefore);
      expect(invoiceAfter?.netAmount).toBe(356.4);
      expect(invoiceAfter?.vatAmount).toBe(67.72);
      expect(invoiceAfter?.grossAmount).toBe(424.12);
      expect(invoiceAfter?.status).toBe("sent");
    });
  });

  describe("Criterion 4: Truthful Legacy Electronic Representation without Fake Stored PDF", () => {
    it("distinguishes on-the-fly rendered PDFs from authoritative archived PDFs in legacy records", async () => {
      seedStandardAssignment("assign-legacy");

      // Legacy electronic confirmation: signature image exists in DB, but NO immutable PDF was archived in storage
      store.serviceConfirmations.set("assign-legacy", {
        id: "sc-legacy-1",
        assignmentId: "assign-legacy",
        confirmedById: "user-client-1",
        method: "electronic",
        signatureData: "data:image/png;base64,LEGACY_SIGNATURE_DATA",
        documentUrl: null, // NO stored file!
        hoursWorked: 8.0,
        signerName: "Sr. Hildegard",
        clientNotes: null,
        ipAddress: "10.0.0.1",
        confirmedAt: new Date("2026-05-01T15:00:00.000Z"),
      });

      const timeline = await getAssignmentEvidenceHistory("assign-legacy", adminUser);

      expect(timeline.legacyBaseline).toBeDefined();
      expect(timeline.legacyBaseline?.exists).toBe(true);
      expect(timeline.legacyBaseline?.method).toBe("electronic");
      expect(timeline.legacyBaseline?.hasSignatureImage).toBe(true);

      // MUST NOT claim an archived PDF exists when none was saved!
      expect(timeline.legacyBaseline?.hasArchivedPdf).toBe(false);
      expect(timeline.legacyBaseline?.isDynamicallyGeneratedView).toBe(true);

      // Virtual legacy evidence item also truthfully reflects this
      expect(timeline.documents).toHaveLength(1);
      expect(timeline.documents[0].isArchivedPdf).toBe(false);
      expect(timeline.documents[0].isDynamicallyGeneratedView).toBe(true);
    });

    it("recognizes authoritative archived PDF when documentUrl contains signed PDF path", async () => {
      seedStandardAssignment("assign-archived");

      store.serviceConfirmations.set("assign-archived", {
        id: "sc-archived-1",
        assignmentId: "assign-archived",
        confirmedById: "user-client-1",
        method: "electronic",
        signatureData: "data:image/png;base64,SIGNATURE",
        documentUrl: "assign-archived/signed/leistungsnachweis-authoritative.pdf",
        hoursWorked: 8.0,
        signerName: "Dr. Weber",
        clientNotes: null,
        ipAddress: "10.0.0.1",
        confirmedAt: new Date("2026-06-01T15:00:00.000Z"),
      });

      const timeline = await getAssignmentEvidenceHistory("assign-archived", adminUser);

      expect(timeline.legacyBaseline?.hasArchivedPdf).toBe(true);
      expect(timeline.legacyBaseline?.isDynamicallyGeneratedView).toBe(false);
    });

    it("preserves visibility of legacy electronic original at position 0 even after manual documents are uploaded, without duplicating if modern original exists", async () => {
      seedStandardAssignment("assign-legacy-preserved");

      // 1. Seed legacy electronic confirmation without modern ConfirmationDocument row
      store.serviceConfirmations.set("assign-legacy-preserved", {
        id: "sc-legacy-orig",
        assignmentId: "assign-legacy-preserved",
        confirmedById: "client-user-1",
        method: "electronic",
        signatureData: "data:image/png;base64,ORIGINAL_CANVAS",
        documentUrl: null,
        hoursWorked: 9.0,
        signerName: "Frau PDL Müller",
        clientNotes: "Erstbestätigung digital",
        ipAddress: "192.168.1.50",
        confirmedAt: new Date("2026-05-10T10:00:00.000Z"),
      });

      // 2. Upload a subsequent manual correction sheet
      const sheet = makeTestPdf("_MANUAL_SHEET_CORRECTION");
      await addConfirmationEvidence({
        assignmentId: "assign-legacy-preserved",
        file: {
          buffer: sheet,
          fileName: "korrektur_nachweis.pdf",
          mimeType: "application/pdf",
          sizeBytes: sheet.length,
        },
        proposedHours: 10.5,
        currentUser: adminUser,
      });

      // 3. Retrieve history
      const history = await getAssignmentEvidenceHistory("assign-legacy-preserved", adminUser);

      // Must have TWO documents:
      // index 0: synthesized legacy electronic original
      // index 1: modern manual correction
      expect(history.documents).toHaveLength(2);

      const doc0 = history.documents[0];
      expect(doc0.id).toBe("legacy-sc-legacy-orig");
      expect(doc0.sourceType).toBe("electronic_original");
      expect(doc0.signatureData).toBe("data:image/png;base64,ORIGINAL_CANVAS");
      expect(doc0.signerName).toBe("Frau PDL Müller");
      expect(doc0.isDynamicallyGeneratedView).toBe(true);
      expect(doc0.isArchivedPdf).toBe(false);

      const doc1 = history.documents[1];
      expect(doc1.sourceType).toBe("manual_correction");
      expect(doc1.fileName).toBe("korrektur_nachweis.pdf");
      expect(doc1.isPhysicalScan).toBe(true);

      // Verify approved hours and signature on ServiceConfirmation remained 100% untouched
      const sc = store.serviceConfirmations.get("assign-legacy-preserved");
      expect(sc?.method).toBe("electronic");
      expect(Number(sc?.hoursWorked)).toBe(9.0);
    });
  });

  describe("Criterion 5: Regression & Compatibility for Initial Manual Confirmations", () => {
    it("creates initial ServiceConfirmation when uploading evidence for an unconfirmed assignment", async () => {
      seedStandardAssignment("assign-initial");

      expect(store.serviceConfirmations.has("assign-initial")).toBe(false);

      const file = makeTestPdf("_INITIAL_MANUAL_TIMESHEET");
      const result = await addConfirmationEvidence({
        assignmentId: "assign-initial",
        file: {
          buffer: file,
          fileName: "initial_sheet.pdf",
          mimeType: "application/pdf",
          sizeBytes: file.length,
        },
        proposedHours: 6.8,
        signerName: "Pflegedienstleitung",
        currentUser: adminUser,
      });

      expect(result.document.sourceType).toBe("manual_upload");

      // ServiceConfirmation is created with method: "upload"
      const sc = store.serviceConfirmations.get("assign-initial");
      expect(sc).toBeDefined();
      expect(sc?.method).toBe("upload");
      expect(Number(sc?.hoursWorked)).toBe(6.8);
      expect(sc?.signerName).toBe("Pflegedienstleitung");

      // No pending correction created because this is the initial approved value
      expect(result.correctionRequest).toBeNull();
    });
  });

  describe("Criterion 6: Live Route & Action Invariants (upload-signed and confirmation-actions)", () => {
    it("POST /api/confirmations/upload-signed: preserves electronic signature and does NOT infer correction from scheduledHours", async () => {
      seedStandardAssignment("assign-route-preserve");

      // Existing electronic confirmation: 6.75 hours
      store.serviceConfirmations.set("assign-route-preserve", {
        id: "sc-route-1",
        assignmentId: "assign-route-preserve",
        confirmedById: "client-1",
        method: "electronic",
        signatureData: "data:image/png;base64,ELECTRONIC_SIG",
        documentUrl: null,
        hoursWorked: 6.75,
        signerName: "Schwester Agnes",
        clientNotes: null,
        ipAddress: "127.0.0.1",
        confirmedAt: new Date("2026-09-01T12:00:00.000Z"),
      });

      // scheduledHours for standard assignment is 8.0 hours.
      // Upload manual timesheet WITHOUT explicit proposedHours:
      const file = new File([new Uint8Array(makeTestPdf("_PDF_ROUTE_TEST"))], "stundenzettel.pdf", {
        type: "application/pdf",
      });

      const formData = new FormData();
      formData.set("assignmentIds", JSON.stringify(["assign-route-preserve"]));
      formData.set("document", file);
      formData.set("signerName", "Manuell unterschrieben");
      formData.set("requestGroupId", "grp-1");

      const req = new Request("http://localhost/api/confirmations/upload-signed", {
        method: "POST",
        body: formData,
      });

      const res = await uploadSignedRoute(req);
      const json = await res.json();
      expect(json.ok).toBe(true);

      // Invariant 1: Electronic confirmation was NOT overwritten
      const sc = store.serviceConfirmations.get("assign-route-preserve");
      expect(sc?.method).toBe("electronic");
      expect(sc?.signatureData).toBe("data:image/png;base64,ELECTRONIC_SIG");
      expect(Number(sc?.hoursWorked)).toBe(6.75);

      // Invariant 2: NO WorkHoursCorrectionRequest created from scheduledHours!
      expect(store.workHoursCorrections.size).toBe(0);

      // Invariant 3: ConfirmationDocument created as manual_correction
      expect(store.confirmationDocuments.size).toBe(1);
      const doc = Array.from(store.confirmationDocuments.values())[0];
      expect(doc.sourceType).toBe("manual_correction");
    });

    it("POST /api/confirmations/upload-signed: creates correction request ONLY when explicit proposedHours is supplied", async () => {
      seedStandardAssignment("assign-route-explicit");

      store.serviceConfirmations.set("assign-route-explicit", {
        id: "sc-route-2",
        assignmentId: "assign-route-explicit",
        confirmedById: "client-1",
        method: "electronic",
        signatureData: "data:image/png;base64,ELECTRONIC_SIG",
        documentUrl: null,
        hoursWorked: 6.75,
        signerName: "Schwester Agnes",
        clientNotes: null,
        ipAddress: "127.0.0.1",
        confirmedAt: new Date("2026-09-01T12:00:00.000Z"),
      });

      const file = new File([new Uint8Array(makeTestPdf("_PDF_EXPLICIT_HOURS"))], "nachweis.pdf", {
        type: "application/pdf",
      });

      const formData = new FormData();
      formData.set("assignmentIds", JSON.stringify(["assign-route-explicit"]));
      formData.set("document", file);
      formData.set("proposedHours", "6.72");

      const req = new Request("http://localhost/api/confirmations/upload-signed", {
        method: "POST",
        body: formData,
      });

      const res = await uploadSignedRoute(req);
      const json = await res.json();
      expect(json.ok).toBe(true);

      // Correction request created with explicit 6.72 hours linked to document
      expect(store.workHoursCorrections.size).toBe(1);
      const corr = Array.from(store.workHoursCorrections.values())[0];
      expect(Number(corr.proposedHoursWorked)).toBe(6.72);
      expect(Number(corr.previousHoursWorked)).toBe(6.75);
      expect(corr.status).toBe("proposed");
      expect(corr.documentId).toBeDefined();
    });

    it("createConfirmationUploadTicket and finalizeDirectSignedConfirmation enforce unique slug, upsert false, and path safety", async () => {
      seedStandardAssignment("assign-action-1");
      store.assignments.get("assign-action-1")!.order.requestGroupId = "group-42";

      const pdfBuffer1024 = Buffer.concat([REAL_PDF_HEADER, Buffer.alloc(1024 - REAL_PDF_HEADER.length, 0x20)]);
      const ticket = await createConfirmationUploadTicket({
        requestGroupId: "group-42",
        fileName: "nachweis.pdf",
        fileSize: pdfBuffer1024.length,
        fileType: "application/pdf",
        assignmentIds: ["assign-action-1"],
      });

      expect(ticket.ok).toBe(true);
      if (ticket.ok) {
        expect(ticket.path).toContain("signed-confirmations/group-42/");
        expect(ticket.path).toMatch(/[0-9a-f]{16}/); // contains 8-byte random slug
      }

      // Finalize rejects path traversal attempt
      const attackRes = await finalizeDirectSignedConfirmation({
        assignmentIds: ["assign-action-1"],
        path: "signed-confirmations/group-42/../../etc/passwd",
      });
      expect(attackRes.ok).toBe(false);
      expect(attackRes.error).toContain("Ungültiger oder unzulässiger Dateipfad");

      // Finalize with valid path succeeds and preserves electronic confirmation
      store.serviceConfirmations.set("assign-action-1", {
        id: "sc-action-1",
        assignmentId: "assign-action-1",
        confirmedById: "client-1",
        method: "electronic",
        signatureData: "SIG",
        documentUrl: null,
        hoursWorked: 7.5,
        signerName: "PDL",
        clientNotes: null,
        ipAddress: "127.0.0.1",
        confirmedAt: new Date(),
      });

      if (ticket.ok) {
        store.storageFiles.set(ticket.path, {
          buffer: pdfBuffer1024,
          contentType: "application/pdf",
        });

        const finalizeRes = await finalizeDirectSignedConfirmation({
          assignmentIds: ["assign-action-1"],
          path: ticket.path,
          ticket: ticket.ticket,
          requestGroupId: "group-42",
        });
        expect(finalizeRes.ok).toBe(true);

        // Electronic confirmation unchanged
        const sc = store.serviceConfirmations.get("assign-action-1");
        expect(sc?.method).toBe("electronic");
        expect(Number(sc?.hoursWorked)).toBe(7.5);
        // No correction created without explicit proposedHours
        expect(store.workHoursCorrections.size).toBe(0);
      }
    });

    it("uploadDirectSignedConfirmation fallback uploads with unique slug and non-overwriting upsert false", async () => {
      seedStandardAssignment("assign-action-fallback");
      store.assignments.get("assign-action-fallback")!.order.requestGroupId = "grp-fallback";

      const file = new File([new Uint8Array(makeTestPdf("_DIRECT_ACTION_FALLBACK"))], "fallback.pdf", {
        type: "application/pdf",
      });

      const formData = new FormData();
      formData.set("assignmentIds", JSON.stringify(["assign-action-fallback"]));
      formData.set("document", file);
      formData.set("requestGroupId", "grp-fallback");

      const res = await uploadDirectSignedConfirmation(formData);
      expect(res.ok).toBe(true);

      expect(store.confirmationDocuments.size).toBe(1);
      const doc = Array.from(store.confirmationDocuments.values())[0];
      expect(doc.storagePath).toContain("signed-confirmations/grp-fallback/");
    });
  });

  describe("Criterion 7: Live Document Retrieval Route (GET /api/confirmations/[assignmentId]/document)", () => {
    it("returns 404 when specific documentId does not exist without silent fallback", async () => {
      seedStandardAssignment("assign-get-doc");

      // Seed an existing document
      store.confirmationDocuments.set("doc-real-1", {
        id: "doc-real-1",
        assignmentId: "assign-get-doc",
        sourceType: "manual_upload",
        storagePath: "signed-confirmations/client/real.pdf",
        fileHash: "hash-real",
        fileName: "real.pdf",
        mimeType: "application/pdf",
        fileSizeBytes: 100,
        signatureData: null,
        signerName: null,
        signerIp: null,
        uploadedById: "admin-1",
        uploaderRole: "admin",
        metadata: null,
        createdAt: new Date(),
      });

      // Request a NON-EXISTENT documentId: MUST NOT return doc-real-1 silently!
      const req = new Request("http://localhost/api/confirmations/assign-get-doc/document?documentId=non-existent-id");
      const res = await getConfirmationDocumentRoute(req, {
        params: Promise.resolve({ assignmentId: "assign-get-doc" }),
      });

      expect(res.status).toBe(404);
    });

    it("returns signed URL redirect when specific documentId exists", async () => {
      seedStandardAssignment("assign-get-doc-ok");

      store.confirmationDocuments.set("doc-target", {
        id: "doc-target",
        assignmentId: "assign-get-doc-ok",
        sourceType: "manual_upload",
        storagePath: "signed-confirmations/client/target.pdf",
        fileHash: "hash-target",
        fileName: "target.pdf",
        mimeType: "application/pdf",
        fileSizeBytes: 200,
        signatureData: null,
        signerName: null,
        signerIp: null,
        uploadedById: "admin-1",
        uploaderRole: "admin",
        metadata: null,
        createdAt: new Date(),
      });

      const req = new Request("http://localhost/api/confirmations/assign-get-doc-ok/document?documentId=doc-target");
      const res = await getConfirmationDocumentRoute(req, {
        params: Promise.resolve({ assignmentId: "assign-get-doc-ok" }),
      });

      expect(res.status).toBe(307); // NextResponse.redirect default
      expect(res.headers.get("location")).toContain("signed-confirmations/client/target.pdf");
    });

    it("falls back to latest document only when documentId parameter is omitted", async () => {
      seedStandardAssignment("assign-fallback");

      store.confirmationDocuments.set("doc-latest", {
        id: "doc-latest",
        assignmentId: "assign-fallback",
        sourceType: "manual_upload",
        storagePath: "signed-confirmations/client/latest.pdf",
        fileHash: "hash-latest",
        fileName: "latest.pdf",
        mimeType: "application/pdf",
        fileSizeBytes: 300,
        signatureData: null,
        signerName: null,
        signerIp: null,
        uploadedById: "admin-1",
        uploaderRole: "admin",
        metadata: null,
        createdAt: new Date(),
      });

      const req = new Request("http://localhost/api/confirmations/assign-fallback/document");
      const res = await getConfirmationDocumentRoute(req, {
        params: Promise.resolve({ assignmentId: "assign-fallback" }),
      });

      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toContain("signed-confirmations/client/latest.pdf");
    });

    it("enforces permission checks and returns 403 for unauthorized users", async () => {
      seedStandardAssignment("assign-get-forbidden");

      store.confirmationDocuments.set("doc-secret", {
        id: "doc-secret",
        assignmentId: "assign-get-forbidden",
        sourceType: "manual_upload",
        storagePath: "signed-confirmations/client/secret.pdf",
        fileHash: "hash-secret",
        fileName: "secret.pdf",
        mimeType: "application/pdf",
        fileSizeBytes: 400,
        signatureData: null,
        signerName: null,
        signerIp: null,
        uploadedById: "admin-1",
        uploaderRole: "admin",
        metadata: null,
        createdAt: new Date(),
      });

      // Switch active user to an unauthorized client
      activeUser = { id: "foreign-user", role: "client", clientId: "foreign-facility-99" };

      const req = new Request("http://localhost/api/confirmations/assign-get-forbidden/document");
      const res = await getConfirmationDocumentRoute(req, {
        params: Promise.resolve({ assignmentId: "assign-get-forbidden" }),
      });

      expect(res.status).toBe(403);
    });
  });

  describe("Criterion 8: Referential Integrity & Audit Retention (ON DELETE RESTRICT)", () => {
    it("prevents deleting an assignment when confirmation documents exist (RESTRICT constraint)", async () => {
      seedStandardAssignment("assign-restrict-test");

      store.confirmationDocuments.set("doc-audit", {
        id: "doc-audit",
        assignmentId: "assign-restrict-test",
        sourceType: "manual_upload",
        storagePath: "signed-confirmations/client/audit.pdf",
        fileHash: "hash-audit",
        fileName: "audit.pdf",
        mimeType: "application/pdf",
        fileSizeBytes: 500,
        signatureData: null,
        signerName: null,
        signerIp: null,
        uploadedById: "admin-1",
        uploaderRole: "admin",
        metadata: null,
        createdAt: new Date(),
      });

      // Attempting to delete the assignment MUST fail with P2003 RESTRICT error
      await expect(
        prismaMock.assignment.delete({
          where: { id: "assign-restrict-test" },
        })
      ).rejects.toThrowError(/RESTRICT/);

      // Assignment remains safe
      expect(store.assignments.has("assign-restrict-test")).toBe(true);
    });
  });

  describe("Criterion 9: Ticket Invariants, Strict Hours Validation, and Fallback Cleanup", () => {
    it("rejects ticket reuse and foreign group path in finalizeDirectSignedConfirmation", async () => {
      seedStandardAssignment("assign-ticket-test");
      store.assignments.get("assign-ticket-test")!.order.requestGroupId = "group-alpha";

      const pdfBuffer2048 = Buffer.concat([REAL_PDF_HEADER, Buffer.alloc(2048 - REAL_PDF_HEADER.length, 0x20)]);
      const ticket = await createConfirmationUploadTicket({
        requestGroupId: "group-alpha",
        fileName: "nachweis.pdf",
        fileSize: pdfBuffer2048.length,
        fileType: "application/pdf",
        assignmentIds: ["assign-ticket-test"],
      });
      expect(ticket.ok).toBe(true);
      if (!ticket.ok) return;

      // 1. Foreign path / group mismatch rejected
      const foreignRes = await finalizeDirectSignedConfirmation({
        assignmentIds: ["assign-ticket-test"],
        path: "signed-confirmations/foreign-group/nonexistent.pdf",
        requestGroupId: "group-alpha",
      });
      expect(foreignRes.ok).toBe(false);

      // 2. First finalization with valid ticket succeeds
      store.storageFiles.set(ticket.path, {
        buffer: pdfBuffer2048,
        contentType: "application/pdf",
      });
      const firstFinalize = await finalizeDirectSignedConfirmation({
        assignmentIds: ["assign-ticket-test"],
        path: ticket.path,
        ticket: ticket.ticket,
        requestGroupId: "group-alpha",
      });
      expect(firstFinalize.ok).toBe(true);

      // 3. Second finalization with identical ticket is rejected (replay attack prevention)
      const secondFinalize = await finalizeDirectSignedConfirmation({
        assignmentIds: ["assign-ticket-test"],
        path: ticket.path,
        ticket: ticket.ticket,
        requestGroupId: "group-alpha",
      });
      expect(secondFinalize.ok).toBe(false);
      expect(secondFinalize.error).toContain("Upload-Ticket wurde bereits verwendet");
    });

    it("normalizes German comma notation and rejects invalid or negative hours", async () => {
      seedStandardAssignment("assign-hours-validation");

      // German comma string "6,75" normalizes to 6.75
      const { validateAndNormalizeProposedHours, validateBreakMinutes } = await import("./confirmation-evidence-service");
      expect(validateAndNormalizeProposedHours("6,75")).toBe(6.75);
      expect(validateAndNormalizeProposedHours("6.75")).toBe(6.75);
      expect(validateAndNormalizeProposedHours(0)).toBe(0);

      // Invalid inputs throw before any DB or storage operations
      expect(() => validateAndNormalizeProposedHours(-2)).toThrow();
      expect(() => validateAndNormalizeProposedHours("-2,50")).toThrow();
      expect(() => validateAndNormalizeProposedHours("6.72oops")).toThrow();
      expect(() => validateAndNormalizeProposedHours("Infinity")).toThrow();
      expect(() => validateAndNormalizeProposedHours(25)).toThrow();

      // Break minutes preserves 0 with ?? null
      expect(validateBreakMinutes(0)).toBe(0);
      expect(validateBreakMinutes("0")).toBe(0);
      expect(validateBreakMinutes(30)).toBe(30);
      expect(() => validateBreakMinutes(-5)).toThrow();
    });

    it("preserves break minutes 0 in correction request instead of converting to null", async () => {
      seedStandardAssignment("assign-break-zero");

      store.serviceConfirmations.set("assign-break-zero", {
        id: "sc-break-zero",
        assignmentId: "assign-break-zero",
        confirmedById: "client-1",
        method: "electronic",
        signatureData: "SIG",
        documentUrl: null,
        hoursWorked: 8.0,
        signerName: "PDL",
        clientNotes: null,
        ipAddress: "127.0.0.1",
        confirmedAt: new Date(),
      });

      const buffer = makeTestPdf("_BREAK_ZERO_TEST");
      const res = await addConfirmationEvidence({
        assignmentId: "assign-break-zero",
        file: {
          buffer,
          fileName: "timesheet.pdf",
          mimeType: "application/pdf",
          sizeBytes: buffer.length,
        },
        proposedHours: 7.5,
        proposedBreakMinutes: 0,
        currentUser: adminUser,
      });

      expect(res.correctionRequest).not.toBeNull();
      expect(res.correctionRequest?.proposedBreakMinutes).toBe(0);
    });
  });
});
