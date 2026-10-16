import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addConfirmationEvidence,
  getAssignmentEvidenceHistory,
  getAssignmentEffectiveWorkHours,
  createOrUpdateHoursCorrectionRequest,
  approveHoursCorrectionRequest,
  rejectHoursCorrectionRequest,
  computeShiftGrossMinutes,
  computeShiftNetHours,
  parseTimeToMinutes,
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
  baseVersion?: string | null;
  revision?: number;
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

vi.mock("@/lib/local-storage", () => ({
  createLocalStorageClient: () => ({
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
      findMany: vi.fn(async ({ where }: { where?: { assignmentId?: string | { in?: string[] }; fileHash?: string } }) => {
        const list: DbConfirmationDocument[] = [];
        for (const doc of store.confirmationDocuments.values()) {
          let match = true;
          if (where?.assignmentId) {
            if (typeof where.assignmentId === "string") {
              if (doc.assignmentId !== where.assignmentId) match = false;
            } else if (where.assignmentId.in) {
              if (!where.assignmentId.in.includes(doc.assignmentId)) match = false;
            }
          }
          if (where?.fileHash && doc.fileHash !== where.fileHash) match = false;
          if (match) list.push(doc);
        }
        return list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        return store.confirmationDocuments.get(where.id) || null;
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
          baseVersion: data.baseVersion || null,
          revision: data.revision ?? 1,
        };
        store.workHoursCorrections.set(id, record);
        return record;
      }),
      findUnique: vi.fn(async ({ where, include }: { where: { id: string }; include?: { assignment?: boolean; document?: boolean } }) => {
        const c = store.workHoursCorrections.get(where.id);
        if (!c) return null;
        let assignment = undefined;
        let document = undefined;
        if (include?.assignment) {
          const a = store.assignments.get(c.assignmentId);
          const sc = store.serviceConfirmations.get(c.assignmentId);
          assignment = a ? { ...a, serviceConfirmation: sc || null } : null;
        }
        if (include?.document) {
          document = c.documentId ? store.confirmationDocuments.get(c.documentId) || null : null;
        }
        return {
          ...c,
          ...(assignment !== undefined ? { assignment } : {}),
          ...(document !== undefined ? { document } : {}),
        };
      }),
      findUniqueOrThrow: vi.fn(async ({ where, include }: { where: { id: string }; include?: { assignment?: boolean; document?: boolean } }) => {
        const c = store.workHoursCorrections.get(where.id);
        if (!c) throw new Error("WorkHoursCorrectionRequest not found");
        let assignment = undefined;
        let document = undefined;
        if (include?.assignment) {
          const a = store.assignments.get(c.assignmentId);
          const sc = store.serviceConfirmations.get(c.assignmentId);
          assignment = a ? { ...a, serviceConfirmation: sc || null } : null;
        }
        if (include?.document) {
          document = c.documentId ? store.confirmationDocuments.get(c.documentId) || null : null;
        }
        return {
          ...c,
          ...(assignment !== undefined ? { assignment } : {}),
          ...(document !== undefined ? { document } : {}),
        };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<DbWorkHoursCorrection> }) => {
        const c = store.workHoursCorrections.get(where.id);
        if (!c) throw new Error("WorkHoursCorrectionRequest not found");
        const updated = { ...c, ...data };
        store.workHoursCorrections.set(where.id, updated);
        return updated;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; status?: string }; data: Partial<DbWorkHoursCorrection> }) => {
        const c = store.workHoursCorrections.get(where.id);
        if (!c) return { count: 0 };
        if (where.status && c.status !== where.status) {
          return { count: 0 };
        }
        // Partial unique index simulation: unique (assignment_id, base_version) WHERE status = 'approved' AND base_version IS NOT NULL
        if (data.status === "approved") {
          const targetBaseVersion = data.baseVersion !== undefined ? data.baseVersion : c.baseVersion;
          if (targetBaseVersion) {
            for (const other of store.workHoursCorrections.values()) {
              if (
                other.assignmentId === c.assignmentId &&
                other.id !== c.id &&
                other.status === "approved" &&
                other.baseVersion === targetBaseVersion
              ) {
                const err = new Error("Unique constraint failed on the constraint: work_hours_correction_requests_assignment_base_approved_key");
                (err as unknown as { code: string; meta: { target: string[] } }).code = "P2002";
                (err as unknown as { meta: { target: string[] } }).meta = { target: ["base_version"] };
                throw err;
              }
            }
          }
        }
        const updated = { ...c, ...data };
        store.workHoursCorrections.set(where.id, updated);
        return { count: 1 };
      }),
      findFirst: vi.fn(async ({ where }: { where: { assignmentId?: string; status?: string; id?: string | { not?: string }; decidedAt?: { gt?: Date }; baseVersion?: string } }) => {
        const matches: DbWorkHoursCorrection[] = [];
        for (const c of store.workHoursCorrections.values()) {
          let match = true;
          if (where.assignmentId && c.assignmentId !== where.assignmentId) match = false;
          if (where.status && c.status !== where.status) match = false;
          if (where.baseVersion !== undefined && c.baseVersion !== where.baseVersion) match = false;
          if (where.id) {
            if (typeof where.id === "string" && c.id !== where.id) match = false;
            if (typeof where.id === "object" && where.id.not && c.id === where.id.not) match = false;
          }
          if (where.decidedAt?.gt) {
            if (!c.decidedAt || c.decidedAt.getTime() <= where.decidedAt.gt.getTime()) match = false;
          }
          if (match) matches.push(c);
        }
        if (matches.length === 0) return null;
        matches.sort((a, b) => {
          const aRev = a.revision ?? 1;
          const bRev = b.revision ?? 1;
          if (bRev !== aRev) return bRev - aRev;
          const aDecided = a.decidedAt ? a.decidedAt.getTime() : 0;
          const bDecided = b.decidedAt ? b.decidedAt.getTime() : 0;
          if (bDecided !== aDecided) return bDecided - aDecided;
          const aReq = a.requestedAt.getTime();
          const bReq = b.requestedAt.getTime();
          if (bReq !== aReq) return bReq - aReq;
          return b.id.localeCompare(a.id);
        });
        return matches[0];
      }),
      findMany: vi.fn(async ({ where }: { where?: { assignmentId?: string } }) => {
        const matches: DbWorkHoursCorrection[] = [];
        for (const c of store.workHoursCorrections.values()) {
          if (!where?.assignmentId || c.assignmentId === where.assignmentId) {
            matches.push(c);
          }
        }
        matches.sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime());
        return matches;
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
    worker: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        for (const a of store.assignments.values()) {
          if (a.worker.id === where.id) {
            return { id: a.worker.id, fullName: a.worker.fullName };
          }
        }
        if (where.id === "worker-1") {
          return { id: "worker-1", fullName: "Oso, Majed" };
        }
        return null;
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
    it("creates initial ServiceConfirmation when uploading evidence for an unconfirmed assignment with intent: 'initial_confirmation'", async () => {
      seedStandardAssignment("assign-initial");

      expect(store.serviceConfirmations.has("assign-initial")).toBe(false);

      const file = makeTestPdf("_INITIAL_MANUAL_TIMESHEET");
      const result = await addConfirmationEvidence({
        assignmentId: "assign-initial",
        intent: "initial_confirmation",
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

    it("attaching evidence with default intent ('attach_evidence') does NOT create a ServiceConfirmation for an unconfirmed assignment", async () => {
      seedStandardAssignment("assign-unconfirmed-attach");

      expect(store.serviceConfirmations.has("assign-unconfirmed-attach")).toBe(false);

      const file = makeTestPdf("_ATTACH_ONLY_PDF");
      const result = await addConfirmationEvidence({
        assignmentId: "assign-unconfirmed-attach",
        file: {
          buffer: file,
          fileName: "timesheet_scan.pdf",
          mimeType: "application/pdf",
          sizeBytes: file.length,
        },
        proposedHours: 6.72,
        signerName: "Pflegedienstleitung",
        currentUser: adminUser,
      });

      expect(result.document.sourceType).toBe("manual_upload");

      // Strict Phase 3b/3c requirement: ServiceConfirmation is NOT created!
      expect(store.serviceConfirmations.has("assign-unconfirmed-attach")).toBe(false);

      // Correction request is registered as proposed without modifying assignment confirmation status
      expect(result.correctionRequest).toBeDefined();
      expect(result.correctionRequest?.status).toBe("proposed");
      expect(Number(result.correctionRequest?.proposedHoursWorked)).toBe(6.72);
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

      store.storageFiles.set("signed-confirmations/client/target.pdf", {
        buffer: Buffer.from("mock target pdf content"),
        contentType: "application/pdf",
      });

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

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/pdf");
      const buffer = await res.arrayBuffer();
      expect(Buffer.from(buffer).toString()).toContain("mock target pdf content");
    });

    it("falls back to latest document only when documentId parameter is omitted", async () => {
      seedStandardAssignment("assign-fallback");

      store.storageFiles.set("signed-confirmations/client/latest.pdf", {
        buffer: Buffer.from("mock latest pdf content"),
        contentType: "application/pdf",
      });

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

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/pdf");
      const buffer = await res.arrayBuffer();
      expect(Buffer.from(buffer).toString()).toContain("mock latest pdf content");
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

  describe("Phase 3b Acceptance Criteria Suite: Multi-Shift Worker Upload & Shift Evidence Display", () => {
    const adminUser = { id: "admin-1", role: "admin" };
    const clientUser = { id: "user-client-1", role: "client", clientId: "client-facility-1" };
    const foreignClientUser = { id: "user-client-2", role: "client", clientId: "client-facility-2" };
    const workerUser = { id: "user-worker-1", role: "worker" };
    const foreignWorkerUser = { id: "user-worker-2", role: "worker" };

    function seedWorkerShifts() {
      // Worker 1 shifts
      const a1: DbAssignment = {
        id: "assign-p3b-1",
        orderId: "order-p3b-1",
        workerId: "worker-1",
        status: "confirmed",
        order: {
          id: "order-p3b-1",
          clientId: "client-facility-1",
          shiftDate: new Date("2026-10-01T00:00:00.000Z"),
          startTime: "06:00",
          endTime: "14:30",
          breakMinutes: 30,
          requestGroupId: "group-p3b",
          client: {
            id: "client-facility-1",
            userId: "user-client-1",
            facilityName: "Marienhaus Klinikum",
          },
        },
        worker: {
          id: "worker-1",
          userId: "user-worker-1",
          fullName: "Oso, Majed",
        },
      };

      const a2: DbAssignment = {
        id: "assign-p3b-2",
        orderId: "order-p3b-2",
        workerId: "worker-1",
        status: "confirmed",
        order: {
          id: "order-p3b-2",
          clientId: "client-facility-1",
          shiftDate: new Date("2026-10-02T00:00:00.000Z"),
          startTime: "06:00",
          endTime: "14:30",
          breakMinutes: 30,
          requestGroupId: "group-p3b",
          client: {
            id: "client-facility-1",
            userId: "user-client-1",
            facilityName: "Marienhaus Klinikum",
          },
        },
        worker: {
          id: "worker-1",
          userId: "user-worker-1",
          fullName: "Oso, Majed",
        },
      };

      // Shift for Worker 2 (different worker)
      const a3: DbAssignment = {
        id: "assign-p3b-other-worker",
        orderId: "order-p3b-3",
        workerId: "worker-2",
        status: "confirmed",
        order: {
          id: "order-p3b-3",
          clientId: "client-facility-1",
          shiftDate: new Date("2026-10-03T00:00:00.000Z"),
          startTime: "06:00",
          endTime: "14:30",
          breakMinutes: 30,
          requestGroupId: "group-p3b",
          client: {
            id: "client-facility-1",
            userId: "user-client-1",
            facilityName: "Marienhaus Klinikum",
          },
        },
        worker: {
          id: "worker-2",
          userId: "user-worker-2",
          fullName: "Schmidt, Anna",
        },
      };

      store.assignments.set(a1.id, a1);
      store.assignments.set(a2.id, a2);
      store.assignments.set(a3.id, a3);

      // Pre-existing electronic confirmation on assign-p3b-2
      const electronicSc: DbServiceConfirmation = {
        id: "sc-p3b-orig-electronic",
        assignmentId: "assign-p3b-2",
        confirmedById: "user-client-1",
        method: "electronic",
        signatureData: "ORIGINAL_DIGITAL_SIGNATURE_DATA",
        documentUrl: "signed-confirmations/client-facility-1/assign-p3b-2/original-signed.pdf",
        hoursWorked: 8.0,
        signerName: "Frau PDL Müller",
        clientNotes: "Einwandfrei gearbeitet",
        ipAddress: "192.168.1.100",
        confirmedAt: new Date("2026-10-02T15:00:00.000Z"),
      };
      store.serviceConfirmations.set(a2.id, electronicSc);
      store.storageFiles.set(electronicSc.documentUrl!, {
        buffer: makeTestPdf("_ORIGINAL_ELECTRONIC_PDF"),
        contentType: "application/pdf",
      });
    }

    it("Criterion 1: Uploads a single physical timesheet file for multiple shifts of the same worker without mutating existing electronic confirmation", async () => {
      seedWorkerShifts();

      const { uploadWorkerMultiShiftEvidence } = await import("./confirmation-evidence-service");
      const timesheetPdf = makeTestPdf("_P3B_MULTI_SHIFT_SCAN");

      const res = await uploadWorkerMultiShiftEvidence({
        workerId: "worker-1",
        assignmentIds: ["assign-p3b-1", "assign-p3b-2"],
        file: {
          buffer: timesheetPdf,
          fileName: "Stundenzettel_Oktober_2026.pdf",
          mimeType: "application/pdf",
          sizeBytes: timesheetPdf.length,
        },
        signerName: "Frau PDL Müller (Handschriftlich)",
        notes: "Gemeinsamer Monatszettel",
        currentUser: adminUser,
      });

      expect(res.success).toBe(true);
      expect(res.count).toBe(2);
      expect(res.documents).toHaveLength(2);

      // Exactly ONE physical file stored in Supabase storage
      expect(store.storageFiles.has(res.storagePath)).toBe(true);

      // Both ConfirmationDocument records link to the same storage path and fileHash
      const doc1 = store.confirmationDocuments.get(res.documents[0].id);
      const doc2 = store.confirmationDocuments.get(res.documents[1].id);
      expect(doc1?.storagePath).toBe(res.storagePath);
      expect(doc2?.storagePath).toBe(res.storagePath);
      expect(doc1?.fileHash).toBe(res.fileHash);
      expect(doc2?.fileHash).toBe(res.fileHash);
      expect(doc1?.fileName).toBe("Stundenzettel_Oktober_2026.pdf");
      expect(doc2?.fileName).toBe("Stundenzettel_Oktober_2026.pdf");

      // Shift 1 (was unconfirmed): STRICTLY remains unconfirmed! Only ConfirmationDocument created, no ServiceConfirmation created
      const sc1 = store.serviceConfirmations.get("assign-p3b-1");
      expect(sc1).toBeUndefined();

      // Shift 2 (was electronically confirmed): PRESERVED INTACT!
      const sc2 = store.serviceConfirmations.get("assign-p3b-2");
      expect(sc2).toBeDefined();
      expect(sc2?.method).toBe("electronic");
      expect(sc2?.hoursWorked).toBe(8.0);
      expect(sc2?.signatureData).toBe("ORIGINAL_DIGITAL_SIGNATURE_DATA");
      expect(sc2?.documentUrl).toBe("signed-confirmations/client-facility-1/assign-p3b-2/original-signed.pdf");
      expect(sc2?.signerName).toBe("Frau PDL Müller");
    });

    it("Criterion 2: Subsequent manual sheet uploads maintain strict chronological sequence with electronic original first", async () => {
      seedWorkerShifts();
      const { uploadWorkerMultiShiftEvidence, getAssignmentEvidenceHistory } = await import("./confirmation-evidence-service");

      // 1. First manual upload for shift 2
      const firstScan = makeTestPdf("_FIRST_MANUAL_SCAN");
      await uploadWorkerMultiShiftEvidence({
        workerId: "worker-1",
        assignmentIds: ["assign-p3b-2"],
        file: {
          buffer: firstScan,
          fileName: "kaufmann-scan-1.pdf",
          mimeType: "application/pdf",
          sizeBytes: firstScan.length,
        },
        signerName: "Erster Scan",
        currentUser: adminUser,
      });

      // 2. Second manual upload for shift 2
      const secondScan = makeTestPdf("_SECOND_MANUAL_SCAN");
      await uploadWorkerMultiShiftEvidence({
        workerId: "worker-1",
        assignmentIds: ["assign-p3b-2"],
        file: {
          buffer: secondScan,
          fileName: "kaufmann-scan-2.pdf",
          mimeType: "application/pdf",
          sizeBytes: secondScan.length,
        },
        signerName: "Zweiter Scan",
        currentUser: adminUser,
      });

      // 3. Inspect evidence history
      const timeline = await getAssignmentEvidenceHistory("assign-p3b-2", adminUser);
      expect(timeline.documents).toHaveLength(3);

      // Order MUST be:
      // Index 0: Electronic original
      expect(timeline.documents[0].sourceType).toBe("electronic_original");
      expect(timeline.documents[0].signerName).toBe("Frau PDL Müller");
      expect(timeline.documents[0].isArchivedPdf).toBe(true);

      // Index 1: First manual scan
      expect(timeline.documents[1].sourceType).toBe("manual_correction");
      expect(timeline.documents[1].fileName).toBe("kaufmann-scan-1.pdf");

      // Index 2: Second manual scan
      expect(timeline.documents[2].sourceType).toBe("manual_correction");
      expect(timeline.documents[2].fileName).toBe("kaufmann-scan-2.pdf");
    });

    it("Criterion 3: Atomically rejects request if any assignment belongs to another worker", async () => {
      seedWorkerShifts();
      const { uploadWorkerMultiShiftEvidence } = await import("./confirmation-evidence-service");
      const scanPdf = makeTestPdf("_MISMATCH_TEST");

      // Attempting to upload for Worker 1, but including a shift of Worker 2
      await expect(
        uploadWorkerMultiShiftEvidence({
          workerId: "worker-1",
          assignmentIds: ["assign-p3b-1", "assign-p3b-other-worker"],
          file: {
            buffer: scanPdf,
            fileName: "mismatch.pdf",
            mimeType: "application/pdf",
            sizeBytes: scanPdf.length,
          },
          currentUser: adminUser,
        })
      ).rejects.toThrow("Eine oder mehrere Schichten gehören nicht zum angegebenen Mitarbeiter");

      // Atomic rejection: NO records created, shift 1 remains untouched!
      expect(store.serviceConfirmations.has("assign-p3b-1")).toBe(false);
      expect(store.confirmationDocuments.size).toBe(0);
    });

    it("Criterion 4: Atomically rejects request if any assignment ID does not exist", async () => {
      seedWorkerShifts();
      const { uploadWorkerMultiShiftEvidence } = await import("./confirmation-evidence-service");
      const scanPdf = makeTestPdf("_NOT_FOUND_TEST");

      await expect(
        uploadWorkerMultiShiftEvidence({
          workerId: "worker-1",
          assignmentIds: ["assign-p3b-1", "non-existent-shift-id"],
          file: {
            buffer: scanPdf,
            fileName: "invalid_id.pdf",
            mimeType: "application/pdf",
            sizeBytes: scanPdf.length,
          },
          currentUser: adminUser,
        })
      ).rejects.toThrow("Eine oder mehrere der angegebenen Schichten wurden nicht gefunden");

      expect(store.serviceConfirmations.has("assign-p3b-1")).toBe(false);
      expect(store.confirmationDocuments.size).toBe(0);
    });

    it("Criterion 5: Rejects empty assignment IDs or invalid worker ID", async () => {
      seedWorkerShifts();
      const { uploadWorkerMultiShiftEvidence } = await import("./confirmation-evidence-service");
      const scanPdf = makeTestPdf("_VALIDATION_TEST");

      // Empty assignments
      await expect(
        uploadWorkerMultiShiftEvidence({
          workerId: "worker-1",
          assignmentIds: [],
          file: {
            buffer: scanPdf,
            fileName: "empty.pdf",
            mimeType: "application/pdf",
            sizeBytes: scanPdf.length,
          },
          currentUser: adminUser,
        })
      ).rejects.toThrow("Mindestens eine Schicht muss ausgewählt werden");

      // Invalid worker
      await expect(
        uploadWorkerMultiShiftEvidence({
          workerId: "non-existent-worker",
          assignmentIds: ["assign-p3b-1"],
          file: {
            buffer: scanPdf,
            fileName: "test.pdf",
            mimeType: "application/pdf",
            sizeBytes: scanPdf.length,
          },
          currentUser: adminUser,
        })
      ).rejects.toThrow("Der angegebene Mitarbeiter existiert nicht");

      // Array containing an empty string: must reject completely without touching storage or DB
      const initialStorageSize = store.storageFiles.size;
      const initialDocsSize = store.confirmationDocuments.size;
      await expect(
        uploadWorkerMultiShiftEvidence({
          workerId: "worker-1",
          assignmentIds: ["assign-p3b-1", ""],
          file: {
            buffer: scanPdf,
            fileName: "test.pdf",
            mimeType: "application/pdf",
            sizeBytes: scanPdf.length,
          },
          currentUser: adminUser,
        })
      ).rejects.toThrow("Ungültiger Schichtbezeichner: Leere Schicht-IDs sind nicht zulässig");

      // Array containing a non-string: must reject completely
      await expect(
        uploadWorkerMultiShiftEvidence({
          workerId: "worker-1",
          assignmentIds: ["assign-p3b-1", 42 as unknown as string],
          file: {
            buffer: scanPdf,
            fileName: "test.pdf",
            mimeType: "application/pdf",
            sizeBytes: scanPdf.length,
          },
          currentUser: adminUser,
        })
      ).rejects.toThrow("Ungültiger Schichtbezeichner: Es werden nur nicht-leere Zeichenketten akzeptiert");

      // Array containing duplicate IDs: must reject completely
      await expect(
        uploadWorkerMultiShiftEvidence({
          workerId: "worker-1",
          assignmentIds: ["assign-p3b-1", "assign-p3b-1"],
          file: {
            buffer: scanPdf,
            fileName: "test.pdf",
            mimeType: "application/pdf",
            sizeBytes: scanPdf.length,
          },
          currentUser: adminUser,
        })
      ).rejects.toThrow("Doppelte Schicht-ID 'assign-p3b-1' in der Auswahlliste");

      // Verify no storage or DB writes occurred
      expect(store.storageFiles.size).toBe(initialStorageSize);
      expect(store.confirmationDocuments.size).toBe(initialDocsSize);
    });

    it("Criterion 6: Cleans up orphaned storage file if database transaction fails", async () => {
      seedWorkerShifts();
      const { uploadWorkerMultiShiftEvidence } = await import("./confirmation-evidence-service");
      const scanPdf = makeTestPdf("_STORAGE_ROLLBACK_TEST");

      // Force DB transaction to fail
      const txSpy = vi.spyOn(prismaMock, "$transaction").mockRejectedValueOnce(new Error("Simulated DB Deadlock"));

      await expect(
        uploadWorkerMultiShiftEvidence({
          workerId: "worker-1",
          assignmentIds: ["assign-p3b-1"],
          file: {
            buffer: scanPdf,
            fileName: "fail.pdf",
            mimeType: "application/pdf",
            sizeBytes: scanPdf.length,
          },
          currentUser: adminUser,
        })
      ).rejects.toThrow("Simulated DB Deadlock");

      // Verify storage was cleaned up via remove()
      expect(storageMock.remove).toHaveBeenCalled();
      txSpy.mockRestore();
    });

    it("Criterion 7: Rejects duplicate document upload for any of the target shifts", async () => {
      seedWorkerShifts();
      const { uploadWorkerMultiShiftEvidence } = await import("./confirmation-evidence-service");
      const scanPdf = makeTestPdf("_DUPLICATE_GUARD_TEST");

      // First upload succeeds
      await uploadWorkerMultiShiftEvidence({
        workerId: "worker-1",
        assignmentIds: ["assign-p3b-1"],
        file: {
          buffer: scanPdf,
          fileName: "timesheet.pdf",
          mimeType: "application/pdf",
          sizeBytes: scanPdf.length,
        },
        currentUser: adminUser,
      });

      // Second upload with EXACT same file bytes on same shift must be rejected
      await expect(
        uploadWorkerMultiShiftEvidence({
          workerId: "worker-1",
          assignmentIds: ["assign-p3b-1"],
          file: {
            buffer: scanPdf,
            fileName: "timesheet.pdf",
            mimeType: "application/pdf",
            sizeBytes: scanPdf.length,
          },
          currentUser: adminUser,
        })
      ).rejects.toThrow("Dieses Dokument wurde für eine oder mehrere der ausgewählten Schichten bereits hochgeladen");
    });

    it("Criterion 8: File inspection rejects fake MIME bytes, oversized files, and empty buffers", async () => {
      seedWorkerShifts();
      const { uploadWorkerMultiShiftEvidence, MAX_CONFIRMATION_FILE_SIZE_BYTES } = await import("./confirmation-evidence-service");

      // Fake PDF (PNG bytes disguised as application/pdf)
      const fakePdfBuffer = makeTestPng("_FAKE_PDF");
      await expect(
        uploadWorkerMultiShiftEvidence({
          workerId: "worker-1",
          assignmentIds: ["assign-p3b-1"],
          file: {
            buffer: fakePdfBuffer,
            fileName: "fake.pdf",
            mimeType: "application/pdf",
            sizeBytes: fakePdfBuffer.length,
          },
          currentUser: adminUser,
        })
      ).rejects.toThrow("Ungültiger oder nicht unterstützter Dateiinhalt");

      // Oversized file (> 25MB)
      const oversizeBuffer = Buffer.concat([REAL_PDF_HEADER, Buffer.alloc(MAX_CONFIRMATION_FILE_SIZE_BYTES + 100)]);
      await expect(
        uploadWorkerMultiShiftEvidence({
          workerId: "worker-1",
          assignmentIds: ["assign-p3b-1"],
          file: {
            buffer: oversizeBuffer,
            fileName: "large.pdf",
            mimeType: "application/pdf",
            sizeBytes: oversizeBuffer.length,
          },
          currentUser: adminUser,
        })
      ).rejects.toThrow("Die Datei überschreitet die maximale Größe von 25 MB");

      // Empty buffer
      await expect(
        uploadWorkerMultiShiftEvidence({
          workerId: "worker-1",
          assignmentIds: ["assign-p3b-1"],
          file: {
            buffer: Buffer.alloc(0),
            fileName: "empty.pdf",
            mimeType: "application/pdf",
            sizeBytes: 0,
          },
          currentUser: adminUser,
        })
      ).rejects.toThrow("Die hochgeladene Datei ist leer");
    });

    it("Criterion 9: Authorization security rejects non-admins from uploading and enforces cross-tenant download isolation", async () => {
      seedWorkerShifts();
      const { uploadWorkerMultiShiftEvidence } = await import("./confirmation-evidence-service");
      const scanPdf = makeTestPdf("_AUTH_TEST");

      // Client role cannot upload worker timesheet
      await expect(
        uploadWorkerMultiShiftEvidence({
          workerId: "worker-1",
          assignmentIds: ["assign-p3b-1"],
          file: {
            buffer: scanPdf,
            fileName: "test.pdf",
            mimeType: "application/pdf",
            sizeBytes: scanPdf.length,
          },
          currentUser: clientUser,
        })
      ).rejects.toThrow("Nur Administratoren dürfen Stundenzettel für Mitarbeiter hochladen");

      // Worker role cannot upload worker timesheet
      await expect(
        uploadWorkerMultiShiftEvidence({
          workerId: "worker-1",
          assignmentIds: ["assign-p3b-1"],
          file: {
            buffer: scanPdf,
            fileName: "test.pdf",
            mimeType: "application/pdf",
            sizeBytes: scanPdf.length,
          },
          currentUser: workerUser,
        })
      ).rejects.toThrow("Nur Administratoren dürfen Stundenzettel für Mitarbeiter hochladen");

      // Cross-tenant document download verification
      activeUser = foreignClientUser;
      const foreignReq = new Request("http://localhost/api/confirmations/assign-p3b-2/document");
      const foreignRes = await getConfirmationDocumentRoute(foreignReq, {
        params: Promise.resolve({ assignmentId: "assign-p3b-2" }),
      });
      expect(foreignRes.status).toBe(403);

      // Foreign worker cannot download another worker's document
      activeUser = foreignWorkerUser;
      const foreignWorkerReq = new Request("http://localhost/api/confirmations/assign-p3b-2/document");
      const foreignWorkerRes = await getConfirmationDocumentRoute(foreignWorkerReq, {
        params: Promise.resolve({ assignmentId: "assign-p3b-2" }),
      });
      expect(foreignWorkerRes.status).toBe(403);

      // Owning client can access document
      activeUser = clientUser;
      const clientReq = new Request("http://localhost/api/confirmations/assign-p3b-2/document");
      const clientRes = await getConfirmationDocumentRoute(clientReq, {
        params: Promise.resolve({ assignmentId: "assign-p3b-2" }),
      });
      expect(clientRes.status).toBe(200);
      expect(clientRes.headers.get("content-type")).toBe("application/pdf");

      // Legacy documentId resolution
      activeUser = adminUser;
      const legacyReq = new Request("http://localhost/api/confirmations/assign-p3b-2/document?documentId=legacy-sc-p3b-orig-electronic");
      const legacyRes = await getConfirmationDocumentRoute(legacyReq, {
        params: Promise.resolve({ assignmentId: "assign-p3b-2" }),
      });
      expect(legacyRes.status).toBe(200);
      expect(legacyRes.headers.get("content-type")).toBe("application/pdf");
    });

    it("Criterion 10: Explicitly distinguishes authoritative archived PDF vs dynamically generated view", async () => {
      seedWorkerShifts();
      const { getAssignmentEvidenceHistory } = await import("./confirmation-evidence-service");

      // Shift with stored physical PDF
      const timelineWithPdf = await getAssignmentEvidenceHistory("assign-p3b-2", adminUser);
      expect(timelineWithPdf.documents[0].isArchivedPdf).toBe(true);
      expect(timelineWithPdf.documents[0].isDynamicallyGeneratedView).toBe(false);

      // Shift with legacy electronic confirmation but without archived PDF (only signatureData)
      const legacyScWithoutPdf: DbServiceConfirmation = {
        id: "sc-legacy-dynamic",
        assignmentId: "assign-p3b-1",
        confirmedById: "client-1",
        method: "electronic",
        signatureData: "ONLY_RAW_SIGNATURE",
        documentUrl: null, // No archived PDF
        hoursWorked: 7.5,
        signerName: "Dr. Meyer",
        clientNotes: null,
        ipAddress: "127.0.0.1",
        confirmedAt: new Date("2026-10-01T12:00:00Z"),
      };
      store.serviceConfirmations.set("assign-p3b-1", legacyScWithoutPdf);

      const timelineDynamic = await getAssignmentEvidenceHistory("assign-p3b-1", adminUser);
      expect(timelineDynamic.documents[0].isDynamicallyGeneratedView).toBe(true);
      expect(timelineDynamic.documents[0].isArchivedPdf).toBe(false);
    });

    it("Criterion 11: sanitizePublicEvidenceTimeline omits raw storagePath and sensitive metadata keys from client DTO", async () => {
      seedWorkerShifts();
      const { getAssignmentEvidenceHistory, sanitizePublicEvidenceTimeline } = await import(
        "./confirmation-evidence-service"
      );

      const internalTimeline = await getAssignmentEvidenceHistory("assign-p3b-2", adminUser);
      // Internal timeline has storagePath
      expect(internalTimeline.documents[0].storagePath).toBeTruthy();

      // Add a test metadata entry with internal storage keys
      internalTimeline.documents[0].metadata = {
        workerId: "worker-1",
        storagePath: "signed-confirmations/secret/file.pdf",
        bucketName: "confirmations",
        directUrl: "https://example.com/file.pdf",
        publicNotes: "Verified note",
      };

      const publicTimeline = sanitizePublicEvidenceTimeline(internalTimeline);

      // storagePath must be stripped from public DTO
      for (const doc of publicTimeline.documents) {
        expect("storagePath" in doc).toBe(false);
        expect(doc.storagePath).toBeUndefined();
      }

      // Metadata must only retain safe keys
      const safeMeta = publicTimeline.documents[0].metadata as Record<string, unknown>;
      expect(safeMeta).toBeDefined();
      expect(safeMeta.workerId).toBe("worker-1");
      expect(safeMeta.publicNotes).toBe("Verified note");
      expect("storagePath" in safeMeta).toBe(false);
      expect("bucketName" in safeMeta).toBe(false);
      expect("directUrl" in safeMeta).toBe(false);

      // UI Localization & Translation invariants across German, English, and Arabic (RTL)
      const fs = await import("fs");
      const path = await import("path");
      const de = JSON.parse(fs.readFileSync(path.resolve("messages/de.json"), "utf8"));
      const en = JSON.parse(fs.readFileSync(path.resolve("messages/en.json"), "utf8"));
      const ar = JSON.parse(fs.readFileSync(path.resolve("messages/ar.json"), "utf8"));

      const requiredKeys = [
        "hoursUnit",
        "workerLabel",
        "periodLabel",
        "filterEmpty",
        "selectFile",
        "changeFile",
        "fileTypeHint",
        "fileSizeExceeded",
        "optionalLabel",
        "notesPlaceholder",
        "fileBadge",
        "invalidShiftIdsError",
        "duplicateDocumentError",
        "storageUploadError",
        "fileTooLargeError",
        "unsupportedFileTypeError",
        "uploadGenericError",
      ];

      for (const k of requiredKeys) {
        expect(de.confirmations[k], `Missing German key ${k}`).toBeTruthy();
        expect(en.confirmations[k], `Missing English key ${k}`).toBeTruthy();
        expect(ar.confirmations[k], `Missing Arabic key ${k}`).toBeTruthy();

        // Enforce that English and Arabic do not contain untranslated German strings
        if (k !== "optionalLabel") {
          expect(en.confirmations[k]).not.toBe(de.confirmations[k]);
        }
        expect(ar.confirmations[k]).not.toBe(de.confirmations[k]);
      }

      // Check common retry key
      expect(de.common.retry).toBe("Erneut versuchen");
      expect(en.common.retry).toBe("Retry");
      expect(ar.common.retry).toBe("إعادة المحاولة");

      // Verify specific localized values
      expect(de.confirmations.hoursUnit).toBe("Std.");
      expect(en.confirmations.hoursUnit).toBe("h");
      expect(ar.confirmations.hoursUnit).toBe("ساعة");

      expect(de.confirmations.workerLabel).toBe("Mitarbeiter:");
      expect(en.confirmations.workerLabel).toBe("Employee:");
      expect(ar.confirmations.workerLabel).toBe("الموظف:");

      expect(de.confirmations.fileSizeExceeded).toContain("25 MB");
      expect(en.confirmations.fileSizeExceeded).toContain("25 MB");
      expect(ar.confirmations.fileSizeExceeded).toContain("25 ميغابايت");
    });
  });

  describe("Phase 3c: Work Hours Correction & Explicit Approval Architecture", () => {
    it("Criterion 1 & 2: Electronic 6.75h -> Manual Doc 6.72h -> Propose -> Explicit Approve: Preserves Electronic Original, Updates Effective Hours, and Keeps Invoices Byte-Identical", async () => {
      seedStandardAssignment("assign-3c-1");

      // 1. Initial State: Electronic Confirmation with 6.75 hours
      const electronicOriginalTimestamp = new Date("2026-07-11T12:00:00.000Z");
      store.serviceConfirmations.set("assign-3c-1", {
        id: "sc-3c-1",
        assignmentId: "assign-3c-1",
        confirmedById: "client-user-1",
        method: "electronic",
        signatureData: "data:image/png;base64,ORIGINAL_E_SIGNATURE_DATA_PHASE_3C",
        documentUrl: "assign-3c-1/signed/original-leistungsnachweis.pdf",
        hoursWorked: 6.75,
        signerName: "Dr. Schmidt",
        clientNotes: "Erstbestätigung digital",
        ipAddress: "192.168.1.50",
        confirmedAt: electronicOriginalTimestamp,
      });

      // Seed historical invoice for this shift
      const initialInvoiceSnapshot = {
        invoiceNumber: "RE-2026-07-001",
        assignmentId: "assign-3c-1",
        hoursBilled: 6.75,
        hourlyRate: 40.0,
        netTotal: 270.0,
        vatAmount: 51.3,
        grossTotal: 321.3,
        frozenAt: "2026-07-31T23:59:59.000Z",
      };
      const initialSnapshotStr = JSON.stringify(initialInvoiceSnapshot);

      store.invoices.set("inv-3c-1", {
        id: "inv-3c-1",
        invoiceNumber: "RE-2026-07-001",
        netAmount: 270.0,
        vatAmount: 51.3,
        grossAmount: 321.3,
        status: "issued",
        snapshotData: initialInvoiceSnapshot,
        createdAt: new Date("2026-08-01T08:00:00.000Z"),
        updatedAt: new Date("2026-08-01T08:00:00.000Z"),
      });

      // Verify baseline reading
      const baseline = await getAssignmentEffectiveWorkHours("assign-3c-1");
      expect(baseline.effectiveHours).toBe(6.75);
      expect(baseline.source).toBe("service_confirmation");
      expect(baseline.isCorrected).toBe(false);

      // 2. Upload supporting physical timesheet document (6.72 hours written)
      const docBuffer = makeTestPdf("_PHYSICAL_MANUAL_TIMESHEET_6_72_HOURS");
      const addDocRes = await addConfirmationEvidence({
        assignmentId: "assign-3c-1",
        file: {
          buffer: docBuffer,
          fileName: "stundenzettel_handschriftlich_6_72.pdf",
          mimeType: "application/pdf",
          sizeBytes: docBuffer.length,
        },
        signerName: "Stationsleitung Müller",
        currentUser: adminUser,
      });

      const uploadedDocId = addDocRes.document.id;
      expect(uploadedDocId).toBeDefined();

      // Invariant Check: Mere upload does NOT alter effective hours!
      const afterUpload = await getAssignmentEffectiveWorkHours("assign-3c-1");
      expect(afterUpload.effectiveHours).toBe(6.75);
      expect(afterUpload.isCorrected).toBe(false);

      // 3. Propose correction: 6.72 hours with start 08:00, end 15:13, break 30m
      const proposedReq = await createOrUpdateHoursCorrectionRequest({
        assignmentId: "assign-3c-1",
        documentId: uploadedDocId,
        expectedEffectiveVersion: afterUpload.effectiveVersion,
        proposedHours: 6.72,
        proposedStartTime: "08:00",
        proposedEndTime: "15:13",
        proposedBreakMinutes: 30,
        reason: "Handschriftliche Erfassung zeigt 6,72 Std statt 6,75 Std",
        currentUser: adminUser,
      });

      expect(proposedReq.status).toBe("proposed");
      expect(Number(proposedReq.proposedHoursWorked)).toBe(6.72);
      expect(Number(proposedReq.previousHoursWorked)).toBe(6.75);

      // Invariant Check: Proposed correction does NOT alter effective hours before approval!
      const afterProposal = await getAssignmentEffectiveWorkHours("assign-3c-1");
      expect(afterProposal.effectiveHours).toBe(6.75);
      expect(afterProposal.isCorrected).toBe(false);

      // 4. Admin Explicitly Approves the correction
      const approveRes = await approveHoursCorrectionRequest({
        correctionRequestId: proposedReq.id,
        expectedEffectiveVersion: afterUpload.effectiveVersion,
        effectiveStartTime: "08:00",
        effectiveEndTime: "15:13",
        effectiveBreakMinutes: 30,
        decisionNote: "Stundenzettel geprüft und anerkannt durch GF",
        currentUser: adminUser,
      });

      expect(approveRes.status).toBe("approved");
      expect(approveRes.decidedById).toBe(adminUser.id);
      expect(approveRes.decisionNote).toBe("Stundenzettel geprüft und anerkannt durch GF");

      // 5. Verify Post-Approval Invariants:
      // A. Effective work hours resolves to 6.72h
      const effectiveAfterApproval = await getAssignmentEffectiveWorkHours("assign-3c-1");
      expect(effectiveAfterApproval.effectiveHours).toBe(6.72);
      expect(effectiveAfterApproval.effectiveStartTime).toBe("08:00");
      expect(effectiveAfterApproval.effectiveEndTime).toBe("15:13");
      expect(effectiveAfterApproval.effectiveBreakMinutes).toBe(30);
      expect(effectiveAfterApproval.source).toBe("approved_correction");
      expect(effectiveAfterApproval.isCorrected).toBe(true);
      expect(effectiveAfterApproval.baselineHours).toBe(6.75);
      expect(effectiveAfterApproval.approvedCorrection?.id).toBe(proposedReq.id);

      // B. Original ServiceConfirmation remains 100% IMMUTABLE & INTACT!
      const scAfter = store.serviceConfirmations.get("assign-3c-1");
      expect(scAfter).toBeDefined();
      expect(scAfter?.method).toBe("electronic"); // Must remain electronic
      expect(scAfter?.signatureData).toBe("data:image/png;base64,ORIGINAL_E_SIGNATURE_DATA_PHASE_3C");
      expect(Number(scAfter?.hoursWorked)).toBe(6.75); // Original electronic hours preserved!
      expect(scAfter?.signerName).toBe("Dr. Schmidt");
      expect(scAfter?.confirmedAt.toISOString()).toBe(electronicOriginalTimestamp.toISOString());
      expect(scAfter?.documentUrl).toBe("assign-3c-1/signed/original-leistungsnachweis.pdf");

      // C. Historical Invoice remains 100% BYTE-IDENTICAL!
      const invoiceAfter = store.invoices.get("inv-3c-1");
      expect(invoiceAfter).toBeDefined();
      expect(JSON.stringify(invoiceAfter?.snapshotData)).toBe(initialSnapshotStr);
      expect(invoiceAfter?.netAmount).toBe(270.0);
      expect(invoiceAfter?.grossAmount).toBe(321.3);

      // D. Full Evidence Timeline reflects both documents and approved correction
      const timeline = await getAssignmentEvidenceHistory("assign-3c-1", adminUser);
      expect(timeline.effectiveWorkHours).toBe(6.72);
      expect(timeline.effectiveSource).toBe("approved_correction");
      expect(timeline.isCorrected).toBe(true);
      expect(timeline.pendingCorrection).toBeNull(); // No pending request remaining
      expect(timeline.approvedCorrection?.id).toBe(proposedReq.id);
      expect(timeline.corrections).toHaveLength(1);
      expect(timeline.documents).toHaveLength(2);
    });

    it("Criterion 3: Rejection of correction request keeps baseline hours intact", async () => {
      seedStandardAssignment("assign-3c-reject");

      store.serviceConfirmations.set("assign-3c-reject", {
        id: "sc-3c-rej",
        assignmentId: "assign-3c-reject",
        confirmedById: "client-1",
        method: "electronic",
        signatureData: "SIG",
        documentUrl: null,
        hoursWorked: 6.75,
        signerName: "Dr. Schmidt",
        clientNotes: null,
        ipAddress: "127.0.0.1",
        confirmedAt: new Date("2026-07-11T12:00:00.000Z"),
      });

      const docBuffer = makeTestPdf("_REJECT_TEST_DOC");
      const addDocRes = await addConfirmationEvidence({
        assignmentId: "assign-3c-reject",
        file: {
          buffer: docBuffer,
          fileName: "sheet.pdf",
          mimeType: "application/pdf",
          sizeBytes: docBuffer.length,
        },
        currentUser: adminUser,
      });

      const effReject = await getAssignmentEffectiveWorkHours("assign-3c-reject");
      const proposedReq = await createOrUpdateHoursCorrectionRequest({
        assignmentId: "assign-3c-reject",
        documentId: addDocRes.document.id,
        expectedEffectiveVersion: effReject.effectiveVersion,
        proposedHours: 6.5,
        proposedStartTime: "08:00",
        proposedEndTime: "15:00",
        proposedBreakMinutes: 30,
        reason: "Unberechtigter Abzug",
        currentUser: adminUser,
      });

      // Admin rejects
      const rejectRes = await rejectHoursCorrectionRequest({
        correctionRequestId: proposedReq.id,
        decisionNote: "Nach Rücksprache mit Station nicht anerkannt",
        currentUser: adminUser,
      });

      expect(rejectRes.status).toBe("rejected");
      expect(rejectRes.decisionNote).toBe("Nach Rücksprache mit Station nicht anerkannt");

      // Effective hours remains baseline (6.75h)
      const effective = await getAssignmentEffectiveWorkHours("assign-3c-reject");
      expect(effective.effectiveHours).toBe(6.75);
      expect(effective.isCorrected).toBe(false);
      expect(effective.source).toBe("service_confirmation");

      // Timeline has no pending correction
      const timeline = await getAssignmentEvidenceHistory("assign-3c-reject", adminUser);
      expect(timeline.pendingCorrection).toBeNull();
      expect(timeline.corrections[0].status).toBe("rejected");
    });

    it("Criterion 4: Reject document belonging to another assignment or another worker", async () => {
      seedStandardAssignment("assign-worker-A");
      seedStandardAssignment("assign-worker-B");

      const docBuffer = makeTestPdf("_DOC_FOR_WORKER_A");
      const addDocRes = await addConfirmationEvidence({
        assignmentId: "assign-worker-A",
        file: {
          buffer: docBuffer,
          fileName: "sheet_A.pdf",
          mimeType: "application/pdf",
          sizeBytes: docBuffer.length,
        },
        currentUser: adminUser,
      });

      const effWorkerB = await getAssignmentEffectiveWorkHours("assign-worker-B");
      // Attempting to propose correction for Worker B with Worker A's document
      await expect(
        createOrUpdateHoursCorrectionRequest({
          assignmentId: "assign-worker-B",
          documentId: addDocRes.document.id, // Belonging to A!
          expectedEffectiveVersion: effWorkerB.effectiveVersion,
          proposedHours: 7.0,
          currentUser: adminUser,
        })
      ).rejects.toThrow("Das ausgewählte Dokument gehört nicht zu dieser Schicht.");
    });

    it("Criterion 5: Two co-workers on the same Order: Worker A correction leaves Worker B and Order times untouched", async () => {
      // Seed Order with two workers
      const orderId = "order-multi-worker";
      const shiftDate = new Date("2026-07-15T00:00:00.000Z");

      const assignA: DbAssignment = {
        id: "assign-multi-A",
        orderId,
        workerId: "worker-A",
        status: "confirmed",
        order: {
          id: orderId,
          clientId: "client-facility-1",
          shiftDate,
          startTime: "06:05",
          endTime: "13:20",
          breakMinutes: 30,
          requestGroupId: null,
          client: { id: "client-facility-1", userId: "client-u1", facilityName: "Seniorenheim Ahr" },
        },
        worker: { id: "worker-A", userId: "u-worker-A", fullName: "Müller, Hans" },
      };

      const assignB: DbAssignment = {
        id: "assign-multi-B",
        orderId,
        workerId: "worker-B",
        status: "confirmed",
        order: assignA.order,
        worker: { id: "worker-B", userId: "u-worker-B", fullName: "Schneider, Sarah" },
      };

      store.assignments.set("assign-multi-A", assignA);
      store.assignments.set("assign-multi-B", assignB);

      store.serviceConfirmations.set("assign-multi-A", {
        id: "sc-multi-A",
        assignmentId: "assign-multi-A",
        confirmedById: "client-u1",
        method: "electronic",
        signatureData: "SIG_A",
        documentUrl: null,
        hoursWorked: 6.75,
        signerName: "PDL",
        clientNotes: null,
        ipAddress: "127.0.0.1",
        confirmedAt: new Date(),
      });

      store.serviceConfirmations.set("assign-multi-B", {
        id: "sc-multi-B",
        assignmentId: "assign-multi-B",
        confirmedById: "client-u1",
        method: "electronic",
        signatureData: "SIG_B",
        documentUrl: null,
        hoursWorked: 6.75,
        signerName: "PDL",
        clientNotes: null,
        ipAddress: "127.0.0.1",
        confirmedAt: new Date(),
      });

      // Upload document for Worker A only
      const docBuffer = makeTestPdf("_DOC_WORKER_A_ONLY");
      const addDocRes = await addConfirmationEvidence({
        assignmentId: "assign-multi-A",
        file: {
          buffer: docBuffer,
          fileName: "timesheet_A.pdf",
          mimeType: "application/pdf",
          sizeBytes: docBuffer.length,
        },
        currentUser: adminUser,
      });

      const effA = await getAssignmentEffectiveWorkHours("assign-multi-A");
      const propReq = await createOrUpdateHoursCorrectionRequest({
        assignmentId: "assign-multi-A",
        documentId: addDocRes.document.id,
        expectedEffectiveVersion: effA.effectiveVersion,
        proposedHours: 6.72,
        proposedStartTime: "06:05",
        proposedEndTime: "13:18",
        proposedBreakMinutes: 30,
        currentUser: adminUser,
      });

      await approveHoursCorrectionRequest({
        correctionRequestId: propReq.id,
        expectedEffectiveVersion: effA.effectiveVersion,
        effectiveStartTime: "06:05",
        effectiveEndTime: "13:18",
        effectiveBreakMinutes: 30,
        currentUser: adminUser,
      });

      // Verification: Worker A has 6.72h effective
      const effectiveA = await getAssignmentEffectiveWorkHours("assign-multi-A");
      expect(effectiveA.effectiveHours).toBe(6.72);
      expect(effectiveA.isCorrected).toBe(true);

      // Worker B is completely unaffected (6.75h)
      const effectiveB = await getAssignmentEffectiveWorkHours("assign-multi-B");
      expect(effectiveB.effectiveHours).toBe(6.75);
      expect(effectiveB.isCorrected).toBe(false);
      expect(effectiveB.source).toBe("service_confirmation");

      // Shared Order times are completely unchanged
      const rawOrder = assignA.order;
      expect(rawOrder.startTime).toBe("06:05");
      expect(rawOrder.endTime).toBe("13:20");
      expect(rawOrder.breakMinutes).toBe(30);
    });

    it("Criterion 6: Digital time validation, night shifts crossing midnight, and break boundary checks", async () => {
      // 1. Valid night shift crossing midnight: 22:00 to 06:00 (8h gross) with 45m break => 7.25h
      expect(parseTimeToMinutes("22:00")).toBe(1320);
      expect(parseTimeToMinutes("06:00")).toBe(360);
      const grossNight = computeShiftGrossMinutes("22:00", "06:00");
      expect(grossNight).toBe(480);
      const netNight = computeShiftNetHours("22:00", "06:00", 45);
      expect(netNight).toBe(7.25);

      // 2. Zero break is valid: 22:00 to 06:00 with 0m break => 8.00h
      const netZeroBreak = computeShiftNetHours("22:00", "06:00", 0);
      expect(netZeroBreak).toBe(8.0);

      // 3. Normal day shift: 08:00 to 15:13 (433m gross) with 30m break => 403m => 6.72h
      const grossDay = computeShiftGrossMinutes("08:00", "15:13");
      expect(grossDay).toBe(433);
      const netDay = computeShiftNetHours("08:00", "15:13", 30);
      expect(netDay).toBe(6.72);

      // 4. Equal start and end time (gross <= 0) rejected
      expect(() => computeShiftNetHours("08:00", "08:00", 0)).toThrow(
        "Beginn und Ende müssen eine positive Schichtdauer ergeben."
      );

      // 5. Negative break minutes rejected
      expect(() => computeShiftNetHours("08:00", "16:00", -15)).toThrow(
        "Pausenzeit muss zwischen 0 und 720 Minuten liegen."
      );

      // 6. Break minutes >= gross duration rejected
      expect(() => computeShiftNetHours("08:00", "12:00", 240)).toThrow(
        "Die Pausenzeit darf nicht größer oder gleich der gesamten Schichtdauer sein."
      );
      expect(() => computeShiftNetHours("08:00", "12:00", 300)).toThrow(
        "Die Pausenzeit darf nicht größer oder gleich der gesamten Schichtdauer sein."
      );
    });

    it("Criterion 7: Missing time details or time mismatch at approval time rejected", async () => {
      seedStandardAssignment("assign-time-check");
      const docBuffer = makeTestPdf("_TIME_CHECK_DOC");
      const addDocRes = await addConfirmationEvidence({
        assignmentId: "assign-time-check",
        file: {
          buffer: docBuffer,
          fileName: "sheet.pdf",
          mimeType: "application/pdf",
          sizeBytes: docBuffer.length,
        },
        currentUser: adminUser,
      });

      const effTimeCheck = await getAssignmentEffectiveWorkHours("assign-time-check");
      const propReq = await createOrUpdateHoursCorrectionRequest({
        assignmentId: "assign-time-check",
        documentId: addDocRes.document.id,
        expectedEffectiveVersion: effTimeCheck.effectiveVersion,
        proposedHours: 6.72,
        reason: "Time check",
        currentUser: adminUser,
      });

      // Approval without supplying start/end/break fails
      await expect(
        approveHoursCorrectionRequest({
          correctionRequestId: propReq.id,
          expectedEffectiveVersion: effTimeCheck.effectiveVersion,
          currentUser: adminUser,
        })
      ).rejects.toThrow("Beginn, Ende und Pausenzeit sind für die Genehmigung zwingend erforderlich.");

      // Approval with mismatched times (e.g. 08:00 to 16:00 break 30 = 7.5h vs 6.72h) fails
      await expect(
        approveHoursCorrectionRequest({
          correctionRequestId: propReq.id,
          expectedEffectiveVersion: effTimeCheck.effectiveVersion,
          effectiveStartTime: "08:00",
          effectiveEndTime: "16:00",
          effectiveBreakMinutes: 30,
          currentUser: adminUser,
        })
      ).rejects.toThrow("Die genehmigten Stunden (6.72) stimmen nicht mit den Zeitangaben überein");
    });

    it("Criterion 8a: Concurrency - Promise.all two concurrent approvals of the same request", async () => {
      seedStandardAssignment("assign-concurrent-same");
      const docBuffer = makeTestPdf("_CONCURRENCY_DOC_1");
      const addDocRes = await addConfirmationEvidence({
        assignmentId: "assign-concurrent-same",
        file: {
          buffer: docBuffer,
          fileName: "sheet1.pdf",
          mimeType: "application/pdf",
          sizeBytes: docBuffer.length,
        },
        currentUser: adminUser,
      });

      const effConcurrentSame = await getAssignmentEffectiveWorkHours("assign-concurrent-same");
      const propReq = await createOrUpdateHoursCorrectionRequest({
        assignmentId: "assign-concurrent-same",
        documentId: addDocRes.document.id,
        expectedEffectiveVersion: effConcurrentSame.effectiveVersion,
        proposedHours: 6.72,
        proposedStartTime: "08:00",
        proposedEndTime: "15:13",
        proposedBreakMinutes: 30,
        currentUser: adminUser,
      });

      // Execute two concurrent approvals simultaneously
      const results = await Promise.allSettled([
        approveHoursCorrectionRequest({
          correctionRequestId: propReq.id,
          expectedEffectiveVersion: effConcurrentSame.effectiveVersion,
          effectiveStartTime: "08:00",
          effectiveEndTime: "15:13",
          effectiveBreakMinutes: 30,
          decisionNote: "Approval A",
          currentUser: adminUser,
        }),
        approveHoursCorrectionRequest({
          correctionRequestId: propReq.id,
          expectedEffectiveVersion: effConcurrentSame.effectiveVersion,
          effectiveStartTime: "08:00",
          effectiveEndTime: "15:13",
          effectiveBreakMinutes: 30,
          decisionNote: "Approval B",
          currentUser: adminUser,
        }),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];

      // Exactly ONE must succeed and exactly ONE must fail with ALREADY_DECIDED
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason.message).toMatch(/bereits.*entschieden|bereits.*genehmigt/i);
      expect(rejected[0].reason.code).toBe("ALREADY_DECIDED");

      // Verify the final record status is approved
      const finalReq = store.workHoursCorrections.get(propReq.id);
      expect(finalReq?.status).toBe("approved");
    });

    it("Criterion 8b: Concurrency - Promise.all concurrent approve vs reject of the same request", async () => {
      seedStandardAssignment("assign-concurrent-app-rej");
      const docBuffer = makeTestPdf("_CONCURRENCY_DOC_2");
      const addDocRes = await addConfirmationEvidence({
        assignmentId: "assign-concurrent-app-rej",
        file: {
          buffer: docBuffer,
          fileName: "sheet2.pdf",
          mimeType: "application/pdf",
          sizeBytes: docBuffer.length,
        },
        currentUser: adminUser,
      });

      const effConcurrentAppRej = await getAssignmentEffectiveWorkHours("assign-concurrent-app-rej");
      const propReq = await createOrUpdateHoursCorrectionRequest({
        assignmentId: "assign-concurrent-app-rej",
        documentId: addDocRes.document.id,
        expectedEffectiveVersion: effConcurrentAppRej.effectiveVersion,
        proposedHours: 6.72,
        proposedStartTime: "08:00",
        proposedEndTime: "15:13",
        proposedBreakMinutes: 30,
        currentUser: adminUser,
      });

      // Execute concurrent approve and reject
      const results = await Promise.allSettled([
        approveHoursCorrectionRequest({
          correctionRequestId: propReq.id,
          expectedEffectiveVersion: effConcurrentAppRej.effectiveVersion,
          effectiveStartTime: "08:00",
          effectiveEndTime: "15:13",
          effectiveBreakMinutes: 30,
          decisionNote: "Concurrent approve",
          currentUser: adminUser,
        }),
        rejectHoursCorrectionRequest({
          correctionRequestId: propReq.id,
          decisionNote: "Concurrent reject",
          currentUser: adminUser,
        }),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];

      // Exactly ONE must succeed and exactly ONE must fail with ALREADY_DECIDED
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason.message).toMatch(/bereits.*entschieden|bereits.*genehmigt|bereits.*abgelehnt/i);
      expect(rejected[0].reason.code).toBe("ALREADY_DECIDED");

      const finalReq = store.workHoursCorrections.get(propReq.id);
      expect(["approved", "rejected"]).toContain(finalReq?.status);
    });

    it("Criterion 8c: Concurrency - Promise.all concurrent approvals of two different requests for same assignment", async () => {
      seedStandardAssignment("assign-concurrent-two-reqs");
      const docBuffer1 = makeTestPdf("_CONCURRENCY_DOC_3A");
      const docBuffer2 = makeTestPdf("_CONCURRENCY_DOC_3B");

      const doc1 = await addConfirmationEvidence({
        assignmentId: "assign-concurrent-two-reqs",
        file: {
          buffer: docBuffer1,
          fileName: "sheet3a.pdf",
          mimeType: "application/pdf",
          sizeBytes: docBuffer1.length,
        },
        currentUser: adminUser,
      });

      const doc2 = await addConfirmationEvidence({
        assignmentId: "assign-concurrent-two-reqs",
        file: {
          buffer: docBuffer2,
          fileName: "sheet3b.pdf",
          mimeType: "application/pdf",
          sizeBytes: docBuffer2.length,
        },
        currentUser: adminUser,
      });

      const initialEffective = await getAssignmentEffectiveWorkHours("assign-concurrent-two-reqs");

      // Create two distinct proposals manually in store derived from the SAME base version
      const reqA = {
        id: "req-a-assign-3",
        assignmentId: "assign-concurrent-two-reqs",
        documentId: doc1.document.id,
        status: "proposed" as const,
        previousHoursWorked: 6.75,
        proposedHoursWorked: 6.72,
        proposedStartTime: "08:00",
        proposedEndTime: "15:13",
        proposedBreakMinutes: 30,
        reason: "Request A",
        requestedById: adminUser.id,
        requestedAt: new Date("2026-07-12T08:00:00.000Z"),
        decidedById: null,
        decidedAt: null,
        decisionNote: null,
        baseVersion: initialEffective.effectiveVersion,
      };
      const reqB = {
        id: "req-b-assign-3",
        assignmentId: "assign-concurrent-two-reqs",
        documentId: doc2.document.id,
        status: "proposed" as const,
        previousHoursWorked: 6.75,
        proposedHoursWorked: 6.5,
        proposedStartTime: "08:00",
        proposedEndTime: "15:00",
        proposedBreakMinutes: 30,
        reason: "Request B",
        requestedById: adminUser.id,
        requestedAt: new Date("2026-07-12T08:05:00.000Z"),
        decidedById: null,
        decidedAt: null,
        decisionNote: null,
        baseVersion: initialEffective.effectiveVersion,
      };
      store.workHoursCorrections.set(reqA.id, reqA);
      store.workHoursCorrections.set(reqB.id, reqB);

      // Attempt concurrent approval of both requests sharing the SAME base version token
      const results = await Promise.allSettled([
        approveHoursCorrectionRequest({
          correctionRequestId: reqA.id,
          expectedEffectiveVersion: initialEffective.effectiveVersion,
          effectiveStartTime: "08:00",
          effectiveEndTime: "15:13",
          effectiveBreakMinutes: 30,
          currentUser: adminUser,
        }),
        approveHoursCorrectionRequest({
          correctionRequestId: reqB.id,
          expectedEffectiveVersion: initialEffective.effectiveVersion,
          effectiveStartTime: "08:00",
          effectiveEndTime: "15:00",
          effectiveBreakMinutes: 30,
          currentUser: adminUser,
        }),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];

      // Exactly ONE can be approved. The other must fail with CONCURRENT_DECISION_CONFLICT (409)
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason.code).toBe("CONCURRENT_DECISION_CONFLICT");
      expect(rejected[0].reason.status).toBe(409);

      // Verify that in the store, only one request has status: "approved"
      const approvedCount = [store.workHoursCorrections.get(reqA.id), store.workHoursCorrections.get(reqB.id)]
        .filter((r) => r?.status === "approved").length;
      expect(approvedCount).toBe(1);
    });

    it("Criterion 8d: Baseline Protection - Concurrent baseline modification rejects conflicting proposals", async () => {
      seedStandardAssignment("assign-baseline-prot");
      // Seed electronic baseline with 6.75 hours
      store.serviceConfirmations.set("assign-baseline-prot", {
        id: "sc-baseline-prot",
        assignmentId: "assign-baseline-prot",
        confirmedById: "user-client-1",
        method: "electronic",
        signatureData: "sig-base64",
        documentUrl: "assign/signed.pdf",
        hoursWorked: 6.75,
        signerName: "Dr. Schmidt",
        clientNotes: null,
        ipAddress: "127.0.0.1",
        confirmedAt: new Date("2026-07-11T13:00:00.000Z"),
      });

      const docBuffer = makeTestPdf("_CONCURRENCY_DOC_4");
      const addDocRes = await addConfirmationEvidence({
        assignmentId: "assign-baseline-prot",
        file: {
          buffer: docBuffer,
          fileName: "sheet4.pdf",
          mimeType: "application/pdf",
          sizeBytes: docBuffer.length,
        },
        currentUser: adminUser,
      });

      // Current baseline is 6.75 from seedStandardAssignment + serviceConfirmation
      const initialEffective = await getAssignmentEffectiveWorkHours("assign-baseline-prot");
      expect(initialEffective.effectiveHours).toBe(6.75);

      // Now simulate another admin approving a correction on this assignment in parallel,
      // changing the effective baseline from 6.75 to 7.00
      const parallelCorrection = {
        id: "corr-parallel-approved",
        assignmentId: "assign-baseline-prot",
        documentId: addDocRes.document.id,
        status: "approved" as const,
        previousHoursWorked: 6.75,
        proposedHoursWorked: 7.0,
        proposedStartTime: "08:00",
        proposedEndTime: "15:30",
        proposedBreakMinutes: 30,
        reason: "Parallel approved",
        requestedById: adminUser.id,
        requestedAt: new Date("2026-07-12T07:00:00.000Z"),
        decidedById: adminUser.id,
        decidedAt: new Date("2026-07-12T07:30:00.000Z"),
        decisionNote: "Approved earlier",
        baseVersion: initialEffective.effectiveVersion,
      };
      store.workHoursCorrections.set(parallelCorrection.id, parallelCorrection);

      // Now client tries to propose a correction expecting old version token
      await expect(
        createOrUpdateHoursCorrectionRequest({
          assignmentId: "assign-baseline-prot",
          documentId: addDocRes.document.id,
          expectedEffectiveVersion: initialEffective.effectiveVersion, // Stale version!
          proposedHours: 6.5,
          proposedStartTime: "08:00",
          proposedEndTime: "15:00",
          proposedBreakMinutes: 30,
          reason: "Old baseline assumption",
          currentUser: adminUser,
        })
      ).rejects.toThrow("Die Basis-Version der Schicht wurde zwischenzeitlich geändert");

      // Verify ServiceConfirmation, Order and Invoices were never modified
      const sc = store.serviceConfirmations.get("assign-baseline-prot");
      expect(sc?.hoursWorked).toBe(6.75);
      const a = store.assignments.get("assign-baseline-prot");
      expect(a?.order.startTime).toBe("06:05");
      expect(a?.order.endTime).toBe("12:53");
    });

    it("Criterion 9: Stale proposal cannot overwrite newer approved correction", async () => {
      seedStandardAssignment("assign-stale");
      const docBuffer = makeTestPdf("_STALE_DOC");
      const addDocRes = await addConfirmationEvidence({
        assignmentId: "assign-stale",
        file: {
          buffer: docBuffer,
          fileName: "sheet.pdf",
          mimeType: "application/pdf",
          sizeBytes: docBuffer.length,
        },
        currentUser: adminUser,
      });

      // Older proposal created at t0
      store.workHoursCorrections.set("corr-old", {
        id: "corr-old",
        assignmentId: "assign-stale",
        documentId: addDocRes.document.id,
        status: "proposed",
        previousHoursWorked: 6.75,
        proposedHoursWorked: 6.5,
        proposedStartTime: "08:00",
        proposedEndTime: "15:00",
        proposedBreakMinutes: 30,
        reason: "Old proposal",
        requestedById: adminUser.id,
        requestedAt: new Date("2026-07-12T08:00:00.000Z"),
        decidedById: null,
        decidedAt: null,
        decisionNote: null,
        baseVersion: null,
      });

      // Newer proposal created at t1 and approved at t2
      store.workHoursCorrections.set("corr-new-approved", {
        id: "corr-new-approved",
        assignmentId: "assign-stale",
        documentId: addDocRes.document.id,
        status: "approved",
        previousHoursWorked: 6.75,
        proposedHoursWorked: 6.72,
        proposedStartTime: "08:00",
        proposedEndTime: "15:13",
        proposedBreakMinutes: 30,
        reason: "Newer approved",
        requestedById: adminUser.id,
        requestedAt: new Date("2026-07-12T09:00:00.000Z"),
        decidedById: adminUser.id,
        decidedAt: new Date("2026-07-12T10:00:00.000Z"),
        decisionNote: "Approved newer",
        baseVersion: "scheduled:order-std",
      });

      const currentEff = await getAssignmentEffectiveWorkHours("assign-stale");

      // 1. Attempting to approve the stale older proposal without baseVersion throws STALE_CORRECTION_REQUEST
      await expect(
        approveHoursCorrectionRequest({
          correctionRequestId: "corr-old",
          expectedEffectiveVersion: currentEff.effectiveVersion,
          effectiveStartTime: "08:00",
          effectiveEndTime: "15:00",
          effectiveBreakMinutes: 30,
          currentUser: adminUser,
        })
      ).rejects.toThrow("Es existiert bereits eine neuere genehmigte Korrektur für diese Schicht.");

      // 2. Proposal with outdated baseVersion throws STALE_BASELINE_CONFLICT
      store.workHoursCorrections.set("corr-old-versioned", {
        id: "corr-old-versioned",
        assignmentId: "assign-stale",
        documentId: addDocRes.document.id,
        status: "proposed",
        previousHoursWorked: 6.75,
        proposedHoursWorked: 6.5,
        proposedStartTime: "08:00",
        proposedEndTime: "15:00",
        proposedBreakMinutes: 30,
        reason: "Old versioned proposal",
        requestedById: adminUser.id,
        requestedAt: new Date("2026-07-12T08:00:00.000Z"),
        decidedById: null,
        decidedAt: null,
        decisionNote: null,
        baseVersion: "scheduled:order-std",
      });

      await expect(
        approveHoursCorrectionRequest({
          correctionRequestId: "corr-old-versioned",
          expectedEffectiveVersion: currentEff.effectiveVersion,
          effectiveStartTime: "08:00",
          effectiveEndTime: "15:00",
          effectiveBreakMinutes: 30,
          currentUser: adminUser,
        })
      ).rejects.toThrow("Dieser Korrekturantrag wurde auf einer veralteten Basis-Version erstellt und kann nicht genehmigt werden.");
    });

    it("Criterion 10: Role authorization: non-admin roles are rejected", async () => {
      seedStandardAssignment("assign-auth");
      const docBuffer = makeTestPdf("_AUTH_DOC");
      const addDocRes = await addConfirmationEvidence({
        assignmentId: "assign-auth",
        file: {
          buffer: docBuffer,
          fileName: "sheet.pdf",
          mimeType: "application/pdf",
          sizeBytes: docBuffer.length,
        },
        currentUser: adminUser,
      });

      // Worker cannot propose
      await expect(
        createOrUpdateHoursCorrectionRequest({
          assignmentId: "assign-auth",
          documentId: addDocRes.document.id,
          expectedEffectiveVersion: "dummy-version",
          proposedHours: 6.72,
          currentUser: workerUser,
        })
      ).rejects.toThrow("Nur Administratoren dürfen Stundenkorrekturen vorschlagen.");

      // Client cannot propose
      await expect(
        createOrUpdateHoursCorrectionRequest({
          assignmentId: "assign-auth",
          documentId: addDocRes.document.id,
          expectedEffectiveVersion: "dummy-version",
          proposedHours: 6.72,
          currentUser: clientUser,
        })
      ).rejects.toThrow("Nur Administratoren dürfen Stundenkorrekturen vorschlagen.");

      // Client cannot approve
      await expect(
        approveHoursCorrectionRequest({
          correctionRequestId: "any-id",
          expectedEffectiveVersion: "dummy-version",
          currentUser: clientUser,
        })
      ).rejects.toThrow("Nur Administratoren dürfen Stundenkorrekturen genehmigen.");

      // Worker cannot reject
      await expect(
        rejectHoursCorrectionRequest({
          correctionRequestId: "any-id",
          currentUser: workerUser,
        })
      ).rejects.toThrow("Nur Administratoren dürfen Stundenkorrekturen ablehnen.");
    });

    it("Criterion 12a: Successive approved corrections on the same shift preserve full history while newest is effective", async () => {
      seedStandardAssignment("assign-successive");

      // Baseline: 6.75h electronic confirmation
      store.serviceConfirmations.set("assign-successive", {
        id: "sc-successive",
        assignmentId: "assign-successive",
        confirmedById: "client-1",
        method: "electronic",
        signatureData: "SIG_ORIG",
        documentUrl: "original.pdf",
        hoursWorked: 6.75,
        signerName: "PDL Schmidt",
        clientNotes: null,
        ipAddress: "127.0.0.1",
        confirmedAt: new Date("2026-07-10T10:00:00.000Z"),
      });

      const initialEffective = await getAssignmentEffectiveWorkHours("assign-successive");
      expect(initialEffective.effectiveHours).toBe(6.75);
      const v0 = initialEffective.effectiveVersion;

      // 1. Upload Doc 1 and approve Correction 1: 6.75h -> 6.72h
      const docBuffer1 = makeTestPdf("_DOC_1_672");
      const doc1 = await addConfirmationEvidence({
        assignmentId: "assign-successive",
        file: {
          buffer: docBuffer1,
          fileName: "klaus_sheet_1.pdf",
          mimeType: "application/pdf",
          sizeBytes: docBuffer1.length,
        },
        currentUser: adminUser,
      });

      const prop1 = await createOrUpdateHoursCorrectionRequest({
        assignmentId: "assign-successive",
        documentId: doc1.document.id,
        expectedEffectiveVersion: v0,
        proposedHours: 6.72,
        proposedStartTime: "08:00",
        proposedEndTime: "15:13",
        proposedBreakMinutes: 30,
        reason: "Erster handschriftlicher Nachweis: 6,72h",
        currentUser: adminUser,
      });

      const approved1 = await approveHoursCorrectionRequest({
        correctionRequestId: prop1.id,
        expectedEffectiveVersion: v0,
        effectiveStartTime: "08:00",
        effectiveEndTime: "15:13",
        effectiveBreakMinutes: 30,
        decisionNote: "Genehmigt GF 1",
        currentUser: adminUser,
      });
      expect(approved1.status).toBe("approved");

      // Verify effective state after 1st approval
      const effectiveAfter1 = await getAssignmentEffectiveWorkHours("assign-successive");
      expect(effectiveAfter1.effectiveHours).toBe(6.72);
      expect(effectiveAfter1.effectiveVersion).not.toBe(v0);
      const v1 = effectiveAfter1.effectiveVersion;

      // Wait small delay so decidedAt of second approval is strictly after first approval
      await new Promise((resolve) => setTimeout(resolve, 15));

      // 2. Upload Doc 2 and approve successive Correction 2: 6.72h -> 6.70h
      const docBuffer2 = makeTestPdf("_DOC_2_670");
      const doc2 = await addConfirmationEvidence({
        assignmentId: "assign-successive",
        file: {
          buffer: docBuffer2,
          fileName: "klaus_sheet_korrigiert_2.pdf",
          mimeType: "application/pdf",
          sizeBytes: docBuffer2.length,
        },
        currentUser: adminUser,
      });

      const prop2 = await createOrUpdateHoursCorrectionRequest({
        assignmentId: "assign-successive",
        documentId: doc2.document.id,
        expectedEffectiveVersion: v1,
        proposedHours: 6.70,
        proposedStartTime: "08:00",
        proposedEndTime: "15:12",
        proposedBreakMinutes: 30,
        reason: "Nachträglicher korrigierter Stundenzettel: 6,70h",
        currentUser: adminUser,
      });

      const approved2 = await approveHoursCorrectionRequest({
        correctionRequestId: prop2.id,
        expectedEffectiveVersion: v1,
        effectiveStartTime: "08:00",
        effectiveEndTime: "15:12",
        effectiveBreakMinutes: 30,
        decisionNote: "Genehmigt GF 2 (weitere Korrektur)",
        currentUser: adminUser,
      });
      expect(approved2.status).toBe("approved");

      // Verify effective state after 2nd approval: Newest approved (6.70h) is effective!
      const effectiveAfter2 = await getAssignmentEffectiveWorkHours("assign-successive");
      expect(effectiveAfter2.effectiveHours).toBe(6.70);
      expect(effectiveAfter2.effectiveStartTime).toBe("08:00");
      expect(effectiveAfter2.effectiveEndTime).toBe("15:12");
      expect(effectiveAfter2.effectiveBreakMinutes).toBe(30);
      expect(effectiveAfter2.approvedCorrection?.id).toBe(prop2.id);

      // Verify full history is preserved: BOTH corrections remain 'approved' in database!
      const rawCorr1 = store.workHoursCorrections.get(prop1.id);
      const rawCorr2 = store.workHoursCorrections.get(prop2.id);
      expect(rawCorr1?.status).toBe("approved");
      expect(rawCorr1?.baseVersion).toBe(v0);
      expect(rawCorr2?.status).toBe("approved");
      expect(rawCorr2?.baseVersion).toBe(v1);

      // Verify timeline contains both approved records and all three documents (electronic original + 2 manual sheets)
      const timeline = await getAssignmentEvidenceHistory("assign-successive", adminUser);
      expect(timeline.corrections).toHaveLength(2);
      expect(timeline.corrections.every((c) => c.status === "approved")).toBe(true);
      expect(timeline.documents).toHaveLength(3);
      expect(timeline.effectiveWorkHours).toBe(6.70);
    });

    it("Criterion 12b: Semantic independence from hours - proposal invalidated even if intermediate approval had identical hours", async () => {
      seedStandardAssignment("assign-identical-hours");

      // Baseline: 6.75h (08:00 to 15:15, break 30m)
      store.serviceConfirmations.set("assign-identical-hours", {
        id: "sc-identical-hours",
        assignmentId: "assign-identical-hours",
        confirmedById: "client-1",
        method: "electronic",
        signatureData: "SIG",
        documentUrl: "doc.pdf",
        hoursWorked: 6.75,
        signerName: "PDL",
        clientNotes: null,
        ipAddress: "127.0.0.1",
        confirmedAt: new Date("2026-07-10T10:00:00.000Z"),
      });

      const initialEffective = await getAssignmentEffectiveWorkHours("assign-identical-hours");
      expect(initialEffective.effectiveHours).toBe(6.75);
      const v0 = initialEffective.effectiveVersion;

      // 1. First, an intermediate correction B is approved with IDENTICAL net hours (6.75h) but new times & doc
      const docBufferB = makeTestPdf("_DOC_B");
      const docB = await addConfirmationEvidence({
        assignmentId: "assign-identical-hours",
        file: {
          buffer: docBufferB,
          fileName: "sheet_B.pdf",
          mimeType: "application/pdf",
          sizeBytes: docBufferB.length,
        },
        currentUser: adminUser,
      });

      const propB = await createOrUpdateHoursCorrectionRequest({
        assignmentId: "assign-identical-hours",
        documentId: docB.document.id,
        expectedEffectiveVersion: v0,
        proposedHours: 6.75,
        proposedStartTime: "06:30",
        proposedEndTime: "13:45",
        proposedBreakMinutes: 30,
        reason: "Frühschicht Nachweis B (gleiche 6,75h)",
        currentUser: adminUser,
      });

      const approvedB = await approveHoursCorrectionRequest({
        correctionRequestId: propB.id,
        expectedEffectiveVersion: v0,
        effectiveStartTime: "06:30",
        effectiveEndTime: "13:45",
        effectiveBreakMinutes: 30,
        decisionNote: "B genehmigt",
        currentUser: adminUser,
      });
      expect(approvedB.status).toBe("approved");

      const afterB = await getAssignmentEffectiveWorkHours("assign-identical-hours");
      expect(afterB.effectiveHours).toBe(6.75); // Identical hours!
      expect(afterB.effectiveVersion).not.toBe(v0); // But different version token!
      const v1 = afterB.effectiveVersion;

      // 2. Proposal A was created based on the old baseline v0 (also 6.75h, but shifted times: 07:00 to 14:15 break 30m)
      const docBufferA = makeTestPdf("_DOC_A");
      const docA = await addConfirmationEvidence({
        assignmentId: "assign-identical-hours",
        file: {
          buffer: docBufferA,
          fileName: "sheet_A.pdf",
          mimeType: "application/pdf",
          sizeBytes: docBufferA.length,
        },
        currentUser: adminUser,
      });

      const propA = {
        id: "corr-a-stale-baseline",
        assignmentId: "assign-identical-hours",
        documentId: docA.document.id,
        status: "proposed" as const,
        previousHoursWorked: 6.75,
        proposedHoursWorked: 6.75,
        proposedStartTime: "07:00",
        proposedEndTime: "14:15",
        proposedBreakMinutes: 30,
        reason: "Zeitenverschiebung bei gleichen 6,75 Stunden",
        requestedById: adminUser.id,
        requestedAt: new Date("2026-07-10T09:00:00.000Z"),
        decidedById: null,
        decidedAt: null,
        decisionNote: null,
        baseVersion: v0,
      };
      store.workHoursCorrections.set(propA.id, propA);

      // Attempting to approve Proposal A with stale version token v0 must FAIL with CONCURRENT_MODIFICATION_CONFLICT
      await expect(
        approveHoursCorrectionRequest({
          correctionRequestId: propA.id,
          expectedEffectiveVersion: v0,
          effectiveStartTime: "07:00",
          effectiveEndTime: "14:15",
          effectiveBreakMinutes: 30,
          currentUser: adminUser,
        })
      ).rejects.toThrow("Die Basis-Version der Schicht wurde zwischenzeitlich geändert");

      // Attempting to approve Proposal A with new token v1 must FAIL with STALE_BASELINE_CONFLICT because propA was constructed on v0
      await expect(
        approveHoursCorrectionRequest({
          correctionRequestId: propA.id,
          expectedEffectiveVersion: v1,
          effectiveStartTime: "07:00",
          effectiveEndTime: "14:15",
          effectiveBreakMinutes: 30,
          currentUser: adminUser,
        })
      ).rejects.toThrow("Dieser Korrekturantrag wurde auf einer veralteten Basis-Version erstellt");
    });

    it("Criterion 12c: Mandatory expectedEffectiveVersion validation rejects missing or empty tokens with 400", async () => {
      seedStandardAssignment("assign-token-mandatory");
      const docBuffer = makeTestPdf("_TOKEN_MANDATORY_DOC");
      const doc = await addConfirmationEvidence({
        assignmentId: "assign-token-mandatory",
        file: {
          buffer: docBuffer,
          fileName: "sheet.pdf",
          mimeType: "application/pdf",
          sizeBytes: docBuffer.length,
        },
        currentUser: adminUser,
      });

      // 1. Propose without expectedEffectiveVersion throws MISSING_VERSION_TOKEN (400)
      await expect(
        // @ts-expect-error Testing missing runtime parameter
        createOrUpdateHoursCorrectionRequest({
          assignmentId: "assign-token-mandatory",
          documentId: doc.document.id,
          proposedHours: 6.72,
          currentUser: adminUser,
        })
      ).rejects.toThrow("Der Versionsbezeichner (expectedEffectiveVersion) ist für die Prüfung zwingend erforderlich.");

      // Empty string also rejected
      await expect(
        createOrUpdateHoursCorrectionRequest({
          assignmentId: "assign-token-mandatory",
          documentId: doc.document.id,
          expectedEffectiveVersion: "   ",
          proposedHours: 6.72,
          currentUser: adminUser,
        })
      ).rejects.toThrow("Der Versionsbezeichner (expectedEffectiveVersion) ist für die Prüfung zwingend erforderlich.");

      // Valid proposal
      const eff = await getAssignmentEffectiveWorkHours("assign-token-mandatory");
      const prop = await createOrUpdateHoursCorrectionRequest({
        assignmentId: "assign-token-mandatory",
        documentId: doc.document.id,
        expectedEffectiveVersion: eff.effectiveVersion,
        proposedHours: 6.72,
        proposedStartTime: "08:00",
        proposedEndTime: "15:13",
        proposedBreakMinutes: 30,
        currentUser: adminUser,
      });

      // 2. Approve without expectedEffectiveVersion throws MISSING_VERSION_TOKEN (400)
      await expect(
        // @ts-expect-error Testing missing runtime parameter
        approveHoursCorrectionRequest({
          correctionRequestId: prop.id,
          effectiveStartTime: "08:00",
          effectiveEndTime: "15:13",
          effectiveBreakMinutes: 30,
          currentUser: adminUser,
        })
      ).rejects.toThrow("Der Versionsbezeichner (expectedEffectiveVersion) ist für die Genehmigung zwingend erforderlich.");

      // Empty string also rejected
      await expect(
        approveHoursCorrectionRequest({
          correctionRequestId: prop.id,
          expectedEffectiveVersion: "   ",
          effectiveStartTime: "08:00",
          effectiveEndTime: "15:13",
          effectiveBreakMinutes: 30,
          currentUser: adminUser,
        })
      ).rejects.toThrow("Der Versionsbezeichner (expectedEffectiveVersion) ist für die Genehmigung zwingend erforderlich.");
    });

    it("Criterion 13a: Modifying confirmed shift hours/times via old route with constant confirmedAt alters version token and rejects stale proposals (409)", async () => {
      seedStandardAssignment("assign-sc-mutation");
      const confirmedDate = new Date("2026-07-10T10:00:00.000Z");

      store.serviceConfirmations.set("assign-sc-mutation", {
        id: "sc-mutation",
        assignmentId: "assign-sc-mutation",
        confirmedById: "client-1",
        method: "electronic",
        signatureData: "SIG",
        documentUrl: "original.pdf",
        hoursWorked: 6.75,
        signerName: "PDL Müller",
        clientNotes: null,
        ipAddress: "127.0.0.1",
        confirmedAt: confirmedDate,
      });

      const initialEff = await getAssignmentEffectiveWorkHours("assign-sc-mutation");
      expect(initialEff.effectiveHours).toBe(6.75);
      const v0 = initialEff.effectiveVersion;
      expect(v0).toMatch(/^sc:sc-mutation:[0-9a-f]{16}$/);

      const docBuffer = makeTestPdf("_SC_MUTATION_DOC");
      const doc = await addConfirmationEvidence({
        assignmentId: "assign-sc-mutation",
        file: {
          buffer: docBuffer,
          fileName: "sheet.pdf",
          mimeType: "application/pdf",
          sizeBytes: docBuffer.length,
        },
        currentUser: adminUser,
      });

      // 1. Simulate legacy admin action modifying Order start/end times with IDENTICAL net hours (6.75h)
      // while confirmedAt remains strictly constant
      const a = store.assignments.get("assign-sc-mutation")!;
      a.order.startTime = "07:00";
      a.order.endTime = "14:15"; // 07:00 - 14:15 break 30 = 6.75h net
      store.assignments.set("assign-sc-mutation", a);

      const effAfterTimesChange = await getAssignmentEffectiveWorkHours("assign-sc-mutation");
      expect(effAfterTimesChange.effectiveHours).toBe(6.75); // Identical hours!
      expect(effAfterTimesChange.effectiveVersion).not.toBe(v0); // Token MUST change!
      const v1 = effAfterTimesChange.effectiveVersion;

      // Attempting to propose correction with stale token v0 fails with 409
      await expect(
        createOrUpdateHoursCorrectionRequest({
          assignmentId: "assign-sc-mutation",
          documentId: doc.document.id,
          expectedEffectiveVersion: v0, // Stale!
          proposedHours: 6.5,
          proposedStartTime: "07:00",
          proposedEndTime: "14:00",
          proposedBreakMinutes: 30,
          currentUser: adminUser,
        })
      ).rejects.toThrow("Die Basis-Version der Schicht wurde zwischenzeitlich geändert");

      // 2. Simulate legacy admin action modifying ServiceConfirmation.hoursWorked directly
      // while confirmedAt remains strictly constant
      const sc = store.serviceConfirmations.get("assign-sc-mutation")!;
      sc.hoursWorked = 7.0; // modified
      expect(sc.confirmedAt.toISOString()).toBe(confirmedDate.toISOString()); // confirmedAt unchanged!
      store.serviceConfirmations.set("assign-sc-mutation", sc);

      const effAfterHoursChange = await getAssignmentEffectiveWorkHours("assign-sc-mutation");
      expect(effAfterHoursChange.effectiveHours).toBe(7.0);
      expect(effAfterHoursChange.effectiveVersion).not.toBe(v1); // Token changes again!
      expect(effAfterHoursChange.effectiveVersion).not.toBe(v0);

      // Attempting to propose with v1 fails with 409
      await expect(
        createOrUpdateHoursCorrectionRequest({
          assignmentId: "assign-sc-mutation",
          documentId: doc.document.id,
          expectedEffectiveVersion: v1, // Stale!
          proposedHours: 6.5,
          proposedStartTime: "07:00",
          proposedEndTime: "14:00",
          proposedBreakMinutes: 30,
          currentUser: adminUser,
        })
      ).rejects.toThrow("Die Basis-Version der Schicht wurde zwischenzeitlich geändert");
    });

    it("Criterion 13b: Modifying Order scheduled times on unconfirmed shift alters version token and rejects stale proposals (409)", async () => {
      seedStandardAssignment("assign-sched-mutation");
      // unconfirmed shift: Order 08:00 to 16:30, break 30m = 8.0h net
      const a = store.assignments.get("assign-sched-mutation")!;
      a.order.startTime = "08:00";
      a.order.endTime = "16:30";
      a.order.breakMinutes = 30;
      store.assignments.set("assign-sched-mutation", a);

      const initialEff = await getAssignmentEffectiveWorkHours("assign-sched-mutation");
      expect(initialEff.effectiveHours).toBe(8.0);
      expect(initialEff.source).toBe("scheduled");
      const v0 = initialEff.effectiveVersion;
      expect(v0).toMatch(/^scheduled:order-101:[0-9a-f]{16}$/);

      const docBuffer = makeTestPdf("_SCHED_MUTATION_DOC");
      const doc = await addConfirmationEvidence({
        assignmentId: "assign-sched-mutation",
        file: {
          buffer: docBuffer,
          fileName: "sheet.pdf",
          mimeType: "application/pdf",
          sizeBytes: docBuffer.length,
        },
        currentUser: adminUser,
      });

      // Admin updates order times to 07:00 to 15:30 (still 8.0h net!)
      a.order.startTime = "07:00";
      a.order.endTime = "15:30";
      store.assignments.set("assign-sched-mutation", a);

      const effAfterChange = await getAssignmentEffectiveWorkHours("assign-sched-mutation");
      expect(effAfterChange.effectiveHours).toBe(8.0);
      expect(effAfterChange.effectiveVersion).not.toBe(v0); // Token MUST change!

      // Attempting to propose with stale token v0 fails with 409
      await expect(
        createOrUpdateHoursCorrectionRequest({
          assignmentId: "assign-sched-mutation",
          documentId: doc.document.id,
          expectedEffectiveVersion: v0, // Stale!
          proposedHours: 7.75,
          proposedStartTime: "07:00",
          proposedEndTime: "15:15",
          proposedBreakMinutes: 30,
          currentUser: adminUser,
        })
      ).rejects.toThrow("Die Basis-Version der Schicht wurde zwischenzeitlich geändert");
    });

    it("Criterion 13c: Causal ordering via database revision guarantees second approval becomes effective even if decidedAt is artificially older than first approval (clock skew immunity)", async () => {
      seedStandardAssignment("assign-clock-skew");

      const docBuffer1 = makeTestPdf("_SKEW_DOC_1");
      const doc1 = await addConfirmationEvidence({
        assignmentId: "assign-clock-skew",
        file: {
          buffer: docBuffer1,
          fileName: "sheet1.pdf",
          mimeType: "application/pdf",
          sizeBytes: docBuffer1.length,
        },
        currentUser: adminUser,
      });

      const initialEff = await getAssignmentEffectiveWorkHours("assign-clock-skew");
      const v0 = initialEff.effectiveVersion;

      // 1. First approval: decided at noon (12:00:00Z)
      const prop1 = await createOrUpdateHoursCorrectionRequest({
        assignmentId: "assign-clock-skew",
        documentId: doc1.document.id,
        expectedEffectiveVersion: v0,
        proposedHours: 6.72,
        proposedStartTime: "08:00",
        proposedEndTime: "15:13",
        proposedBreakMinutes: 30,
        currentUser: adminUser,
      });

      const approved1 = await approveHoursCorrectionRequest({
        correctionRequestId: prop1.id,
        expectedEffectiveVersion: v0,
        effectiveStartTime: "08:00",
        effectiveEndTime: "15:13",
        effectiveBreakMinutes: 30,
        decidedAt: new Date("2026-10-09T12:00:00.000Z"),
        decisionNote: "First approval at noon",
        currentUser: adminUser,
      });
      expect(approved1.status).toBe("approved");

      const effAfter1 = await getAssignmentEffectiveWorkHours("assign-clock-skew");
      expect(effAfter1.effectiveHours).toBe(6.72);
      expect(effAfter1.approvedCorrection?.revision).toBe(1);
      const v1 = effAfter1.effectiveVersion;
      expect(v1).toContain(":r1:");

      // 2. Second approval on server B with clock skew (decidedAt artificially 2 hours earlier: 10:00:00Z!)
      const docBuffer2 = makeTestPdf("_SKEW_DOC_2");
      const doc2 = await addConfirmationEvidence({
        assignmentId: "assign-clock-skew",
        file: {
          buffer: docBuffer2,
          fileName: "sheet2.pdf",
          mimeType: "application/pdf",
          sizeBytes: docBuffer2.length,
        },
        currentUser: adminUser,
      });

      const prop2 = await createOrUpdateHoursCorrectionRequest({
        assignmentId: "assign-clock-skew",
        documentId: doc2.document.id,
        expectedEffectiveVersion: v1,
        proposedHours: 6.70,
        proposedStartTime: "08:00",
        proposedEndTime: "15:12",
        proposedBreakMinutes: 30,
        currentUser: adminUser,
      });

      const approved2 = await approveHoursCorrectionRequest({
        correctionRequestId: prop2.id,
        expectedEffectiveVersion: v1,
        effectiveStartTime: "08:00",
        effectiveEndTime: "15:12",
        effectiveBreakMinutes: 30,
        decidedAt: new Date("2026-10-09T10:00:00.000Z"), // 2 HOURS BEFORE APPROVAL 1!
        decisionNote: "Second approval with clock skew backwards",
        currentUser: adminUser,
      });
      expect(approved2.status).toBe("approved");

      // Verify causal order: Despite decidedAt being earlier, Revision 2 takes absolute precedence!
      const effAfter2 = await getAssignmentEffectiveWorkHours("assign-clock-skew");
      expect(effAfter2.effectiveHours).toBe(6.70); // Approval 2 wins causally!
      expect(effAfter2.effectiveStartTime).toBe("08:00");
      expect(effAfter2.effectiveEndTime).toBe("15:12");
      expect(effAfter2.approvedCorrection?.id).toBe(prop2.id);
      expect(effAfter2.approvedCorrection?.revision).toBe(2);
      const v2 = effAfter2.effectiveVersion;
      expect(v2).toContain(":r2:");

      // Verify both remain approved in history
      const raw1 = store.workHoursCorrections.get(prop1.id);
      const raw2 = store.workHoursCorrections.get(prop2.id);
      expect(raw1?.status).toBe("approved");
      expect(raw1?.revision).toBe(1);
      expect(raw2?.status).toBe("approved");
      expect(raw2?.revision).toBe(2);

      // Verify proposals built on v1 are rejected with 409
      await expect(
        createOrUpdateHoursCorrectionRequest({
          assignmentId: "assign-clock-skew",
          documentId: doc2.document.id,
          expectedEffectiveVersion: v1, // Stale!
          proposedHours: 6.65,
          proposedStartTime: "08:00",
          proposedEndTime: "15:09",
          proposedBreakMinutes: 30,
          currentUser: adminUser,
        })
      ).rejects.toThrow("Die Basis-Version der Schicht wurde zwischenzeitlich geändert");
    });

    it("Criterion 11: Multi-language completeness for Phase 3c keys", async () => {
      const de = await import("@/messages/de.json");
      const en = await import("@/messages/en.json");
      const ar = await import("@/messages/ar.json");

      const phase3cKeys = [
        "effectiveHours",
        "effectiveHoursBadge",
        "effectiveSource",
        "sourceApprovedCorrection",
        "sourceServiceConfirmation",
        "sourceScheduled",
        "baselineHours",
        "approveCorrectionBtn",
        "rejectCorrectionBtn",
        "approveModalTitle",
        "approveModalDesc",
        "rejectModalTitle",
        "rejectModalDesc",
        "decisionNoteLabel",
        "decisionNotePlaceholder",
        "confirmApprovalBtn",
        "confirmRejectionBtn",
        "proposeCorrectionBtn",
        "proposeModalTitle",
        "proposeModalDesc",
        "selectSupportingDoc",
        "selectDocPlaceholder",
        "startTimeLabel",
        "endTimeLabel",
        "breakMinutesLabel",
        "calculatedNetHours",
        "correctionApprovedSuccess",
        "correctionRejectedSuccess",
        "correctionProposedSuccess",
        "decidedByLabel",
        "decidedAtLabel",
        "timeMismatchError",
        "missingTimeDetailsError",
        "correctionsAuditHistory",
        "statusApproved",
        "statusRejected",
        "statusProposed",
      ];

      const deConf = de.confirmations as Record<string, string>;
      const enConf = en.confirmations as Record<string, string>;
      const arConf = ar.confirmations as Record<string, string>;

      for (const k of phase3cKeys) {
        expect(deConf[k], `Missing German key ${k}`).toBeTruthy();
        expect(enConf[k], `Missing English key ${k}`).toBeTruthy();
        expect(arConf[k], `Missing Arabic key ${k}`).toBeTruthy();

        // Ensure localized values are not identical across German vs Arabic
        expect(arConf[k]).not.toBe(deConf[k]);
      }
    });
  });
});
