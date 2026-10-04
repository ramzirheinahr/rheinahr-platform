import { describe, it, expect, vi, beforeEach } from "vitest";
import { findMatchingMonthlyRequestGroupId } from "./orders";

describe("findMatchingMonthlyRequestGroupId", () => {
  const mockFindFirst = vi.fn();
  const mockTx = {
    order: {
      findFirst: mockFindFirst,
    },
  };

  beforeEach(() => {
    mockFindFirst.mockReset();
  });

  it("returns existing requestGroupId when an open order exists in the same month, client, and qualification", async () => {
    mockFindFirst.mockResolvedValue({
      requestGroupId: "group-123",
    });

    const result = await findMatchingMonthlyRequestGroupId({
      clientId: "client-abc",
      shiftDate: new Date("2026-10-15T08:00:00.000Z"),
      requiredQualification: "pflegefachkraft",
      tx: mockTx,
    });

    expect(result).toBe("group-123");
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: {
        clientId: "client-abc",
        requiredQualification: "pflegefachkraft",
        shiftDate: {
          gte: new Date(Date.UTC(2026, 9, 1, 0, 0, 0)),
          lt: new Date(Date.UTC(2026, 10, 1, 0, 0, 0)),
        },
        requestGroupId: { not: null },
        status: { notIn: ["cancelled", "completed"] },
      },
      orderBy: { createdAt: "desc" },
      select: { requestGroupId: true },
    });
  });

  it("returns null when no open order exists in the same month", async () => {
    mockFindFirst.mockResolvedValue(null);

    const result = await findMatchingMonthlyRequestGroupId({
      clientId: "client-abc",
      shiftDate: new Date("2026-10-20T14:00:00.000Z"),
      requiredQualification: "pflegehelfer",
      tx: mockTx,
    });

    expect(result).toBeNull();
  });
});
