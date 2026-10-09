// Independent acceptance probes; reuses the submitted mock harness, no external I/O.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addConfirmationEvidence,
} from "@/lib/confirmation-evidence-service";
import { POST as uploadSignedRoute } from "@/app/api/confirmations/upload-signed/route";
import {
  createConfirmationUploadTicket,
  finalizeDirectSignedConfirmation,
  uploadDirectSignedConfirmation,
} from "@/app/[locale]/admin/orders/[id]/confirmation-actions";
import { signTicket } from "@/lib/confirmation-tickets";

process.env.CONFIRMATION_TICKET_SECRET = "test-secret-key-confirmation-3a-audit-safe-256bit";

// Valid synthetic file buffers with authentic magic headers
const REAL_PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]),
  Buffer.alloc(16, 0x20),
]);

const REAL_PDF_BYTES = Buffer.concat([
  Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"),
  Buffer.alloc(64, 0x20),
  Buffer.from("\n%%EOF\n"),
]);

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

type DbConsumedTicket = {
  id: string;
  ticketId: string;
  storagePath: string;
  consumedBy: string;
  consumedAt: Date;
};

const store = {
  assignments: new Map<string, DbAssignment>(),
  serviceConfirmations: new Map<string, DbServiceConfirmation>(),
  confirmationDocuments: new Map<string, DbConfirmationDocument>(),
  workHoursCorrections: new Map<string, DbWorkHoursCorrection>(),
  consumedTickets: new Map<string, DbConsumedTicket>(),
  invoices: new Map<string, DbInvoice>(),
  storageFiles: new Map<string, { buffer: Buffer; contentType: string }>(),
};

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
  roleSatisfies: (userRole: string, allowedRoles: string[]) => allowedRoles.includes(userRole),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({
    get: (name: string) => (name.toLowerCase() === "x-forwarded-for" ? "127.0.0.1" : null),
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
      findUnique: vi.fn(async ({ where }: { where: { assignmentId: string } }) => {
        return store.serviceConfirmations.get(where.assignmentId) || null;
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
    consumedConfirmationTicket: {
      create: vi.fn(async ({ data }: { data: { ticketId: string; storagePath: string; consumedBy: string; consumedAt?: Date } }) => {
        if (store.consumedTickets.has(data.ticketId)) {
          const err = new Error("Unique constraint failed on the fields: (`ticket_id`)");
          (err as unknown as { code: string; meta: { target: string[] } }).code = "P2002";
          (err as unknown as { meta: { target: string[] } }).meta = { target: ["ticket_id"] };
          throw err;
        }
        const rec: DbConsumedTicket = {
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
          proposedBreakMinutes: data.proposedBreakMinutes || null,
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
    $transaction: vi.fn(async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => {
      return await cb(prismaMock);
    }),
  },
}));

// Self-referencing mock for transactions
const prismaMock = (await import("@/lib/prisma")).prisma;

describe("Independent phase 3a acceptance probes", () => {
  const adminUser = { id: "admin-1", role: "admin" };
  beforeEach(() => {
    for (const value of Object.values(store)) value.clear();
    vi.clearAllMocks();
    activeUser = adminUser;
    process.env.CONFIRMATION_TICKET_SECRET = "test-secret-key-confirmation-3a-audit-safe-256bit";
    storageMock.download = vi.fn(async (path: string) => {
      const file = store.storageFiles.get(path);
      if (!file) {
        return { data: null, error: new Error("File not found in storage") };
      }
      return {
        data: new Blob([new Uint8Array(file.buffer)], { type: file.contentType }),
        error: null,
      };
    });
  });

  function seedStandardAssignment(assignmentId = "assign-1", requestGroupId: string | null = "group-july") {
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
        requestGroupId,
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

  function form() {
    const data = new FormData();
    data.set("assignmentIds", JSON.stringify(["assign-1"]));
    data.set("document", new File([REAL_PNG_BYTES], "sheet.png", { type: "image/png" }));
    data.set("requestGroupId", "group-july");
    return data;
  }

  it("rejects finalization of a path with no ticket and no uploaded object", async () => {
    seedStandardAssignment();
    const result = await finalizeDirectSignedConfirmation({
      assignmentIds: ["assign-1"],
      path: "signed-confirmations/foreign-group/nonexistent.pdf",
      requestGroupId: "group-july",
    });
    expect(result.ok).toBe(false);
    expect(store.confirmationDocuments.size).toBe(0);
  });

  it("rejects identical fallback upload and records real image metadata and hash", async () => {
    seedStandardAssignment();
    expect((await uploadDirectSignedConfirmation(form())).ok).toBe(true);
    const result = await uploadDirectSignedConfirmation(form());
    expect(result.ok).toBe(false);
    expect(store.confirmationDocuments.size).toBe(1);
    const doc = Array.from(store.confirmationDocuments.values())[0];
    expect(doc.fileHash).toMatch(/^[a-f0-9]{64}$/);
    expect(doc.mimeType).toBe("image/png");
  });

  it("stores the actual PNG mime type, hash and byte size through fallback", async () => {
    seedStandardAssignment();
    expect((await uploadDirectSignedConfirmation(form())).ok).toBe(true);
    const doc = Array.from(store.confirmationDocuments.values())[0];
    expect(doc.mimeType).toBe("image/png");
    expect(doc.fileHash).toMatch(/^[a-f0-9]{64}$/);
    expect(doc.fileSizeBytes).toBe(REAL_PNG_BYTES.length);
  });

  it("cleans fallback storage when database persistence fails", async () => {
    seedStandardAssignment();
    vi.mocked(prismaMock.$transaction).mockRejectedValueOnce(new Error("forced database failure"));
    expect((await uploadDirectSignedConfirmation(form())).ok).toBe(false);
    expect(store.storageFiles.size).toBe(0);
    expect(storageMock.remove).toHaveBeenCalled();
  });

  it("rejects negative proposed hours before evidence is persisted", async () => {
    seedStandardAssignment();
    const buffer = REAL_PDF_BYTES;
    await expect(addConfirmationEvidence({
      assignmentId: "assign-1",
      file: { buffer, fileName: "sheet.pdf", mimeType: "application/pdf", sizeBytes: buffer.length },
      proposedHours: -2,
      currentUser: adminUser,
    })).rejects.toThrow();
    expect(store.confirmationDocuments.size).toBe(0);
  });

  it("rejects partially missing assignment selection without upload or writes", async () => {
    seedStandardAssignment();
    const data = form();
    data.set("assignmentIds", JSON.stringify(["assign-1", "missing-assignment"]));
    const result = await uploadSignedRoute(new Request("http://localhost/api/confirmations/upload-signed", { method: "POST", body: data }));
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(store.confirmationDocuments.size).toBe(0);
  });

  it("does not allow browser-supplied internal metadata to bypass ticket and storage checks", async () => {
    seedStandardAssignment();
    const result = await finalizeDirectSignedConfirmation({
      assignmentIds: ["assign-1"],
      path: "signed-confirmations/group-july/nonexistent.png",
      requestGroupId: "group-july",
      _internalMeta: { fileHash: "a".repeat(64), fileSizeBytes: 10, mimeType: "image/png" },
    });
    expect(result.ok).toBe(false);
    expect(store.confirmationDocuments.size).toBe(0);
  });

  it("does not finalize an issued ticket when object verification is unavailable", async () => {
    seedStandardAssignment();
    const ticket = await createConfirmationUploadTicket({
      requestGroupId: "group-july",
      fileName: "sheet.png",
      fileSize: REAL_PNG_BYTES.length,
      fileType: "image/png",
      assignmentIds: ["assign-1"],
    });
    expect(ticket.ok).toBe(true);
    if (!ticket.ok) return;
    const result = await finalizeDirectSignedConfirmation({
      assignmentIds: ["assign-1"],
      path: ticket.path,
      ticket: ticket.ticket,
      requestGroupId: "group-july",
    });
    expect(result.ok).toBe(false);
    expect(store.confirmationDocuments.size).toBe(0);
  });

  it("rejects a stored object whose MIME and size disagree with its upload ticket", async () => {
    seedStandardAssignment();
    const ticket = await createConfirmationUploadTicket({
      requestGroupId: "group-july",
      fileName: "sheet.png",
      fileSize: REAL_PNG_BYTES.length,
      fileType: "image/png",
      assignmentIds: ["assign-1"],
    });
    if (!ticket.ok) throw new Error("ticket creation failed");
    const withDownload = storageMock as typeof storageMock & { download?: unknown };
    const originalDownload = withDownload.download;
    withDownload.download = vi.fn(async () => ({
      data: new Blob([Buffer.from("<!DOCTYPE html><html><body>fake</body></html>")], { type: "text/html" }),
      error: null,
    }));
    try {
      const result = await finalizeDirectSignedConfirmation({
        assignmentIds: ["assign-1"],
        path: ticket.path,
        ticket: ticket.ticket,
        requestGroupId: "group-july",
      });
      expect(result.ok).toBe(false);
      expect(store.confirmationDocuments.size).toBe(0);
    } finally {
      withDownload.download = originalDownload;
    }
  });

  it("rejects an expired issued ticket even if only its path is supplied", async () => {
    seedStandardAssignment();
    const ticket = await createConfirmationUploadTicket({
      requestGroupId: "group-july",
      fileName: "sheet.png",
      fileSize: REAL_PNG_BYTES.length,
      fileType: "image/png",
      assignmentIds: ["assign-1"],
    });
    if (!ticket.ok) throw new Error("ticket creation failed");
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now + 16 * 60 * 1000);
    try {
      const result = await finalizeDirectSignedConfirmation({
        assignmentIds: ["assign-1"],
        path: ticket.path,
        requestGroupId: "group-july",
      });
      expect(result.ok).toBe(false);
      expect(store.confirmationDocuments.size).toBe(0);
    } finally {
      clock.mockRestore();
    }
  });

  it("rejects assigning a group-alpha ticket to a group-july assignment", async () => {
    seedStandardAssignment("assign-1", "group-july");
    seedStandardAssignment("assign-alpha-1", "group-alpha");
    const ticket = await createConfirmationUploadTicket({
      requestGroupId: "group-alpha",
      fileName: "sheet.png",
      fileSize: REAL_PNG_BYTES.length,
      fileType: "image/png",
      assignmentIds: ["assign-alpha-1"],
    });
    if (!ticket.ok) throw new Error("ticket creation failed");
    const result = await finalizeDirectSignedConfirmation({
      assignmentIds: ["assign-1"],
      path: ticket.path,
      ticket: ticket.ticket,
      requestGroupId: "group-alpha",
    });
    expect(result.ok).toBe(false);
    expect(store.confirmationDocuments.size).toBe(0);
  });

  // New Probes for Codex closing conditions:
  it("rejects HTML or random text declared as PDF/PNG with correct size across all upload paths", async () => {
    seedStandardAssignment();
    const fakeHtml = Buffer.from("<!DOCTYPE html><html><body>malicious</body></html>");

    // 1. Fallback FormData
    const badForm = new FormData();
    badForm.set("assignmentIds", JSON.stringify(["assign-1"]));
    badForm.set("document", new File([fakeHtml], "doc.pdf", { type: "application/pdf" }));
    badForm.set("requestGroupId", "group-july");
    const fallbackRes = await uploadDirectSignedConfirmation(badForm);
    expect(fallbackRes.ok).toBe(false);
    expect(store.confirmationDocuments.size).toBe(0);

    // 2. Direct Service
    await expect(addConfirmationEvidence({
      assignmentId: "assign-1",
      file: { buffer: fakeHtml, fileName: "sheet.pdf", mimeType: "application/pdf", sizeBytes: fakeHtml.length },
      currentUser: adminUser,
    })).rejects.toThrow();
    expect(store.confirmationDocuments.size).toBe(0);

    // 3. API Route
    const routeRes = await uploadSignedRoute(new Request("http://localhost/api/confirmations/upload-signed", {
      method: "POST",
      body: badForm,
    }));
    expect(routeRes.status).toBe(400);
    expect(store.confirmationDocuments.size).toBe(0);
  });

  it("fails ticket issuance explicitly when secrets are not configured in environment", async () => {
    seedStandardAssignment();
    const oldSecret = process.env.CONFIRMATION_TICKET_SECRET;
    const oldAuth = process.env.NEXTAUTH_SECRET;
    delete process.env.CONFIRMATION_TICKET_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    try {
      const ticket = await createConfirmationUploadTicket({
        requestGroupId: "group-july",
        fileName: "sheet.png",
        fileSize: REAL_PNG_BYTES.length,
        fileType: "image/png",
        assignmentIds: ["assign-1"],
      });
      expect(ticket.ok).toBe(false);
      if (!ticket.ok) {
        expect(ticket.error).toContain("Sicherheitskonfiguration");
      }
    } finally {
      process.env.CONFIRMATION_TICKET_SECRET = oldSecret;
      process.env.NEXTAUTH_SECRET = oldAuth;
    }
  });

  it("atomically prevents concurrent ticket replay on two separate assignment groups via DB constraint", async () => {
    seedStandardAssignment("assign-1", "group-july");
    seedStandardAssignment("assign-2", "group-july");

    const ticket = await createConfirmationUploadTicket({
      requestGroupId: "group-july",
      fileName: "sheet.png",
      fileSize: REAL_PNG_BYTES.length,
      fileType: "image/png",
      assignmentIds: ["assign-1"],
    });
    expect(ticket.ok).toBe(true);
    if (!ticket.ok) return;

    store.storageFiles.set(ticket.path, { buffer: REAL_PNG_BYTES, contentType: "image/png" });

    // First finalization consumes the ticket atomically in DB
    const firstRes = await finalizeDirectSignedConfirmation({
      assignmentIds: ["assign-1"],
      path: ticket.path,
      ticket: ticket.ticket,
      requestGroupId: "group-july",
    });
    expect(firstRes.ok).toBe(true);
    expect(store.consumedTickets.size).toBe(1);

    // Second concurrent finalization using the same ticket on a separate assignment fails atomically
    const secondRes = await finalizeDirectSignedConfirmation({
      assignmentIds: ["assign-2"],
      path: ticket.path,
      ticket: ticket.ticket,
      requestGroupId: "group-july",
    });
    expect(secondRes.ok).toBe(false);
    expect(secondRes.error).toContain("Upload-Ticket wurde bereits verwendet");
  });

  it("rejects ticket when requested assignments mismatch the ticket's bound assignments", async () => {
    seedStandardAssignment("assign-1", "group-july");
    seedStandardAssignment("assign-2", "group-july");

    const ticket = await createConfirmationUploadTicket({
      requestGroupId: "group-july",
      fileName: "sheet.png",
      fileSize: REAL_PNG_BYTES.length,
      fileType: "image/png",
      assignmentIds: ["assign-1"],
    });
    expect(ticket.ok).toBe(true);
    if (!ticket.ok) return;

    store.storageFiles.set(ticket.path, { buffer: REAL_PNG_BYTES, contentType: "image/png" });

    // Attempting to finalize with an extra or different assignment is rejected
    const attackRes = await finalizeDirectSignedConfirmation({
      assignmentIds: ["assign-1", "assign-2"],
      path: ticket.path,
      ticket: ticket.ticket,
      requestGroupId: "group-july",
    });
    expect(attackRes.ok).toBe(false);
    expect(attackRes.error).toContain("Ausgewählte Schichten stimmen nicht mit dem Upload-Ticket überein");
  });

  it("rejects assignments belonging to different request groups or null/mixed groups", async () => {
    seedStandardAssignment("assign-1", "group-a");
    seedStandardAssignment("assign-2", "group-b");

    const ticket = await createConfirmationUploadTicket({
      requestGroupId: "group-a",
      fileName: "sheet.png",
      fileSize: REAL_PNG_BYTES.length,
      fileType: "image/png",
      assignmentIds: ["assign-1", "assign-2"],
    });
    expect(ticket.ok).toBe(false);
    if (!ticket.ok) {
      expect(ticket.error).toContain("Schichten gehören zu unterschiedlichen Auftragsgruppen");
    }
  });
  it("refuses to issue a ticket with no bound assignment IDs", async () => {
    seedStandardAssignment("assign-1", "group-july");
    const ticket = await createConfirmationUploadTicket({
      requestGroupId: "group-july", fileName: "sheet.png",
      fileSize: REAL_PNG_BYTES.length, fileType: "image/png",
    });
    expect(ticket.ok).toBe(false);
  });

  it("refuses to finalize an unbound ticket against a later selected shift", async () => {
    seedStandardAssignment("assign-1", "group-july");
    const path = "signed-confirmations/group-july/unbound-sheet.png";
    const now = Date.now();
    const ticket = signTicket({
      ticketId: "unbound-independent-probe",
      userId: "admin-1",
      requestGroupId: "group-july",
      assignmentIds: [],
      path,
      fileName: "sheet.png",
      fileSize: REAL_PNG_BYTES.length,
      mimeType: "image/png",
      issuedAt: now,
      expiresAt: now + 15 * 60 * 1000,
    });
    store.storageFiles.set(path, { buffer: REAL_PNG_BYTES, contentType: "image/png" });
    const result = await finalizeDirectSignedConfirmation({
      assignmentIds: ["assign-1"], path,
      ticket, requestGroupId: "group-july",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("keine Schichten gebunden");
    expect(store.confirmationDocuments.size).toBe(0);
  });

});
