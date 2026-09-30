import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { extractGermanZip, estimateGermanDistanceKm } from "./geocoding";

describe("geocoding postal code estimation", () => {
  it("extracts 5-digit German ZIP from various address formats", () => {
    expect(extractGermanZip("Westpreußenstr 16, 53119 Bonn")).toBe("53119");
    expect(extractGermanZip("Bahnhofstr. 24, 52385 Nideggen")).toBe("52385");
    expect(extractGermanZip("No zip here")).toBeNull();
  });

  it("calculates estimated distance correctly based on ZIP codes", () => {
    // Same ZIP
    expect(estimateGermanDistanceKm("Street 1, 53119 Bonn", "Street 2, 53119 Bonn")).toBe(5.0);

    // Same 2-digit prefix (Bonn area)
    const bonnAreaDist = estimateGermanDistanceKm("Street 1, 53115 Bonn", "Street 2, 53604 Bad Honnef");
    expect(bonnAreaDist).toBeGreaterThanOrEqual(10);
    expect(bonnAreaDist).toBeLessThanOrEqual(35);

    // Same 1-digit prefix (5xxxx - Cologne/Bonn/Aachen area)
    const nrwDist = estimateGermanDistanceKm("Street 1, 53115 Bonn", "Street 2, 50667 Köln");
    expect(nrwDist).toBe(35.0);

    // Missing ZIP fallback
    expect(estimateGermanDistanceKm("Unknown", "53115 Bonn")).toBe(25.0);
  });
});
