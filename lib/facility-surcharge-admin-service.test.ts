/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import {
  previewFacilitySurchargePolicy,
  createAndFreezeFacilitySurchargePolicy,
} from "./facility-surcharge-admin-service";
import { resolveInvoiceSurchargePolicy } from "./surcharge-policy";

describe("FacilitySurchargeAdminService & Approval Verification", () => {
  const adminActorId = "user-admin-01";
  const nonAdminActorId = "user-worker-01";
  const clientId = "client-facility-test";
  const clientContractId = "contract-test-2026";

  const mockAdminUser = {
    id: adminActorId,
    email: "admin@rheinahr.de",
    fullName: "Admin Officer",
    role: "admin",
    active: true,
  };

  const mockWorkerUser = {
    id: nonAdminActorId,
    email: "worker@rheinahr.de",
    fullName: "Care Worker",
    role: "worker",
    active: true,
  };

  const mockClient = {
    id: clientId,
    facilityName: "Test Seniorenstift",
    frameworkAgreementSignedAt: new Date("2026-01-01T00:00:00Z"),
    frameworkAgreementUrl: "https://storage/framework.pdf",
  };

  const mockContract = {
    id: clientContractId,
    clientId,
    period: "2026",
    status: "signed",
    signedAt: new Date("2026-01-01T00:00:00Z"),
    documentUrl: "https://storage/contract.pdf",
  };

  const createMockPrisma = (options?: {
    users?: Record<string, unknown>;
    client?: unknown;
    contract?: unknown;
    policies?: unknown[];
    onPolicyCreate?: (data: unknown) => void;
  }) => {
    const users = options?.users ?? {
      [adminActorId]: mockAdminUser,
      [nonAdminActorId]: mockWorkerUser,
    };
    const client = options?.client !== undefined ? options.client : mockClient;
    const contract = options?.contract !== undefined ? options.contract : mockContract;
    const policies = options?.policies ?? [];

    return {
      user: {
        findUnique: vi.fn(async ({ where }: any) => users[where.id] ?? null),
      },
      client: {
        findUnique: vi.fn(async ({ where }: any) => (where.id === clientId ? client : null)),
      },
      clientContract: {
        findUnique: vi.fn(async ({ where }: any) => (where.id === clientContractId ? contract : null)),
      },
      facilitySurchargePolicy: {
        findMany: vi.fn(async () => policies),
        create: vi.fn(async ({ data }: any) => {
          if (options?.onPolicyCreate) options.onPolicyCreate(data);
          return { id: "policy-new-uuid", ...data };
        }),
      },
    };
  };

  const validPolicyInput = {
    clientId,
    clientContractId,
    policyVersion: 1,
    federalState: "NW",
    municipality: "Bonn",
    districtLocality: "Bad Godesberg",
    surchargeSat: 0.25,
    surchargeSun: 0.50,
    surchargeHoliday: 1.00,
    surchargeNight: 0.25,
    nightStart: "20:00",
    nightEnd: "06:00",
    combinationRule: "highest_non_night_plus_night",
    sourceType: "contract",
    sourceReference: "Rahmenvertrag 2026 §5 Abs. 2",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-12-31",
    verifiedByUserId: adminActorId,
    verifiedAt: "2026-01-01T12:00:00Z",
    isFrozen: true,
  };

  it("rejects non-admin actor", async () => {
    const prisma = createMockPrisma();
    const result = await previewFacilitySurchargePolicy({
      prisma,
      input: validPolicyInput,
      actorUserId: nonAdminActorId,
    });
    expect(result.success).toBe(false);
    expect((result as any).code).toBe("INSUFFICIENT_PERMISSIONS");
  });

  it("rejects forged verifier identity", async () => {
    const prisma = createMockPrisma();
    const result = await previewFacilitySurchargePolicy({
      prisma,
      input: { ...validPolicyInput, verifiedByUserId: "different-admin" },
      actorUserId: adminActorId,
    });
    expect(result.success).toBe(false);
    expect((result as any).code).toBe("FORGED_VERIFIER_IDENTITY");
  });

  it("rejects zero rate without rationale", async () => {
    const prisma = createMockPrisma();
    const result = await previewFacilitySurchargePolicy({
      prisma,
      input: { ...validPolicyInput, surchargeSat: 0 },
      actorUserId: adminActorId,
    });
    expect(result.success).toBe(false);
    expect((result as any).code).toBe("INVALID_POLICY_INPUT");
  });

  it("accepts zero rate with explicit documented rationale", async () => {
    const prisma = createMockPrisma();
    const result = await previewFacilitySurchargePolicy({
      prisma,
      input: {
        ...validPolicyInput,
        surchargeSat: 0,
        zeroRateRationale: { surchargeSat: "Vertraglich abbedungen nach Anlage 2" },
      },
      actorUserId: adminActorId,
    });
    expect(result.success).toBe(true);
  });

  it("rejects when contract belongs to a different client", async () => {
    const prisma = createMockPrisma({
      contract: { ...mockContract, clientId: "another-client" },
    });
    const result = await previewFacilitySurchargePolicy({
      prisma,
      input: validPolicyInput,
      actorUserId: adminActorId,
    });
    expect(result.success).toBe(false);
    expect((result as any).code).toBe("CONTRACT_CLIENT_MISMATCH");
  });

  it("rejects overlapping validity interval with existing policy", async () => {
    const existingPolicy = {
      id: "policy-existing",
      clientId,
      policyVersion: 1,
      effectiveFrom: new Date("2026-01-01"),
      effectiveTo: new Date("2026-06-30"),
      federalState: "NW",
      surchargeSat: 0.25,
      surchargeSun: 0.50,
      surchargeHoliday: 1.00,
      surchargeNight: 0.25,
      sourceReference: "Vertrag 1",
    };
    const prisma = createMockPrisma({ policies: [existingPolicy] });
    const result = await previewFacilitySurchargePolicy({
      prisma,
      input: {
        ...validPolicyInput,
        effectiveFrom: "2026-05-01",
        effectiveTo: "2026-12-31",
      },
      actorUserId: adminActorId,
    });
    expect(result.success).toBe(false);
    expect((result as any).code).toBe("OVERLAPPING_POLICY_INTERVAL");
  });

  it("successfully previews valid policy and computes canonical hash", async () => {
    const prisma = createMockPrisma();
    const result = await previewFacilitySurchargePolicy({
      prisma,
      input: validPolicyInput,
      actorUserId: adminActorId,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.integrity.canonicalHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.data.terms.policyVersion).toBe(1);
    expect(result.data.terms.federalState).toBe("NW");
  });

  it("creates and freezes policy when preview hash matches", async () => {
    let createdData: any = null;
    const prisma = createMockPrisma({
      onPolicyCreate: (data) => {
        createdData = data;
      },
    });

    const preview = await previewFacilitySurchargePolicy({
      prisma,
      input: validPolicyInput,
      actorUserId: adminActorId,
    });
    expect(preview.success).toBe(true);
    if (!preview.success) return;

    const commit = await createAndFreezeFacilitySurchargePolicy({
      prisma,
      input: validPolicyInput,
      actorUserId: adminActorId,
      expectedPreviewHash: preview.data.integrity.canonicalHash,
    });

    expect(commit.success).toBe(true);
    expect(createdData).not.toBeNull();
    expect(createdData.isFrozen).toBe(true);
    expect(createdData.frozenHash).toBe(preview.data.integrity.canonicalHash);

    // Verify resolving with resolveInvoiceSurchargePolicy
    const resolved = resolveInvoiceSurchargePolicy({
      policy: createdData,
      referenceDate: "2026-06-15",
    });
    expect(resolved.status).toBe("resolved");
  });

  it("rejects commit when expectedPreviewHash does not match", async () => {
    const prisma = createMockPrisma();
    const commit = await createAndFreezeFacilitySurchargePolicy({
      prisma,
      input: validPolicyInput,
      actorUserId: adminActorId,
      expectedPreviewHash: "wrong-hash-altered-terms",
    });
    expect(commit.success).toBe(false);
    expect((commit as any).code).toBe("PREVIEW_HASH_MISMATCH");
  });
});
