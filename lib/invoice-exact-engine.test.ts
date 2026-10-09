import { describe, expect, it } from "vitest";
import {
  calculateExactInvoice,
  divideRoundHalfAwayFromZero,
  formatCentsDecimal,
  formatCentsGerman,
  formatHundredthsDecimal,
  formatHundredthsGerman,
  formatRatioToPercentGerman,
  ITEM_CATEGORIES,
  KNOWN_QUALIFICATIONS,
  normalizeRatio,
  normalizeTaxRate,
  parseRateToCents,
  RawWorkLineInput,
  ExactMoneyValidationError,
} from "./invoice-exact-engine";

/**
 * Independent Reference Oracle for Commercial Rounding (Round Half Away From Zero).
 * Uses pure rational fraction reduction and integer arithmetic completely decoupled
 * from the engine implementation to verify truth independently.
 */
function independentCommercialRound(num: number, den: number): number {
  if (den <= 0) throw new Error("Denominator must be > 0");
  const isNegative = num < 0;
  const absNum = Math.abs(num);
  const quotient = Math.floor(absNum / den);
  const remainder = absNum % den;
  const shouldRoundUp = 2 * remainder >= den;
  const rounded = shouldRoundUp ? quotient + 1 : quotient;
  if (rounded === 0) return 0;
  return isNegative ? -rounded : rounded;
}

describe("Exact Monetary Engine (Phase 2 - Unit Tests & Acceptance Criteria)", () => {
  describe("1. Pure Commercial Rounding (Round Half Away From Zero / DIN 1333)", () => {
    it("rounds positive halves away from zero (upwards)", () => {
      // 102.5 -> 103 (e.g. 10250 / 100)
      expect(divideRoundHalfAwayFromZero(BigInt(10250), BigInt(100))).toBe(BigInt(103));
      // 102.49 -> 102
      expect(divideRoundHalfAwayFromZero(BigInt(10249), BigInt(100))).toBe(BigInt(102));
      // 102.51 -> 103
      expect(divideRoundHalfAwayFromZero(BigInt(10251), BigInt(100))).toBe(BigInt(103));
      // 0.5 -> 1
      expect(divideRoundHalfAwayFromZero(BigInt(5), BigInt(10))).toBe(BigInt(1));
      // 0.49 -> 0
      expect(divideRoundHalfAwayFromZero(BigInt(49), BigInt(100))).toBe(BigInt(0));
    });

    it("rounds negative halves symmetrically away from zero (downwards / away from zero)", () => {
      // -102.5 -> -103 (e.g. -10250 / 100)
      expect(divideRoundHalfAwayFromZero(BigInt(-10250), BigInt(100))).toBe(BigInt(-103));
      // -102.49 -> -102
      expect(divideRoundHalfAwayFromZero(BigInt(-10249), BigInt(100))).toBe(BigInt(-102));
      // -102.51 -> -103
      expect(divideRoundHalfAwayFromZero(BigInt(-10251), BigInt(100))).toBe(BigInt(-103));
      // -0.5 -> -1
      expect(divideRoundHalfAwayFromZero(BigInt(-5), BigInt(10))).toBe(BigInt(-1));
      // -0.49 -> 0
      expect(divideRoundHalfAwayFromZero(BigInt(-49), BigInt(100))).toBe(BigInt(0));
    });

    it("matches the independent reference oracle across an extensive range of boundary points", () => {
      const denominators = [10, 60, 100, 1000];
      for (const den of denominators) {
        for (let num = -500; num <= 500; num++) {
          const actual = Number(divideRoundHalfAwayFromZero(BigInt(num), BigInt(den)));
          const expected = independentCommercialRound(num, den);
          expect(actual).toBe(expected);
        }
      }
    });

    it("rejects non-positive denominator with descriptive error", () => {
      expect(() => divideRoundHalfAwayFromZero(BigInt(100), BigInt(0))).toThrowError(
        ExactMoneyValidationError
      );
      expect(() => divideRoundHalfAwayFromZero(BigInt(100), BigInt(-10))).toThrowError(
        ExactMoneyValidationError
      );
    });
  });

  describe("2. Rate & Input Validation", () => {
    it("parses valid decimal strings to exact integer cents", () => {
      expect(parseRateToCents("52.80")).toBe(5280);
      expect(parseRateToCents("40.00")).toBe(4000);
      expect(parseRateToCents("51.25")).toBe(5125);
      expect(parseRateToCents("0.00")).toBe(0);
      expect(parseRateToCents("0")).toBe(0);
      expect(parseRateToCents("15.84")).toBe(1584);
      expect(parseRateToCents("26.40")).toBe(2640);
      expect(parseRateToCents("100")).toBe(10000);
      expect(parseRateToCents("-42.50")).toBe(-4250);
    });

    it("parses cents object directly", () => {
      expect(parseRateToCents({ cents: 5280 })).toBe(5280);
      expect(parseRateToCents({ cents: 0 })).toBe(0);
      expect(parseRateToCents({ cents: -1500 })).toBe(-1500);
    });

    it("rejects localized strings with currency symbols or commas", () => {
      expect(() => parseRateToCents("52,80 €")).toThrowError(
        /Lokalisierte Währungszeichen oder Kommas/
      );
      expect(() => parseRateToCents("1.234,56 €")).toThrowError(
        /Lokalisierte Währungszeichen oder Kommas/
      );
      expect(() => parseRateToCents("52,80")).toThrowError(
        /Lokalisierte Währungszeichen oder Kommas/
      );
      expect(() => parseRateToCents("€ 50")).toThrowError(
        /Lokalisierte Währungszeichen oder Kommas/
      );
    });

    it("rejects missing, null, undefined, empty, or non-numeric strings with explicit error", () => {
      expect(() => parseRateToCents(null as unknown as string)).toThrowError(/MISSING_RATE/);
      expect(() => parseRateToCents(undefined as unknown as string)).toThrowError(/MISSING_RATE/);
      expect(() => parseRateToCents("")).toThrowError(/EMPTY_RATE_STRING/);
      expect(() => parseRateToCents("   ")).toThrowError(/EMPTY_RATE_STRING/);
      expect(() => parseRateToCents("abc")).toThrowError(/INVALID_DECIMAL_FORMAT/);
      expect(() => parseRateToCents(NaN)).toThrowError(/INVALID_RATE_NUMBER/);
      expect(() => parseRateToCents(Infinity)).toThrowError(/INVALID_RATE_NUMBER/);
    });
  });

  describe("3. Required Synthetic Benchmark Cases (Prompt Specifications)", () => {
    it("Benchmark 1: 0.02h × €51.25 equals exactly €1.03 (fixes Defect F02 binary float loss)", () => {
      const input: RawWorkLineInput[] = [
        {
          workerId: "worker-bench-1",
          qualification: "pflegefachkraft",
          itemCategory: ITEM_CATEGORIES.BASE,
          priceVersionId: "v2026-1",
          minutes: 1, // 1 minute -> 2 hundredths (0.02h)
          hourlyRate: "51.25",
        },
      ];

      const result = calculateExactInvoice(input);
      expect(result.items).toHaveLength(1);
      const item = result.items[0];

      expect(item.displayHourHundredths).toBe(2);
      expect(item.hoursDecimal).toBe("0.02");
      expect(item.hoursDisplay).toBe("0,02");
      expect(item.rateCents).toBe(5125);
      expect(item.rateDecimal).toBe("51.25");
      expect(item.rateDisplay).toBe("51,25 €");
      expect(item.amountCents).toBe(103);
      expect(item.amountDecimal).toBe("1.03");
      expect(item.amountDisplay).toBe("1,03 €");

      expect(result.totals.subtotalCents).toBe(103);
      expect(result.totals.subtotalDecimal).toBe("1.03");
      expect(result.totals.subtotalDisplay).toBe("1,03 €");
    });

    it("Benchmark 2: Net €42.50 with VAT 19% yields exact tax €8.08 and gross €50.58", () => {
      const input: RawWorkLineInput[] = [
        {
          workerId: "worker-bench-2",
          qualification: "pflegefachkraft",
          itemCategory: ITEM_CATEGORIES.BASE,
          priceVersionId: "v2026-1",
          minutes: 60, // 1.00 h
          hourlyRate: "42.50",
        },
      ];

      const result = calculateExactInvoice(input, { taxRate: "19%" });

      expect(result.totals.subtotalCents).toBe(4250);
      expect(result.totals.subtotalDecimal).toBe("42.50");
      expect(result.totals.subtotalDisplay).toBe("42,50 €");

      expect(result.totals.taxAmountCents).toBe(808);
      expect(result.totals.taxAmountDecimal).toBe("8.08");
      expect(result.totals.taxAmountDisplay).toBe("8,08 €");

      expect(result.totals.totalCents).toBe(5058);
      expect(result.totals.totalDecimal).toBe("50.58");
      expect(result.totals.totalDisplay).toBe("50,58 €");
    });

    it("Benchmark 3: Negative counterpart Net -€42.50 with VAT 19% yields exact tax -€8.08 and gross -€50.58", () => {
      const input: RawWorkLineInput[] = [
        {
          workerId: "worker-bench-3",
          qualification: "pflegefachkraft",
          itemCategory: ITEM_CATEGORIES.ADJUSTMENT,
          priceVersionId: "v2026-1",
          minutes: 60,
          hourlyRate: "-42.50", // Negative adjustment line
        },
      ];

      const result = calculateExactInvoice(input, {
        taxRate: "19%",
        allowAdjustments: true,
      });

      expect(result.totals.subtotalCents).toBe(-4250);
      expect(result.totals.subtotalDecimal).toBe("-42.50");
      expect(result.totals.subtotalDisplay).toBe("-42,50 €");

      expect(result.totals.taxAmountCents).toBe(-808);
      expect(result.totals.taxAmountDecimal).toBe("-8.08");
      expect(result.totals.taxAmountDisplay).toBe("-8,08 €");

      expect(result.totals.totalCents).toBe(-5058);
      expect(result.totals.totalDecimal).toBe("-50.58");
      expect(result.totals.totalDisplay).toBe("-50,58 €");
    });
  });

  describe("4. Audit Characterization Case TC1 (Oso, Majed Shifts from Audit Simulation)", () => {
    it("TC1: Reproduces exact displayed PDF line amounts and exact totals without DB minute-float drift", () => {
      const osoLines: RawWorkLineInput[] = [
        {
          workerId: "worker-oso",
          workerName: "Oso, Majed",
          qualification: "pflegefachkraft",
          itemCategory: ITEM_CATEGORIES.BASE,
          priceVersionId: "pv-tc1",
          minutes: 757, // 12h 37m -> 12.62 h
          hourlyRate: "52.80",
        },
        {
          workerId: "worker-oso",
          workerName: "Oso, Majed",
          qualification: "pflegefachkraft",
          itemCategory: ITEM_CATEGORIES.SURCHARGE_SATURDAY,
          priceVersionId: "pv-tc1",
          minutes: 408, // 6h 48m -> 6.80 h
          hourlyRate: "15.84",
          surchargeRatio: "30%",
        },
        {
          workerId: "worker-oso",
          workerName: "Oso, Majed",
          qualification: "pflegefachkraft",
          itemCategory: ITEM_CATEGORIES.SURCHARGE_SUNDAY,
          priceVersionId: "pv-tc1",
          minutes: 349, // 5h 49m -> 5.82 h
          hourlyRate: "26.40",
          surchargeRatio: "50%",
        },
      ];

      const result = calculateExactInvoice(osoLines, { taxRate: "19%" });

      expect(result.items).toHaveLength(3);

      const baseLine = result.items[0];
      expect(baseLine.displayHourHundredths).toBe(1262);
      expect(baseLine.hoursDecimal).toBe("12.62");
      expect(baseLine.rateCents).toBe(5280);
      expect(baseLine.rateDecimal).toBe("52.80");
      expect(baseLine.amountCents).toBe(66634);
      expect(baseLine.amountDecimal).toBe("666.34");
      expect(baseLine.description).toBe("Pflegefachkraft (Oso, Majed)");

      const satLine = result.items[1];
      expect(satLine.displayHourHundredths).toBe(680);
      expect(satLine.hoursDecimal).toBe("6.80");
      expect(satLine.rateCents).toBe(1584);
      expect(satLine.rateDecimal).toBe("15.84");
      expect(satLine.amountCents).toBe(10771);
      expect(satLine.amountDecimal).toBe("107.71");
      expect(satLine.description).toBe("Samstagzuschlag (Oso, Majed) 30%");

      const sunLine = result.items[2];
      expect(sunLine.displayHourHundredths).toBe(582);
      expect(sunLine.hoursDecimal).toBe("5.82");
      expect(sunLine.rateCents).toBe(2640);
      expect(sunLine.rateDecimal).toBe("26.40");
      expect(sunLine.amountCents).toBe(15365);
      expect(sunLine.amountDecimal).toBe("153.65");
      expect(sunLine.description).toBe("Sonntagzuschlag (Oso, Majed) 50%");

      expect(result.totals.subtotalCents).toBe(92770);
      expect(result.totals.subtotalDecimal).toBe("927.70");
      expect(result.totals.subtotalDisplay).toBe("927,70 €");

      expect(result.totals.taxAmountCents).toBe(17626);
      expect(result.totals.taxAmountDecimal).toBe("176.26");
      expect(result.totals.taxAmountDisplay).toBe("176,26 €");

      expect(result.totals.totalCents).toBe(110396);
      expect(result.totals.totalDecimal).toBe("1103.96");
      expect(result.totals.totalDisplay).toBe("1103,96 €");

      // Verify explicit semantics of line item minutes sum vs service hours
      expect(result.totals.totalLineItemMinutes).toBe(757 + 408 + 349);
      expect(result.totals.totalMinutes).toBe(1514);
    });

    it("TC1 derived surcharge rates: correctly calculates surcharge rates from base rate and rational ratios", () => {
      const derivedLines: RawWorkLineInput[] = [
        {
          workerId: "worker-oso",
          qualification: "pflegefachkraft",
          itemCategory: ITEM_CATEGORIES.SURCHARGE_SATURDAY,
          priceVersionId: "pv-tc1",
          minutes: 408,
          hourlyRate: "52.80",
          surchargeRatio: { numerator: 30, denominator: 100 },
          deriveSurchargeRate: true,
        },
        {
          workerId: "worker-oso",
          qualification: "pflegefachkraft",
          itemCategory: ITEM_CATEGORIES.SURCHARGE_SUNDAY,
          priceVersionId: "pv-tc1",
          minutes: 349,
          hourlyRate: "52.80",
          surchargeRatio: "0.50",
          deriveSurchargeRate: true,
        },
      ];

      const result = calculateExactInvoice(derivedLines);
      expect(result.items[0].rateCents).toBe(1584);
      expect(result.items[0].rateDecimal).toBe("15.84");
      expect(result.items[1].rateCents).toBe(2640);
      expect(result.items[1].rateDecimal).toBe("26.40");
    });
  });

  describe("5. Worker Identity & Aggregation Contract (Defect F09 Fix & Collision Proof Key)", () => {
    it("keeps two workers with identical names but different workerIds strictly separated as distinct lines", () => {
      const lines: RawWorkLineInput[] = [
        {
          workerId: "worker-id-1",
          workerName: "Müller, Hans",
          qualification: "pflegefachkraft",
          itemCategory: ITEM_CATEGORIES.BASE,
          priceVersionId: "v1",
          minutes: 60,
          hourlyRate: "40.80",
        },
        {
          workerId: "worker-id-2",
          workerName: "Müller, Hans",
          qualification: "pflegefachkraft",
          itemCategory: ITEM_CATEGORIES.BASE,
          priceVersionId: "v1",
          minutes: 60,
          hourlyRate: "40.80",
        },
      ];

      const result = calculateExactInvoice(lines);
      expect(result.items).toHaveLength(2);
      expect(result.items[0].workerId).toBe("worker-id-1");
      expect(result.items[1].workerId).toBe("worker-id-2");
      expect(result.items[0].amountCents).toBe(4080);
      expect(result.items[1].amountCents).toBe(4080);
      expect(result.totals.subtotalCents).toBe(8160);
    });

    it("prevents aggregation key collisions when fields contain delimiters (Defect 3 Fix)", () => {
      // "a::b" + "c" vs "a" + "b::c"
      const lines: RawWorkLineInput[] = [
        {
          workerId: "a::b",
          qualification: "c",
          itemCategory: ITEM_CATEGORIES.BASE,
          priceVersionId: "v1",
          minutes: 60,
          hourlyRate: "40.00",
        },
        {
          workerId: "a",
          qualification: "b::c",
          itemCategory: ITEM_CATEGORIES.BASE,
          priceVersionId: "v1",
          minutes: 60,
          hourlyRate: "40.00",
        },
      ];

      // Provide custom allowed qualifications to allow these synthetic test tokens
      const result = calculateExactInvoice(lines, {
        allowedQualifications: ["c", "b::c"],
      });

      // Must remain 2 completely distinct lines and not merge into 1 bucket!
      expect(result.items).toHaveLength(2);
      expect(result.items[0].workerId).toBe("a");
      expect(result.items[0].qualification).toBe("b::c");
      expect(result.items[1].workerId).toBe("a::b");
      expect(result.items[1].qualification).toBe("c");
    });

    it("aggregates raw minutes BEFORE rounding for the same worker in two separate shifts", () => {
      const lines: RawWorkLineInput[] = [
        {
          workerId: "worker-1",
          qualification: "pflegefachkraft",
          itemCategory: ITEM_CATEGORIES.BASE,
          priceVersionId: "v1",
          minutes: 61,
          hourlyRate: "40.00",
        },
        {
          workerId: "worker-1",
          qualification: "pflegefachkraft",
          itemCategory: ITEM_CATEGORIES.BASE,
          priceVersionId: "v1",
          minutes: 61,
          hourlyRate: "40.00",
        },
      ];

      const result = calculateExactInvoice(lines);
      expect(result.items).toHaveLength(1);
      const item = result.items[0];
      expect(item.rawMinutes).toBe(122);
      expect(item.displayHourHundredths).toBe(203);
      expect(item.amountCents).toBe(8120);
    });

    it("does NOT aggregate lines when qualification differs for the same worker", () => {
      const lines: RawWorkLineInput[] = [
        {
          workerId: "worker-1",
          qualification: "pflegefachkraft",
          itemCategory: ITEM_CATEGORIES.BASE,
          priceVersionId: "v1",
          minutes: 60,
          hourlyRate: "50.00",
        },
        {
          workerId: "worker-1",
          qualification: "pflegehelfer",
          itemCategory: ITEM_CATEGORIES.BASE,
          priceVersionId: "v1",
          minutes: 60,
          hourlyRate: "40.00",
        },
      ];

      const result = calculateExactInvoice(lines);
      expect(result.items).toHaveLength(2);
      expect(result.items[0].qualification).toBe("pflegefachkraft");
      expect(result.items[1].qualification).toBe("pflegehelfer");
    });

    it("does NOT aggregate lines when price version differs for the same worker", () => {
      const lines: RawWorkLineInput[] = [
        {
          workerId: "worker-1",
          qualification: "pflegefachkraft",
          itemCategory: ITEM_CATEGORIES.BASE,
          priceVersionId: "v1",
          minutes: 60,
          hourlyRate: "50.00",
        },
        {
          workerId: "worker-1",
          qualification: "pflegefachkraft",
          itemCategory: ITEM_CATEGORIES.BASE,
          priceVersionId: "v2",
          minutes: 60,
          hourlyRate: "50.00",
        },
      ];

      const result = calculateExactInvoice(lines);
      expect(result.items).toHaveLength(2);
    });

    it("does NOT aggregate lines when rate differs for the same worker and qualification", () => {
      const lines: RawWorkLineInput[] = [
        {
          workerId: "worker-1",
          qualification: "pflegefachkraft",
          itemCategory: ITEM_CATEGORIES.BASE,
          priceVersionId: "v1",
          minutes: 60,
          hourlyRate: "50.00",
        },
        {
          workerId: "worker-1",
          qualification: "pflegefachkraft",
          itemCategory: ITEM_CATEGORIES.BASE,
          priceVersionId: "v1",
          minutes: 60,
          hourlyRate: "55.00",
        },
      ];

      const result = calculateExactInvoice(lines);
      expect(result.items).toHaveLength(2);
    });
  });

  describe("6. Full Ratio Precision & Semantic Equivalence (Defect 1 Fix)", () => {
    it("normalizes rational ratios accurately across string, percentage, decimal factor, and rational object", () => {
      const defaultR = { numerator: 0, denominator: 1 };
      expect(normalizeRatio("0.125", defaultR)).toEqual({ numerator: 1, denominator: 8 });
      expect(normalizeRatio("12.5%", defaultR)).toEqual({ numerator: 1, denominator: 8 });
      expect(normalizeRatio({ numerator: 125, denominator: 1000 }, defaultR)).toEqual({
        numerator: 1,
        denominator: 8,
      });
      expect(normalizeRatio("0.19", defaultR)).toEqual({ numerator: 19, denominator: 100 });
      expect(normalizeRatio("19%", defaultR)).toEqual({ numerator: 19, denominator: 100 });
      expect(normalizeRatio("-0.10", defaultR)).toEqual({ numerator: -1, denominator: 10 });
      expect(normalizeRatio(0, defaultR)).toEqual({ numerator: 0, denominator: 1 });
      expect(normalizeRatio(undefined, defaultR)).toEqual(defaultR);
    });

    it("preserves exact ratio for decimal factors and percentage strings equivalently", () => {
      // 1h at 100.00 with 12.5% surcharge -> €12.50
      const lineFactor: RawWorkLineInput = {
        workerId: "w1",
        qualification: "pflegefachkraft",
        itemCategory: ITEM_CATEGORIES.SURCHARGE_SATURDAY,
        priceVersionId: "v1",
        minutes: 60,
        hourlyRate: "100.00",
        surchargeRatio: "0.125",
        deriveSurchargeRate: true,
      };

      const linePercent: RawWorkLineInput = {
        workerId: "w2",
        qualification: "pflegefachkraft",
        itemCategory: ITEM_CATEGORIES.SURCHARGE_SATURDAY,
        priceVersionId: "v1",
        minutes: 60,
        hourlyRate: "100.00",
        surchargeRatio: "12.5%",
        deriveSurchargeRate: true,
      };

      const lineRational: RawWorkLineInput = {
        workerId: "w3",
        qualification: "pflegefachkraft",
        itemCategory: ITEM_CATEGORIES.SURCHARGE_SATURDAY,
        priceVersionId: "v1",
        minutes: 60,
        hourlyRate: "100.00",
        surchargeRatio: { numerator: 1, denominator: 8 },
        deriveSurchargeRate: true,
      };

      const resultFactor = calculateExactInvoice([lineFactor]);
      const resultPercent = calculateExactInvoice([linePercent]);
      const resultRational = calculateExactInvoice([lineRational]);

      // All three must produce identical rate of 1250 cents (€12.50), NOT €13.00!
      expect(resultFactor.items[0].rateCents).toBe(1250);
      expect(resultFactor.items[0].rateDecimal).toBe("12.50");
      expect(resultFactor.items[0].amountCents).toBe(1250);

      expect(resultPercent.items[0].rateCents).toBe(1250);
      expect(resultPercent.items[0].rateDecimal).toBe("12.50");
      expect(resultPercent.items[0].amountCents).toBe(1250);

      expect(resultRational.items[0].rateCents).toBe(1250);
      expect(resultRational.items[0].rateDecimal).toBe("12.50");
      expect(resultRational.items[0].amountCents).toBe(1250);
    });

    it("preserves high-precision ratios like 12.345% without premature rounding", () => {
      const lineHighPrec: RawWorkLineInput = {
        workerId: "w1",
        qualification: "pflegefachkraft",
        itemCategory: ITEM_CATEGORIES.SURCHARGE_SATURDAY,
        priceVersionId: "v1",
        minutes: 60,
        hourlyRate: "100.00",
        surchargeRatio: "12.345%",
        deriveSurchargeRate: true,
      };

      const result = calculateExactInvoice([lineHighPrec]);
      // 10000 * 12345 / 100000 = 1234.5 -> rounds to 1235 cents (€12.35)
      expect(result.items[0].rateCents).toBe(1235);
      expect(result.items[0].rateDecimal).toBe("12.35");
    });

    it("formats ratios accurately without inventing percentages or time windows (Defect 2 Fix)", () => {
      const lineNoRatio: RawWorkLineInput = {
        workerId: "w1",
        workerName: "Hans",
        qualification: "pflegefachkraft",
        itemCategory: ITEM_CATEGORIES.SURCHARGE_SATURDAY,
        priceVersionId: "v1",
        minutes: 60,
        hourlyRate: "15.00",
      };

      const lineCustomRatio: RawWorkLineInput = {
        workerId: "w2",
        workerName: "Anna",
        qualification: "pflegefachkraft",
        itemCategory: ITEM_CATEGORIES.SURCHARGE_NIGHT,
        priceVersionId: "v1",
        minutes: 60,
        hourlyRate: "50.00",
        surchargeRatio: "12.5%",
      };

      const result = calculateExactInvoice([lineNoRatio, lineCustomRatio]);
      // lineNoRatio: must NOT claim "30%"
      expect(result.items[0].description).toBe("Samstagzuschlag (Hans)");
      // lineCustomRatio: must show actual "12,5%" and NOT invent "(22:00-06:00) 25%"
      expect(result.items[1].description).toBe("Nachtzuschlag (Anna) 12,5%");
    });
  });

  describe("7. Safe Integer Totals & Overflow Protection (Defect 4 Fix)", () => {
    it("rejects minute sum overflow even with zero rates using BigInt check", () => {
      // 3 workers with 4_000_000_000_000_000 minutes each -> sum = 12_000_000_000_000_000 (> MAX_SAFE_INTEGER 9_007_199_254_740_991)
      const hugeMinutes = 4_000_000_000_000_000;
      const lines: RawWorkLineInput[] = [
        {
          workerId: "w1",
          qualification: "pflegefachkraft",
          itemCategory: ITEM_CATEGORIES.BASE,
          priceVersionId: "v1",
          minutes: hugeMinutes,
          hourlyRate: "0.00",
        },
        {
          workerId: "w2",
          qualification: "pflegefachkraft",
          itemCategory: ITEM_CATEGORIES.BASE,
          priceVersionId: "v1",
          minutes: hugeMinutes,
          hourlyRate: "0.00",
        },
        {
          workerId: "w3",
          qualification: "pflegefachkraft",
          itemCategory: ITEM_CATEGORIES.BASE,
          priceVersionId: "v1",
          minutes: hugeMinutes,
          hourlyRate: "0.00",
        },
      ];

      expect(() => calculateExactInvoice(lines)).toThrowError(/SAFE_INTEGER_EXCEEDED/);
    });

    it("rejects subtotal overflow even if offsetting negative lines exist", () => {
      const lines: RawWorkLineInput[] = [
        {
          workerId: "w1",
          qualification: "pflegefachkraft",
          itemCategory: ITEM_CATEGORIES.BASE,
          priceVersionId: "v1",
          minutes: 600000000,
          hourlyRate: "80000000.00",
        },
        {
          workerId: "w2",
          qualification: "pflegefachkraft",
          itemCategory: ITEM_CATEGORIES.BASE,
          priceVersionId: "v1",
          minutes: 600000000,
          hourlyRate: "80000000.00",
        },
      ];

      expect(() => calculateExactInvoice(lines)).toThrowError(/SAFE_INTEGER_EXCEEDED/);
    });
  });

  describe("8. Qualification & Negative Minutes Enforcement (Defect 5 Fix)", () => {
    it("rejects unknown qualification with UNKNOWN_QUALIFICATION", () => {
      const line: RawWorkLineInput = {
        workerId: "w1",
        qualification: "unbekannter_beruf",
        itemCategory: ITEM_CATEGORIES.BASE,
        priceVersionId: "v1",
        minutes: 60,
        hourlyRate: "50.00",
      };

      expect(() => calculateExactInvoice([line])).toThrowError(/UNKNOWN_QUALIFICATION/);
    });

    it("accepts known qualifications from domain whitelist", () => {
      for (const qual of KNOWN_QUALIFICATIONS) {
        const result = calculateExactInvoice([
          {
            workerId: `w-${qual}`,
            qualification: qual,
            itemCategory: ITEM_CATEGORIES.BASE,
            priceVersionId: "v1",
            minutes: 60,
            hourlyRate: "30.00",
          },
        ]);
        expect(result.items[0].qualification).toBe(qual);
      }
    });

    it("rejects negative minutes on base work even when allowAdjustments is true", () => {
      const line: RawWorkLineInput = {
        workerId: "w1",
        qualification: "pflegefachkraft",
        itemCategory: ITEM_CATEGORIES.BASE,
        priceVersionId: "v1",
        minutes: -60,
        hourlyRate: "50.00",
      };

      expect(() =>
        calculateExactInvoice([line], {
          allowAdjustments: true,
          allowNegativeWorkMinutes: true,
        })
      ).toThrowError(/Negative Arbeitsminuten sind für die reguläre Kategorie 'base' unzulässig/);
    });

    it("rejects negative minutes on surcharge categories even when allowAdjustments is true", () => {
      const line: RawWorkLineInput = {
        workerId: "w1",
        qualification: "pflegefachkraft",
        itemCategory: ITEM_CATEGORIES.SURCHARGE_SATURDAY,
        priceVersionId: "v1",
        minutes: -60,
        hourlyRate: "15.00",
      };

      expect(() =>
        calculateExactInvoice([line], {
          allowAdjustments: true,
        })
      ).toThrowError(/Negative Arbeitsminuten sind für die reguläre Kategorie 'surcharge_saturday' unzulässig/);
    });

    it("allows negative minutes only on adjustment and discount categories when allowAdjustments is true", () => {
      const lines: RawWorkLineInput[] = [
        {
          workerId: "w1",
          qualification: "pflegefachkraft",
          itemCategory: ITEM_CATEGORIES.BASE,
          priceVersionId: "v1",
          minutes: 120,
          hourlyRate: "50.00",
        },
        {
          workerId: "w1",
          qualification: "pflegefachkraft",
          itemCategory: ITEM_CATEGORIES.ADJUSTMENT,
          priceVersionId: "v1",
          minutes: -30,
          hourlyRate: "50.00",
        },
      ];

      const result = calculateExactInvoice(lines, { allowAdjustments: true });
      expect(result.items).toHaveLength(2);
      expect(result.items[0].amountCents).toBe(10000);
      expect(result.items[1].amountCents).toBe(-2500);
      expect(result.totals.subtotalCents).toBe(7500);
    });
  });

  describe("9. Deterministic Output Ordering", () => {
    it("guarantees byte-identical output ordering regardless of input sequence", () => {
      const lineA: RawWorkLineInput = {
        workerId: "worker-beta",
        qualification: "pflegefachkraft",
        itemCategory: ITEM_CATEGORIES.SURCHARGE_SATURDAY,
        priceVersionId: "v1",
        minutes: 60,
        hourlyRate: "20.00",
      };
      const lineB: RawWorkLineInput = {
        workerId: "worker-alpha",
        qualification: "pflegefachkraft",
        itemCategory: ITEM_CATEGORIES.BASE,
        priceVersionId: "v1",
        minutes: 60,
        hourlyRate: "50.00",
      };
      const lineC: RawWorkLineInput = {
        workerId: "worker-alpha",
        qualification: "pflegefachkraft",
        itemCategory: ITEM_CATEGORIES.SURCHARGE_SUNDAY,
        priceVersionId: "v1",
        minutes: 60,
        hourlyRate: "25.00",
      };

      const result1 = calculateExactInvoice([lineA, lineB, lineC]);
      const result2 = calculateExactInvoice([lineC, lineA, lineB]);
      const result3 = calculateExactInvoice([lineB, lineC, lineA]);

      expect(result1.items.map((i) => `${i.workerId}::${i.itemCategory}`)).toEqual([
        "worker-alpha::base",
        "worker-alpha::surcharge_sunday",
        "worker-beta::surcharge_saturday",
      ]);

      expect(result1).toEqual(result2);
      expect(result2).toEqual(result3);
    });
  });

  describe("10. Formatting Helpers", () => {
    it("formats hundredths and cents properly according to German conventions", () => {
      expect(formatHundredthsGerman(1262)).toBe("12,62");
      expect(formatHundredthsGerman(0)).toBe("0,00");
      expect(formatHundredthsGerman(5)).toBe("0,05");
      expect(formatHundredthsGerman(-1262)).toBe("-12,62");

      expect(formatHundredthsDecimal(1262)).toBe("12.62");
      expect(formatHundredthsDecimal(-1262)).toBe("-12.62");

      expect(formatCentsGerman(92770)).toBe("927,70 €");
      expect(formatCentsGerman(-4250)).toBe("-42,50 €");
      expect(formatCentsDecimal(92770)).toBe("927.70");

      // Terminating decimals are displayed with full precision without truncation or premature rounding
      expect(formatRatioToPercentGerman({ numerator: 19, denominator: 100 })).toBe("19%");
      expect(formatRatioToPercentGerman({ numerator: 1, denominator: 8 })).toBe("12,5%");
      expect(formatRatioToPercentGerman({ numerator: 12345, denominator: 100000 })).toBe("12,345%");
      expect(formatRatioToPercentGerman({ numerator: 0, denominator: 1 })).toBe("0%");
      expect(formatRatioToPercentGerman({ numerator: -1, denominator: 8 })).toBe("-12,5%");

      // Non-terminating fractions are formatted with explicit approximation marker "ca. "
      expect(formatRatioToPercentGerman({ numerator: 1, denominator: 3 })).toBe("ca. 33,33%");
      expect(formatRatioToPercentGerman({ numerator: 2, denominator: 3 })).toBe("ca. 66,67%");
      expect(formatRatioToPercentGerman({ numerator: 1, denominator: 7 })).toBe("ca. 14,29%");
      expect(formatRatioToPercentGerman({ numerator: -1, denominator: 3 })).toBe("ca. -33,33%");
    });
  });

  describe("11. Tax Rate Specifications & Explicit Percent Semantics (Defect 1 Fix)", () => {
    it("interprets { percent: ... } strictly as a percentage without 100x inflation", () => {
      const baseLine: RawWorkLineInput = {
        workerId: "w1",
        qualification: "pflegefachkraft",
        itemCategory: ITEM_CATEGORIES.BASE,
        priceVersionId: "v1",
        minutes: 60,
        hourlyRate: "100.00",
      };

      // { percent: 19 } must yield 19% VAT (€19.00 on €100.00 base, NOT €1900.00!)
      const resNum = calculateExactInvoice([baseLine], { taxRate: { percent: 19 } });
      expect(resNum.totals.subtotalCents).toBe(10000);
      expect(resNum.totals.taxAmountCents).toBe(1900);
      expect(resNum.totals.taxAmountDisplay).toBe("19,00 €");
      expect(resNum.totals.totalCents).toBe(11900);
      expect(resNum.totals.taxRatePercentFormatted).toBe("19%");

      // { percent: "19" } must yield identical 19% VAT
      const resStr = calculateExactInvoice([baseLine], { taxRate: { percent: "19" } });
      expect(resStr.totals.taxAmountCents).toBe(1900);
      expect(resStr.totals.taxAmountDisplay).toBe("19,00 €");
      expect(resStr.totals.totalCents).toBe(11900);
      expect(resStr.totals.taxRatePercentFormatted).toBe("19%");

      // { percent: "19%" } must yield identical 19% VAT
      const resPct = calculateExactInvoice([baseLine], { taxRate: { percent: "19%" } });
      expect(resPct.totals.taxAmountCents).toBe(1900);
      expect(resPct.totals.totalCents).toBe(11900);

      // Top-level "19%" string
      const resTopStr = calculateExactInvoice([baseLine], { taxRate: "19%" });
      expect(resTopStr.totals.taxAmountCents).toBe(1900);
      expect(resTopStr.totals.totalCents).toBe(11900);

      // Top-level rational object { ratio: { numerator: 19, denominator: 100 } }
      const resRatioObj = calculateExactInvoice([baseLine], {
        taxRate: { ratio: { numerator: 19, denominator: 100 } },
      });
      expect(resRatioObj.totals.taxAmountCents).toBe(1900);
      expect(resRatioObj.totals.totalCents).toBe(11900);

      // Top-level factor 0.19
      const resFactor = calculateExactInvoice([baseLine], { taxRate: 0.19 });
      expect(resFactor.totals.taxAmountCents).toBe(1900);
      expect(resFactor.totals.totalCents).toBe(11900);
    });

    it("interprets { percent: '0.19' } as explicit 0.19% (19/10000) adhering strictly to field semantics", () => {
      const baseLine: RawWorkLineInput = {
        workerId: "w1",
        qualification: "pflegefachkraft",
        itemCategory: ITEM_CATEGORIES.BASE,
        priceVersionId: "v1",
        minutes: 60,
        hourlyRate: "100.00",
      };

      // 0.19% on €100.00 is 10000 * 19 / 10000 = 19 cents (€0.19)
      const resPoint19Str = calculateExactInvoice([baseLine], { taxRate: { percent: "0.19" } });
      expect(resPoint19Str.totals.taxAmountCents).toBe(19);
      expect(resPoint19Str.totals.taxAmountDisplay).toBe("0,19 €");
      expect(resPoint19Str.totals.taxRatePercentFormatted).toBe("0,19%");

      const resPoint19Num = calculateExactInvoice([baseLine], { taxRate: { percent: 0.19 } });
      expect(resPoint19Num.totals.taxAmountCents).toBe(19);
      expect(resPoint19Num.totals.taxAmountDisplay).toBe("0,19 €");
      expect(resPoint19Num.totals.taxRatePercentFormatted).toBe("0,19%");
    });

    it("verifies normalizeTaxRate unit behavior for all supported specifications", () => {
      expect(normalizeTaxRate()).toEqual({ numerator: 19, denominator: 100 });
      expect(normalizeTaxRate(undefined)).toEqual({ numerator: 19, denominator: 100 });
      expect(normalizeTaxRate({ percent: 19 })).toEqual({ numerator: 19, denominator: 100 });
      expect(normalizeTaxRate({ percent: "19" })).toEqual({ numerator: 19, denominator: 100 });
      expect(normalizeTaxRate({ percent: "19%" })).toEqual({ numerator: 19, denominator: 100 });
      expect(normalizeTaxRate({ percent: 7 })).toEqual({ numerator: 7, denominator: 100 });
      expect(normalizeTaxRate({ percent: "0.19" })).toEqual({ numerator: 19, denominator: 10000 });
      expect(normalizeTaxRate({ percent: 0.19 })).toEqual({ numerator: 19, denominator: 10000 });
      expect(normalizeTaxRate({ ratio: { numerator: 19, denominator: 100 } })).toEqual({
        numerator: 19,
        denominator: 100,
      });
      expect(normalizeTaxRate("19%")).toEqual({ numerator: 19, denominator: 100 });
      expect(normalizeTaxRate("19")).toEqual({ numerator: 19, denominator: 100 });
      expect(normalizeTaxRate(0.19)).toEqual({ numerator: 19, denominator: 100 });
    });

    it("rejects invalid or ambiguous taxRate specifications", () => {
      expect(() => normalizeTaxRate({ percent: -5 })).toThrowError(ExactMoneyValidationError);
      expect(() => normalizeTaxRate({ percent: "" })).toThrowError(ExactMoneyValidationError);
      expect(() => normalizeTaxRate({ percent: "invalid" })).toThrowError(
        ExactMoneyValidationError
      );
    });
  });

  describe("12. Description Ratio Precision vs Rounded Hourly Rate (Defect 2 Fix)", () => {
    it("displays exact terminating percentage 12,345% in description and tax totals without premature rounding", () => {
      // 1h at base rate 1000.00 with surchargeRatio 12.345%
      // Exact calculation: 100000 cents * 12345 / 100000 = 12345 cents (€123.45)
      const line: RawWorkLineInput = {
        workerId: "w1",
        qualification: "pflegefachkraft",
        itemCategory: ITEM_CATEGORIES.SURCHARGE_SATURDAY,
        priceVersionId: "v1",
        minutes: 60,
        baseHourlyRate: "1000.00",
        surchargeRatio: "12.345%",
      };

      const result = calculateExactInvoice([line], { taxRate: { percent: "12.345" } });
      expect(result.items[0].rateCents).toBe(12345);
      expect(result.items[0].rateDisplay).toBe("123,45 €");
      expect(result.items[0].amountCents).toBe(12345);
      expect(result.items[0].amountDisplay).toBe("123,45 €");

      // Description must display exact percentage "12,345%", NOT rounded "12,35%"
      expect(result.items[0].description).toBe("Samstagzuschlag 12,345%");

      // Tax rate formatting also preserves exact terminating decimals
      expect(result.totals.taxRatePercentFormatted).toBe("12,345%");
    });

    it("uses explicit approximation prefix 'ca. ' for non-terminating ratio in description and tax totals", () => {
      const line: RawWorkLineInput = {
        workerId: "w1",
        qualification: "pflegefachkraft",
        itemCategory: ITEM_CATEGORIES.SURCHARGE_SATURDAY,
        priceVersionId: "v1",
        minutes: 60,
        hourlyRate: "30.00",
        surchargeRatio: { numerator: 1, denominator: 3 },
      };

      const result = calculateExactInvoice([line], {
        taxRate: { ratio: { numerator: 1, denominator: 3 } },
      });
      expect(result.items[0].description).toBe("Samstagzuschlag ca. 33,33%");
      expect(result.totals.taxRatePercentFormatted).toBe("ca. 33,33%");
    });
  });

  describe("13. Deterministic & Truthful Aggregation Outputs (Defect 3 Fix)", () => {
    it("does NOT merge lines with distinct surcharge ratios even if effective rounded cent rate matches", () => {
      // 1h at base rate 100.00
      // Line A: 12.345% -> 10000 * 12345 / 100000 = 1234.5 -> rounds to 1235 cents (€12.35)
      // Line B: 12.349% -> 10000 * 12349 / 100000 = 1234.9 -> rounds to 1235 cents (€12.35)
      // Both round to 1235 cents, but their ratios are distinct (2469/20000 vs 12349/100000).
      // They must NOT merge into a single line, so neither description misrepresents the other.
      const lineA: RawWorkLineInput = {
        workerId: "w1",
        qualification: "pflegefachkraft",
        itemCategory: ITEM_CATEGORIES.SURCHARGE_SATURDAY,
        priceVersionId: "v1",
        minutes: 60,
        baseHourlyRate: "100.00",
        surchargeRatio: "12.345%",
      };

      const lineB: RawWorkLineInput = {
        workerId: "w1",
        qualification: "pflegefachkraft",
        itemCategory: ITEM_CATEGORIES.SURCHARGE_SATURDAY,
        priceVersionId: "v1",
        minutes: 60,
        baseHourlyRate: "100.00",
        surchargeRatio: "12.349%",
      };

      const result = calculateExactInvoice([lineA, lineB]);
      expect(result.items).toHaveLength(2);
      expect(result.items[0].rateCents).toBe(1235);
      expect(result.items[1].rateCents).toBe(1235);
      expect(result.items[0].description).toBe("Samstagzuschlag 12,345%");
      expect(result.items[1].description).toBe("Samstagzuschlag 12,349%");

      // Reverse order must produce identical items sorted deterministically
      const resultRev = calculateExactInvoice([lineB, lineA]);
      expect(resultRev.items).toHaveLength(2);
      expect(resultRev.items[0].description).toBe("Samstagzuschlag 12,345%");
      expect(resultRev.items[1].description).toBe("Samstagzuschlag 12,349%");
    });

    it("deterministically merges custom descriptions alphabetically without input-order dependence", () => {
      const line1: RawWorkLineInput = {
        workerId: "w1",
        qualification: "pflegefachkraft",
        itemCategory: ITEM_CATEGORIES.BASE,
        priceVersionId: "v1",
        minutes: 60,
        hourlyRate: "50.00",
        description: "Spätschicht",
      };

      const line2: RawWorkLineInput = {
        workerId: "w1",
        qualification: "pflegefachkraft",
        itemCategory: ITEM_CATEGORIES.BASE,
        priceVersionId: "v1",
        minutes: 60,
        hourlyRate: "50.00",
        description: "Frühschicht",
      };

      const res1 = calculateExactInvoice([line1, line2]);
      const res2 = calculateExactInvoice([line2, line1]);

      expect(res1.items[0].description).toBe("Frühschicht / Spätschicht");
      expect(res2.items[0].description).toBe("Frühschicht / Spätschicht");

      // Deduplication: two identical descriptions don't produce duplicate labels
      const line3: RawWorkLineInput = { ...line1, description: "Frühschicht" };
      const resDedup = calculateExactInvoice([line2, line3]);
      expect(resDedup.items[0].description).toBe("Frühschicht");
    });

    it("deterministically determines min periodStart and max periodEnd from valid ISO dates", () => {
      const lineLate: RawWorkLineInput = {
        workerId: "w1",
        qualification: "pflegefachkraft",
        itemCategory: ITEM_CATEGORIES.BASE,
        priceVersionId: "v1",
        minutes: 60,
        hourlyRate: "50.00",
        periodStart: "2026-10-15",
        periodEnd: "2026-10-20",
      };

      const lineEarly: RawWorkLineInput = {
        workerId: "w1",
        qualification: "pflegefachkraft",
        itemCategory: ITEM_CATEGORIES.BASE,
        priceVersionId: "v1",
        minutes: 60,
        hourlyRate: "50.00",
        periodStart: "2026-10-01",
        periodEnd: "2026-10-05",
      };

      // Regardless of whether late or early is passed first, start is min (2026-10-01) and end is max (2026-10-20)
      const res1 = calculateExactInvoice([lineLate, lineEarly]);
      const res2 = calculateExactInvoice([lineEarly, lineLate]);

      expect(res1.items[0].periodStart).toBe("2026-10-01");
      expect(res1.items[0].periodEnd).toBe("2026-10-20");

      expect(res2.items[0].periodStart).toBe("2026-10-01");
      expect(res2.items[0].periodEnd).toBe("2026-10-20");
    });

    it("filters out invalid date strings without corrupting periodStart / periodEnd", () => {
      const lineValid: RawWorkLineInput = {
        workerId: "w1",
        qualification: "pflegefachkraft",
        itemCategory: ITEM_CATEGORIES.BASE,
        priceVersionId: "v1",
        minutes: 60,
        hourlyRate: "50.00",
        periodStart: "2026-10-05",
        periodEnd: "2026-10-10",
      };

      const lineInvalidDates: RawWorkLineInput = {
        workerId: "w1",
        qualification: "pflegefachkraft",
        itemCategory: ITEM_CATEGORIES.BASE,
        priceVersionId: "v1",
        minutes: 60,
        hourlyRate: "50.00",
        periodStart: "not-a-date",
        periodEnd: "invalid-string",
      };

      const res = calculateExactInvoice([lineValid, lineInvalidDates]);
      expect(res.items[0].periodStart).toBe("2026-10-05");
      expect(res.items[0].periodEnd).toBe("2026-10-10");

      // If all dates are invalid, periodStart and periodEnd remain undefined
      const resAllInvalid = calculateExactInvoice([lineInvalidDates]);
      expect(resAllInvalid.items[0].periodStart).toBeUndefined();
      expect(resAllInvalid.items[0].periodEnd).toBeUndefined();
    });
  });
});
