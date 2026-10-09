import { describe, it, expect } from "vitest";
import {
  getGermanHolidaysForYear,
  resolveGermanHoliday,
  calculateEasterSunday,
  calculateBussUndBettag,
  isBavarianCatholicMunicipality,
  isSaxonyCatholicMunicipality,
  isThuringianCatholicMunicipality,
  isValidGregorianCalendarDate,
} from "./german-holidays";
import {
  resolveInvoiceSurchargePolicy,
  evaluateMinuteSurcharges,
  computePolicyCanonicalHash,
  validatePolicyIntervalOverlap,
  type FacilitySurchargePolicyRecord,
  type ResolvedSurchargePolicySuccess,
} from "./surcharge-policy";
import { germanHolidays } from "./holidays";

describe("Phase 4a Acceptance Criteria Suite: Surcharge Policy & German Calendar Analyzer", () => {
  describe("1. Multi-State Federalism: Two facilities in differing Bundesländer", () => {
    it("distinguishes public holidays between Nordrhein-Westfalen (NW) and Berlin (BE) deterministically", () => {
      // 2026-06-04 is Fronleichnam (Corpus Christi - Easter + 60 days)
      // In NRW (NW): Statutory public holiday (§ 2 FTG NW)
      // In Berlin (BE): Regular working day (FTAG Berlin does not recognize Fronleichnam)
      const dateFronleichnam = "2026-06-04";

      const resNW = resolveGermanHoliday(dateFronleichnam, "NW");
      expect(resNW.status).toBe("resolved");
      if (resNW.status === "resolved") {
        expect(resNW.isHoliday).toBe(true);
        expect(resNW.holiday?.name).toBe("Fronleichnam");
        expect(resNW.holiday?.isNationwide).toBe(false);
      }

      const resBE = resolveGermanHoliday(dateFronleichnam, "BE");
      expect(resBE.status).toBe("resolved");
      if (resBE.status === "resolved") {
        expect(resBE.isHoliday).toBe(false);
        expect(resBE.holiday).toBeUndefined();
      }

      // 2026-03-08 is Internationaler Frauentag
      // In Berlin (BE): Statutory public holiday (§ 1 FTAG Berlin)
      // In NRW (NW): Regular day
      const dateFrauentag = "2026-03-08";

      const resFrauentagBE = resolveGermanHoliday(dateFrauentag, "BE");
      expect(resFrauentagBE.status).toBe("resolved");
      if (resFrauentagBE.status === "resolved") {
        expect(resFrauentagBE.isHoliday).toBe(true);
        expect(resFrauentagBE.holiday?.name).toBe("Internationaler Frauentag");
      }

      const resFrauentagNW = resolveGermanHoliday(dateFrauentag, "NW");
      expect(resFrauentagNW.status).toBe("resolved");
      if (resFrauentagNW.status === "resolved") {
        expect(resFrauentagNW.isHoliday).toBe(false);
      }

      // Verify getGermanHolidaysForYear full year generation
      const allNWHolidays = getGermanHolidaysForYear({ year: 2026, federalState: "NW" });
      expect(allNWHolidays.size).toBe(11);
    });

    it("distinguishes Sachsen (SN) Buß- und Bettag and Heilige Drei Könige in Bayern (BY)", () => {
      // Buß- und Bettag 2026: Wednesday Nov 18, 2026
      const bussUndBettag2026 = calculateBussUndBettag(2026);
      expect(bussUndBettag2026).toBe("2026-11-18");

      const resSN = resolveGermanHoliday(bussUndBettag2026, "SN");
      expect(resSN.status).toBe("resolved");
      if (resSN.status === "resolved") {
        expect(resSN.isHoliday).toBe(true);
        expect(resSN.holiday?.name).toBe("Buß- und Bettag");
      }

      const resNW = resolveGermanHoliday(bussUndBettag2026, "NW");
      expect(resNW.status).toBe("resolved");
      if (resNW.status === "resolved") {
        expect(resNW.isHoliday).toBe(false);
      }

      // Heilige Drei Könige: Jan 6, 2026
      const resBY = resolveGermanHoliday("2026-01-06", "BY");
      expect(resBY.status).toBe("resolved");
      if (resBY.status === "resolved") {
        expect(resBY.isHoliday).toBe(true);
        expect(resBY.holiday?.name).toBe("Heilige Drei Könige");
      }

      const resHH = resolveGermanHoliday("2026-01-06", "HH");
      expect(resHH.status).toBe("resolved");
      if (resHH.status === "resolved") {
        expect(resHH.isHoliday).toBe(false);
      }
    });
  });

  describe("2. Sunday Coinciding with a Public Holiday", () => {
    it("handles Allerheiligen 2026-11-01 falling on a Sunday", () => {
      // 2026-11-01 is Sunday
      const policyNW: FacilitySurchargePolicyRecord = {
        clientId: "client-nw-1",
        clientContractId: "contract-nw-1",
        policyVersion: 1,
        federalState: "NW",
        surchargeSat: 0.25,
        surchargeSun: 0.5,
        surchargeHoliday: 1.0,
        surchargeNight: 0.25,
        nightStart: "20:00",
        nightEnd: "06:00",
        combinationRule: "highest_non_night_plus_night",
        sourceType: "contract",
        sourceReference: "Rahmenvertrag § 16 v. 01.01.2026",
        effectiveFrom: "2026-01-01",
      };

      const resolved = resolveInvoiceSurchargePolicy({
        policy: policyNW,
        referenceDate: "2026-11-01",
      });
      expect(resolved.status).toBe("resolved");
      const resSuccess = resolved as ResolvedSurchargePolicySuccess;

      // Daylight minute: 12:00 (minute 720) on 2026-11-01 (Allerheiligen on Sunday)
      const daylightEval = evaluateMinuteSurcharges("2026-11-01", 720, resSuccess);
      expect(daylightEval.status).toBe("resolved");
      if (daylightEval.status === "resolved") {
        expect(daylightEval.isSunday).toBe(true);
        expect(daylightEval.isHoliday).toBe(true);
        expect(daylightEval.holidayRecord?.name).toBe("Allerheiligen");
        expect(daylightEval.isNight).toBe(false);

        // Under highest_non_night_plus_night: Holiday (100%) wins over Sunday (50%)
        expect(daylightEval.effectiveSurchargeFraction).toBe(1.0);
        expect(daylightEval.rateMultiplier).toBe(2.0);
        expect(daylightEval.breakdownDescriptionDE).toContain("Feiertagszuschlag (Allerheiligen +100%)");
        expect(daylightEval.breakdownDescriptionDE).not.toContain("Sonntagszuschlag");
      }

      // Night minute: 22:30 (minute 1350) on 2026-11-01 (Allerheiligen + Sunday + Night)
      const nightEval = evaluateMinuteSurcharges("2026-11-01", 1350, resSuccess);
      expect(nightEval.status).toBe("resolved");
      if (nightEval.status === "resolved") {
        expect(nightEval.isSunday).toBe(true);
        expect(nightEval.isHoliday).toBe(true);
        expect(nightEval.isNight).toBe(true);
        // Under highest_non_night_plus_night: max(Holiday 100%, Sunday 50%) + Night 25% = 125%
        expect(nightEval.effectiveSurchargeFraction).toBe(1.25);
        expect(nightEval.rateMultiplier).toBe(2.25);
      }
    });

    it("Brandenburg (BB) explicitly legislates Ostersonntag as statutory holiday", () => {
      // Easter Sunday 2026 is 2026-04-05
      const easter2026 = calculateEasterSunday(2026);
      expect(easter2026).toEqual({ year: 2026, month: 4, day: 5 });

      const resBB = resolveGermanHoliday("2026-04-05", "BB");
      expect(resBB.status).toBe("resolved");
      if (resBB.status === "resolved") {
        expect(resBB.isHoliday).toBe(true);
        expect(resBB.holiday?.name).toBe("Ostersonntag");
      }

      // In NRW, Ostersonntag is a calendar Sunday, but not a statutory public holiday by FTG NW
      const resNW = resolveGermanHoliday("2026-04-05", "NW");
      expect(resNW.status).toBe("resolved");
      if (resNW.status === "resolved") {
        expect(resNW.isHoliday).toBe(false);
      }
    });
  });

  describe("3. Documented Municipal Exceptions & Bavarian Confessional Ambiguity", () => {
    it("recognizes Augsburger Hohes Friedensfest on August 8 only in Augsburg (BY)", () => {
      // 2026-08-08 in Augsburg, BY
      const resAugsburg = resolveGermanHoliday("2026-08-08", "BY", "Augsburg");
      expect(resAugsburg.status).toBe("resolved");
      if (resAugsburg.status === "resolved") {
        expect(resAugsburg.isHoliday).toBe(true);
        expect(resAugsburg.holiday?.name).toBe("Augsburger Hohes Friedensfest");
        expect(resAugsburg.holiday?.municipality).toBe("Augsburg");
      }

      // 2026-08-08 in München, BY (not a holiday)
      const resMunich = resolveGermanHoliday("2026-08-08", "BY", "München");
      expect(resMunich.status).toBe("resolved");
      if (resMunich.status === "resolved") {
        expect(resMunich.isHoliday).toBe(false);
      }
    });

    it("resolves Mariä Himmelfahrt (15.08.) for Catholic municipality and rejects ambiguous location with diagnostic error", () => {
      // In Catholic municipality (München, BY): Resolved as Holiday
      const resMunich = resolveGermanHoliday("2026-08-15", "BY", "München");
      expect(resMunich.status).toBe("resolved");
      if (resMunich.status === "resolved") {
        expect(resMunich.isHoliday).toBe(true);
        expect(resMunich.holiday?.name).toBe("Mariä Himmelfahrt");
      }

      // In predominantly Protestant municipality (Nürnberg, BY): Resolved as NOT a holiday
      const resNuremberg = resolveGermanHoliday("2026-08-15", "BY", "Nürnberg");
      expect(resNuremberg.status).toBe("resolved");
      if (resNuremberg.status === "resolved") {
        expect(resNuremberg.isHoliday).toBe(false);
      }

      // Missing or unknown municipality in Bavaria on August 15: Returns policy_unresolved rather than guessing!
      const resAmbiguous = resolveGermanHoliday("2026-08-15", "BY", null);
      expect(resAmbiguous.status).toBe("policy_unresolved");
      if (resAmbiguous.status === "policy_unresolved") {
        expect(resAmbiguous.code).toBe("AMBIGUOUS_MUNICIPAL_LOCATION");
        expect(resAmbiguous.diagnostics.reason).toContain("Mariä Himmelfahrt");
      }

      // Explicit failure in evaluateMinuteSurcharges: ambiguous Bavarian municipality must NOT default to regular day / 1.0x
      const policyBYAmbiguous: FacilitySurchargePolicyRecord = {
        clientId: "client-by-ambiguous",
        clientContractId: "contract-by-ambiguous",
        policyVersion: 1,
        federalState: "BY",
        municipality: "UnbekannteGemeinde",
        surchargeSat: 0.25,
        surchargeSun: 0.5,
        surchargeHoliday: 1.0,
        surchargeNight: 0.25,
        nightStart: "20:00",
        nightEnd: "06:00",
        combinationRule: "highest_non_night_plus_night",
        sourceType: "contract",
        sourceReference: "Vertrag Bayern § 4",
        effectiveFrom: "2026-01-01",
      };
      const resolvedBYAmbiguous = resolveInvoiceSurchargePolicy({
        policy: policyBYAmbiguous,
        referenceDate: "2026-08-15",
      }) as ResolvedSurchargePolicySuccess;

      const evalBYAmbiguous = evaluateMinuteSurcharges("2026-08-15", 720, resolvedBYAmbiguous);
      expect(evalBYAmbiguous.status).toBe("policy_unresolved");
      if (evalBYAmbiguous.status === "policy_unresolved") {
        expect(evalBYAmbiguous.code).toBe("AMBIGUOUS_MUNICIPAL_LOCATION");
        expect(evalBYAmbiguous.message).toContain("Mariä Himmelfahrt");
      }

      // Official Amtlicher Gemeindeschlüssel (AGS) support for Bavaria (Zensus 2022)
      const resMunichAgs = resolveGermanHoliday("2026-08-15", "BY", "09162000"); // München AGS
      expect(resMunichAgs.status).toBe("resolved");
      if (resMunichAgs.status === "resolved") {
        expect(resMunichAgs.isHoliday).toBe(true);
      }

      const resNurembergAgs = resolveGermanHoliday("2026-08-15", "BY", "09564000"); // Nürnberg AGS
      expect(resNurembergAgs.status).toBe("resolved");
      if (resNurembergAgs.status === "resolved") {
        expect(resNurembergAgs.isHoliday).toBe(false);
      }

      // In Saarland (SL): Landesweit gesetzlicher Feiertag (no municipality needed)
      const resSL = resolveGermanHoliday("2026-08-15", "SL", null);
      expect(resSL.status).toBe("resolved");
      if (resSL.status === "resolved") {
        expect(resSL.isHoliday).toBe(true);
        expect(resSL.holiday?.name).toBe("Mariä Himmelfahrt");
      }

      // Verify isBavarianCatholicMunicipality helper directly
      expect(isBavarianCatholicMunicipality("München")).toBe(true);
      expect(isBavarianCatholicMunicipality("09162000")).toBe(true);
      expect(isBavarianCatholicMunicipality("Nürnberg")).toBe(false);
      expect(isBavarianCatholicMunicipality("09564000")).toBe(false);
      expect(isBavarianCatholicMunicipality("Unbekannte Gemeinde")).toBeNull();
    });

    it("evaluates statutory local Fronleichnam exceptions in Saxony (SN) and Thuringia (TH) with precise AGS and Ortsteil rules", () => {
      // 2026-06-04 is Fronleichnam
      const fronleichnam2026 = "2026-06-04";

      // 1. Saxony (SN) - Statutory full Catholic municipalities in Landkreis Bautzen:
      // Crostwitz (AGS: 14625080)
      const resCrostwitz = resolveGermanHoliday(fronleichnam2026, "SN", "Crostwitz");
      expect(resCrostwitz.status).toBe("resolved");
      if (resCrostwitz.status === "resolved") {
        expect(resCrostwitz.isHoliday).toBe(true);
        expect(resCrostwitz.holiday?.name).toBe("Fronleichnam");
      }
      const resCrostwitzAgs = resolveGermanHoliday(fronleichnam2026, "SN", "14625080");
      expect(resCrostwitzAgs.status).toBe("resolved");
      if (resCrostwitzAgs.status === "resolved") {
        expect(resCrostwitzAgs.isHoliday).toBe(true);
      }

      // Panschwitz-Kuckau (AGS: 14625440)
      const resPanschwitz = resolveGermanHoliday(fronleichnam2026, "SN", "Panschwitz-Kuckau");
      expect(resPanschwitz.status).toBe("resolved");
      if (resPanschwitz.status === "resolved") {
        expect(resPanschwitz.isHoliday).toBe(true);
      }
      const resPanschwitzAgs = resolveGermanHoliday(fronleichnam2026, "SN", "14625440");
      expect(resPanschwitzAgs.status).toBe("resolved");
      if (resPanschwitzAgs.status === "resolved") {
        expect(resPanschwitzAgs.isHoliday).toBe(true);
      }

      // 2. Strict Saxony Counter-Tests: Cunewalde (14625090) and Obergurig (14625390) are NOT statutory holiday locations!
      const resCunewalde = resolveGermanHoliday(fronleichnam2026, "SN", "14625090");
      expect(resCunewalde.status).toBe("resolved");
      if (resCunewalde.status === "resolved") {
        expect(resCunewalde.isHoliday).toBe(false);
      }

      const resObergurig = resolveGermanHoliday(fronleichnam2026, "SN", "14625390");
      expect(resObergurig.status).toBe("resolved");
      if (resObergurig.status === "resolved") {
        expect(resObergurig.isHoliday).toBe(false);
      }

      const resPulsnitz = resolveGermanHoliday(fronleichnam2026, "SN", "14625450");
      expect(resPulsnitz.status).toBe("resolved");
      if (resPulsnitz.status === "resolved") {
        expect(resPulsnitz.isHoliday).toBe(false);
      }

      // 3. Bautzen (14625020) sub-municipal Ortsteil precision:
      // Bautzen without Ortsteil MUST return policy_unresolved (AMBIGUOUS_MUNICIPAL_LOCATION)
      const resBautzenNoLocality = resolveGermanHoliday(fronleichnam2026, "SN", "Bautzen");
      expect(resBautzenNoLocality.status).toBe("policy_unresolved");
      if (resBautzenNoLocality.status === "policy_unresolved") {
        expect(resBautzenNoLocality.code).toBe("AMBIGUOUS_MUNICIPAL_LOCATION");
        expect(resBautzenNoLocality.message).toContain("Bolbritz und Salzenforst");
      }

      const resBautzenAgsNoLocality = resolveGermanHoliday(fronleichnam2026, "SN", "14625020");
      expect(resBautzenAgsNoLocality.status).toBe("policy_unresolved");
      if (resBautzenAgsNoLocality.status === "policy_unresolved") {
        expect(resBautzenAgsNoLocality.code).toBe("AMBIGUOUS_MUNICIPAL_LOCATION");
      }

      // Bautzen with Ortsteil Salzenforst or Bolbritz -> Statutory Holiday (true)
      const resBautzenSalzenforst = resolveGermanHoliday(fronleichnam2026, "SN", "Bautzen", undefined, "Salzenforst");
      expect(resBautzenSalzenforst.status).toBe("resolved");
      if (resBautzenSalzenforst.status === "resolved") {
        expect(resBautzenSalzenforst.isHoliday).toBe(true);
      }

      const resBautzenBolbritz = resolveGermanHoliday(fronleichnam2026, "SN", "14625020", undefined, "Bolbritz");
      expect(resBautzenBolbritz.status).toBe("resolved");
      if (resBautzenBolbritz.status === "resolved") {
        expect(resBautzenBolbritz.isHoliday).toBe(true);
      }

      // Bautzen with other Ortsteil (e.g. Innenstadt) -> Regular workday (false)
      const resBautzenInnenstadt = resolveGermanHoliday(fronleichnam2026, "SN", "Bautzen", undefined, "Innenstadt");
      expect(resBautzenInnenstadt.status).toBe("resolved");
      if (resBautzenInnenstadt.status === "resolved") {
        expect(resBautzenInnenstadt.isHoliday).toBe(false);
      }

      // 4. Non-qualifying municipality in Saxony (e.g. Dresden)
      const resDresden = resolveGermanHoliday(fronleichnam2026, "SN", "Dresden");
      expect(resDresden.status).toBe("resolved");
      if (resDresden.status === "resolved") {
        expect(resDresden.isHoliday).toBe(false);
      }

      // Ambiguous municipality in Saxony on Fronleichnam must return policy_unresolved rather than regular day!
      const resSNAmbiguous = resolveGermanHoliday(fronleichnam2026, "SN", null);
      expect(resSNAmbiguous.status).toBe("policy_unresolved");
      if (resSNAmbiguous.status === "policy_unresolved") {
        expect(resSNAmbiguous.code).toBe("AMBIGUOUS_MUNICIPAL_LOCATION");
        expect(resSNAmbiguous.message).toContain("Fronleichnam im Freistaat Sachsen");
      }

      // 5. Thuringia (TH) - ThürFtG § 2 Abs. 2:
      // Statutory holiday in the entire Landkreis Eichsfeld (AGS prefix 16061)
      const resHeiligenstadt = resolveGermanHoliday(fronleichnam2026, "TH", "Heilbad Heiligenstadt");
      expect(resHeiligenstadt.status).toBe("resolved");
      if (resHeiligenstadt.status === "resolved") {
        expect(resHeiligenstadt.isHoliday).toBe(true);
        expect(resHeiligenstadt.holiday?.name).toBe("Fronleichnam");
      }

      const resHeiligenstadtAgs = resolveGermanHoliday(fronleichnam2026, "TH", "16061045");
      expect(resHeiligenstadtAgs.status).toBe("resolved");
      if (resHeiligenstadtAgs.status === "resolved") {
        expect(resHeiligenstadtAgs.isHoliday).toBe(true);
      }

      const resEichsfeld = resolveGermanHoliday(fronleichnam2026, "TH", "Landkreis Eichsfeld");
      expect(resEichsfeld.status).toBe("resolved");
      if (resEichsfeld.status === "resolved") {
        expect(resEichsfeld.isHoliday).toBe(true);
      }

      // Official Thuringian register keys for kreisfreie Städte (Erfurt: 16051000, Jena: 16053000)
      const resErfurt = resolveGermanHoliday(fronleichnam2026, "TH", "Erfurt");
      expect(resErfurt.status).toBe("resolved");
      if (resErfurt.status === "resolved") {
        expect(resErfurt.isHoliday).toBe(false);
      }

      const resErfurtAgs = resolveGermanHoliday(fronleichnam2026, "TH", "16051000");
      expect(resErfurtAgs.status).toBe("resolved");
      if (resErfurtAgs.status === "resolved") {
        expect(resErfurtAgs.isHoliday).toBe(false);
      }

      const resJenaAgs = resolveGermanHoliday(fronleichnam2026, "TH", "16053000");
      expect(resJenaAgs.status).toBe("resolved");
      if (resJenaAgs.status === "resolved") {
        expect(resJenaAgs.isHoliday).toBe(false);
      }

      // Ambiguous municipality in Thuringia on Fronleichnam must return policy_unresolved rather than regular day!
      const resTHAmbiguous = resolveGermanHoliday(fronleichnam2026, "TH", null);
      expect(resTHAmbiguous.status).toBe("policy_unresolved");
      if (resTHAmbiguous.status === "policy_unresolved") {
        expect(resTHAmbiguous.code).toBe("AMBIGUOUS_MUNICIPAL_LOCATION");
        expect(resTHAmbiguous.message).toContain("Fronleichnam im Freistaat Thüringen");
      }

      // Direct helper assertions
      expect(isSaxonyCatholicMunicipality("Crostwitz")).toBe(true);
      expect(isSaxonyCatholicMunicipality("14625080")).toBe(true);
      expect(isSaxonyCatholicMunicipality("14625090")).toBe(false); // Cunewalde
      expect(isSaxonyCatholicMunicipality("14625390")).toBe(false); // Obergurig
      expect(isSaxonyCatholicMunicipality("14625340")).toBeNull(); // Malschwitz (NOT a Fronleichnam municipality in VO)
      expect(isSaxonyCatholicMunicipality("14625620")).toBeNull(); // Undocumented/historic key
      expect(isSaxonyCatholicMunicipality("Bautzen")).toBeNull();
      expect(isSaxonyCatholicMunicipality("Bautzen", "Salzenforst")).toBe(true);
      expect(isSaxonyCatholicMunicipality("Bautzen", "Innenstadt")).toBe(false);
      expect(isSaxonyCatholicMunicipality("Dresden")).toBe(false);
      expect(isSaxonyCatholicMunicipality(null)).toBeNull();

      // Counter-tests: SN Malschwitz (14625340) and undocumented (14625620) must be policy_unresolved
      const resMalschwitz = resolveGermanHoliday(fronleichnam2026, "SN", "14625340");
      expect(resMalschwitz.status).toBe("policy_unresolved");
      if (resMalschwitz.status === "policy_unresolved") {
        expect(resMalschwitz.code).toBe("AMBIGUOUS_MUNICIPAL_LOCATION");
      }

      const resSnOldKey = resolveGermanHoliday(fronleichnam2026, "SN", "14625620");
      expect(resSnOldKey.status).toBe("policy_unresolved");
      if (resSnOldKey.status === "policy_unresolved") {
        expect(resSnOldKey.code).toBe("AMBIGUOUS_MUNICIPAL_LOCATION");
      }

      // Thuringia verified 2026 TLS statutory registry assertions
      expect(isThuringianCatholicMunicipality("Heilbad Heiligenstadt")).toBe(true);
      expect(isThuringianCatholicMunicipality("16061045")).toBe(true);
      expect(isThuringianCatholicMunicipality("Dingelstädt")).toBe(true);
      expect(isThuringianCatholicMunicipality("16061118")).toBe(true); // Dingelstädt 2026 TLS key
      expect(isThuringianCatholicMunicipality("Südeichsfeld")).toBe(true);
      expect(isThuringianCatholicMunicipality("16064074")).toBe(true); // Südeichsfeld official key
      expect(isThuringianCatholicMunicipality("Schleid")).toBe(true);
      expect(isThuringianCatholicMunicipality("16063068")).toBe(true); // Schleid official key
      expect(isThuringianCatholicMunicipality("Buttlar")).toBe(true);
      expect(isThuringianCatholicMunicipality("16063011")).toBe(true); // Buttlar official key
      expect(isThuringianCatholicMunicipality("Geisa")).toBe(true);
      expect(isThuringianCatholicMunicipality("16063032")).toBe(true); // Geisa official key

      // Non-qualifying / historic / dummy keys in Thuringia
      expect(isThuringianCatholicMunicipality("16064058")).toBeNull(); // Historic Schönstedt (NOT Südeichsfeld)
      expect(isThuringianCatholicMunicipality("16061199")).toBeNull(); // Non-existent dummy Eichsfeld key
      expect(isThuringianCatholicMunicipality("not-eichsfeld")).toBeNull(); // Substring must not match
      expect(isThuringianCatholicMunicipality("Seebach")).toBe(false);
      expect(isThuringianCatholicMunicipality("16063071")).toBe(false); // Seebach (Wartburgkreis)
      expect(isThuringianCatholicMunicipality("Erfurt")).toBe(false);
      expect(isThuringianCatholicMunicipality("16051000")).toBe(false);
      expect(isThuringianCatholicMunicipality("16053000")).toBe(false);
      expect(isThuringianCatholicMunicipality(null)).toBeNull();

      // Counter-tests in resolveGermanHoliday:
      const resThSchoenstedt = resolveGermanHoliday(fronleichnam2026, "TH", "16064058");
      expect(resThSchoenstedt.status).toBe("policy_unresolved");
      if (resThSchoenstedt.status === "policy_unresolved") {
        expect(resThSchoenstedt.code).toBe("AMBIGUOUS_MUNICIPAL_LOCATION");
      }

      const resThDummy = resolveGermanHoliday(fronleichnam2026, "TH", "16061199");
      expect(resThDummy.status).toBe("policy_unresolved");
      if (resThDummy.status === "policy_unresolved") {
        expect(resThDummy.code).toBe("AMBIGUOUS_MUNICIPAL_LOCATION");
      }

      const resThSubstring = resolveGermanHoliday(fronleichnam2026, "TH", "not-eichsfeld");
      expect(resThSubstring.status).toBe("policy_unresolved");
      if (resThSubstring.status === "policy_unresolved") {
        expect(resThSubstring.code).toBe("AMBIGUOUS_MUNICIPAL_LOCATION");
      }

      // Positive statutory holiday resolutions in Thuringia:
      const resDingelstaedt = resolveGermanHoliday(fronleichnam2026, "TH", "16061118");
      expect(resDingelstaedt.status).toBe("resolved");
      if (resDingelstaedt.status === "resolved") {
        expect(resDingelstaedt.isHoliday).toBe(true);
      }

      const resSuedeichsfeld = resolveGermanHoliday(fronleichnam2026, "TH", "16064074");
      expect(resSuedeichsfeld.status).toBe("resolved");
      if (resSuedeichsfeld.status === "resolved") {
        expect(resSuedeichsfeld.isHoliday).toBe(true);
      }

      const resSchleid = resolveGermanHoliday(fronleichnam2026, "TH", "16063068");
      expect(resSchleid.status).toBe("resolved");
      if (resSchleid.status === "resolved") {
        expect(resSchleid.isHoliday).toBe(true);
      }

      const resSeebach = resolveGermanHoliday(fronleichnam2026, "TH", "16063071");
      expect(resSeebach.status).toBe("resolved");
      if (resSeebach.status === "resolved") {
        expect(resSeebach.isHoliday).toBe(false);
      }
    });

    it("supports documented custom contract/facility exceptions", () => {
      const customExceptions = [
        {
          date: "2026-12-24",
          name: "Heiligabend (Betriebsvereinbarung)",
          legalBasis: "Haustarifvertrag § 4 Abs. 2",
          action: "include" as const,
        },
      ];

      const res = resolveGermanHoliday("2026-12-24", "NW", null, customExceptions);
      expect(res.status).toBe("resolved");
      if (res.status === "resolved") {
        expect(res.isHoliday).toBe(true);
        expect(res.holiday?.name).toBe("Heiligabend (Betriebsvereinbarung)");
        expect(res.holiday?.isCustomException).toBe(true);
      }
    });
  });

  describe("4. Surcharge Overlap Rules: Highest Non-Night + Night vs Cumulative", () => {
    it("proves mathematical divergence between highest_non_night_plus_night and cumulative rules", () => {
      // Facility policy with highest_non_night_plus_night
      const policyHighest: FacilitySurchargePolicyRecord = {
        clientId: "client-rule-test",
        clientContractId: "contract-rule-test",
        policyVersion: 1,
        federalState: "NW",
        surchargeSat: 0.25,
        surchargeSun: 0.5,
        surchargeHoliday: 1.0,
        surchargeNight: 0.25,
        nightStart: "20:00",
        nightEnd: "06:00",
        combinationRule: "highest_non_night_plus_night",
        sourceType: "contract",
        sourceReference: "Rahmenvertrag § 16 Abs. 2 (Standard)",
        effectiveFrom: "2026-01-01",
      };

      // Facility policy with cumulative rule explicitly agreed
      const policyCumulative: FacilitySurchargePolicyRecord = {
        ...policyHighest,
        policyVersion: 2,
        combinationRule: "cumulative",
        sourceReference: "Sondervereinbarung Anlage B (Kumulativ)",
      };

      const resolvedHighest = resolveInvoiceSurchargePolicy({
        policy: policyHighest,
        referenceDate: "2026-11-01",
      }) as ResolvedSurchargePolicySuccess;

      const resolvedCumulative = resolveInvoiceSurchargePolicy({
        policy: policyCumulative,
        referenceDate: "2026-11-01",
      }) as ResolvedSurchargePolicySuccess;

      // Minute 1350 (22:30 on 2026-11-01 = Allerheiligen + Sunday + Night)
      const evalHighest = evaluateMinuteSurcharges("2026-11-01", 1350, resolvedHighest);
      const evalCumulative = evaluateMinuteSurcharges("2026-11-01", 1350, resolvedCumulative);

      expect(evalHighest.status).toBe("resolved");
      expect(evalCumulative.status).toBe("resolved");

      if (evalHighest.status === "resolved" && evalCumulative.status === "resolved") {
        // Rule 1: Highest non-night (Holiday 100%) + Night (25%) = 125% -> Multiplier 2.25
        expect(evalHighest.effectiveSurchargeFraction).toBe(1.25);
        expect(evalHighest.rateMultiplier).toBe(2.25);
        expect(evalHighest.breakdownDescriptionDE).toBe(
          "Feiertagszuschlag (Allerheiligen +100%) + Nachtzuschlag (+25%)"
        );

        // Rule 2: Cumulative (Holiday 100% + Sunday 50% + Night 25%) = 175% -> Multiplier 2.75
        expect(evalCumulative.effectiveSurchargeFraction).toBe(1.75);
        expect(evalCumulative.rateMultiplier).toBe(2.75);
        expect(evalCumulative.breakdownDescriptionDE).toBe(
          "Feiertag (+100%) + Sonntag (+50%) + Nacht (+25%)"
        );

        // Difference is exactly the 50% Sunday surcharge that was superseded under the highest rule!
        expect(evalCumulative.effectiveSurchargeFraction - evalHighest.effectiveSurchargeFraction).toBe(0.5);
      }
    });
  });

  describe("5. Policy Lifecycle, Effective Dates, and Expiration Diagnostics", () => {
    const basePolicy: FacilitySurchargePolicyRecord = {
      clientId: "client-lifecycle-1",
      clientContractId: "contract-lifecycle-1",
      policyVersion: 1,
      federalState: "BY",
      municipality: "München",
      surchargeSat: 0.25,
      surchargeSun: 0.5,
      surchargeHoliday: 1.0,
      surchargeNight: 0.25,
      nightStart: "20:00",
      nightEnd: "06:00",
      combinationRule: "highest_non_night_plus_night",
      sourceType: "contract",
      sourceReference: "Vertrag 2026-Q1/Q2",
      effectiveFrom: "2026-01-01",
      effectiveTo: "2026-06-30",
    };

    it("rejects shifts before effectiveFrom with POLICY_NOT_YET_EFFECTIVE", () => {
      const res = resolveInvoiceSurchargePolicy({
        policy: basePolicy,
        referenceDate: "2025-12-31",
      });
      expect(res.status).toBe("policy_unresolved");
      if (res.status === "policy_unresolved") {
        expect(res.code).toBe("POLICY_NOT_YET_EFFECTIVE");
        expect(res.message).toContain("noch nicht in Kraft");
      }
    });

    it("resolves shifts within the effective validity window", () => {
      const res = resolveInvoiceSurchargePolicy({
        policy: basePolicy,
        referenceDate: "2026-03-15",
      });
      expect(res.status).toBe("resolved");
      if (res.status === "resolved") {
        expect(res.policyVersion).toBe(1);
        expect(res.effectiveFrom).toBe("2026-01-01");
        expect(res.effectiveTo).toBe("2026-06-30");
      }
    });

    it("rejects inverted date intervals with INVALID_DATE_INTERVAL", () => {
      const invertedPolicy: FacilitySurchargePolicyRecord = {
        clientId: "client-inverted",
        clientContractId: "contract-inverted-1",
        policyVersion: 1,
        federalState: "NW",
        surchargeSat: 0.25,
        surchargeSun: 0.5,
        surchargeHoliday: 1.0,
        surchargeNight: 0.25,
        nightStart: "20:00",
        nightEnd: "06:00",
        combinationRule: "highest_non_night_plus_night",
        sourceType: "contract",
        sourceReference: "Vertrag",
        effectiveFrom: "2026-12-31",
        effectiveTo: "2026-01-01", // Before effectiveFrom!
      };

      const res = resolveInvoiceSurchargePolicy({
        policy: invertedPolicy,
        referenceDate: "2026-06-01",
      });
      expect(res.status).toBe("policy_unresolved");
      if (res.status === "policy_unresolved") {
        expect(res.code).toBe("INVALID_DATE_INTERVAL");
        expect(res.message).toContain("darf nicht nach effectiveTo");
      }
    });

    it("evaluates minute bounds and expiration during minute evaluation", () => {
      const resolved = resolveInvoiceSurchargePolicy({
        policy: basePolicy,
        referenceDate: "2026-06-30",
      }) as ResolvedSurchargePolicySuccess;

      // Minute out of bounds: -1
      const evalNeg = evaluateMinuteSurcharges("2026-06-30", -1, resolved);
      expect(evalNeg.status).toBe("policy_unresolved");
      if (evalNeg.status === "policy_unresolved") {
        expect(evalNeg.code).toBe("INVALID_MINUTE_OF_DAY");
      }

      // Minute out of bounds: 1440
      const evalOver = evaluateMinuteSurcharges("2026-06-30", 1440, resolved);
      expect(evalOver.status).toBe("policy_unresolved");
      if (evalOver.status === "policy_unresolved") {
        expect(evalOver.code).toBe("INVALID_MINUTE_OF_DAY");
      }

      // Minute on day crossing after policy expiration (effectiveTo was 2026-06-30)
      const evalExpired = evaluateMinuteSurcharges("2026-07-01", 30, resolved);
      expect(evalExpired.status).toBe("policy_unresolved");
      if (evalExpired.status === "policy_unresolved") {
        expect(evalExpired.code).toBe("POLICY_EXPIRED");
        expect(evalExpired.message).toContain("abgelaufen");
      }
    });
  });

  describe("6. Strict Non-Guessing Policy: Missing or Corrupted Configurations", () => {
    it("returns MISSING_POLICY_RECORD when policy is null or undefined without guessing NRW", () => {
      const resNull = resolveInvoiceSurchargePolicy({
        policy: null,
        referenceDate: "2026-05-01",
      });
      expect(resNull.status).toBe("policy_unresolved");
      if (resNull.status === "policy_unresolved") {
        expect(resNull.code).toBe("MISSING_POLICY_RECORD");
        expect(resNull.message).toContain("Automatische Schätzungen oder Default-Bundesländer sind unzulässig");
      }
    });

    it("rejects policy missing mandatory policyVersion with MISSING_POLICY_VERSION", () => {
      const missingVersionPolicy: FacilitySurchargePolicyRecord = {
        clientId: "client-no-version",
        federalState: "NW",
        surchargeSat: 0.25,
        surchargeSun: 0.5,
        surchargeHoliday: 1.0,
        surchargeNight: 0.25,
        nightStart: "20:00",
        nightEnd: "06:00",
        combinationRule: "highest_non_night_plus_night",
        sourceType: "contract",
        sourceReference: "Vertrag",
        effectiveFrom: "2026-01-01",
      };

      const res = resolveInvoiceSurchargePolicy({
        policy: missingVersionPolicy,
        referenceDate: "2026-05-01",
      });
      expect(res.status).toBe("policy_unresolved");
      if (res.status === "policy_unresolved") {
        expect(res.code).toBe("MISSING_POLICY_VERSION");
      }
    });

    it("rejects invalid or unknown federal state with UNKNOWN_FEDERAL_STATE", () => {
      const invalidStatePolicy: FacilitySurchargePolicyRecord = {
        clientId: "client-bad-state",
        policyVersion: 1,
        federalState: "XX", // Non-existent state
        surchargeSat: 0.25,
        surchargeSun: 0.5,
        surchargeHoliday: 1.0,
        surchargeNight: 0.25,
        nightStart: "20:00",
        nightEnd: "06:00",
        combinationRule: "highest_non_night_plus_night",
        sourceType: "contract",
        sourceReference: "Manual entry",
        effectiveFrom: "2026-01-01",
      };

      const res = resolveInvoiceSurchargePolicy({
        policy: invalidStatePolicy,
        referenceDate: "2026-05-01",
      });
      expect(res.status).toBe("policy_unresolved");
      if (res.status === "policy_unresolved") {
        expect(res.code).toBe("UNKNOWN_FEDERAL_STATE");
      }
    });

    it("rejects missing or invalid night window", () => {
      // Missing night window (no implicit fallback)
      const missingNightPolicy: FacilitySurchargePolicyRecord = {
        clientId: "client-missing-night",
        policyVersion: 1,
        federalState: "NW",
        surchargeSat: 0.25,
        surchargeSun: 0.5,
        surchargeHoliday: 1.0,
        surchargeNight: 0.25,
        combinationRule: "highest_non_night_plus_night",
        sourceType: "contract",
        sourceReference: "Manual entry",
        effectiveFrom: "2026-01-01",
      };

      const resMissing = resolveInvoiceSurchargePolicy({
        policy: missingNightPolicy,
        referenceDate: "2026-05-01",
      });
      expect(resMissing.status).toBe("policy_unresolved");
      if (resMissing.status === "policy_unresolved") {
        expect(resMissing.code).toBe("INVALID_NIGHT_WINDOW");
      }

      // Invalid night window format
      const badNightPolicy: FacilitySurchargePolicyRecord = {
        ...missingNightPolicy,
        nightStart: "25:99",
        nightEnd: "06:00",
      };

      const resNight = resolveInvoiceSurchargePolicy({
        policy: badNightPolicy,
        referenceDate: "2026-05-01",
      });
      expect(resNight.status).toBe("policy_unresolved");
      if (resNight.status === "policy_unresolved") {
        expect(resNight.code).toBe("INVALID_NIGHT_WINDOW");
      }
    });

    it("rejects invalid surcharge fractions", () => {
      const negativeRatePolicy: FacilitySurchargePolicyRecord = {
        clientId: "client-neg-rate",
        clientContractId: "contract-neg-rate",
        policyVersion: 1,
        federalState: "NW",
        surchargeSat: -0.1, // Negative surcharge
        surchargeSun: 0.5,
        surchargeHoliday: 1.0,
        surchargeNight: 0.25,
        nightStart: "20:00",
        nightEnd: "06:00",
        combinationRule: "highest_non_night_plus_night",
        sourceType: "contract",
        sourceReference: "Manual entry",
        effectiveFrom: "2026-01-01",
      };

      const resRate = resolveInvoiceSurchargePolicy({
        policy: negativeRatePolicy,
        referenceDate: "2026-05-01",
      });
      expect(resRate.status).toBe("policy_unresolved");
      if (resRate.status === "policy_unresolved") {
        expect(resRate.code).toBe("INVALID_SURCHARGE_RATES");
      }
    });

    it("rejects missing combinationRule and missing sourceType", () => {
      const missingRulePolicy: FacilitySurchargePolicyRecord = {
        clientId: "client-missing-rule",
        clientContractId: "contract-missing-rule",
        policyVersion: 1,
        federalState: "NW",
        surchargeSat: 0.25,
        surchargeSun: 0.5,
        surchargeHoliday: 1.0,
        surchargeNight: 0.25,
        nightStart: "20:00",
        nightEnd: "06:00",
        sourceType: "contract",
        sourceReference: "Manual entry",
        effectiveFrom: "2026-01-01",
      };

      const resRule = resolveInvoiceSurchargePolicy({
        policy: missingRulePolicy,
        referenceDate: "2026-05-01",
      });
      expect(resRule.status).toBe("policy_unresolved");
      if (resRule.status === "policy_unresolved") {
        expect(resRule.code).toBe("INVALID_COMBINATION_RULE");
      }

      const missingSourcePolicy: FacilitySurchargePolicyRecord = {
        ...missingRulePolicy,
        combinationRule: "highest_non_night_plus_night",
        sourceType: undefined,
      };

      const resSource = resolveInvoiceSurchargePolicy({
        policy: missingSourcePolicy,
        referenceDate: "2026-05-01",
      });
      expect(resSource.status).toBe("policy_unresolved");
      if (resSource.status === "policy_unresolved") {
        expect(resSource.code).toBe("UNVERIFIED_POLICY_SOURCE");
      }
    });

    it("enforces strict provenance verification across setting, local_exception, and contract sources", () => {
      // 1. Setting without verifier metadata MUST be rejected with UNVERIFIED_POLICY_SOURCE
      const unverifiedSetting: FacilitySurchargePolicyRecord = {
        clientId: "client-setting-unverified",
        policyVersion: 1,
        federalState: "NW",
        surchargeSat: 0.25,
        surchargeSun: 0.5,
        surchargeHoliday: 1.0,
        surchargeNight: 0.25,
        nightStart: "20:00",
        nightEnd: "06:00",
        combinationRule: "highest_non_night_plus_night",
        sourceType: "setting",
        sourceReference: "Admin Einstellung im Web-Portal", // Free text alone is not sufficient
        effectiveFrom: "2026-01-01",
      };
      const resSetting = resolveInvoiceSurchargePolicy({
        policy: unverifiedSetting,
        referenceDate: "2026-05-01",
      });
      expect(resSetting.status).toBe("policy_unresolved");
      if (resSetting.status === "policy_unresolved") {
        expect(resSetting.code).toBe("UNVERIFIED_POLICY_SOURCE");
        expect(resSetting.message).toContain("verifiedByUserId und verifiedAt sind Pflichtangaben");
      }

      // Setting with verifier metadata resolves successfully
      const verifiedSetting: FacilitySurchargePolicyRecord = {
        ...unverifiedSetting,
        verifiedByUserId: "admin-audit-user-42",
        verifiedAt: "2026-01-01T10:00:00.000Z",
      };
      const resSettingSuccess = resolveInvoiceSurchargePolicy({
        policy: verifiedSetting,
        referenceDate: "2026-05-01",
      });
      expect(resSettingSuccess.status).toBe("resolved");

      // 2. Local exception without verifier metadata MUST be rejected
      const unverifiedLocalExc: FacilitySurchargePolicyRecord = {
        ...unverifiedSetting,
        sourceType: "local_exception",
        sourceReference: "Ausnahmeverfügung Bautzen",
      };
      const resExc = resolveInvoiceSurchargePolicy({
        policy: unverifiedLocalExc,
        referenceDate: "2026-05-01",
      });
      expect(resExc.status).toBe("policy_unresolved");
      if (resExc.status === "policy_unresolved") {
        expect(resExc.code).toBe("UNVERIFIED_POLICY_SOURCE");
      }

      // 3. Contract without clientContractId and without verifier metadata MUST be rejected
      const unverifiedContract: FacilitySurchargePolicyRecord = {
        ...unverifiedSetting,
        sourceType: "contract",
        sourceReference: "Freitext-Vertragsbeleg",
      };
      const resContract = resolveInvoiceSurchargePolicy({
        policy: unverifiedContract,
        referenceDate: "2026-05-01",
      });
      expect(resContract.status).toBe("policy_unresolved");
      if (resContract.status === "policy_unresolved") {
        expect(resContract.code).toBe("UNVERIFIED_POLICY_SOURCE");
        expect(resContract.message).toContain("clientContractId besitzen oder mit Benutzer-Verifizierungsdaten");
      }
    });

    it("rejects unverified policy without sourceReference", () => {
      const unverifiedPolicy: FacilitySurchargePolicyRecord = {
        clientId: "client-unverified",
        clientContractId: "contract-unverified",
        policyVersion: 1,
        federalState: "NW",
        surchargeSat: 0.25,
        surchargeSun: 0.5,
        surchargeHoliday: 1.0,
        surchargeNight: 0.25,
        nightStart: "20:00",
        nightEnd: "06:00",
        combinationRule: "highest_non_night_plus_night",
        sourceType: "contract",
        sourceReference: "", // Empty source reference
        effectiveFrom: "2026-01-01",
      };

      const res = resolveInvoiceSurchargePolicy({
        policy: unverifiedPolicy,
        referenceDate: "2026-05-01",
      });
      expect(res.status).toBe("policy_unresolved");
      if (res.status === "policy_unresolved") {
        expect(res.code).toBe("UNVERIFIED_POLICY_SOURCE");
      }
    });

    it("strictly rejects tampered frozen policy with TAMPERED_FROZEN_POLICY", () => {
      const tamperedPolicy: FacilitySurchargePolicyRecord = {
        clientId: "client-tampered",
        clientContractId: "contract-tampered-1",
        policyVersion: 1,
        federalState: "NW",
        surchargeSat: 0.25,
        surchargeSun: 0.5,
        surchargeHoliday: 1.0,
        surchargeNight: 0.25,
        nightStart: "20:00",
        nightEnd: "06:00",
        combinationRule: "highest_non_night_plus_night",
        sourceType: "contract",
        sourceReference: "Vertrag",
        effectiveFrom: "2026-01-01",
        isFrozen: true,
        frozenHash: "tampered_unauthorized_hash_value",
      };

      const res = resolveInvoiceSurchargePolicy({
        policy: tamperedPolicy,
        referenceDate: "2026-05-01",
      });
      expect(res.status).toBe("policy_unresolved");
      if (res.status === "policy_unresolved") {
        expect(res.code).toBe("TAMPERED_FROZEN_POLICY");
        expect(res.diagnostics.details).toBe("FROZEN_POLICY_HASH_MISMATCH");
      }
    });

    it("safely handles invalid verifiedAt without throwing unhandled exceptions", () => {
      const invalidVerifiedPolicy: FacilitySurchargePolicyRecord = {
        clientId: "client-invalid-verified",
        clientContractId: "contract-verified-1",
        policyVersion: 1,
        federalState: "NW",
        surchargeSat: 0.25,
        surchargeSun: 0.5,
        surchargeHoliday: 1.0,
        surchargeNight: 0.25,
        nightStart: "20:00",
        nightEnd: "06:00",
        combinationRule: "highest_non_night_plus_night",
        sourceType: "contract",
        sourceReference: "Vertrag",
        effectiveFrom: "2026-01-01",
        verifiedAt: "not-a-valid-timestamp",
      };

      const res = resolveInvoiceSurchargePolicy({
        policy: invalidVerifiedPolicy,
        referenceDate: "2026-05-01",
      });
      expect(res.status).toBe("policy_unresolved");
      if (res.status === "policy_unresolved") {
        expect(res.code).toBe("INVALID_VERIFICATION_METADATA");
      }
    });

    it("validates that client policy intervals do not overlap", () => {
      const p1: FacilitySurchargePolicyRecord = {
        clientId: "client-overlap-test",
        clientContractId: "contract-overlap-1",
        policyVersion: 1,
        federalState: "NW",
        surchargeSat: 0.25,
        surchargeSun: 0.5,
        surchargeHoliday: 1.0,
        surchargeNight: 0.25,
        nightStart: "20:00",
        nightEnd: "06:00",
        combinationRule: "highest_non_night_plus_night",
        sourceType: "contract",
        sourceReference: "Vertrag 1",
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-06-30",
      };

      const p2Disjoint: FacilitySurchargePolicyRecord = {
        ...p1,
        policyVersion: 2,
        effectiveFrom: "2026-07-01",
        effectiveTo: "2026-12-31",
      };

      const disjointRes = validatePolicyIntervalOverlap([p1, p2Disjoint]);
      expect(disjointRes.valid).toBe(true);
      expect(disjointRes.conflict).toBeUndefined();

      const p2Overlapping: FacilitySurchargePolicyRecord = {
        ...p1,
        policyVersion: 2,
        effectiveFrom: "2026-06-15", // Overlaps p1 (which ends 2026-06-30)
        effectiveTo: "2026-12-31",
      };

      const overlapRes = validatePolicyIntervalOverlap([p1, p2Overlapping]);
      expect(overlapRes.valid).toBe(false);
      expect(overlapRes.conflict?.reason).toContain("überschneiden sich für Mandant");
    });
  });

  describe("7. Year-Boundary Shift Crossing (Dec 31 -> Jan 1)", () => {
    it("evaluates New Year's Eve (Dec 31) vs New Year's Day (Jan 1) minute by minute", () => {
      const policyNW: FacilitySurchargePolicyRecord = {
        clientId: "client-nye",
        clientContractId: "contract-nye-1",
        policyVersion: 1,
        federalState: "NW",
        surchargeSat: 0.25,
        surchargeSun: 0.5,
        surchargeHoliday: 1.0,
        surchargeNight: 0.25,
        nightStart: "20:00",
        nightEnd: "06:00",
        combinationRule: "highest_non_night_plus_night",
        sourceType: "contract",
        sourceReference: "Vertrag 2026/2027",
        effectiveFrom: "2026-01-01",
      };

      const resolved = resolveInvoiceSurchargePolicy({
        policy: policyNW,
        referenceDate: "2026-12-31",
      }) as ResolvedSurchargePolicySuccess;

      // 2026-12-31 was a Thursday (regular workday)
      // Minute 1410 (23:30) on 2026-12-31: Night only (Silvester is not a statutory holiday)
      const nyeMinute = evaluateMinuteSurcharges("2026-12-31", 1410, resolved);
      expect(nyeMinute.status).toBe("resolved");
      if (nyeMinute.status === "resolved") {
        expect(nyeMinute.isHoliday).toBe(false);
        expect(nyeMinute.isNight).toBe(true);
        expect(nyeMinute.effectiveSurchargeFraction).toBe(0.25);
        expect(nyeMinute.rateMultiplier).toBe(1.25);
      }

      // 2026-01-01 is Neujahr (statutory holiday in all 16 states)
      // Minute 30 (00:30) on 2026-01-01: Holiday + Night
      const newYearMinute = evaluateMinuteSurcharges("2026-01-01", 30, resolved);
      expect(newYearMinute.status).toBe("resolved");
      if (newYearMinute.status === "resolved") {
        expect(newYearMinute.isHoliday).toBe(true);
        expect(newYearMinute.holidayRecord?.name).toBe("Neujahr");
        expect(newYearMinute.isNight).toBe(true);
        // Under highest_non_night_plus_night: Holiday 100% + Night 25% = 125% -> Multiplier 2.25
        expect(newYearMinute.effectiveSurchargeFraction).toBe(1.25);
        expect(newYearMinute.rateMultiplier).toBe(2.25);
      }
    });
  });

  describe("8. Deterministic Idempotency & Cryptographic Terms Hash", () => {
    it("guarantees identical inputs and policy version produce 100% byte-identical frozenHash", () => {
      const policyA: FacilitySurchargePolicyRecord = {
        clientId: "client-hash-test",
        clientContractId: "contract-123",
        policyVersion: 4,
        federalState: "BW",
        municipality: "Stuttgart",
        surchargeSat: 0.3,
        surchargeSun: 0.6,
        surchargeHoliday: 1.25,
        surchargeNight: 0.35,
        nightStart: "21:00",
        nightEnd: "06:00",
        combinationRule: "highest_non_night_plus_night",
        sourceType: "contract",
        sourceReference: "Haustarifvertrag Stuttgart 2026",
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-12-31",
      };

      const res1 = resolveInvoiceSurchargePolicy({
        policy: policyA,
        referenceDate: "2026-05-15",
      }) as ResolvedSurchargePolicySuccess;

      const res2 = resolveInvoiceSurchargePolicy({
        policy: policyA,
        referenceDate: "2026-05-15",
      }) as ResolvedSurchargePolicySuccess;

      expect(res1.frozenHash).toBe(res2.frozenHash);
      expect(res1.frozenHash).toHaveLength(64); // SHA-256 hex string

      const directHash = computePolicyCanonicalHash({
        clientId: policyA.clientId,
        clientContractId: policyA.clientContractId || null,
        policyVersion: policyA.policyVersion!,
        federalState: policyA.federalState,
        municipality: policyA.municipality || null,
        surchargeSat: policyA.surchargeSat,
        surchargeSun: policyA.surchargeSun,
        surchargeHoliday: policyA.surchargeHoliday,
        surchargeNight: policyA.surchargeNight,
        nightStart: policyA.nightStart!,
        nightEnd: policyA.nightEnd!,
        combinationRule: policyA.combinationRule!,
        sourceType: policyA.sourceType!,
        sourceReference: policyA.sourceReference,
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-12-31",
      });
      expect(res1.frozenHash).toBe(directHash);

      // Altering even a single parameter (e.g. nightStart from 21:00 to 20:00) changes the hash
      const policyModified = { ...policyA, nightStart: "20:00" };
      const resModified = resolveInvoiceSurchargePolicy({
        policy: policyModified,
        referenceDate: "2026-05-15",
      }) as ResolvedSurchargePolicySuccess;

      expect(resModified.frozenHash).not.toBe(res1.frozenHash);
    });
  });

  describe("9. Legacy germanHolidays Backwards Compatibility", () => {
    it("proves legacy germanHolidays in lib/holidays.ts remains 100% intact for legacy callers", () => {
      const nrwHolidays = germanHolidays(2026);
      expect(nrwHolidays).toBeInstanceOf(Map);
      expect(nrwHolidays.size).toBe(11);
      expect(nrwHolidays.get("2026-01-01")).toBe("Neujahr");
      expect(nrwHolidays.get("2026-05-01")).toBe("Tag der Arbeit");
      expect(nrwHolidays.get("2026-10-03")).toBe("Tag der Deutschen Einheit");
      expect(nrwHolidays.get("2026-11-01")).toBe("Allerheiligen");
      expect(nrwHolidays.get("2026-12-25")).toBe("1. Weihnachtstag");
      expect(nrwHolidays.get("2026-12-26")).toBe("2. Weihnachtstag");
    });
  });

  describe("10. Gregorian Calendar Integrity: Rejection of Invalid Dates", () => {
    it("rejects non-existent Gregorian dates like 2026-02-31 and 2026-04-31 with INVALID_CALENDAR_DATE", () => {
      // Counter-test: Feb 31 does not exist in any Gregorian year
      const resFeb31 = resolveGermanHoliday("2026-02-31", "NW");
      expect(resFeb31.status).toBe("policy_unresolved");
      if (resFeb31.status === "policy_unresolved") {
        expect(resFeb31.code).toBe("INVALID_CALENDAR_DATE");
        expect(resFeb31.message).toContain("existiert nicht im gregorianischen Kalender");
      }

      // April has only 30 days
      const resApr31 = resolveGermanHoliday("2026-04-31", "NW");
      expect(resApr31.status).toBe("policy_unresolved");
      if (resApr31.status === "policy_unresolved") {
        expect(resApr31.code).toBe("INVALID_CALENDAR_DATE");
      }

      // Rejection in resolveInvoiceSurchargePolicy reference date
      const policyNW: FacilitySurchargePolicyRecord = {
        clientId: "client-nw-gregorian",
        clientContractId: "contract-greg-1",
        policyVersion: 1,
        federalState: "NW",
        surchargeSat: 0.25,
        surchargeSun: 0.5,
        surchargeHoliday: 1.0,
        surchargeNight: 0.25,
        nightStart: "20:00",
        nightEnd: "06:00",
        combinationRule: "highest_non_night_plus_night",
        sourceType: "contract",
        sourceReference: "Vertrag",
        effectiveFrom: "2026-01-01",
      };

      const resRefFeb31 = resolveInvoiceSurchargePolicy({
        policy: policyNW,
        referenceDate: "2026-02-31",
      });
      expect(resRefFeb31.status).toBe("policy_unresolved");
      if (resRefFeb31.status === "policy_unresolved") {
        expect(resRefFeb31.code).toBe("INVALID_CALENDAR_DATE");
      }

      // Direct helper assertions
      expect(isValidGregorianCalendarDate(2026, 2, 28)).toBe(true);
      expect(isValidGregorianCalendarDate(2026, 2, 29)).toBe(false); // 2026 is not a leap year
      expect(isValidGregorianCalendarDate(2024, 2, 29)).toBe(true); // 2024 is a leap year
      expect(isValidGregorianCalendarDate(2026, 2, 31)).toBe(false);
      expect(isValidGregorianCalendarDate(2026, 4, 31)).toBe(false);
      expect(isValidGregorianCalendarDate(2026, 4, 30)).toBe(true);
    });
  });

  describe("11. Sub-Municipal Ortsteil Precision in Minute Evaluation (Bautzen)", () => {
    it("evaluates Bautzen with Salzenforst as holiday, and Bautzen without Ortsteil as policy_unresolved", () => {
      // 2026-06-04 is Fronleichnam in Saxony
      const dateFronleichnam = "2026-06-04";

      // 1. Facility policy in Bautzen with explicit Ortsteil Salzenforst
      const policyBautzenSalzenforst: FacilitySurchargePolicyRecord = {
        clientId: "client-bautzen-salzenforst",
        clientContractId: "contract-sn-bautzen-1",
        policyVersion: 1,
        federalState: "SN",
        municipality: "14625020", // Bautzen AGS
        districtLocality: "Salzenforst",
        surchargeSat: 0.25,
        surchargeSun: 0.5,
        surchargeHoliday: 1.0,
        surchargeNight: 0.25,
        nightStart: "20:00",
        nightEnd: "06:00",
        combinationRule: "highest_non_night_plus_night",
        sourceType: "contract",
        sourceReference: "Vertrag Klinik Bautzen-Salzenforst",
        effectiveFrom: "2026-01-01",
      };

      const resolvedSalzenforst = resolveInvoiceSurchargePolicy({
        policy: policyBautzenSalzenforst,
        referenceDate: dateFronleichnam,
      }) as ResolvedSurchargePolicySuccess;
      expect(resolvedSalzenforst.status).toBe("resolved");
      expect(resolvedSalzenforst.districtLocality).toBe("Salzenforst");

      const evalSalzenforst = evaluateMinuteSurcharges(dateFronleichnam, 720, resolvedSalzenforst);
      expect(evalSalzenforst.status).toBe("resolved");
      if (evalSalzenforst.status === "resolved") {
        expect(evalSalzenforst.isHoliday).toBe(true);
        expect(evalSalzenforst.holidayRecord?.name).toBe("Fronleichnam");
        expect(evalSalzenforst.effectiveSurchargeFraction).toBe(1.0);
      }

      // 2. Facility policy in Bautzen WITHOUT districtLocality -> evaluateMinuteSurcharges MUST return policy_unresolved
      const policyBautzenNoLocality: FacilitySurchargePolicyRecord = {
        ...policyBautzenSalzenforst,
        clientId: "client-bautzen-no-loc",
        districtLocality: undefined,
      };

      const resolvedNoLoc = resolveInvoiceSurchargePolicy({
        policy: policyBautzenNoLocality,
        referenceDate: dateFronleichnam,
      }) as ResolvedSurchargePolicySuccess;
      expect(resolvedNoLoc.status).toBe("resolved");

      const evalNoLoc = evaluateMinuteSurcharges(dateFronleichnam, 720, resolvedNoLoc);
      expect(evalNoLoc.status).toBe("policy_unresolved");
      if (evalNoLoc.status === "policy_unresolved") {
        expect(evalNoLoc.code).toBe("AMBIGUOUS_MUNICIPAL_LOCATION");
        expect(evalNoLoc.message).toContain("Bolbritz und Salzenforst");
      }
    });
  });

  describe("12. Disallowed & Ambiguous Key Counter-Tests in evaluateMinuteSurcharges (Never 1.0x)", () => {
    const dateFronleichnam = "2026-06-04";

    const baseContractPolicy = {
      policyVersion: 1,
      surchargeSat: 0.25,
      surchargeSun: 0.5,
      surchargeHoliday: 1.0,
      surchargeNight: 0.25,
      nightStart: "20:00",
      nightEnd: "06:00",
      combinationRule: "highest_non_night_plus_night" as const,
      sourceType: "contract" as const,
      sourceReference: "Vertrag 2026 Audit",
      effectiveFrom: "2026-01-01",
    };

    it("fails explicitly with policy_unresolved for SN 14625340 (Malschwitz) without defaulting to 1.0x", () => {
      const policyMalschwitz: FacilitySurchargePolicyRecord = {
        ...baseContractPolicy,
        clientId: "client-sn-malschwitz",
        clientContractId: "contract-sn-14625340",
        federalState: "SN",
        municipality: "14625340", // Malschwitz (NOT a statutory Fronleichnam municipality)
      };

      const resolved = resolveInvoiceSurchargePolicy({
        policy: policyMalschwitz,
        referenceDate: dateFronleichnam,
      }) as ResolvedSurchargePolicySuccess;
      expect(resolved.status).toBe("resolved");

      const minuteEval = evaluateMinuteSurcharges(dateFronleichnam, 720, resolved);
      expect(minuteEval.status).toBe("policy_unresolved");
      if (minuteEval.status === "policy_unresolved") {
        expect(minuteEval.code).toBe("AMBIGUOUS_MUNICIPAL_LOCATION");
      }
    });

    it("fails explicitly with policy_unresolved for TH 16064058 (historic Schönstedt) without defaulting to 1.0x", () => {
      const policySchoenstedt: FacilitySurchargePolicyRecord = {
        ...baseContractPolicy,
        clientId: "client-th-schoenstedt",
        clientContractId: "contract-th-16064058",
        federalState: "TH",
        municipality: "16064058", // Historic Schönstedt (NOT Südeichsfeld 16064074)
      };

      const resolved = resolveInvoiceSurchargePolicy({
        policy: policySchoenstedt,
        referenceDate: dateFronleichnam,
      }) as ResolvedSurchargePolicySuccess;
      expect(resolved.status).toBe("resolved");

      const minuteEval = evaluateMinuteSurcharges(dateFronleichnam, 720, resolved);
      expect(minuteEval.status).toBe("policy_unresolved");
      if (minuteEval.status === "policy_unresolved") {
        expect(minuteEval.code).toBe("AMBIGUOUS_MUNICIPAL_LOCATION");
      }
    });

    it("fails explicitly with policy_unresolved for TH 16061199 (dummy code) without defaulting to 1.0x", () => {
      const policyDummy: FacilitySurchargePolicyRecord = {
        ...baseContractPolicy,
        clientId: "client-th-dummy",
        clientContractId: "contract-th-16061199",
        federalState: "TH",
        municipality: "16061199", // Dummy non-existent AGS code
      };

      const resolved = resolveInvoiceSurchargePolicy({
        policy: policyDummy,
        referenceDate: dateFronleichnam,
      }) as ResolvedSurchargePolicySuccess;
      expect(resolved.status).toBe("resolved");

      const minuteEval = evaluateMinuteSurcharges(dateFronleichnam, 720, resolved);
      expect(minuteEval.status).toBe("policy_unresolved");
      if (minuteEval.status === "policy_unresolved") {
        expect(minuteEval.code).toBe("AMBIGUOUS_MUNICIPAL_LOCATION");
      }
    });

    it("fails explicitly with policy_unresolved for TH not-eichsfeld without defaulting to 1.0x", () => {
      const policySubstring: FacilitySurchargePolicyRecord = {
        ...baseContractPolicy,
        clientId: "client-th-substring",
        clientContractId: "contract-th-not-eichsfeld",
        federalState: "TH",
        municipality: "not-eichsfeld", // Free-text substring match must be rejected
      };

      const resolved = resolveInvoiceSurchargePolicy({
        policy: policySubstring,
        referenceDate: dateFronleichnam,
      }) as ResolvedSurchargePolicySuccess;
      expect(resolved.status).toBe("resolved");

      const minuteEval = evaluateMinuteSurcharges(dateFronleichnam, 720, resolved);
      expect(minuteEval.status).toBe("policy_unresolved");
      if (minuteEval.status === "policy_unresolved") {
        expect(minuteEval.code).toBe("AMBIGUOUS_MUNICIPAL_LOCATION");
      }
    });

    it("evaluates verified positive 2026 TLS municipalities in evaluateMinuteSurcharges with statutory holiday rate", () => {
      // 1. Dingelstädt (16061118)
      const policyDingelstaedt: FacilitySurchargePolicyRecord = {
        ...baseContractPolicy,
        clientId: "client-th-dingelstaedt",
        clientContractId: "contract-th-16061118",
        federalState: "TH",
        municipality: "16061118",
      };
      const resDing = resolveInvoiceSurchargePolicy({ policy: policyDingelstaedt, referenceDate: dateFronleichnam }) as ResolvedSurchargePolicySuccess;
      const evalDing = evaluateMinuteSurcharges(dateFronleichnam, 720, resDing);
      expect(evalDing.status).toBe("resolved");
      if (evalDing.status === "resolved") {
        expect(evalDing.isHoliday).toBe(true);
        expect(evalDing.effectiveSurchargeFraction).toBe(1.0);
      }

      // 2. Südeichsfeld (16064074)
      const policySuedeichsfeld: FacilitySurchargePolicyRecord = {
        ...baseContractPolicy,
        clientId: "client-th-suedeichsfeld",
        clientContractId: "contract-th-16064074",
        federalState: "TH",
        municipality: "16064074",
      };
      const resSued = resolveInvoiceSurchargePolicy({ policy: policySuedeichsfeld, referenceDate: dateFronleichnam }) as ResolvedSurchargePolicySuccess;
      const evalSued = evaluateMinuteSurcharges(dateFronleichnam, 720, resSued);
      expect(evalSued.status).toBe("resolved");
      if (evalSued.status === "resolved") {
        expect(evalSued.isHoliday).toBe(true);
        expect(evalSued.effectiveSurchargeFraction).toBe(1.0);
      }

      // 3. Schleid (16063068)
      const policySchleid: FacilitySurchargePolicyRecord = {
        ...baseContractPolicy,
        clientId: "client-th-schleid",
        clientContractId: "contract-th-16063068",
        federalState: "TH",
        municipality: "16063068",
      };
      const resSchleid = resolveInvoiceSurchargePolicy({ policy: policySchleid, referenceDate: dateFronleichnam }) as ResolvedSurchargePolicySuccess;
      const evalSchleid = evaluateMinuteSurcharges(dateFronleichnam, 720, resSchleid);
      expect(evalSchleid.status).toBe("resolved");
      if (evalSchleid.status === "resolved") {
        expect(evalSchleid.isHoliday).toBe(true);
        expect(evalSchleid.effectiveSurchargeFraction).toBe(1.0);
      }
    });
  });
});
