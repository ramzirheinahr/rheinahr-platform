/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// Mock prisma
vi.mock("@/lib/prisma", () => ({
  prisma: {
    facilityTypeCatalog: {
      count: vi.fn(),
      findMany: vi.fn(),
      createMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    client: {
      findMany: vi.fn(),
      groupBy: vi.fn(),
      count: vi.fn(),
    },
  },
}));

// Mock next/cache
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Mock auth
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ id: "admin-1", role: "admin" }),
  getCurrentUser: vi.fn().mockResolvedValue({ id: "admin-1", role: "admin" }),
  roleSatisfies: vi.fn().mockReturnValue(true),
}));

import { prisma } from "@/lib/prisma";
import { facilityTypeName, type FacilityTypeItem } from "./facility-type-shared";
import {
  INITIAL_FACILITY_TYPES,
  ensureFacilityTypeCatalog,
  getFacilityTypeCatalog,
  getFacilityTypeLabelMap,
} from "./facility-type-catalog";
import {
  createFacilityTypeAction,
  updateFacilityTypeAction,
  deleteFacilityTypeAction,
} from "@/app/[locale]/admin/settings/system/facility-type-actions";

describe("Facility Type Catalog Service & Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("facilityTypeName localization", () => {
    const item: FacilityTypeItem = {
      code: "pflegeheim",
      nameDe: "Pflegeheim",
      nameEn: "Nursing home",
      nameAr: "دار رعاية تمريضية",
      active: true,
      sortOrder: 10,
    };

    it("returns German name when locale is 'de'", () => {
      expect(facilityTypeName(item, "de")).toBe("Pflegeheim");
    });

    it("returns English name when locale is 'en'", () => {
      expect(facilityTypeName(item, "en")).toBe("Nursing home");
    });

    it("returns Arabic name when locale is 'ar'", () => {
      expect(facilityTypeName(item, "ar")).toBe("دار رعاية تمريضية");
    });

    it("falls back to German when requested locale translation is missing", () => {
      const itemWithoutEn = { nameDe: "Spezialklinik", nameEn: null, nameAr: null };
      expect(facilityTypeName(itemWithoutEn, "en")).toBe("Spezialklinik");
      expect(facilityTypeName(itemWithoutEn, "ar")).toBe("Spezialklinik");
    });
  });

  describe("INITIAL_FACILITY_TYPES configuration", () => {
    it("defines 13 standard care facility types with unique codes", () => {
      expect(INITIAL_FACILITY_TYPES.length).toBeGreaterThanOrEqual(13);
      const codes = INITIAL_FACILITY_TYPES.map((t) => t.code);
      const uniqueCodes = new Set(codes);
      expect(uniqueCodes.size).toBe(codes.length);
    });

    it("includes standard care domains like pflegeheim, klinik, ambulant, and hospiz", () => {
      const codes = new Set(INITIAL_FACILITY_TYPES.map((t) => t.code));
      expect(codes.has("pflegeheim")).toBe(true);
      expect(codes.has("klinik")).toBe(true);
      expect(codes.has("ambulant")).toBe(true);
      expect(codes.has("hospiz")).toBe(true);
    });
  });

  describe("ensureFacilityTypeCatalog bootstrap", () => {
    it("skips bootstrap if records already exist", async () => {
      (prisma.facilityTypeCatalog.count as any).mockResolvedValue(5);

      await ensureFacilityTypeCatalog();

      expect(prisma.facilityTypeCatalog.count).toHaveBeenCalledTimes(1);
      expect(prisma.facilityTypeCatalog.createMany).not.toHaveBeenCalled();
    });

    it("populates initial catalog and migrates existing client types if empty", async () => {
      (prisma.facilityTypeCatalog.count as any).mockResolvedValue(0);
      (prisma.client.findMany as any).mockResolvedValue([
        { facilityType: "pflegeheim" },
        { facilityType: "custom_type_from_history" },
      ]);
      (prisma.facilityTypeCatalog.createMany as any).mockResolvedValue({ count: 14 });

      await ensureFacilityTypeCatalog();

      expect(prisma.facilityTypeCatalog.createMany).toHaveBeenCalledTimes(1);
      const callArg = (prisma.facilityTypeCatalog.createMany as any).mock.calls[0][0];
      const insertedCodes = callArg.data.map((d: any) => d.code);
      expect(insertedCodes).toContain("pflegeheim");
      expect(insertedCodes).toContain("custom_type_from_history");
    });
  });

  describe("getFacilityTypeCatalog and getFacilityTypeLabelMap", () => {
    it("returns catalog items and enriches with client counts when requested", async () => {
      (prisma.facilityTypeCatalog.count as any).mockResolvedValue(1);
      (prisma.facilityTypeCatalog.findMany as any).mockResolvedValue([
        {
          code: "pflegeheim",
          nameDe: "Pflegeheim",
          nameEn: "Nursing home",
          nameAr: "دار مسنين",
          active: true,
          sortOrder: 10,
          updatedAt: new Date(),
        },
      ]);
      (prisma.client.groupBy as any).mockResolvedValue([
        { facilityType: "pflegeheim", _count: { id: 7 } },
      ]);

      const result = await getFacilityTypeCatalog({ includeClientCount: true });

      expect(result).toHaveLength(1);
      expect(result[0].code).toBe("pflegeheim");
      expect(result[0].clientCount).toBe(7);
    });

    it("builds localized label map correctly", async () => {
      (prisma.facilityTypeCatalog.count as any).mockResolvedValue(1);
      (prisma.facilityTypeCatalog.findMany as any).mockResolvedValue([
        {
          code: "pflegeheim",
          nameDe: "Pflegeheim",
          nameEn: "Nursing home",
          nameAr: "دار رعاية تمريضية",
          active: true,
          sortOrder: 10,
          updatedAt: new Date(),
        },
      ]);

      const mapEn = await getFacilityTypeLabelMap("en");
      expect(mapEn.get("pflegeheim")).toBe("Nursing home");

      const mapDe = await getFacilityTypeLabelMap("de");
      expect(mapDe.get("pflegeheim")).toBe("Pflegeheim");
    });
  });

  describe("Server Actions: createFacilityTypeAction", () => {
    it("rejects invalid input when nameDe is too short", async () => {
      const res = await createFacilityTypeAction({
        code: "invalid",
        nameDe: "",
      });
      expect(res.ok).toBe(false);
      expect((res as any).error).toContain("mindestens 2 Zeichen");
    });

    it("creates a new catalog item with normalized code", async () => {
      (prisma.facilityTypeCatalog.count as any).mockResolvedValue(1);
      (prisma.facilityTypeCatalog.create as any).mockResolvedValue({
        code: "dialysezentrum",
        nameDe: "Dialysezentrum",
        active: true,
        sortOrder: 140,
      });

      const res = await createFacilityTypeAction({
        code: "dialysezentrum",
        nameDe: "Dialysezentrum",
        nameEn: "Dialysis Center",
        sortOrder: 140,
      });

      expect(res.ok).toBe(true);
      expect(prisma.facilityTypeCatalog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            code: "dialysezentrum",
            nameDe: "Dialysezentrum",
            nameEn: "Dialysis Center",
          }),
        })
      );
    });
  });

  describe("Server Actions: updateFacilityTypeAction", () => {
    it("updates existing catalog item fields", async () => {
      (prisma.facilityTypeCatalog.update as any).mockResolvedValue({
        code: "pflegeheim",
        nameDe: "Stationäre Pflege",
        active: true,
        sortOrder: 5,
      });

      const res = await updateFacilityTypeAction({
        code: "pflegeheim",
        nameDe: "Stationäre Pflege",
        active: true,
        sortOrder: 5,
      });

      expect(res.ok).toBe(true);
      expect(prisma.facilityTypeCatalog.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { code: "pflegeheim" },
          data: expect.objectContaining({
            nameDe: "Stationäre Pflege",
            sortOrder: 5,
          }),
        })
      );
    });
  });

  describe("Server Actions: deleteFacilityTypeAction", () => {
    it("rejects deletion when clientCount > 0 to preserve data integrity", async () => {
      (prisma.client.count as any).mockResolvedValue(3);

      const res = await deleteFacilityTypeAction("pflegeheim");

      expect(res.ok).toBe(false);
      expect((res as any).error).toContain("wird derzeit von 3 Einrichtung(en) verwendet");
      expect(prisma.facilityTypeCatalog.delete).not.toHaveBeenCalled();
    });

    it("safely deletes facility type when no client is referencing it", async () => {
      (prisma.client.count as any).mockResolvedValue(0);
      (prisma.facilityTypeCatalog.delete as any).mockResolvedValue({ code: "unused_type" });

      const res = await deleteFacilityTypeAction("unused_type");

      expect(res.ok).toBe(true);
      expect(prisma.facilityTypeCatalog.delete).toHaveBeenCalledWith({
        where: { code: "unused_type" },
      });
    });
  });
});
