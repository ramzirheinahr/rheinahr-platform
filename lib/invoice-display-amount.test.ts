import { describe, expect, it, vi } from "vitest";
import { getFrozenInvoiceDocumentAmounts, getInvoiceDisplayGrossAmount } from "@/lib/invoicing";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const frozen = {
  isFrozen: true,
  items: [
    { description: "Grundvergütung", amount: "3.000,00 €" },
    { description: "Zuschlag", amount: "252,69 €" },
  ],
  subtotal: "3252,69 €",
  taxAmount: "618,01 €",
  total: "3870,70 €",
};

describe("issued invoice amount in lists", () => {
  it("shows the frozen document total instead of an unrounded legacy row", () => {
    expect(getFrozenInvoiceDocumentAmounts(frozen)?.totalCents).toBe(387070);
    expect(getInvoiceDisplayGrossAmount({ grossAmount: 3870.878608333333, snapshotData: frozen })).toBe(3870.7);
  });

  it("rejects a document whose items or totals disagree", () => {
    expect(getFrozenInvoiceDocumentAmounts({ ...frozen, total: "3870,88 €" })).toBeNull();
    expect(getFrozenInvoiceDocumentAmounts({ ...frozen, items: [{ description: "Grundvergütung", amount: "3252,68 €" }] })).toBeNull();
    expect(getInvoiceDisplayGrossAmount({ grossAmount: 3870.88, snapshotData: { ...frozen, isFrozen: false } })).toBe(3870.88);
  });
});
