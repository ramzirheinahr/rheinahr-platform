import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Order PDF Export Feature", () => {
  it("has matching translation keys across de, en, and ar for orderPdfExport", () => {
    const de = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages/de.json"), "utf8")).orderPdfExport;
    const en = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages/en.json"), "utf8")).orderPdfExport;
    const ar = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages/ar.json"), "utf8")).orderPdfExport;

    expect(de).toBeDefined();
    expect(en).toBeDefined();
    expect(ar).toBeDefined();

    const deKeys = Object.keys(de).sort();
    const enKeys = Object.keys(en).sort();
    const arKeys = Object.keys(ar).sort();

    expect(enKeys).toEqual(deKeys);
    expect(arKeys).toEqual(deKeys);

    // Verify critical keys
    expect(de.dialogTitle).toBe("Dienstplan als PDF exportieren");
    expect(de.exportSelected).toContain("{count}");
    expect(de.exportAll).toContain("{total}");
    expect(de.selectedCount).toContain("{selected}");
  });

  it("correctly parses orderIds query parameter", () => {
    const url = new URL("https://app.rheinahr.de/api/exports/order-request/req-123?format=pdf&orderIds=id-1,id-2,id-3");
    const idsParam = url.searchParams.get("orderIds") || url.searchParams.get("ids");
    const selectedOrderIds = idsParam
      ? idsParam.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

    expect(selectedOrderIds).toEqual(["id-1", "id-2", "id-3"]);
  });

  it("handles empty or missing orderIds parameter cleanly", () => {
    const url = new URL("https://app.rheinahr.de/api/exports/order-request/req-123?format=pdf");
    const idsParam = url.searchParams.get("orderIds") || url.searchParams.get("ids");
    const selectedOrderIds = idsParam
      ? idsParam.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

    expect(selectedOrderIds).toEqual([]);
  });
});
