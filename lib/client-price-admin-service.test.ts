/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import {
  createAndFreezeClientHourlyRate,
  deleteClientHourlyRate,
  doIntervalsOverlap,
  formatCentsGermanEur,
  previewClientHourlyRate,
  supersedeClientHourlyRate,
  updateClientHourlyRate,
  validateClientHourlyRateInput,
  type ClientHourlyRateInput,
} from "./client-price-admin-service";
import {
  computeRateVersionCanonicalHash,
  resolveClientPriceVersion,
} from "./client-price-resolver";
import { prepareV2InvoiceDraft } from "./invoice-v2-draft-service";
import { resolveInvoiceSurchargePolicy } from "./surcharge-policy";

describe("ClientPriceAdminService & Ingestion Verification (Phase 5b-2a)", () => {
  // Common test fixtures
  const adminActorId = "user-admin-01";
  const otherAdminId = "user-admin-other";
  const nonAdminActorId = "user-worker-01";
  const clientId = "client-facility-alpha";
  const clientContractId = "contract-alpha-2026";

  const mockAdminUser = {
    id: adminActorId,
    email: "admin@rheinahr.de",
    fullName: "Admin Officer",
    role: "admin",
    active: true,
  };

  const mockOtherAdminUser = {
    id: otherAdminId,
    email: "other.admin@rheinahr.de",
    fullName: "Other Admin",
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
    facilityName: "Seniorenresidenz Rheinblick",
    shortCode: "SR-RB",
    frameworkAgreementSignedAt: new Date("2026-01-01T00:00:00Z"),
    frameworkAgreementUrl: "https://storage/framework.pdf",
  };

  const mockContract = {
    id: clientContractId,
    clientId,
    period: "2026-Q1/Q4",
    status: "active",
    signedAt: new Date("2026-01-01T00:00:00Z"),
    documentUrl: "https://storage/contract.pdf",
  };

  const createMockPrisma = (options?: {
    users?: Record<string, unknown>;
    client?: unknown;
    contract?: unknown;
    rates?: unknown[];
    onRateCreate?: (data: unknown) => void;
  }) => {
    const usersMap: Record<string, unknown> = {
      [adminActorId]: mockAdminUser,
      [otherAdminId]: mockOtherAdminUser,
      [nonAdminActorId]: mockWorkerUser,
      ...(options?.users ?? {}),
    };

    return {
      user: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
          return usersMap[where.id] ?? null;
        }),
      },
      client: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
          if (options?.client !== undefined) return options.client;
          return where.id === clientId ? mockClient : null;
        }),
      },
      clientContract: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
          if (options?.contract !== undefined) return options.contract;
          return where.id === clientContractId ? mockContract : null;
        }),
      },
      clientHourlyRateVersion: {
        findMany: vi.fn(async () => {
          return options?.rates ?? [];
        }),
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
          return (options?.rates as Array<{ id: string }>)?.find((r) => r.id === where.id) ?? null;
        }),
        create: vi.fn(async ({ data }: { data: unknown }) => {
          if (options?.onRateCreate) options.onRateCreate(data);
          return { id: "created-rate-id-123", ...(data as Record<string, unknown>) };
        }),
      },
      invoice: {
        create: vi.fn(),
        update: vi.fn(),
      },
      outgoingEmail: {
        create: vi.fn(),
      },
    };
  };

  describe("1. Pure Input Validation & Business Rule Guards", () => {
    it("accepts valid input with complete contractual metadata and closed interval", () => {
      const input: ClientHourlyRateInput = {
        clientId,
        clientContractId,
        qualification: "pflegefachkraft",
        hourlyRateInCents: 3850,
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-12-31",
        sourceType: "contract",
        sourceReference: "Vertrag Nr. 2026-01, § 4 Abs. 2",
        sourceDocumentUrl: null,
        verifyingUserId: adminActorId,
      };

      const result = validateClientHourlyRateInput(input);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.validatedInput).toEqual(input);
    });

    it("accepts valid input for general scope (clientContractId = null) with closed interval", () => {
      const input: ClientHourlyRateInput = {
        clientId,
        clientContractId: null,
        qualification: "pflegehelfer",
        hourlyRateInCents: 2900,
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-12-31",
        sourceType: "framework_agreement",
        sourceReference: "Rahmenvereinbarung 2026, Anlage 1",
        verifyingUserId: adminActorId,
      };

      const result = validateClientHourlyRateInput(input);
      expect(result.isValid).toBe(true);
      expect(result.validatedInput?.clientContractId).toBeNull();
      expect(result.validatedInput?.effectiveTo).toBe("2026-12-31");
    });

    it("rejects non-object or null input", () => {
      expect(validateClientHourlyRateInput(null).isValid).toBe(false);
      expect(validateClientHourlyRateInput("string").isValid).toBe(false);
    });

    it("rejects missing or empty clientId", () => {
      const result = validateClientHourlyRateInput({
        clientId: "  ",
        qualification: "pflegefachkraft",
        hourlyRateInCents: 3500,
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-12-31",
        sourceType: "contract",
        sourceReference: "Vertrag §4",
        verifyingUserId: adminActorId,
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes("clientId"))).toBe(true);
    });

    it("rejects invalid, zero, or negative hourlyRateInCents", () => {
      for (const badRate of [0, -100, 35.5, NaN, Infinity]) {
        const result = validateClientHourlyRateInput({
          clientId,
          qualification: "pflegefachkraft",
          hourlyRateInCents: badRate,
          effectiveFrom: "2026-01-01",
          effectiveTo: "2026-12-31",
          sourceType: "contract",
          sourceReference: "Vertrag §4",
          verifyingUserId: adminActorId,
        });
        expect(result.isValid).toBe(false);
        expect(result.errors.some((e) => e.includes("hourlyRateInCents"))).toBe(true);
      }
    });

    it("rejects malformed or impossible dates (e.g. 2026-02-30, invalid string)", () => {
      for (const badDate of ["invalid-date", "2026-02-30", "2026-13-01", "2026-00-10"]) {
        const result = validateClientHourlyRateInput({
          clientId,
          qualification: "pflegefachkraft",
          hourlyRateInCents: 3500,
          effectiveFrom: badDate,
          effectiveTo: "2026-12-31",
          sourceType: "contract",
          sourceReference: "Vertrag §4",
          verifyingUserId: adminActorId,
        });
        expect(result.isValid).toBe(false);
        expect(result.errors.some((e) => e.includes("effectiveFrom"))).toBe(true);
      }
    });

    it("rejects open-ended validity period (effectiveTo: null) to avoid unresolvable overlap (Finding 4)", () => {
      const result = validateClientHourlyRateInput({
        clientId,
        qualification: "pflegefachkraft",
        hourlyRateInCents: 3500,
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        sourceType: "contract",
        sourceReference: "Vertrag §4",
        verifyingUserId: adminActorId,
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes("effectiveTo"))).toBe(true);
      expect(result.errors.some((e) => e.includes("Unbefristete Zeiträume"))).toBe(true);
    });

    it("rejects inverted interval where effectiveFrom > effectiveTo", () => {
      const result = validateClientHourlyRateInput({
        clientId,
        qualification: "pflegefachkraft",
        hourlyRateInCents: 3500,
        effectiveFrom: "2026-12-31",
        effectiveTo: "2026-01-01",
        sourceType: "contract",
        sourceReference: "Vertrag §4",
        verifyingUserId: adminActorId,
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes("Invertierter Gültigkeitszeitraum"))).toBe(true);
    });

    it("strictly forbids automated legacy source types or unapproved source extraction", () => {
      for (const forbidden of [
        "client_hourly_rates_legacy",
        "auto_extraction",
        "default_rates",
        "chat_message",
      ]) {
        const result = validateClientHourlyRateInput({
          clientId,
          qualification: "pflegefachkraft",
          hourlyRateInCents: 3500,
          effectiveFrom: "2026-01-01",
          effectiveTo: "2026-12-31",
          sourceType: forbidden as any,
          sourceReference: "Altdaten",
          verifyingUserId: adminActorId,
        });
        expect(result.isValid).toBe(false);
        expect(result.errors.some((e) => e.includes("sourceType"))).toBe(true);
      }
    });

    it("rejects short or generic source references (< 5 characters)", () => {
      const result = validateClientHourlyRateInput({
        clientId,
        qualification: "pflegefachkraft",
        hourlyRateInCents: 3500,
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-12-31",
        sourceType: "contract",
        sourceReference: "V1",
        verifyingUserId: adminActorId,
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes("mindestens 5 Zeichen"))).toBe(true);
    });
  });

  describe("2. Interval Overlap & Currency Helper Functions", () => {
    it("formats cents into German currency string correctly", () => {
      expect(formatCentsGermanEur(3500)).toBe("35,00 €");
      expect(formatCentsGermanEur(3850)).toBe("38,50 €");
      expect(formatCentsGermanEur(4275)).toBe("42,75 €");
    });

    it("correctly identifies overlapping and non-overlapping date ranges", () => {
      // Overlapping: [2026-01-01 .. 2026-06-30] vs [2026-05-01 .. 2026-12-31]
      expect(doIntervalsOverlap("2026-01-01", "2026-06-30", "2026-05-01", "2026-12-31")).toBe(true);

      // Non-overlapping: [2026-01-01 .. 2026-06-30] vs [2026-07-01 .. 2026-12-31]
      expect(doIntervalsOverlap("2026-01-01", "2026-06-30", "2026-07-01", "2026-12-31")).toBe(false);

      // Overlapping with open-ended: [2026-01-01 .. null] vs [2026-05-01 .. 2026-12-31]
      expect(doIntervalsOverlap("2026-01-01", null, "2026-05-01", "2026-12-31")).toBe(true);

      // Non-overlapping before start: [2025-01-01 .. 2025-12-31] vs [2026-01-01 .. "2026-12-31"]
      expect(doIntervalsOverlap("2025-01-01", "2025-12-31", "2026-01-01", "2026-12-31")).toBe(false);
    });
  });

  describe("3. Pre-Freeze Preview, Verifier Identity & Documentary Proof (Findings 1, 2, 4)", () => {
    it("rejects preview when acting user is not an administrator", async () => {
      const prisma = createMockPrisma();
      const result = await previewClientHourlyRate({
        prisma,
        input: {
          clientId,
          qualification: "pflegefachkraft",
          hourlyRateInCents: 3500,
          effectiveFrom: "2026-01-01",
          effectiveTo: "2026-12-31",
          sourceType: "contract",
          sourceReference: "Vertrag §4",
          verifyingUserId: adminActorId,
        },
        actorUserId: nonAdminActorId,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("INSUFFICIENT_PERMISSIONS");
      }
    });

    it("rejects preview when verifyingUserId does not match acting user (FORGED_VERIFIER_IDENTITY)", async () => {
      const prisma = createMockPrisma();
      const result = await previewClientHourlyRate({
        prisma,
        input: {
          clientId,
          clientContractId,
          qualification: "pflegefachkraft",
          hourlyRateInCents: 3500,
          effectiveFrom: "2026-01-01",
          effectiveTo: "2026-12-31",
          sourceType: "contract",
          sourceReference: "Vertrag §4",
          verifyingUserId: otherAdminId, // Different admin ID than actor!
        },
        actorUserId: adminActorId,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("FORGED_VERIFIER_IDENTITY");
      }
    });

    it("rejects preview when client does not exist", async () => {
      const prisma = createMockPrisma({ client: null });
      const result = await previewClientHourlyRate({
        prisma,
        input: {
          clientId: "non-existent-client",
          qualification: "pflegefachkraft",
          hourlyRateInCents: 3500,
          effectiveFrom: "2026-01-01",
          effectiveTo: "2026-12-31",
          sourceType: "contract",
          sourceReference: "Vertrag §4",
          verifyingUserId: adminActorId,
        },
        actorUserId: adminActorId,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("CLIENT_NOT_FOUND");
      }
    });

    it("rejects preview when contract belongs to a different client (CONTRACT_CLIENT_MISMATCH)", async () => {
      const prisma = createMockPrisma({
        contract: {
          id: clientContractId,
          clientId: "different-client-id",
          period: "2026-Q1",
          status: "active",
          signedAt: new Date(),
          documentUrl: "https://storage/contract.pdf",
        },
      });

      const result = await previewClientHourlyRate({
        prisma,
        input: {
          clientId,
          clientContractId,
          qualification: "pflegefachkraft",
          hourlyRateInCents: 3500,
          effectiveFrom: "2026-01-01",
          effectiveTo: "2026-12-31",
          sourceType: "contract",
          sourceReference: "Vertrag §4",
          verifyingUserId: adminActorId,
        },
        actorUserId: adminActorId,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("CONTRACT_CLIENT_MISMATCH");
      }
    });

    it("rejects preview when contract is pending or unsigned (CONTRACT_NOT_SIGNED_OR_ACTIVE)", async () => {
      const unsignedContract = {
        id: clientContractId,
        clientId,
        period: "2026-Q1",
        status: "pending", // Pending contract!
        signedAt: null,
        documentUrl: null,
      };

      const prisma = createMockPrisma({ contract: unsignedContract });

      const result = await previewClientHourlyRate({
        prisma,
        input: {
          clientId,
          clientContractId,
          qualification: "pflegefachkraft",
          hourlyRateInCents: 3500,
          effectiveFrom: "2026-01-01",
          effectiveTo: "2026-12-31",
          sourceType: "contract",
          sourceReference: "Vertrag §4",
          verifyingUserId: adminActorId,
        },
        actorUserId: adminActorId,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("CONTRACT_NOT_SIGNED_OR_ACTIVE");
      }
    });

    it("rejects general-scoped rate when facility lacks framework agreement and archival URL (GENERAL_SCOPE_LACKS_DOCUMENTATION)", async () => {
      const undocumentedClient = {
        id: "client-undocumented",
        facilityName: "Undocumented Facility",
        shortCode: "UF",
        frameworkAgreementSignedAt: null,
        frameworkAgreementUrl: null,
      };

      const prisma = createMockPrisma({ client: undocumentedClient });

      const result = await previewClientHourlyRate({
        prisma,
        input: {
          clientId: "client-undocumented",
          clientContractId: null,
          qualification: "pflegefachkraft",
          hourlyRateInCents: 3500,
          effectiveFrom: "2026-01-01",
          effectiveTo: "2026-12-31",
          sourceType: "framework_agreement",
          sourceReference: "Nur mündliche Absprache",
          verifyingUserId: adminActorId,
        },
        actorUserId: adminActorId,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("GENERAL_SCOPE_LACKS_DOCUMENTATION");
      }
    });

    it("rejects preview when new rate overlaps with an existing rate in the same scope", async () => {
      const existingRate = {
        id: "rate-existing-01",
        clientId,
        clientContractId,
        rateVersion: 1,
        qualification: "pflegefachkraft",
        effectiveFrom: new Date("2026-01-01"),
        effectiveTo: new Date("2026-06-30"),
      };

      const prisma = createMockPrisma({ rates: [existingRate] });

      const result = await previewClientHourlyRate({
        prisma,
        input: {
          clientId,
          clientContractId,
          qualification: "pflegefachkraft",
          hourlyRateInCents: 3800,
          effectiveFrom: "2026-04-01", // Overlaps with 2026-01-01..2026-06-30
          effectiveTo: "2026-10-31",
          sourceType: "contract_amendment",
          sourceReference: "Nachtrag 1",
          verifyingUserId: adminActorId,
        },
        actorUserId: adminActorId,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("OVERLAPPING_VALIDITY_INTERVAL");
      }
    });

    it("generates a complete, verifiable preview summary with facilityName and computes matching canonical hash", async () => {
      const prisma = createMockPrisma({ rates: [] });

      const input: ClientHourlyRateInput = {
        clientId,
        clientContractId,
        qualification: "Pflegefachkraft",
        hourlyRateInCents: 3850,
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-12-31",
        sourceType: "contract",
        sourceReference: "Vertrag Nr. 2026-01, § 4",
        verifyingUserId: adminActorId,
      };

      const result = await previewClientHourlyRate({
        prisma,
        input,
        actorUserId: adminActorId,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        const preview = result.data;
        expect(preview.isValid).toBe(true);
        expect(preview.scope.clientId).toBe(clientId);
        expect(preview.scope.facilityName).toBe("Seniorenresidenz Rheinblick");
        expect(preview.scope.isGeneralScope).toBe(false);
        expect(preview.rateTerms.qualification).toBe("Pflegefachkraft");
        expect(preview.rateTerms.normalizedQualification).toBe("pflegefachkraft");
        expect(preview.rateTerms.hourlyRateFormattedEur).toBe("38,50 €");
        expect(preview.rateTerms.rateVersion).toBe(1);
        expect(preview.provenance.sourceType).toBe("contract");
        expect(preview.provenance.verifyingUser.email).toBe("admin@rheinahr.de");

        // Verify that computed canonical hash matches computeRateVersionCanonicalHash
        const expectedHash = computeRateVersionCanonicalHash({
          clientId,
          clientContractId,
          rateVersion: 1,
          qualification: "Pflegefachkraft",
          hourlyRateInCents: 3850,
          effectiveFrom: "2026-01-01",
          effectiveTo: "2026-12-31",
          sourceType: "contract",
          sourceReference: "Vertrag Nr. 2026-01, § 4",
        });
        expect(preview.integrity.canonicalHash).toBe(expectedHash);
      }
    });
  });

  describe("4. Ingestion, Freezing & Hash Binding Enforcement (Findings 2, 4)", () => {
    it("creates and immediately freezes a new rate record when expectedPreviewHash matches", async () => {
      let createdData: any = null;
      const prisma = createMockPrisma({
        rates: [],
        onRateCreate: (data) => {
          createdData = data;
        },
      });

      const input: ClientHourlyRateInput = {
        clientId,
        clientContractId,
        qualification: "pflegefachkraft",
        hourlyRateInCents: 4100,
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-12-31",
        sourceType: "contract",
        sourceReference: "Hauptvertrag 2026",
        verifyingUserId: adminActorId,
      };

      // 1. First run preview
      const preview = await previewClientHourlyRate({ prisma, input, actorUserId: adminActorId });
      expect(preview.success).toBe(true);
      if (!preview.success) return;

      const previewHash = preview.data.integrity.canonicalHash;

      // 2. Commit with expected preview hash
      const result = await createAndFreezeClientHourlyRate({
        prisma,
        input,
        actorUserId: adminActorId,
        expectedPreviewHash: previewHash,
      });

      expect(result.success).toBe(true);
      expect(createdData).not.toBeNull();
      expect(createdData.isFrozen).toBe(true);
      expect(createdData.verifiedByUserId).toBe(adminActorId);
      expect(createdData.frozenHash).toBe(previewHash);
    });

    it("rejects commit when expectedPreviewHash is missing or does not match (post-preview alteration)", async () => {
      const prisma = createMockPrisma({ rates: [] });

      const input: ClientHourlyRateInput = {
        clientId,
        clientContractId,
        qualification: "pflegefachkraft",
        hourlyRateInCents: 4100,
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-12-31",
        sourceType: "contract",
        sourceReference: "Hauptvertrag 2026",
        verifyingUserId: adminActorId,
      };

      // Missing expected preview hash
      const resMissing = await createAndFreezeClientHourlyRate({
        prisma,
        input,
        actorUserId: adminActorId,
        expectedPreviewHash: "",
      });
      expect(resMissing.success).toBe(false);
      if (!resMissing.success) {
        expect(resMissing.code).toBe("MISSING_PREVIEW_HASH");
      }

      // Mismatched expected preview hash (tampered post-preview)
      const resMismatch = await createAndFreezeClientHourlyRate({
        prisma,
        input,
        actorUserId: adminActorId,
        expectedPreviewHash: "stale-or-tampered-preview-hash-1234567890",
      });
      expect(resMismatch.success).toBe(false);
      if (!resMismatch.success) {
        expect(resMismatch.code).toBe("PREVIEW_HASH_MISMATCH");
      }
    });

    it("rejects modifying (update) a frozen rate record", async () => {
      const frozenRate = {
        id: "frozen-rate-01",
        clientId,
        isFrozen: true,
      };
      const prisma = createMockPrisma({ rates: [frozenRate] });

      const result = await updateClientHourlyRate({
        prisma,
        rateId: "frozen-rate-01",
        actorUserId: adminActorId,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("FROZEN_RECORD_IMMUTABLE");
      }
    });

    it("rejects deleting a frozen rate record", async () => {
      const frozenRate = {
        id: "frozen-rate-01",
        clientId,
        isFrozen: true,
      };
      const prisma = createMockPrisma({ rates: [frozenRate] });

      const result = await deleteClientHourlyRate({
        prisma,
        rateId: "frozen-rate-01",
        actorUserId: adminActorId,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("FROZEN_RECORD_IMMUTABLE");
      }
    });

    it("supersedes a frozen record with a successor version (rateVersion = 2) starting after prior effectiveTo", async () => {
      const existingRate = {
        id: "rate-v1",
        clientId,
        clientContractId,
        rateVersion: 1,
        qualification: "pflegefachkraft",
        effectiveFrom: new Date("2026-01-01"),
        effectiveTo: new Date("2026-06-30"),
        isFrozen: true,
      };

      let createdSuccessor: any = null;
      const prisma = createMockPrisma({
        rates: [existingRate],
        onRateCreate: (data) => {
          createdSuccessor = data;
        },
      });

      const newRateInput: ClientHourlyRateInput = {
        clientId,
        clientContractId,
        qualification: "pflegefachkraft",
        hourlyRateInCents: 4300,
        effectiveFrom: "2026-07-01", // starts day after 2026-06-30
        effectiveTo: "2026-12-31",
        sourceType: "contract_amendment",
        sourceReference: "Vertragsnachtrag Nr. 1 vom 15.06.2026",
        verifyingUserId: adminActorId,
      };

      // Preview successor
      const prevSucc = await previewClientHourlyRate({
        prisma,
        input: newRateInput,
        actorUserId: adminActorId,
      });
      expect(prevSucc.success).toBe(true);
      if (!prevSucc.success) return;

      const result = await supersedeClientHourlyRate({
        prisma,
        existingRateId: "rate-v1",
        newRateInput,
        actorUserId: adminActorId,
        expectedPreviewHash: prevSucc.data.integrity.canonicalHash,
      });

      expect(result.success).toBe(true);
      expect(createdSuccessor).not.toBeNull();
      expect(createdSuccessor.rateVersion).toBe(2);
      expect(createdSuccessor.hourlyRateInCents).toBe(4300);
      expect(createdSuccessor.isFrozen).toBe(true);
    });

    it("rejects superseding when new version starts before or on prior effectiveTo (OVERLAPPING_SUCCESSOR_START)", async () => {
      const existingRate = {
        id: "rate-v1",
        clientId,
        clientContractId,
        rateVersion: 1,
        qualification: "pflegefachkraft",
        effectiveFrom: new Date("2026-01-01"),
        effectiveTo: new Date("2026-06-30"),
        isFrozen: true,
      };

      const prisma = createMockPrisma({ rates: [existingRate] });

      const overlappingInput: ClientHourlyRateInput = {
        clientId,
        clientContractId,
        qualification: "pflegefachkraft",
        hourlyRateInCents: 4300,
        effectiveFrom: "2026-06-15", // overlaps!
        effectiveTo: "2026-12-31",
        sourceType: "contract_amendment",
        sourceReference: "Nachtrag 1",
        verifyingUserId: adminActorId,
      };

      const result = await supersedeClientHourlyRate({
        prisma,
        existingRateId: "rate-v1",
        newRateInput: overlappingInput,
        actorUserId: adminActorId,
        expectedPreviewHash: "hash-any",
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("OVERLAPPING_SUCCESSOR_START");
      }
    });
  });

  describe("5. Integration with resolveClientPriceVersion & prepareV2InvoiceDraft", () => {
    it("successfully resolves the frozen rate through production resolver", async () => {
      const hash = computeRateVersionCanonicalHash({
        clientId,
        clientContractId,
        rateVersion: 1,
        qualification: "pflegefachkraft",
        hourlyRateInCents: 3850,
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-12-31",
        sourceType: "contract",
        sourceReference: "Vertrag §4",
      });

      const frozenRate = {
        id: "db-rate-01",
        clientId,
        clientContractId,
        rateVersion: 1,
        qualification: "pflegefachkraft",
        hourlyRateInCents: 3850,
        effectiveFrom: new Date("2026-01-01"),
        effectiveTo: new Date("2026-12-31"),
        sourceType: "contract",
        sourceReference: "Vertrag §4",
        isFrozen: true,
        frozenHash: hash,
        verifiedByUserId: adminActorId,
        verifiedAt: new Date("2026-01-01T10:00:00Z"),
        verifiedByUser: mockAdminUser,
      };

      const prisma = createMockPrisma({ rates: [frozenRate] });

      const resolved = await resolveClientPriceVersion({
        prisma,
        clientId,
        qualification: "pflegefachkraft",
        shiftDateIso: "2026-05-15",
        contractId: clientContractId,
      });

      expect(resolved.status).toBe("resolved");
      if (resolved.status === "resolved") {
        expect(resolved.priceRecord.hourlyRateInCents).toBe(3850);
        expect(resolved.priceRecord.contractId).toBe(clientContractId);
        expect(resolved.priceRecord.sourceReference).toBe("Vertrag §4");
      }
    });

    it("strictly returns PRICE_UNRESOLVED when no verified rate exists, writes 0 invoices and sends 0 emails", async () => {
      const invoiceCreateSpy = vi.fn();
      const emailCreateSpy = vi.fn();

      const mockAssignment = {
        id: "assign-unverified-01",
        status: "confirmed",
        invoiceId: null,
        contractId: clientContractId,
        worker: { id: "worker-01", fullName: "Erika Muster", qualification: "pflegefachkraft" },
        order: {
          id: "order-01",
          clientId,
          shiftDate: new Date("2026-05-15T00:00:00.000Z"),
          startTime: "08:00",
          endTime: "16:00",
          breakMinutes: 30,
          requiredQualification: "pflegefachkraft",
          client: {
            id: clientId,
            facilityName: "Seniorenresidenz Rheinblick",
            paymentTermsDays: 14,
          },
        },
        serviceConfirmation: {
          hoursWorked: 7.5,
        },
      };

      const prisma = {
        assignment: { findMany: vi.fn(async () => [mockAssignment]) },
        user: { findUnique: vi.fn(async () => mockAdminUser) },
        client: { findUnique: vi.fn(async () => mockClient) },
        clientContract: { findUnique: vi.fn(async () => mockContract) },
        clientHourlyRateVersion: { findMany: vi.fn(async () => []) }, // empty DB
        facilitySurchargePolicy: {
          findFirst: vi.fn(async () => null),
          findMany: vi.fn(async () => []),
        },
        invoice: { create: invoiceCreateSpy, update: vi.fn() },
        outgoingEmail: { create: emailCreateSpy },
      };

      const baseRecord = {
        id: "policy-01",
        clientId,
        clientContractId,
        policyVersion: 1,
        federalState: "NW",
        municipality: "Köln",
        districtLocality: null,
        surchargeSat: 0.25,
        surchargeSun: 0.5,
        surchargeHoliday: 1.0,
        surchargeNight: 0.25,
        nightStart: "20:00",
        nightEnd: "06:00",
        combinationRule: "highest_non_night_plus_night" as const,
        sourceType: "contract" as const,
        sourceReference: "Vertrag §7",
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        isFrozen: false,
        frozenHash: "",
      };

      const resolvedPol = resolveInvoiceSurchargePolicy({
        policy: baseRecord as any,
        referenceDate: "2026-05-15",
      });

      const frozenPol = resolveInvoiceSurchargePolicy({
        policy: {
          ...baseRecord,
          isFrozen: true,
          frozenHash: resolvedPol.status === "resolved" ? resolvedPol.frozenHash : "",
        } as any,
        referenceDate: "2026-05-15",
      });

      const result = await prepareV2InvoiceDraft(
        { assignmentIds: ["assign-unverified-01"] },
        {
          prisma: prisma as any,
          facilityPolicyResolver: async () => frozenPol,
          effectiveHoursResolver: async () => ({
            assignmentId: "assign-unverified-01",
            effectiveHours: 7.5,
            effectiveStartTime: "08:00",
            effectiveEndTime: "16:00",
            effectiveBreakMinutes: 30,
            source: "scheduled",
            effectiveVersion: "v1-scheduled",
            isCorrected: false,
          }),
        }
      );

      // Draft must report unresolved status with PRICE_UNRESOLVED
      expect(result.status).toBe("unresolved");
      if (result.status === "unresolved") {
        expect(result.code).toBe("PRICE_UNRESOLVED");
      }

      // Guarantees: Read-only draft preparation writes 0 DB invoices and sends 0 emails
      expect(invoiceCreateSpy).not.toHaveBeenCalled();
      expect(emailCreateSpy).not.toHaveBeenCalled();
    });

    it("fails with PRICE_UNRESOLVED if frozenHash has been tampered with or modified", async () => {
      const tamperedRate = {
        id: "db-rate-tampered",
        clientId,
        clientContractId,
        rateVersion: 1,
        qualification: "pflegefachkraft",
        hourlyRateInCents: 9999, // tampered amount
        effectiveFrom: new Date("2026-01-01"),
        effectiveTo: new Date("2026-12-31"),
        sourceType: "contract",
        sourceReference: "Vertrag §4",
        isFrozen: true,
        frozenHash: "original-untampered-hash-that-no-longer-matches",
        verifiedByUserId: adminActorId,
        verifiedAt: new Date("2026-01-01T10:00:00Z"),
        verifiedByUser: mockAdminUser,
      };

      const prisma = createMockPrisma({ rates: [tamperedRate] });

      const resolved = await resolveClientPriceVersion({
        prisma,
        clientId,
        qualification: "pflegefachkraft",
        shiftDateIso: "2026-05-15",
        contractId: clientContractId,
      });

      expect(resolved.status).toBe("unresolved");
      if (resolved.status === "unresolved") {
        expect(resolved.code).toBe("PRICE_UNRESOLVED");
        expect(resolved.message).toContain("Integritätsverletzung");
      }
    });

    it("fails with PRICE_NOT_FROZEN if rate in DB is not frozen", async () => {
      const unfrozenRate = {
        id: "db-rate-unfrozen",
        clientId,
        clientContractId,
        rateVersion: 1,
        qualification: "pflegefachkraft",
        hourlyRateInCents: 3850,
        effectiveFrom: new Date("2026-01-01"),
        effectiveTo: new Date("2026-12-31"),
        sourceType: "contract",
        sourceReference: "Vertrag §4",
        isFrozen: false, // NOT frozen
        verifiedByUserId: adminActorId,
        verifiedAt: new Date("2026-01-01T10:00:00Z"),
        verifiedByUser: mockAdminUser,
      };

      const prisma = createMockPrisma({ rates: [unfrozenRate] });

      const resolved = await resolveClientPriceVersion({
        prisma,
        clientId,
        qualification: "pflegefachkraft",
        shiftDateIso: "2026-05-15",
        contractId: clientContractId,
      });

      expect(resolved.status).toBe("unresolved");
      if (resolved.status === "unresolved") {
        expect(resolved.code).toBe("PRICE_NOT_FROZEN");
      }
    });
  });

  describe("6. Synthetic Boundary Countertests (General vs Contract, Mismatches, Case-Insensitivity)", () => {
    it("resolves general facility rate when shift is not tied to a specific contract", async () => {
      const hash = computeRateVersionCanonicalHash({
        clientId,
        clientContractId: null,
        rateVersion: 1,
        qualification: "pflegefachkraft",
        hourlyRateInCents: 3700,
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-12-31",
        sourceType: "framework_agreement",
        sourceReference: "Rahmenvertrag 2026",
      });

      const generalFrozenRate = {
        id: "general-rate-01",
        clientId,
        clientContractId: null,
        rateVersion: 1,
        qualification: "pflegefachkraft",
        hourlyRateInCents: 3700,
        effectiveFrom: new Date("2026-01-01"),
        effectiveTo: new Date("2026-12-31"),
        sourceType: "framework_agreement",
        sourceReference: "Rahmenvertrag 2026",
        isFrozen: true,
        frozenHash: hash,
        verifiedByUserId: adminActorId,
        verifiedAt: new Date("2026-01-01T10:00:00Z"),
        verifiedByUser: mockAdminUser,
      };

      const prisma = createMockPrisma({ rates: [generalFrozenRate] });

      const resolved = await resolveClientPriceVersion({
        prisma,
        clientId,
        qualification: "pflegefachkraft",
        shiftDateIso: "2026-05-15",
        contractId: null,
      });

      expect(resolved.status).toBe("resolved");
      if (resolved.status === "resolved") {
        expect(resolved.priceRecord.contractId).toBeNull();
        expect(resolved.priceRecord.hourlyRateInCents).toBe(3700);
      }
    });

    it("rejects resolution when client ID differs (Client A rate cannot be used for Client B)", async () => {
      const hash = computeRateVersionCanonicalHash({
        clientId: "client-facility-alpha",
        clientContractId,
        rateVersion: 1,
        qualification: "pflegefachkraft",
        hourlyRateInCents: 4000,
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-12-31",
        sourceType: "contract",
        sourceReference: "Vertrag Alpha",
      });

      const alphaRate = {
        id: "alpha-rate-01",
        clientId: "client-facility-alpha",
        clientContractId,
        rateVersion: 1,
        qualification: "pflegefachkraft",
        hourlyRateInCents: 4000,
        effectiveFrom: new Date("2026-01-01"),
        effectiveTo: new Date("2026-12-31"),
        sourceType: "contract",
        sourceReference: "Vertrag Alpha",
        isFrozen: true,
        frozenHash: hash,
        verifiedByUserId: adminActorId,
        verifiedAt: new Date("2026-01-01T10:00:00Z"),
        verifiedByUser: mockAdminUser,
      };

      // Mock prisma returning no matches for client-facility-beta
      const prisma = {
        clientHourlyRateVersion: {
          findMany: vi.fn(async ({ where }: { where: { clientId: string } }) => {
            if (where.clientId === "client-facility-alpha") return [alphaRate];
            return [];
          }),
        },
      };

      const resolved = await resolveClientPriceVersion({
        prisma,
        clientId: "client-facility-beta", // different client
        qualification: "pflegefachkraft",
        shiftDateIso: "2026-05-15",
        contractId: clientContractId,
      });

      expect(resolved.status).toBe("unresolved");
      if (resolved.status === "unresolved") {
        expect(resolved.code).toBe("PRICE_UNRESOLVED");
        expect(resolved.message).toContain('client-facility-beta');
      }
    });

    it("rejects resolution when qualification differs (pflegefachkraft vs pflegehelfer)", async () => {
      const hash = computeRateVersionCanonicalHash({
        clientId,
        clientContractId,
        rateVersion: 1,
        qualification: "pflegefachkraft",
        hourlyRateInCents: 4000,
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-12-31",
        sourceType: "contract",
        sourceReference: "Vertrag §4",
      });

      const pfkRate = {
        id: "pfk-rate-01",
        clientId,
        clientContractId,
        rateVersion: 1,
        qualification: "pflegefachkraft",
        hourlyRateInCents: 4000,
        effectiveFrom: new Date("2026-01-01"),
        effectiveTo: new Date("2026-12-31"),
        sourceType: "contract",
        sourceReference: "Vertrag §4",
        isFrozen: true,
        frozenHash: hash,
        verifiedByUserId: adminActorId,
        verifiedAt: new Date("2026-01-01T10:00:00Z"),
        verifiedByUser: mockAdminUser,
      };

      const prisma = {
        clientHourlyRateVersion: {
          findMany: vi.fn(async ({ where }: { where: { qualification: { equals: string } } }) => {
            if (where.qualification.equals === "pflegefachkraft") return [pfkRate];
            return [];
          }),
        },
      };

      // Request rate for pflegehelfer
      const resolved = await resolveClientPriceVersion({
        prisma,
        clientId,
        qualification: "pflegehelfer",
        shiftDateIso: "2026-05-15",
        contractId: clientContractId,
      });

      expect(resolved.status).toBe("unresolved");
      if (resolved.status === "unresolved") {
        expect(resolved.code).toBe("PRICE_UNRESOLVED");
        expect(resolved.message).toContain("pflegehelfer");
      }
    });

    it("handles case-insensitivity: matches 'Pflegefachkraft' with stored 'pflegefachkraft'", async () => {
      const hash = computeRateVersionCanonicalHash({
        clientId,
        clientContractId,
        rateVersion: 1,
        qualification: "Pflegefachkraft",
        hourlyRateInCents: 4000,
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-12-31",
        sourceType: "contract",
        sourceReference: "Vertrag §4",
      });

      const pfkRate = {
        id: "pfk-rate-01",
        clientId,
        clientContractId,
        rateVersion: 1,
        qualification: "Pflegefachkraft",
        hourlyRateInCents: 4000,
        effectiveFrom: new Date("2026-01-01"),
        effectiveTo: new Date("2026-12-31"),
        sourceType: "contract",
        sourceReference: "Vertrag §4",
        isFrozen: true,
        frozenHash: hash,
        verifiedByUserId: adminActorId,
        verifiedAt: new Date("2026-01-01T10:00:00Z"),
        verifiedByUser: mockAdminUser,
      };

      const prisma = createMockPrisma({ rates: [pfkRate] });

      // Query with uppercase 'PFLEGEFACHKRAFT'
      const resolved = await resolveClientPriceVersion({
        prisma,
        clientId,
        qualification: "PFLEGEFACHKRAFT",
        shiftDateIso: "2026-05-15",
        contractId: clientContractId,
      });

      expect(resolved.status).toBe("resolved");
      if (resolved.status === "resolved") {
        expect(resolved.priceRecord.hourlyRateInCents).toBe(4000);
      }
    });

    it("rejects resolution when verification metadata (verifiedBy / verifiedAt / sourceReference) is missing or blank", async () => {
      const incompleteRate = {
        id: "incomplete-rate-01",
        clientId,
        clientContractId,
        rateVersion: 1,
        qualification: "pflegefachkraft",
        hourlyRateInCents: 4000,
        effectiveFrom: new Date("2026-01-01"),
        effectiveTo: new Date("2026-12-31"),
        sourceType: "contract",
        sourceReference: "   ", // blank source reference!
        isFrozen: true,
        frozenHash: "some-hash",
        verifiedByUserId: null, // missing verifier!
        verifiedAt: null,
        verifiedByUser: null,
      };

      const prisma = createMockPrisma({ rates: [incompleteRate] });

      const resolved = await resolveClientPriceVersion({
        prisma,
        clientId,
        qualification: "pflegefachkraft",
        shiftDateIso: "2026-05-15",
        contractId: clientContractId,
      });

      expect(resolved.status).toBe("unresolved");
      if (resolved.status === "unresolved") {
        expect(resolved.code).toBe("PRICE_UNRESOLVED");
        expect(resolved.message).toContain("unzureichende oder unbestätigte Verifizierungs-Metadaten");
      }
    });
  });
});
