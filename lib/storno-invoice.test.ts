import { describe, expect, it } from "vitest";
import { buildStornoInvoiceData } from "./storno-invoice";

const history = { cancelledAt: "2026-10-13T14:39:30.888Z" };
const issuedAt = new Date("2026-10-14T12:00:00.000Z");
const base = {
  invoiceNumber: "551-147-0926",
  status: "cancelled",
  date: new Date("2026-10-05T10:18:12.983Z"),
  grossAmount: 10202.66333333333,
  snapshotData: {
    facilityName: "Example Facility",
    address: "Example Street 1, 53111 Bonn",
    internalNumber: "147",
    subtotal: "8573,66 €",
    taxAmount: "1629,00 €",
    total: "10202,66 €",
    cancellationHistory: history,
  },
};

describe("Stornorechnung", () => {
  it("reverses the frozen original amount, including a legacy cent-rounding difference", () => {
    const data = buildStornoInvoiceData(base, issuedAt);
    expect(data.invoiceNumber).toBe("ST-551-147-0926");
    expect(data.date).toBe("14.10.2026");
    expect(data.cancellation?.originalInvoiceNumber).toBe("551-147-0926");
    expect(data.items[0].hours).toBe("-1,00");
    expect(data.items[0].amount).toBe("-8573,66 €");
    expect(data.subtotal).toBe("-8573,66 €");
    expect(data.taxAmount).toBe("-1629,00 €");
    expect(data.total).toBe("-10202,66 €");
  });

  it("reverses a V2 invoice at exact cent precision", () => {
    const data = buildStornoInvoiceData({
      ...base,
      invoiceNumber: "640-265-0926",
      grossAmount: 737.38,
      snapshotData: {
        ...base.snapshotData,
        subtotal: "619,65 €",
        taxAmount: "117,73 €",
        total: "737,38 €",
        subtotalCents: 61965,
        taxAmountCents: 11773,
        totalCents: 73738,
      },
    }, issuedAt);
    expect(data.total).toBe("-737,38 €");
  });

  it("refuses conflicting historical totals", () => {
    expect(() => buildStornoInvoiceData({
      ...base,
      snapshotData: { ...base.snapshotData, total: "10202,67 €" },
    }, issuedAt)).toThrow(/widersprüchlich/);
  });
});
