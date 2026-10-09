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

    it("evaluates statutory local Fronleichnam exceptions in Saxony (SN) and Thuringia (TH)", () => {
      // 2026-06-04 is Fronleichnam
      const fronleichnam2026 = "2026-06-04";

      // Saxony (SN) - SächsSFG § 1 Abs. 1 Nr. 1 i.V.m. FronleichnamsVO:
      // Statutory holiday in designated Catholic communities of Landkreis Bautzen
      const resCrostwitz = resolveGermanHoliday(fronleichnam2026, "SN", "Crostwitz");
      expect(resCrostwitz.status).toBe("resolved");
      if (resCrostwitz.status === "resolved") {
        expect(resCrostwitz.isHoliday).toBe(true);
        expect(resCrostwitz.holiday?.name).toBe("Fronleichnam");
      }

      const resPanschwitzAgs = resolveGermanHoliday(fronleichnam2026, "SN", "14625390"); // Panschwitz-Kuckau AGS
      expect(resPanschwitzAgs.status).toBe("resolved");
      if (resPanschwitzAgs.status === "resolved") {
        expect(resPanschwitzAgs.isHoliday).toBe(true);
      }

      // Non-qualifying municipality in Saxony (e.g. Dresden)
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

      // Thuringia (TH) - ThürFtG § 2 Abs. 2:
      // Statutory holiday in the entire Landkreis Eichsfeld and designated Catholic communities
      const resHeiligenstadt = resolveGermanHoliday(fronleichnam2026, "TH", "Heilbad Heiligenstadt");
      expect(resHeiligenstadt.status).toBe("resolved");
      if (resHeiligenstadt.status === "resolved") {
        expect(resHeiligenstadt.isHoliday).toBe(true);
        expect(resHeiligenstadt.holiday?.name).toBe("Fronleichnam");
      }

      const resEichsfeld = resolveGermanHoliday(fronleichnam2026, "TH", "Landkreis Eichsfeld");
      expect(resEichsfeld.status).toBe("resolved");
      if (resEichsfeld.status === "resolved") {
        expect(resEichsfeld.isHoliday).toBe(true);
      }

      // Non-qualifying municipality in Thuringia (e.g. Erfurt)
      const resErfurt = resolveGermanHoliday(fronleichnam2026, "TH", "Erfurt");
      expect(resErfurt.status).toBe("resolved");
      if (resErfurt.status === "resolved") {
        expect(resErfurt.isHoliday).toBe(false);
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
      expect(isSaxonyCatholicMunicipality("Dresden")).toBe(false);
      expect(isSaxonyCatholicMunicipality(null)).toBeNull();

      expect(isThuringianCatholicMunicipality("Heilbad Heiligenstadt")).toBe(true);
      expect(isThuringianCatholicMunicipality("Erfurt")).toBe(false);
      expect(isThuringianCatholicMunicipality(null)).toBeNull();
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

    it("rejects unverified policy without sourceReference", () => {
      const unverifiedPolicy: FacilitySurchargePolicyRecord = {
        clientId: "client-unverified",
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
});
