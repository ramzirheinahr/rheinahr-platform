import { describe, expect, it } from "vitest";
import registry from "../docs/audit/STATUTORY_MUNICIPAL_REGISTRY_2026.json";
import { isSaxonyCatholicMunicipality, resolveGermanHoliday } from "./german-holidays";
import {
  evaluateMinuteSurcharges,
  resolveInvoiceSurchargePolicy,
  type FacilitySurchargePolicyRecord,
} from "./surcharge-policy";

// AGS and Gemeinde/Gemeindeteil membership: Statistisches Landesamt Sachsen,
// https://www.statistik.sachsen.de/download/verzeichnisse/Verzeichnis_statistik-sachsen_gemeinden-gemeindeteile.pdf
// Holiday scope: https://www.revosax.sachsen.de/vorschrift/4142-FronleichnamsVO
const verifiedPartialMunicipalities = [
  { name: "Bautzen", ags: "14625020", positive: "Salzenforst", negative: "Innenstadt" },
  { name: "Göda", ags: "14625150", positive: "Prischwitz", negative: "Coblenz" },
  { name: "Großdubrau", ags: "14625160", positive: "Sdier", negative: "Großdubrau" },
  { name: "Hoyerswerda", ags: "14625240", positive: "Dörgenhausen", negative: "Hoyerswerda" },
  { name: "Königswartha", ags: "14625280", positive: "Königswartha", negative: "Wartha" },
  { name: "Neschwitz", ags: "14625360", positive: "Neschwitz", negative: null },
  { name: "Puschwitz", ags: "14625460", positive: "Puschwitz", negative: null },
  { name: "Radibor", ags: "14625490", positive: "Radibor", negative: null },
] as const;

const basePolicy: Omit<FacilitySurchargePolicyRecord, "clientId" | "municipality" | "districtLocality"> = {
  clientContractId: "contract-saxony-ags-audit",
  policyVersion: 1,
  federalState: "SN",
  surchargeSat: 0.25,
  surchargeSun: 0.5,
  surchargeHoliday: 1,
  surchargeNight: 0.25,
  nightStart: "20:00",
  nightEnd: "06:00",
  combinationRule: "highest_non_night_plus_night",
  sourceType: "contract",
  sourceReference: "FronleichnamsVO Saxony AGS audit",
  effectiveFrom: "2026-01-01",
};

function evaluate(ags: string, locality: string) {
  const policy = resolveInvoiceSurchargePolicy({
    policy: { ...basePolicy, clientId: `client-${ags}-${locality}`, municipality: ags, districtLocality: locality },
    referenceDate: "2026-06-04",
  });
  expect(policy.status).toBe("resolved");
  if (policy.status !== "resolved") throw new Error("Fixture policy did not resolve");
  return evaluateMinuteSurcharges("2026-06-04", 720, policy);
}

describe("Saxony statutory municipality and Ortsteil audit", () => {
  it("uses official AGS and matches the delivered registry for all eight partial municipalities", () => {
    expect(registry.saxony.partialMunicipalities.map((item) => [item.name, item.ags])).toEqual(
      verifiedPartialMunicipalities.map(({ name, ags }) => [name, ags]),
    );
    expect(new Set(verifiedPartialMunicipalities.map(({ ags }) => ags)).size).toBe(8);
    for (const { ags, positive, negative } of verifiedPartialMunicipalities) {
      expect(isSaxonyCatholicMunicipality(ags, positive)).toBe(true);
      expect(resolveGermanHoliday("2026-06-04", "SN", ags, undefined, positive)).toMatchObject({
        status: "resolved", isHoliday: true,
      });
      expect(evaluate(ags, positive)).toMatchObject({ status: "resolved", isHoliday: true });
      if (negative) {
        expect(isSaxonyCatholicMunicipality(ags, negative)).toBe(false);
        expect(evaluate(ags, negative)).toMatchObject({ status: "resolved", isHoliday: false });
      }
    }
  });

  it("does not give holiday rates to four AGS that belong to different municipalities", () => {
    for (const [wrongAgs, unrelatedLocality] of [
      ["14625160", "Prischwitz"], // Großdubrau, not Göda
      ["14625170", "Sdier"], // Großharthau, not Großdubrau
      ["14625270", "Truppen"], // Königsbrück, not Königswartha
      ["14625430", "Puschwitz"], // Ottendorf-Okrilla, not Puschwitz
    ]) {
      expect(resolveGermanHoliday("2026-06-04", "SN", wrongAgs, undefined, unrelatedLocality)).toMatchObject({
        status: "policy_unresolved", code: "AMBIGUOUS_MUNICIPAL_LOCATION",
      });
      expect(evaluate(wrongAgs, unrelatedLocality)).toMatchObject({
        status: "policy_unresolved", code: "AMBIGUOUS_MUNICIPAL_LOCATION",
      });
    }
  });

  it("never treats a place belonging to another municipality as a verified negative or positive", () => {
    for (const [ags, unrelatedLocality] of [
      ["14625460", "Bannewitz"], // separate municipality near Dresden
      ["14625360", "Wetro"], // Puschwitz
      ["14625160", "Quoos"], // Radibor
      ["14625490", "Caminau"], // Königswartha
      ["14625490", "Milstrich"], // Oßling
      ["14625150", "Doberschau"], // Doberschau-Gaußig
    ]) {
      expect(isSaxonyCatholicMunicipality(ags, unrelatedLocality)).toBeNull();
      expect(evaluate(ags, unrelatedLocality)).toMatchObject({
        status: "policy_unresolved", code: "AMBIGUOUS_MUNICIPAL_LOCATION",
      });
    }
  });
});
