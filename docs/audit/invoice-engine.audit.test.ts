/** Audit characterization: passing tests reproduce current behavior, including defects.
 * No real database, storage, notification, or email operations are performed.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { buildInvoicePdfData } from "@/lib/invoice-pdf-builder";
import { germanHolidays } from "@/lib/holidays";
import { netShiftHours, requestNetTotal, resolveRates, shiftSurchargeHours } from "@/lib/pricing";
import { generateOrderInvoices, refreshInvoice, cancelInvoice, deleteInvoice } from "@/app/[locale]/admin/orders/[id]/invoice-actions";
import { generateMonthInvoices } from "@/app/[locale]/admin/clients/[id]/schedule/invoice-actions";
import { updateInvoiceAction } from "@/app/[locale]/admin/invoicing/actions";

const mocks = vi.hoisted(() => ({
  prisma: {
    invoice: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
    assignment: { findMany: vi.fn(), updateMany: vi.fn() },
    client: { findUnique: vi.fn() },
    notification: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  email: vi.fn(), pdf: vi.fn(), audit: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireRole: vi.fn(async () => ({ id: "audit-admin" })) }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/email", () => ({ sendEmailToRecipients: mocks.email }));
vi.mock("@/lib/pdf/invoice", () => ({ generateInvoicePdf: mocks.pdf }));
vi.mock("@/lib/pdf/generate-timesheets-pdf", () => ({ generateLeistungsnachweisePdf: vi.fn(async () => null) }));
vi.mock("@/lib/invoicing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/invoicing")>();
  return {
    ...actual,
    qualLabel: { pflegefachkraft: "Pflegefachkraft", pflegehelfer: "Pflegehilfskraft" },
    generateUniqueInvoiceNumber: vi.fn(async () => "AUDIT-ONLY"),
  };
});

const client = {
  id: "audit-client", userId: "audit-user", shortCode: "AUD", internalNumber: "TEST",
  facilityName: "Synthetic audit facility", address: "Synthetic address", billingEmail: "audit@example.invalid",
  billingInfo: null, hourlyRates: { pflegefachkraft: 52.8, pflegehelfer: 30 },
  surchargeSat: 0.3, surchargeSun: 0.5, surchargeHoliday: 1, surchargeNight: 0.25,
  nightStart: "22:00", nightEnd: "06:00", paymentTermsDays: 14,
};
function assignment(id: string, date: string, start: string, end: string, pause = 0,
  name = "Oso, Majed", qual = "pflegefachkraft", workerId = "worker-1") {
  return { id, workerId, status: "confirmed", invoiceId: null,
    worker: { id: workerId, fullName: name, qualification: qual },
    order: { requiredQualification: qual, shiftDate: new Date(`${date}T00:00:00Z`),
      startTime: start, endTime: end, breakMinutes: pause, client, clientId: client.id, requestGroupId: "audit-request" },
  };
}
const irregular = [assignment("a1", "2026-07-11", "06:05", "12:53"), assignment("a2", "2026-07-12", "15:19", "21:08")];
const invoice = { id: "audit-invoice", invoiceNumber: "AUDIT-ONLY", date: new Date("2026-10-08T12:00:00Z"),
  status: "unpaid", netAmount: 927.432, vatAmount: 176.21208, grossAmount: 1103.64408, snapshotData: {} };
type PdfAssignments = Parameters<typeof buildInvoicePdfData>[2];
type PdfInvoice = Parameters<typeof buildInvoicePdfData>[0];
function build(as = irregular, c = client, inv: PdfInvoice & { snapshotData?: unknown } = invoice, force = false) {
  return buildInvoicePdfData(inv as PdfInvoice, c, as as PdfAssignments, { forceRecalculate: force });
}
function price(as = irregular, c = client) {
  return requestNetTotal(as.map(a => ({ ...a.order, quantity: 1 })),
    { sat: c.surchargeSat, sun: c.surchargeSun, holiday: c.surchargeHoliday, night: c.surchargeNight },
    resolveRates(c), { start: c.nightStart, end: c.nightEnd });
}
const amount = (s: string) => Number(s.replace(" €", "").replace(/\./g, "").replace(",", "."));
function summary(d: ReturnType<typeof build>) {
  return { items: d.items, net: d.subtotal, vat: d.taxAmount, gross: d.total };
}
const results: Record<string, unknown> = {};
beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-08T12:00:00.000Z"));
});
afterAll(() => {
  try {
    writeFileSync(new URL("../implementation/invoices/phase-01/invoice-engine-simulations.phase-01.json", import.meta.url), JSON.stringify(results, null, 2) + "\n");
  } catch {
    // Ignore write errors in read-only/sandboxed review environments
  }
  vi.useRealTimers();
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.invoice.create.mockImplementation(async ({ data }) => ({ id: invoice.id, ...data }));
  mocks.prisma.invoice.update.mockImplementation(async ({ data }) => ({ ...invoice, ...data }));
  mocks.prisma.invoice.findUnique.mockResolvedValue({ ...invoice, client, assignments: irregular });
  mocks.prisma.client.findUnique.mockResolvedValue(client);
  mocks.prisma.assignment.findMany.mockResolvedValue(irregular);
  mocks.prisma.assignment.updateMany.mockResolvedValue({ count: irregular.length });
  mocks.prisma.$transaction.mockImplementation(async (ops) => Promise.all(ops));
  mocks.email.mockResolvedValue({
    smtpConfigured: true,
    totalRequested: 1,
    eligibleCount: 1,
    acceptedCount: 1,
    failedCount: 0,
    skippedCount: 0,
    unresolvedCount: 0,
    eligibleRecipients: ["audit@example.invalid"],
    acceptedRecipients: ["audit@example.invalid"],
    failedRecipients: [],
    skippedRecipients: [],
    unresolvedRecipients: [],
  });
});

describe("five requested invoice simulations", () => {
  it("TC1: printed-hour arithmetic passes, database calculation differs", () => {
    const d = build();
    expect(d.items.map((i: any) => i.amount)).toEqual(["666,34 €", "107,71 €", "153,65 €"]);
    expect([d.subtotal, d.taxAmount, d.total]).toEqual(["927,70 €", "176,26 €", "1103,96 €"]);
    expect(price()).toBeCloseTo(927.432, 8);
    results.TC1 = { window: "22:00–06:00", ...summary(d), generationNet: price(), generationVat: price() * .19, generationGross: price() * 1.19 };
  });
  it("TC1 sensitivity: default night window adds 1h08 Sunday-night surcharge", () => {
    const c = { ...client, nightStart: "20:00" };
    const d = build(irregular, c);
    expect([d.subtotal, d.taxAmount, d.total]).toEqual(["942,62 €", "179,10 €", "1121,72 €"]);
    expect(d.items.find((i: any) => i.description.startsWith("Nacht"))?.amount).toBe("14,92 €");
    results.TC1_default_night = { ...summary(d), generationNet: price(irregular, c) };
  });
  it("TC2: deterministic middle break is entirely Sunday night", () => {
    const as = [assignment("night", "2026-07-11", "20:30", "06:30", 45)];
    const c = { ...client, hourlyRates: { pflegefachkraft: 40, pflegehelfer: 30 }, surchargeSat: .25 };
    const groups = shiftSurchargeHours("2026-07-11", "20:30", "06:30", 45, () => false, { start: "22:00", end: "06:00" });
    expect(Object.fromEntries([...groups].map(([k, g]) => [k, g.hours]))).toEqual({ sat: 1.5, "sat+night": 2, "sun+night": 5.25, sun: .5 });
    const d = build(as, c);
    expect([d.subtotal, d.taxAmount, d.total]).toEqual(["592,50 €", "112,58 €", "705,08 €"]);
    results.TC2 = { break: "Sunday 01:07–01:52 (invented midpoint)", groups: Object.fromEntries(groups), ...summary(d), generationNet: price(as, c) };
  });
  it("TC3: NRW Easter/Pentecost Sundays are Sunday-only", () => {
    const c = { ...client, hourlyRates: { pflegefachkraft: 40, pflegehelfer: 30 } };
    for (const date of ["2026-04-05", "2026-05-24"]) {
      expect(germanHolidays(2026).has(date)).toBe(false);
      const d = build([assignment("holiday", date, "10:00", "13:00")], c);
      expect(d.subtotal).toBe("180,00 €");
      results[`TC3_${date}`] = summary(d);
    }
  });
  it("TC3: a recognized holiday on Sunday stacks 150% surcharge", () => {
    const as = [assignment("recognized", "2026-11-01", "10:00", "13:00")];
    const c = { ...client, hourlyRates: { pflegefachkraft: 40, pflegehelfer: 30 } };
    const d = build(as, c);
    expect([d.subtotal, d.taxAmount, d.total]).toEqual(["300,00 €", "57,00 €", "357,00 €"]);
    results.TC3_recognized = summary(d);
  });
  it("TC4: three distinct names and qualifications group and sum correctly", () => {
    const as = [assignment("w1", "2026-07-06", "10:00", "11:01", 0, "Worker A"),
      assignment("w2", "2026-07-06", "10:00", "11:01", 0, "Worker B", "pflegefachkraft", "worker-2"),
      assignment("w3", "2026-07-06", "10:00", "11:01", 0, "Worker C", "pflegehelfer", "worker-3")];
    const c = { ...client, hourlyRates: { pflegefachkraft: 40, pflegehelfer: 30 } };
    const d = build(as, c);
    expect(d.items.map((i: any) => i.amount)).toEqual(["40,80 €", "40,80 €", "30,60 €"]);
    expect(d.subtotal).toBe("112,20 €");
    expect(d.items.reduce((sum: number, i: any) => sum + Math.round(amount(i.amount) * 100), 0)).toBe(11220);
    results.TC4 = { ...summary(d), generationNet: price(as, c) };
  });
  it("TC5: ordinary zero break survives, legacy sent heuristic substitutes 30", () => {
    const as = [assignment("zero", "2026-07-06", "10:00", "13:00")];
    const c = { ...client, hourlyRates: { pflegefachkraft: 40, pflegehelfer: 30 } };
    expect(build(as, c).subtotal).toBe("120,00 €");
    const legacy = { ...invoice, netAmount: 100, snapshotData: { emailSent: { sentAt: "2026-09-01" } } };
    expect(build(as, c, legacy).subtotal).toBe("100,00 €");
    expect(build(as, c, legacy, true).subtotal).toBe("100,00 €");
    results.TC5 = { ordinary: summary(build(as, c)), legacy: summary(build(as, c, legacy)), forceLegacy: summary(build(as, c, legacy, true)) };
  });
});

describe("financial and archive defect reproductions", () => {
  it("line rounding still loses an exact decimal half cent", () => {
    const c = { ...client, hourlyRates: { pflegefachkraft: 51.25, pflegehelfer: 30 } };
    const d = build([assignment("minute", "2026-07-06", "10:00", "10:01")], c);
    expect(d.items[0]).toMatchObject({ hours: "0,02", rate: "51,25", amount: "1,02 €" });
    // Exact decimal: 2 hundredths-hour * 5125 cents/hour / 100 = 102.5 cents -> 103 cents.
    expect((BigInt(2) * BigInt(5125) + BigInt(50)) / BigInt(100)).toBe(BigInt(103));
    results.decimalTie = { ...summary(d), expectedLine: "1,03 €" };
  });
  it("VAT also loses an exact decimal half cent", () => {
    const c = { ...client, hourlyRates: { pflegefachkraft: 42.5, pflegehelfer: 30 } };
    const d = build([assignment("tax", "2026-07-06", "10:00", "11:00")], c);
    expect([d.subtotal, d.taxAmount, d.total]).toEqual(["42,50 €", "8,07 €", "50,57 €"]);
    expect((BigInt(4250) * BigInt(19) + BigInt(50)) / BigInt(100)).toBe(BigInt(808));
    results.vatTie = { ...summary(d), expectedVat: "8,08 €", expectedGross: "50,58 €" };
  });
  it("homonymous workers are merged and change money at rounding boundaries", () => {
    const as = [assignment("a", "2026-07-06", "10:00", "11:01", 0, "Same Name", "pflegefachkraft", "id-a"),
      assignment("b", "2026-07-06", "10:00", "11:01", 0, "Same Name", "pflegefachkraft", "id-b")];
    const c = { ...client, hourlyRates: { pflegefachkraft: 40, pflegehelfer: 30 } };
    const d = build(as, c);
    expect(d.items).toHaveLength(1);
    expect(d.subtotal).toBe("81,20 €");
    results.homonyms = { ...summary(d), expectedSeparateNet: "81,60 €" };
  });
  it("same worker with two qualifications stays separate", () => {
    const d = build([assignment("a", "2026-07-06", "10:00", "11:00"), assignment("b", "2026-07-06", "11:00", "12:00", 0, "Oso, Majed", "pflegehelfer")]);
    expect(d.items).toHaveLength(2);
  });
  it("frozen rows bypass all arithmetic validation and ignore isFrozen=false", () => {
    const bad = { ...invoice, snapshotData: { isFrozen: false, items: [{ pos: 1, description: "bad", hours: "12,62", rate: "52,80", amount: "666,16 €" }], subtotal: "1,00 €", taxAmount: "0,19 €", total: "1,19 €" } };
    const d = build([], client, bad);
    expect(d.subtotal).toBe("1,00 €");
    expect(d.items[0].amount).toBe("666,16 €");
    results.invalidFrozen = summary(d);
  });
  it("oversized break is silently clamped to zero hours", () => {
    const groups = shiftSurchargeHours("2026-07-06", "10:00", "11:00", 90, () => false);
    expect([...groups.values()].reduce((sum, g) => sum + g.hours, 0)).toBe(0);
    expect(netShiftHours("10:00", "11:00", 90)).toBe(0);
    expect(price([assignment("invalid", "2026-07-06", "10:00", "11:00", 90)])).toBe(0);
    results.oversizedBreak = { groupedHours: 0, netShiftHours: 0, requestNet: 0 };
  });
  it("fractional break keeps total hours but splits a minute then rescales", () => {
    const groups = shiftSurchargeHours("2026-07-06", "10:00", "11:00", .5, () => false);
    expect([...groups.values()].reduce((sum, g) => sum + g.hours, 0)).toBeCloseTo(59.5 / 60, 10);
    expect(netShiftHours("10:00", "11:00", .5)).toBeCloseTo(59.5 / 60, 10);
  });
  it("equal times silently become 24 hours", () => {
    expect(netShiftHours("10:00", "10:00", 0)).toBe(24);
  });
  it("unknown qualification silently prices at zero", () => {
    expect(price([assignment("unknown", "2026-07-06", "10:00", "13:00", 0, "Worker", "misspelled-role")])).toBe(0);
  });
  it("invoice ignores independently confirmed shorter service hours", () => {
    const as = [{ ...assignment("signed", "2026-07-06", "10:00", "18:00", 30), serviceConfirmation: { hoursWorked: 6 } }];
    const c = { ...client, hourlyRates: { pflegefachkraft: 40, pflegehelfer: 30 } };
    const d = build(as, c);
    expect(d.subtotal).toBe("300,00 €");
    results.confirmedHoursMismatch = { signedHours: 6, invoiceHours: d.items[0].hours, invoiceNet: d.subtotal, confirmedHoursBaseNet: "240,00 €" };
  });
  it("unfrozen historical invoice follows edited shift hours", () => {
    const as = [assignment("historic", "2026-07-06", "10:00", "13:00")];
    const c = { ...client, hourlyRates: { pflegefachkraft: 40, pflegehelfer: 30 } };
    const inv = { ...invoice, netAmount: 120, snapshotData: { ...c } };
    expect(build(as, c, inv).subtotal).toBe("120,00 €");
    const edited = [{ ...as[0], order: { ...as[0].order, endTime: "14:00" } }];
    expect(build(edited, c, inv).subtotal).toBe("160,00 €");
    results.historicalDrift = { before: summary(build(as, c, inv)), after: summary(build(edited, c, inv)), dbNet: inv.netAmount };
  });
  it("DST wall-clock calculation ignores spring and autumn elapsed-hour changes", () => {
    expect(netShiftHours("22:00", "06:00", 0)).toBe(8);
    const spring = (Date.parse("2026-03-29T06:00:00+02:00") - Date.parse("2026-03-28T22:00:00+01:00")) / 3600000;
    const autumn = (Date.parse("2026-10-25T06:00:00+01:00") - Date.parse("2026-10-24T22:00:00+02:00")) / 3600000;
    expect([spring, autumn]).toEqual([7, 9]);
    results.DST = { wallClockHours: 8, springElapsedHours: spring, autumnElapsedHours: autumn };
  });
});

describe("actual server actions with mocked external boundaries", () => {
  it.each(["order", "month"])("%s generation persists different DB and frozen PDF totals", async (kind) => {
    if (kind === "order") await generateOrderInvoices(irregular.map(a => a.id));
    else await generateMonthInvoices(client.id, 2026, 7);
    const createData = mocks.prisma.invoice.create.mock.calls[0][0].data;
    const frozen = mocks.prisma.invoice.update.mock.calls[0][0].data;
    expect(createData.netAmount).toBeCloseTo(927.432, 8);
    expect(frozen.snapshotData.subtotal).toBe("927,70 €");
    expect(frozen.netAmount).toBeUndefined();
    results[`${kind}_generation`] = { db: { net: createData.netAmount, vat: createData.vatAmount, gross: createData.grossAmount }, snapshot: frozen.snapshotData };
  });
  it.each(["order", "month"])("%s successful email preserves frozen snapshot with email metadata", async (kind) => {
    if (kind === "order") await generateOrderInvoices(irregular.map(a => a.id), undefined, undefined, false, true);
    else await generateMonthInvoices(client.id, 2026, 7, undefined, undefined, false, true);
    expect(mocks.email).toHaveBeenCalledOnce();
    const first = mocks.prisma.invoice.update.mock.calls[0][0].data.snapshotData;
    const last = mocks.prisma.invoice.update.mock.calls[1][0].data.snapshotData;
    expect(first.isFrozen).toBe(true);
    expect(last.items).toBeDefined();
    expect(last.items).toEqual(first.items);
    expect(last.isFrozen).toBe(true);
    expect(last.subtotal).toBe(first.subtotal);
    expect(last.taxAmount).toBe(first.taxAmount);
    expect(last.total).toBe(first.total);
    expect(last.calculationVersion).toBe("legacy-v1");
    expect(last.emailSent).toBeDefined();
    expect(last.emailSent.recipients).toContain("audit@example.invalid");
    results[`${kind}_email_snapshot_keys`] = { before: Object.keys(first), after: Object.keys(last) };
  });
  it("refresh calculates old snapshot rates then archives new client rates (reproduction blocked in Phase 6)", async () => {
    const old = { ...invoice, snapshotData: { ...client, hourlyRates: { pflegefachkraft: 40 } } };
    const live = { ...client, hourlyRates: { pflegefachkraft: 60, pflegehelfer: 30 } };
    const as = [assignment("refresh", "2026-07-06", "10:00", "13:00")];
    mocks.prisma.invoice.findUnique.mockResolvedValue({ ...old, client: live, assignments: as });
    await expect(refreshInvoice(invoice.id)).rejects.toThrow(/\[FEATURE_DISABLED\]/);
  });
  it("refresh ordinary case synchronizes money and snapshot (reproduction blocked in Phase 6)", async () => {
    await expect(refreshInvoice(invoice.id)).rejects.toThrow(/\[FEATURE_DISABLED\]/);
  });
  it("adjustment changes DB while the existing frozen PDF stays unchanged", async () => {
    const d = build();
    const frozen = { ...invoice, snapshotData: { ...client, ...d, items: d.items, isFrozen: true } };
    mocks.prisma.invoice.findUnique.mockResolvedValue({ ...frozen, client, assignments: irregular });
    const { invoice: updated } = await updateInvoiceAction({ invoiceId: invoice.id, netAdjustment: 10, adjustmentReason: "Synthetic test" });
    expect(updated.netAmount).toBe(937.43);
    expect(build(irregular, client, updated).subtotal).toBe("927,70 €");
    results.adjustment = { dbNet: updated.netAmount, pdf: summary(build(irregular, client, updated)), expectedCanonicalNet: "937,70 €" };
  });
  it("paid invoices can be refreshed and old sent metadata is retained (reproduction blocked in Phase 6)", async () => {
    mocks.prisma.invoice.findUnique.mockResolvedValue({ ...invoice, status: "paid", client, assignments: irregular, snapshotData: { emailSent: { sentAt: "2026-09-01" } } });
    await expect(refreshInvoice(invoice.id)).rejects.toThrow(/\[FEATURE_DISABLED\]/);
  });
  it("cancellation detaches all assignments without creating a reversal invoice", async () => {
    await cancelInvoice(invoice.id);
    expect(mocks.prisma.assignment.updateMany.mock.calls[0][0].data.invoiceId).toBe(null);
    expect(mocks.prisma.invoice.create).not.toHaveBeenCalled();
    expect(mocks.prisma.invoice.update.mock.calls[0][0].data.status).toBe("cancelled");
  });
  it("deletion of invoices is permanently prohibited on server", async () => {
    mocks.prisma.invoice.findUnique.mockResolvedValue({ ...invoice, status: "paid", assignments: irregular, snapshotData: { emailSent: { sentAt: "2026-09-01" } } });
    await expect(deleteInvoice(invoice.id)).rejects.toThrow("Das physische Löschen von Rechnungen ist serverseitig permanent verboten");
    expect(mocks.prisma.invoice.delete).not.toHaveBeenCalled();
  });
  it("generation claims assignments without an unbilled guard and no transaction", async () => {
    await generateOrderInvoices(irregular.map(a => a.id));
    expect(mocks.prisma.assignment.updateMany.mock.calls[0][0].where.invoiceId).toBeUndefined();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
  it("failed freeze leaves invoice creation and assignment claims already executed", async () => {
    mocks.prisma.invoice.update.mockRejectedValueOnce(new Error("Synthetic freeze failure"));
    await expect(generateOrderInvoices(irregular.map(a => a.id))).rejects.toThrow("Synthetic freeze failure");
    expect(mocks.prisma.invoice.create).toHaveBeenCalledOnce();
    expect(mocks.prisma.assignment.updateMany).toHaveBeenCalledOnce();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
});
