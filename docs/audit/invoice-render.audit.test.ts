/** Diagnostic samples only; uses the real React-PDF renderer with synthetic company data. */
import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { generateInvoicePdf, type InvoicePdfData } from "@/lib/pdf/invoice";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/config/company", () => ({ getCompanyConfig: async () => ({
  name: "SYNTHETIC AUDIT SAMPLE - NOT AN INVOICE", street: "Test address", city: "Test city",
  phone: "TEST", fax: "TEST", mobile: "TEST", email: "audit@example.invalid", website: "example.invalid",
  registryCourt: "TEST", hrb: "TEST", taxId: "TEST", vatId: "TEST", ceo: "TEST",
  bankName: "TEST", iban: "TEST", bic: "TEST", logoUrl: "/logo.png",
}) }));
const base: InvoicePdfData = {
  invoiceNumber: "AUDIT-ONLY", date: "08.10.2026", clientId: "AUDIT", clientName: "Synthetic Facility Name",
  billingInfo: null, clientAddress: "Synthetic street 1\n00000 Synthetic city",
  periodStart: "11.07.2026", periodEnd: "12.07.2026", paymentTermsDays: 14,
  items: [
    { pos: 1, description: "Synthetic Worker (Pflegefachkraft) vom 11.07.2026 bis 12.07.2026", hours: "12,62", rate: "52,80", amount: "666,34 €" },
    { pos: 2, description: "Samstagzuschlag (Synthetic Worker) 30%", hours: "6,80", rate: "15,84", amount: "107,71 €" },
    { pos: 3, description: "Sonntagzuschlag (Synthetic Worker) 50%", hours: "5,82", rate: "26,40", amount: "153,65 €" },
  ], subtotal: "927,70 €", taxAmount: "176,26 €", total: "1103,96 €",
};
const scratchPath = mkdtempSync(join(tmpdir(), "rheinahr-invoice-audit-"));
const directory = pathToFileURL(scratchPath + "/");
afterAll(() => rmSync(scratchPath, { recursive: true }));
describe("actual invoice template rendering", () => {
  it("renders the irregular-minute sample", async () => {
    mkdirSync(directory, { recursive: true });
    const buffer = await generateInvoicePdf(base);
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
    writeFileSync(new URL("irregular-minutes.pdf", directory), buffer);
  });
  it("renders a many-worker pagination sample", async () => {
    mkdirSync(directory, { recursive: true });
    const data = { ...base, items: Array.from({ length: 36 }, (_, i) => ({
      pos: i + 1, description: `Synthetic Worker ${i + 1} (Pflegefachkraft) vom 11.07.2026 bis 12.07.2026`, hours: "1,00", rate: "40,00", amount: "40,00 €",
    })), subtotal: "1440,00 €", taxAmount: "273,60 €", total: "1713,60 €" };
    const buffer = await generateInvoicePdf(data);
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
    writeFileSync(new URL("many-workers.pdf", directory), buffer);
  });
});
