import { describe, it, expect } from "vitest";
import { orderRequestSchema } from "./validations";

describe("orderRequestSchema", () => {
  it("successfully parses orders with more than 60 shifts (e.g. 66 shifts for a full month)", () => {
    const shifts = Array.from({ length: 66 }, (_, i) => {
      const day = String((i % 30) + 1).padStart(2, "0");
      return {
        date: `2026-09-${day}`,
        requiredQualification: "exam_nurse",
        startTime: "13:00",
        endTime: "21:00",
        pause: 30,
        quantity: 1,
        bereich: "Station 1",
      };
    });

    const result = orderRequestSchema.safeParse({ shifts });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.shifts).toHaveLength(66);
    }
  });

  it("successfully parses orders with up to 1000 shifts", () => {
    const shifts = Array.from({ length: 500 }, (_, i) => {
      const day = String((i % 28) + 1).padStart(2, "0");
      return {
        date: `2026-09-${day}`,
        requiredQualification: "nurse_assistant",
        startTime: "06:00",
        endTime: "14:30",
        pause: 30,
        quantity: 2,
      };
    });

    const result = orderRequestSchema.safeParse({ shifts });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.shifts).toHaveLength(500);
    }
  });

  it("fails if shifts array exceeds 1000", () => {
    const shifts = Array.from({ length: 1001 }, () => ({
      date: "2026-09-01",
      requiredQualification: "nurse_assistant",
      startTime: "06:00",
      endTime: "14:30",
      pause: 30,
      quantity: 1,
    }));

    const result = orderRequestSchema.safeParse({ shifts });
    expect(result.success).toBe(false);
  });
});
