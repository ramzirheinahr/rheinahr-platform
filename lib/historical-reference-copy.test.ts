import { describe, expect, it } from "vitest";
import { hasFrozenHistoricalReferenceCopy, hasReliableInvoiceDocument } from "./invoicing";

const invoice = {
  status: "cancelled",
  netAmount: 799.01,
  vatAmount: 151.81,
  grossAmount: 950.81,
  snapshotData: {
    isFrozen: true,
    facilityName: "Testeinrichtung",
    address: "Teststraße 1, 53111 Bonn",
    paymentTermsDays: 14,
    subtotal: "799,00 €",
    taxAmount: "151,81 €",
    total: "950,81 €",
    items: [
      { pos: 1, description: "Pflegehilfskraft", hours: "17,50", rate: "34,00", amount: "595,00 €" },
      { pos: 2, description: "Pflegehilfskraft", hours: "6,00", rate: "34,00", amount: "204,00 €" },
    ],
  },
};

describe("historical reference copy", () => {
  it("allows a labelled frozen-data copy for the one-cent legacy net mismatch", () => {
    expect(hasReliableInvoiceDocument(invoice)).toBe(false);
    expect(hasFrozenHistoricalReferenceCopy(invoice)).toBe(true);
  });

  it("rejects changes beyond the known rounding mismatch or an unfrozen source", () => {
    expect(hasFrozenHistoricalReferenceCopy({ ...invoice, netAmount: 799.02 })).toBe(false);
    expect(hasFrozenHistoricalReferenceCopy({ ...invoice, status: "unpaid" })).toBe(false);
    expect(hasFrozenHistoricalReferenceCopy({
      ...invoice,
      snapshotData: { ...invoice.snapshotData, items: [{ ...invoice.snapshotData.items[0], amount: "594,00 €" }, invoice.snapshotData.items[1]] },
    })).toBe(false);
  });
});
