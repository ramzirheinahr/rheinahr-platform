import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ id: "admin-1", role: "admin" }),
  roleSatisfies: vi.fn().mockReturnValue(true),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { client: { update: vi.fn().mockResolvedValue({ id: "client-1" }) } },
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/local-storage", () => ({ createLocalStorageClient: vi.fn() }));

import { updateClient } from "./actions";
import { prisma } from "@/lib/prisma";

describe("client profile edit preserves remuneration", () => {
  it("does not clear or overwrite prices and surcharges when saving other profile fields", async () => {
    const form = new FormData();
    form.set("facilityName", "Residenz Alpha");
    form.set("facilityType", "pflegeheim");
    form.set("paymentTermsDays", "14");
    const result = await updateClient("client-1", form);
    expect(result).toEqual({ ok: true });
    const update = vi.mocked(prisma.client.update).mock.calls[0][0];
    expect(update.data.facilityName).toBe("Residenz Alpha");
    for (const field of [
      "surchargeSat", "surchargeSun", "surchargeHoliday", "surchargeNight",
      "nightStart", "nightEnd", "hourlyRates",
    ]) {
      expect(update.data).not.toHaveProperty(field);
    }
  });
});
