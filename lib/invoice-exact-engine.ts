/**
 * Exact Monetary Calculation Engine (v2) - Pure, Independent Calculation Unit
 *
 * RheinAhr Dienstleistungen GmbH - Invoice Engine Modernization (Phase 2)
 *
 * Mathematical Principles:
 * 1. Zero Floating-Point Arithmetic for Money:
 *    All intermediate operations and multiplications are calculated using exact integer
 *    arithmetic (scaled BigInt in cents, basis points, or exact integer fractions).
 *    Never uses Number.EPSILON, Math.round on floats, or binary floating-point multiplication.
 * 2. Pre-Rounding Aggregation:
 *    Raw shift minutes are summed per unique key (workerId, qualification, itemCategory,
 *    priceVersionId, rateInCents) BEFORE rounding hours.
 * 3. Commercial Rounding (DIN 1333 / Kaufmännische Rundung):
 *    Round Half Away From Zero:
 *    - For x >= 0: floor(x + 0.5)
 *    - For x < 0:  -floor(|x| + 0.5)
 * 4. Display-Anchored Line Item Math:
 *    Line items are computed from the displayed hours and displayed rate:
 *    displayHourHundredths = roundHalfAwayFromZero(rawMinutes * 100 / 60)
 *    lineCents = roundHalfAwayFromZero(displayHourHundredths * rateCents / 100)
 * 5. Net Subtotal & VAT:
 *    Subtotal equals the exact sum of line items in cents.
 *    VAT is calculated once on the net subtotal in cents using the exact tax ratio.
 *    Gross total equals subtotal + VAT.
 * 6. Symmetric Sign Policy:
 *    Adjustments/discounts use the exact symmetric Round Half Away From Zero rule.
 * 7. Safe Integer Guarantee:
 *    All aggregations and intermediate sums are verified against Number.isSafeInteger
 *    using BigInt arithmetic to guarantee zero integer overflow and lossless JSON serialization.
 */

export class ExactMoneyValidationError extends Error {
  public readonly code: string;
  public readonly field?: string;
  public readonly details?: unknown;

  constructor(code: string, message: string, field?: string, details?: unknown) {
    super(`[${code}] ${message}`);
    this.name = "ExactMoneyValidationError";
    this.code = code;
    this.field = field;
    this.details = details;
  }
}

/**
 * Standard Item Categories
 */
export const ITEM_CATEGORIES = {
  BASE: "base",
  SURCHARGE_SATURDAY: "surcharge_saturday",
  SURCHARGE_SUNDAY: "surcharge_sunday",
  SURCHARGE_HOLIDAY: "surcharge_holiday",
  SURCHARGE_NIGHT: "surcharge_night",
  ADJUSTMENT: "adjustment",
  DISCOUNT: "discount",
} as const;

export type ItemCategory = (typeof ITEM_CATEGORIES)[keyof typeof ITEM_CATEGORIES] | (string & {});

/**
 * Recognizable canonical qualifications in the domain
 */
export const KNOWN_QUALIFICATIONS = [
  "pflegefachkraft",
  "pflegehelfer",
  "betreuungskraft",
  "pflegedienstleitung",
  "kuechenhilfe",
  "hausmeister",
  "pflegeassistenz",
  "hebamme",
] as const;

export type KnownQualification = (typeof KNOWN_QUALIFICATIONS)[number];

/**
 * Exact Rational Ratio (e.g. 19/100 for 19% VAT, or 1/8 for 12.5% surcharge)
 */
export type ExactRatio = {
  numerator: number;
  denominator: number;
};

/**
 * Raw Work Line Input to the Engine
 */
export type RawWorkLineInput = {
  /** Unique permanent identifier of the worker (mandatory, prevents aggregating different workers with identical names) */
  workerId: string;
  /** Optional worker display name (for human-readable rendering only, NOT used for aggregation) */
  workerName?: string;
  /** Valid qualification code (mandatory, e.g. "pflegefachkraft", "pflegehelfer") */
  qualification: string;
  /** Category of the service or surcharge (mandatory) */
  itemCategory: ItemCategory;
  /** Contract or price list version identifier (mandatory) */
  priceVersionId: string;
  /** Work minutes (must be an integer; >= 0 for regular work, negative only allowed for adjustments/discounts) */
  minutes: number;
  /**
   * Effective hourly rate or base rate. Can be supplied as:
   * - Decimal string (e.g. "52.80", "40.00", "0.00")
   * - Object with integer cents (e.g. { cents: 5280 })
   * - Number (e.g. 52.8, validated for precision)
   *
   * By default, hourlyRate is treated as the effective hourly rate.
   * If baseHourlyRate is provided, or if deriveSurchargeRate is set to true (or baseRate provided),
   * the effective rate is computed as: roundHalfAwayFromZero(baseRate * surchargeRatio).
   */
  /** Effective hourly rate in cents or decimal string (e.g. 5280 or "52.80"). Optional if baseHourlyRate is specified. */
  hourlyRate?: string | number | { cents: number };
  /**
   * Base hourly rate to derive surcharge rate from when hourlyRate is not already effective.
   */
  baseHourlyRate?: string | number | { cents: number };
  /**
   * Surcharge ratio / percentage.
   * Accepts decimal factor (e.g. "0.125" for 12.5%), percentage string (e.g. "12.5%"),
   * number (0.125 or 12.5), or rational ratio ({ numerator: 1, denominator: 8 }).
   * Used for description rendering, and for deriving effective rate if deriveSurchargeRate or baseHourlyRate is used.
   */
  surchargeRatio?: ExactRatio | string | number;
  /**
   * Explicitly flag whether hourlyRate provided is a base rate that should be multiplied by surchargeRatio
   * to compute the effective rate. Defaults to false (hourlyRate is already effective rate).
   */
  deriveSurchargeRate?: boolean;
  /** Optional custom line description */
  description?: string;
  /** Optional date range for display */
  periodStart?: string;
  periodEnd?: string;
};

/**
 * Tax Rate Specification
 */
export type TaxRateSpecification =
  | { ratio: ExactRatio }
  | { percent: number | string }
  | number
  | string;

/**
 * Calculation Options
 */
export type ExactCalculationOptions = {
  /** Tax rate to apply to subtotal (default is 19% if omitted) */
  taxRate?: TaxRateSpecification;
  /** Allow negative minutes for adjustment and discount line items (default: false; regular work categories like base/surcharges must always be >= 0) */
  allowAdjustments?: boolean;
  /** Alias for backwards compatibility with test calls */
  allowNegativeWorkMinutes?: boolean;
  /** Whitelist of accepted qualification codes (defaults to KNOWN_QUALIFICATIONS) */
  allowedQualifications?: readonly string[] | Set<string>;
};

/**
 * Calculated Line Item Output
 */
export type CalculatedLineItem = {
  pos: number;
  workerId: string;
  workerName?: string;
  qualification: string;
  itemCategory: ItemCategory;
  priceVersionId: string;
  description: string;
  periodStart?: string;
  periodEnd?: string;
  rawMinutes: number;
  displayHourHundredths: number; // e.g. 1262 for 12.62 hours
  hoursDisplay: string; // e.g. "12,62"
  hoursDecimal: string; // e.g. "12.62"
  rateCents: number; // e.g. 5280 for 52.80 €
  rateDisplay: string; // e.g. "52,80 €"
  rateDecimal: string; // e.g. "52.80"
  amountCents: number; // e.g. 66634 for 666.34 €
  amountDisplay: string; // e.g. "666,34 €"
  amountDecimal: string; // e.g. "666.34"
};

/**
 * Overall Invoice Totals Output
 */
export type CalculatedInvoiceTotals = {
  subtotalCents: number;
  subtotalDisplay: string; // e.g. "927,70 €"
  subtotalDecimal: string; // e.g. "927.70"
  taxRatePercentFormatted: string; // e.g. "19%"
  taxRateRatio: ExactRatio;
  taxAmountCents: number;
  taxAmountDisplay: string; // e.g. "176,26 €"
  taxAmountDecimal: string; // e.g. "176.26"
  totalCents: number;
  totalDisplay: string; // e.g. "1103,96 €"
  totalDecimal: string; // e.g. "1103.96"
  /**
   * Sum of minutes across all line items (note: line items may include both base and surcharge lines for the same shift).
   * Do not interpret as distinct shift/service hours.
   */
  totalLineItemMinutes: number;
  /** Legacy alias for totalLineItemMinutes */
  totalMinutes: number;
  lineItemCount: number;
  calculationVersion: "v2";
};

/**
 * Full Engine Calculation Result
 */
export type ExactCalculationResult = {
  items: CalculatedLineItem[];
  totals: CalculatedInvoiceTotals;
};

const B_ZERO = BigInt(0);
const B_ONE = BigInt(1);
const B_TWO = BigInt(2);
const B_SIXTY = BigInt(60);
const B_HUNDRED = BigInt(100);
const B_TEN = BigInt(10);
const B_MAX_SAFE_INT = BigInt(Number.MAX_SAFE_INTEGER);
const B_MIN_SAFE_INT = BigInt(Number.MIN_SAFE_INTEGER);

/**
 * Commercial Rounding (Round Half Away From Zero) using BigInt Arithmetic.
 * Implements DIN 1333 / BMF guidelines without floating point error.
 *
 * For numerator >= 0:
 *   q = numerator / denominator
 *   r = numerator % denominator
 *   if (2 * r >= denominator) q += 1
 *
 * For numerator < 0:
 *   Symmetric: -roundHalfAwayFromZero(|numerator|, denominator)
 */
export function divideRoundHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= B_ZERO) {
    throw new ExactMoneyValidationError(
      "INVALID_DENOMINATOR",
      "Der Nenner für die Division muss eine positive Ganzzahl größer als 0 sein."
    );
  }

  const sign = numerator < B_ZERO ? -B_ONE : B_ONE;
  const absNum = numerator < B_ZERO ? -numerator : numerator;

  let quotient = absNum / denominator;
  const remainder = absNum % denominator;

  if (B_TWO * remainder >= denominator) {
    quotient += B_ONE;
  }

  return sign * quotient;
}

/**
 * Computes greatest common divisor using Euclidean algorithm for exact ratio reduction.
 */
function gcdBigInt(a: bigint, b: bigint): bigint {
  let x = a < B_ZERO ? -a : a;
  let y = b < B_ZERO ? -b : b;
  while (y !== B_ZERO) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x;
}

/**
 * Parses any supported monetary rate input into exact integer cents.
 * Rejects localized formatting strings, empty strings, NaN, Infinity, and unsafe numbers.
 */
export function parseRateToCents(
  rate: string | number | { cents: number },
  fieldName = "hourlyRate"
): number {
  if (rate === null || rate === undefined) {
    throw new ExactMoneyValidationError(
      "MISSING_RATE",
      `Das Pflichtfeld '${fieldName}' fehlt oder ist null/undefined.`,
      fieldName
    );
  }

  if (typeof rate === "object" && "cents" in rate) {
    const c = rate.cents;
    if (typeof c !== "number" || !Number.isSafeInteger(c)) {
      throw new ExactMoneyValidationError(
        "INVALID_RATE_CENTS",
        `Ungültiger Cent-Betrag im Objekt: '${c}'.`,
        fieldName
      );
    }
    return c;
  }

  if (typeof rate === "number") {
    if (!Number.isFinite(rate)) {
      throw new ExactMoneyValidationError(
        "INVALID_RATE_NUMBER",
        `Der Stundensatz '${rate}' ist keine gültige endliche Zahl.`,
        fieldName
      );
    }
    return parseRateToCents(rate.toString(), fieldName);
  }

  if (typeof rate === "string") {
    const trimmed = rate.trim();
    if (!trimmed) {
      throw new ExactMoneyValidationError(
        "EMPTY_RATE_STRING",
        `Das Feld '${fieldName}' darf kein leerer Text sein.`,
        fieldName
      );
    }

    if (trimmed.includes("€") || trimmed.includes(",")) {
      throw new ExactMoneyValidationError(
        "UNSUPPORTED_LOCALIZED_RATE_STRING",
        `Lokalisierte Währungszeichen oder Kommas ('${trimmed}') sind als numerische Eingabe unzulässig. Verwenden Sie ein standardisiertes Dezimalformat mit Punkt (z.B. '52.80').`,
        fieldName
      );
    }

    const decimalRegex = /^-?\d+(\.\d+)?$/;
    if (!decimalRegex.test(trimmed)) {
      throw new ExactMoneyValidationError(
        "INVALID_DECIMAL_FORMAT",
        `Das Zahlenformat für '${fieldName}' ('${trimmed}') ist ungültig.`,
        fieldName
      );
    }

    const isNegative = trimmed.startsWith("-");
    const absString = isNegative ? trimmed.slice(1) : trimmed;
    const [intPart, fracPart = ""] = absString.split(".");

    const intVal = BigInt(intPart);
    const paddedFrac = fracPart.padEnd(2, "0");
    const firstTwo = BigInt(paddedFrac.slice(0, 2));

    let centsBig = intVal * B_HUNDRED + firstTwo;

    if (fracPart.length > 2) {
      const remainingFrac = BigInt(fracPart.slice(2));
      const remainingDiv = B_TEN ** BigInt(fracPart.length - 2);
      if (B_TWO * remainingFrac >= remainingDiv) {
        centsBig += B_ONE;
      }
    }

    const signedCents = isNegative ? -centsBig : centsBig;
    const finalNumber = Number(signedCents);

    if (!Number.isSafeInteger(finalNumber)) {
      throw new ExactMoneyValidationError(
        "SAFE_INTEGER_EXCEEDED",
        `Der Cent-Betrag überschreitet das sichere Ganzzahllimit von JavaScript.`,
        fieldName
      );
    }

    return finalNumber;
  }

  throw new ExactMoneyValidationError(
    "UNSUPPORTED_RATE_TYPE",
    `Der Typ für '${fieldName}' wird nicht unterstützt: ${typeof rate}`,
    fieldName
  );
}

/**
 * Normalizes any ratio or percentage input to an exact irreducible integer fraction (numerator / denominator).
 * Retains infinite arbitrary decimal precision without cent rounding or premature float conversion.
 *
 * Interpretation Contract:
 * - String ending with "%": e.g. "12.5%" -> 12.5 / 100 = 125 / 1000 = 1 / 8
 * - String without "%":
 *     e.g. "0.125" -> factor: 125 / 1000 = 1 / 8
 *     e.g. "1.5"   -> factor: 15 / 10 = 3 / 2 (150%)
 * - Number:
 *     If number >= 1.0 (e.g. 12.5 or 19): interpreted as percentage (12.5% -> 1/8)
 *     If number < 1.0 (e.g. 0.125 or 0.19): interpreted as factor (0.125 -> 1/8)
 *     If number === 0: 0 / 1
 *     If number < 0: negative factor (e.g. -0.10 -> -1/10)
 */
export function normalizeRatio(
  spec: ExactRatio | string | number | undefined,
  defaultRatio: ExactRatio,
  fieldName = "ratio"
): ExactRatio {
  if (spec === undefined || spec === null) {
    return defaultRatio;
  }

  if (typeof spec === "object" && "numerator" in spec && "denominator" in spec) {
    const { numerator, denominator } = spec;
    if (
      typeof numerator !== "number" ||
      typeof denominator !== "number" ||
      !Number.isSafeInteger(numerator) ||
      !Number.isSafeInteger(denominator) ||
      denominator <= 0
    ) {
      throw new ExactMoneyValidationError(
        "INVALID_RATIO_OBJECT",
        `Ungültiges Verhältnis-Objekt für '${fieldName}': Zähler und Nenner müssen ganze Zahlen sein, und der Nenner muss > 0 sein.`,
        fieldName
      );
    }
    const g = gcdBigInt(BigInt(numerator), BigInt(denominator));
    return {
      numerator: Number(BigInt(numerator) / g),
      denominator: Number(BigInt(denominator) / g),
    };
  }

  if (typeof spec === "number") {
    if (!Number.isFinite(spec)) {
      throw new ExactMoneyValidationError(
        "INVALID_RATIO_NUMBER",
        `Das Verhältnis '${spec}' für '${fieldName}' ist keine gültige Zahl.`,
        fieldName
      );
    }
    if (spec >= 1) {
      return normalizeRatio(`${spec}%`, defaultRatio, fieldName);
    }
    return normalizeRatio(spec.toString(), defaultRatio, fieldName);
  }

  if (typeof spec === "string") {
    const trimmed = spec.trim();
    if (!trimmed) {
      throw new ExactMoneyValidationError(
        "EMPTY_RATIO_STRING",
        `Das Verhältnis-Feld '${fieldName}' darf kein leerer Text sein.`,
        fieldName
      );
    }

    if (trimmed.includes("€") || trimmed.includes(",")) {
      throw new ExactMoneyValidationError(
        "UNSUPPORTED_LOCALIZED_RATIO_STRING",
        `Lokalisierte Kommas oder Symbole ('${trimmed}') sind im Verhältnis unzulässig. Verwenden Sie Standard-Dezimalzahlen mit Punkt.`,
        fieldName
      );
    }

    let isPercentage = false;
    let numericStr = trimmed;
    if (trimmed.endsWith("%")) {
      isPercentage = true;
      numericStr = trimmed.slice(0, -1).trim();
    }

    const decimalRegex = /^-?\d+(\.\d+)?$/;
    if (!decimalRegex.test(numericStr)) {
      throw new ExactMoneyValidationError(
        "INVALID_DECIMAL_FORMAT",
        `Das Verhältnisformat '${trimmed}' für '${fieldName}' ist ungültig.`,
        fieldName
      );
    }

    const isNegative = numericStr.startsWith("-");
    const absStr = isNegative ? numericStr.slice(1) : numericStr;
    const [intPart, fracPart = ""] = absStr.split(".");

    const scale = fracPart.length;
    const combinedDigits = `${intPart}${fracPart}`;
    let numBig = BigInt(combinedDigits);
    let denBig = B_TEN ** BigInt(scale);

    if (isPercentage) {
      denBig *= B_HUNDRED;
    }

    if (isNegative) {
      numBig = -numBig;
    }

    const g = gcdBigInt(numBig, denBig);
    numBig /= g;
    denBig /= g;

    const numSafe = Number(numBig);
    const denSafe = Number(denBig);

    if (!Number.isSafeInteger(numSafe) || !Number.isSafeInteger(denSafe)) {
      throw new ExactMoneyValidationError(
        "SAFE_INTEGER_EXCEEDED",
        `Das Verhältnis für '${fieldName}' überschreitet das sichere Ganzzahllimit.`,
        fieldName
      );
    }

    return { numerator: numSafe, denominator: denSafe };
  }

  throw new ExactMoneyValidationError(
    "UNSUPPORTED_RATIO_TYPE",
    `Der Typ für '${fieldName}' wird nicht unterstützt: ${typeof spec}`,
    fieldName
  );
}

/**
 * Normalizes Tax Rate input (default 19% VAT).
 *
 * Interpretation Contract:
 * - undefined | null: Default VAT 19% ({ numerator: 19, denominator: 100 })
 * - { percent: number | string }: Explicit percentage value (e.g. 19 or "19" or "19%" -> 19%, 0.19 -> 0.19% = 19/10000).
 * - { ratio: ExactRatio }: Exact rational fraction (e.g. { numerator: 19, denominator: 100 }).
 * - Top-level string: e.g. "19%" -> 19%, "0.19" -> factor 0.19 = 19%. If "19" without %, interpreted as 19% in VAT context.
 * - Top-level number: e.g. 19 -> 19%, 0.19 -> factor 0.19 = 19%.
 */
export function normalizeTaxRate(taxRateSpec?: TaxRateSpecification): ExactRatio {
  const defaultVat: ExactRatio = { numerator: 19, denominator: 100 };

  if (taxRateSpec === undefined || taxRateSpec === null) {
    return defaultVat;
  }

  if (typeof taxRateSpec === "object") {
    if ("ratio" in taxRateSpec && taxRateSpec.ratio !== undefined) {
      return normalizeRatio(taxRateSpec.ratio, defaultVat, "taxRate.ratio");
    }
    if ("percent" in taxRateSpec && taxRateSpec.percent !== undefined) {
      const p = taxRateSpec.percent;
      if (typeof p === "number") {
        if (!Number.isFinite(p) || p < 0) {
          throw new ExactMoneyValidationError(
            "INVALID_TAX_RATE",
            `Der Prozentwert für 'taxRate.percent' ('${p}') ist ungültig.`,
            "taxRate.percent"
          );
        }
        return normalizeRatio(`${p}%`, defaultVat, "taxRate.percent");
      }
      if (typeof p === "string") {
        const trimmed = p.trim();
        if (!trimmed) {
          throw new ExactMoneyValidationError(
            "EMPTY_TAX_RATE",
            "Das Feld 'taxRate.percent' darf kein leerer Text sein.",
            "taxRate.percent"
          );
        }
        const withPercent = trimmed.endsWith("%") ? trimmed : `${trimmed}%`;
        return normalizeRatio(withPercent, defaultVat, "taxRate.percent");
      }
      throw new ExactMoneyValidationError(
        "INVALID_TAX_RATE_TYPE",
        `Ungültiger Typ für 'taxRate.percent': ${typeof p}`,
        "taxRate.percent"
      );
    }
    if ("numerator" in taxRateSpec && "denominator" in taxRateSpec) {
      return normalizeRatio(taxRateSpec as ExactRatio, defaultVat, "taxRate");
    }
    throw new ExactMoneyValidationError(
      "INVALID_TAX_RATE_SPEC",
      "Ungültiges Steuersatz-Objekt. Erwartet wird ein ExactRatio, { ratio } oder { percent }.",
      "taxRate"
    );
  }

  if (typeof taxRateSpec === "string") {
    const trimmed = taxRateSpec.trim();
    if (!trimmed.endsWith("%")) {
      const num = Number(trimmed);
      if (Number.isFinite(num) && num >= 1) {
        return normalizeRatio(`${trimmed}%`, defaultVat, "taxRate");
      }
    }
    return normalizeRatio(trimmed, defaultVat, "taxRate");
  }

  if (typeof taxRateSpec === "number") {
    return normalizeRatio(taxRateSpec, defaultVat, "taxRate");
  }

  throw new ExactMoneyValidationError(
    "INVALID_TAX_RATE_TYPE",
    `Ungültiger Typ für Steuersatz: ${typeof taxRateSpec}`,
    "taxRate"
  );
}

/**
 * Validates ISO date string format (YYYY-MM-DD or standard ISO 8601).
 */
export function isValidDateString(d: string): boolean {
  if (!d || typeof d !== "string") return false;
  const trimmed = d.trim();
  const isoRegex = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;
  if (!isoRegex.test(trimmed)) return false;
  const parsed = new Date(trimmed);
  return !isNaN(parsed.getTime());
}

/**
 * Format integer hundredths (e.g. 1262) to German decimal format (e.g. "12,62")
 */
export function formatHundredthsGerman(hundredths: number): string {
  const isNegative = hundredths < 0;
  const abs = Math.abs(hundredths);
  const intPart = Math.floor(abs / 100);
  const fracPart = String(abs % 100).padStart(2, "0");
  const prefix = isNegative ? "-" : "";
  return `${prefix}${intPart},${fracPart}`;
}

/**
 * Format integer hundredths (e.g. 1262) to standard decimal string (e.g. "12.62")
 */
export function formatHundredthsDecimal(hundredths: number): string {
  const isNegative = hundredths < 0;
  const abs = Math.abs(hundredths);
  const intPart = Math.floor(abs / 100);
  const fracPart = String(abs % 100).padStart(2, "0");
  const prefix = isNegative ? "-" : "";
  return `${prefix}${intPart}.${fracPart}`;
}

/**
 * Format integer cents to German currency string (e.g. 66634 -> "666,34 €")
 */
export function formatCentsGerman(cents: number): string {
  return `${formatHundredthsGerman(cents)} €`;
}

/**
 * Format integer cents to decimal string (e.g. 66634 -> "666.34")
 */
export function formatCentsDecimal(cents: number): string {
  return formatHundredthsDecimal(cents);
}

/**
 * Formats an exact ratio to an honest German percentage string:
 * - If the decimal representation of the percentage terminates (prime factors of reduced denominator in percentage form are only 2 and 5):
 *   displays all exact decimal digits without truncation or premature rounding (e.g. 19/100 -> "19%", 1/8 -> "12,5%", 12345/100000 -> "12,345%").
 * - If non-terminating (e.g. 1/3 = 33.333...%):
 *   displays commercial rounded percentage with explicit approximation prefix "ca. " (e.g. "ca. 33,33%").
 */
export function formatRatioToPercentGerman(ratio: ExactRatio): string {
  if (ratio.denominator <= 0) {
    throw new ExactMoneyValidationError(
      "INVALID_DENOMINATOR",
      "Nenner für Verhältnis-Formatierung muss > 0 sein."
    );
  }

  const isNegative = ratio.numerator < 0;
  const absNum = BigInt(Math.abs(ratio.numerator));
  const den = BigInt(ratio.denominator);

  if (absNum === B_ZERO) {
    return "0%";
  }

  // Fraction for percentage is (100 * absNum) / den
  const percentNum = absNum * B_HUNDRED;
  const g = gcdBigInt(percentNum, den);
  const redNum = percentNum / g;
  const redDen = den / g;

  // Check if reduced denominator has only prime factors 2 and 5
  let tempDen = redDen;
  while (tempDen % B_TWO === B_ZERO) {
    tempDen /= B_TWO;
  }
  while (tempDen % BigInt(5) === B_ZERO) {
    tempDen /= BigInt(5);
  }
  const isTerminating = tempDen === B_ONE;

  const prefix = isNegative ? "-" : "";

  if (isTerminating) {
    const intPart = redNum / redDen;
    let remainder = redNum % redDen;

    if (remainder === B_ZERO) {
      return `${prefix}${intPart}%`;
    }

    let fracDigits = "";
    let safetyCounter = 0;
    while (remainder > B_ZERO && safetyCounter < 12) {
      remainder *= B_TEN;
      const digit = remainder / redDen;
      fracDigits += digit.toString();
      remainder %= redDen;
      safetyCounter++;
    }

    if (remainder === B_ZERO) {
      return `${prefix}${intPart},${fracDigits}%`;
    }
  }

  // Non-terminating fraction: format with commercial rounding to 2 decimal places with "ca. "
  const numBasisPoints = absNum * BigInt(10000);
  const basisPoints = divideRoundHalfAwayFromZero(numBasisPoints, den);
  const bpNumber = Number(basisPoints);
  const intPart = Math.floor(bpNumber / 100);
  const fracPart = bpNumber % 100;

  let formattedVal = "";
  if (fracPart === 0) {
    formattedVal = `${intPart}%`;
  } else if (fracPart % 10 === 0) {
    formattedVal = `${intPart},${fracPart / 10}%`;
  } else {
    formattedVal = `${intPart},${String(fracPart).padStart(2, "0")}%`;
  }

  return `ca. ${prefix}${formattedVal}`;
}

/**
 * Default German qualification label resolver
 */
export function defaultQualificationLabel(qual: string): string {
  const map: Record<string, string> = {
    pflegefachkraft: "Pflegefachkraft",
    pflegehelfer: "Pflegehilfskraft",
    betreuungskraft: "Betreuungskraft",
    pflegedienstleitung: "Pflegedienstleitung",
    kuechenhilfe: "Küchenhilfe",
    hausmeister: "Hausmeister",
    pflegeassistenz: "Pflegeassistenz",
    hebamme: "Hebamme",
  };
  return map[qual.toLowerCase()] || qual;
}

/**
 * Default human-readable German item category label.
 * Never invents unverified percentages or shift time windows.
 * If an exact surcharge ratio is provided, it is appended accurately.
 */
export function defaultCategoryLabel(
  category: ItemCategory,
  qual: string,
  workerName?: string,
  ratio?: ExactRatio
): string {
  const qLabel = defaultQualificationLabel(qual);
  const namePart = workerName ? ` (${workerName})` : "";
  const percentSuffix = ratio ? ` ${formatRatioToPercentGerman(ratio)}` : "";

  switch (category) {
    case ITEM_CATEGORIES.BASE:
      return `${qLabel}${namePart}`;
    case ITEM_CATEGORIES.SURCHARGE_SATURDAY:
      return `Samstagzuschlag${namePart}${percentSuffix}`;
    case ITEM_CATEGORIES.SURCHARGE_SUNDAY:
      return `Sonntagzuschlag${namePart}${percentSuffix}`;
    case ITEM_CATEGORIES.SURCHARGE_HOLIDAY:
      return `Feiertagzuschlag${namePart}${percentSuffix}`;
    case ITEM_CATEGORIES.SURCHARGE_NIGHT:
      return `Nachtzuschlag${namePart}${percentSuffix}`;
    case ITEM_CATEGORIES.ADJUSTMENT:
      return `Korrektur / Anpassung${namePart}`;
    case ITEM_CATEGORIES.DISCOUNT:
      return `Rabatt / Nachlass${namePart}`;
    default:
      return `${category}${namePart}${percentSuffix}`;
  }
}

/**
 * Internal grouped aggregation bucket
 */
interface AggregationBucket {
  workerId: string;
  workerName?: string;
  qualification: string;
  itemCategory: ItemCategory;
  priceVersionId: string;
  rateCents: number;
  totalMinutesBig: bigint;
  customDescriptions: string[];
  periodStarts: string[];
  periodEnds: string[];
  surchargeRatio?: ExactRatio;
}

/**
 * Category sorting priority for deterministic output ordering
 */
function getCategorySortPriority(cat: ItemCategory): number {
  switch (cat) {
    case ITEM_CATEGORIES.BASE:
      return 1;
    case ITEM_CATEGORIES.SURCHARGE_SATURDAY:
      return 2;
    case ITEM_CATEGORIES.SURCHARGE_SUNDAY:
      return 3;
    case ITEM_CATEGORIES.SURCHARGE_HOLIDAY:
      return 4;
    case ITEM_CATEGORIES.SURCHARGE_NIGHT:
      return 5;
    case ITEM_CATEGORIES.ADJUSTMENT:
      return 6;
    case ITEM_CATEGORIES.DISCOUNT:
      return 7;
    default:
      return 100;
  }
}

/**
 * Creates a collision-free JSON-structured aggregation key.
 * Prevents delimiter injection attacks where fields containing "::" could collide.
 * Includes ratioKey to ensure lines with different surcharge ratios never merge into the same bucket,
 * preventing misleading descriptions or lost ratio metadata.
 */
function createAggregationKey(
  workerId: string,
  qualification: string,
  itemCategory: string,
  priceVersionId: string,
  rateCents: number,
  ratioKey: string
): string {
  return JSON.stringify([workerId, qualification, itemCategory, priceVersionId, rateCents, ratioKey]);
}

/**
 * Primary calculation function for Phase 2:
 * Processes raw work minute entries, aggregates per distinct key, calculates commercial
 * line items and exact net/VAT/gross totals without floating point error.
 */
export function calculateExactInvoice(
  lines: RawWorkLineInput[],
  options?: ExactCalculationOptions
): ExactCalculationResult {
  if (!Array.isArray(lines)) {
    throw new ExactMoneyValidationError(
      "INVALID_INPUT",
      "Die Eingabe 'lines' muss ein Array von Arbeitszeilen sein."
    );
  }

  const taxRatio = normalizeTaxRate(options?.taxRate);
  const allowAdjustments = options?.allowAdjustments ?? options?.allowNegativeWorkMinutes ?? false;

  const allowedQualificationsSet: Set<string> = options?.allowedQualifications
    ? new Set(
        options.allowedQualifications instanceof Set
          ? Array.from(options.allowedQualifications).map((q) => q.toLowerCase())
          : options.allowedQualifications.map((q) => q.toLowerCase())
      )
    : new Set(KNOWN_QUALIFICATIONS.map((q) => q.toLowerCase()));

  // Map to hold aggregated buckets keyed strictly by collision-free JSON tuple
  const buckets = new Map<string, AggregationBucket>();

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];

    // 1. Validate workerId
    if (!line.workerId || typeof line.workerId !== "string" || !line.workerId.trim()) {
      throw new ExactMoneyValidationError(
        "INVALID_WORKER_ID",
        `Zeile ${idx + 1}: 'workerId' ist erforderlich und darf nicht leer sein.`,
        "workerId",
        { lineIndex: idx }
      );
    }
    const cleanWorkerId = line.workerId.trim();

    // 2. Validate qualification
    if (!line.qualification || typeof line.qualification !== "string" || !line.qualification.trim()) {
      throw new ExactMoneyValidationError(
        "INVALID_QUALIFICATION",
        `Zeile ${idx + 1}: 'qualification' ist erforderlich und darf nicht leer sein.`,
        "qualification",
        { lineIndex: idx }
      );
    }
    const cleanQualification = line.qualification.trim();
    if (!allowedQualificationsSet.has(cleanQualification.toLowerCase())) {
      throw new ExactMoneyValidationError(
        "UNKNOWN_QUALIFICATION",
        `Zeile ${idx + 1}: Unbekannte Qualifikation '${cleanQualification}'. Zulässig sind: ${Array.from(allowedQualificationsSet).join(", ")}.`,
        "qualification",
        { lineIndex: idx, qualification: cleanQualification }
      );
    }

    // 3. Validate itemCategory
    if (!line.itemCategory || typeof line.itemCategory !== "string" || !line.itemCategory.trim()) {
      throw new ExactMoneyValidationError(
        "INVALID_ITEM_CATEGORY",
        `Zeile ${idx + 1}: 'itemCategory' ist erforderlich.`,
        "itemCategory",
        { lineIndex: idx }
      );
    }
    const cleanCategory = line.itemCategory.trim();

    // 4. Validate priceVersionId
    if (!line.priceVersionId || typeof line.priceVersionId !== "string" || !line.priceVersionId.trim()) {
      throw new ExactMoneyValidationError(
        "INVALID_PRICE_VERSION",
        `Zeile ${idx + 1}: 'priceVersionId' ist erforderlich.`,
        "priceVersionId",
        { lineIndex: idx }
      );
    }
    const cleanPriceVersion = line.priceVersionId.trim();

    // 5. Validate minutes & sign policy
    if (typeof line.minutes !== "number" || !Number.isSafeInteger(line.minutes)) {
      throw new ExactMoneyValidationError(
        "INVALID_MINUTES",
        `Zeile ${idx + 1}: 'minutes' muss eine gültige Ganzzahl sein (aktuell: ${line.minutes}).`,
        "minutes",
        { lineIndex: idx, minutes: line.minutes }
      );
    }

    const isAdjustmentCategory =
      cleanCategory === ITEM_CATEGORIES.ADJUSTMENT || cleanCategory === ITEM_CATEGORIES.DISCOUNT;

    if (line.minutes < 0) {
      if (!isAdjustmentCategory) {
        throw new ExactMoneyValidationError(
          "INVALID_MINUTES",
          `Zeile ${idx + 1}: Negative Arbeitsminuten sind für die reguläre Kategorie '${cleanCategory}' unzulässig. Negative Minuten sind ausschließlich für Korrekturen ('adjustment'/'discount') erlaubt.`,
          "minutes",
          { lineIndex: idx, minutes: line.minutes, category: cleanCategory }
        );
      }
      if (!allowAdjustments) {
        throw new ExactMoneyValidationError(
          "INVALID_MINUTES",
          `Zeile ${idx + 1}: Negative Minuten für Anpassungen/Korrekturen erfordern die explizite Freigabe über 'allowAdjustments: true'.`,
          "minutes",
          { lineIndex: idx, minutes: line.minutes }
        );
      }
    }

    // 6. Validate and parse rate
    let effectiveRateCents: number;
    let normalizedSurchargeRatio: ExactRatio | undefined;

    if (line.surchargeRatio !== undefined) {
      normalizedSurchargeRatio = normalizeRatio(
        line.surchargeRatio,
        { numerator: 0, denominator: 100 },
        "surchargeRatio"
      );
    }

    if (line.baseHourlyRate !== undefined) {
      const baseCents = parseRateToCents(line.baseHourlyRate, `lines[${idx}].baseHourlyRate`);
      if (normalizedSurchargeRatio !== undefined) {
        const derivedCentsBig = divideRoundHalfAwayFromZero(
          BigInt(baseCents) * BigInt(normalizedSurchargeRatio.numerator),
          BigInt(normalizedSurchargeRatio.denominator)
        );
        if (derivedCentsBig > B_MAX_SAFE_INT || derivedCentsBig < B_MIN_SAFE_INT) {
          throw new ExactMoneyValidationError(
            "SAFE_INTEGER_EXCEEDED",
            `Zeile ${idx + 1}: Berechneter Zuschlagssatz überschreitet das Ganzzahllimit.`,
            "hourlyRate"
          );
        }
        effectiveRateCents = Number(derivedCentsBig);
      } else {
        effectiveRateCents = baseCents;
      }
    } else if (line.hourlyRate !== undefined) {
      const parsedRate = parseRateToCents(line.hourlyRate, `lines[${idx}].hourlyRate`);
      if (line.deriveSurchargeRate && normalizedSurchargeRatio !== undefined) {
        // Explicit request to derive surcharge rate from base hourlyRate
        const derivedCentsBig = divideRoundHalfAwayFromZero(
          BigInt(parsedRate) * BigInt(normalizedSurchargeRatio.numerator),
          BigInt(normalizedSurchargeRatio.denominator)
        );
        if (derivedCentsBig > B_MAX_SAFE_INT || derivedCentsBig < B_MIN_SAFE_INT) {
          throw new ExactMoneyValidationError(
            "SAFE_INTEGER_EXCEEDED",
            `Zeile ${idx + 1}: Berechneter Zuschlagssatz überschreitet das Ganzzahllimit.`,
            "hourlyRate"
          );
        }
        effectiveRateCents = Number(derivedCentsBig);
      } else {
        effectiveRateCents = parsedRate;
      }
    } else {
      throw new ExactMoneyValidationError(
        "MISSING_RATE",
        `Zeile ${idx + 1}: Weder 'hourlyRate' noch 'baseHourlyRate' angegeben.`,
        "hourlyRate"
      );
    }

    const ratioKey = normalizedSurchargeRatio
      ? `${normalizedSurchargeRatio.numerator}/${normalizedSurchargeRatio.denominator}`
      : "none";

    // Aggregation Key: strictly collision-free JSON tuple
    const groupKey = createAggregationKey(
      cleanWorkerId,
      cleanQualification,
      cleanCategory,
      cleanPriceVersion,
      effectiveRateCents,
      ratioKey
    );

    let bucket = buckets.get(groupKey);
    if (!bucket) {
      bucket = {
        workerId: cleanWorkerId,
        workerName: line.workerName?.trim(),
        qualification: cleanQualification,
        itemCategory: cleanCategory,
        priceVersionId: cleanPriceVersion,
        rateCents: effectiveRateCents,
        totalMinutesBig: B_ZERO,
        customDescriptions: [],
        periodStarts: [],
        periodEnds: [],
        surchargeRatio: normalizedSurchargeRatio,
      };
      buckets.set(groupKey, bucket);
    }

    // Accumulate minutes safely in BigInt
    bucket.totalMinutesBig += BigInt(line.minutes);
    if (bucket.totalMinutesBig > B_MAX_SAFE_INT || bucket.totalMinutesBig < B_MIN_SAFE_INT) {
      throw new ExactMoneyValidationError(
        "SAFE_INTEGER_EXCEEDED",
        `Gesamtminuten für Arbeiter '${cleanWorkerId}' überschreiten das sichere Ganzzahllimit.`,
        "minutes"
      );
    }

    if (line.description) bucket.customDescriptions.push(line.description.trim());
    if (line.periodStart) bucket.periodStarts.push(line.periodStart.trim());
    if (line.periodEnd) bucket.periodEnds.push(line.periodEnd.trim());
  }

  // Convert buckets to deterministic sorted array
  const sortedBuckets = Array.from(buckets.values()).sort((a, b) => {
    const workerComp = a.workerId.localeCompare(b.workerId);
    if (workerComp !== 0) return workerComp;

    const catPriorityA = getCategorySortPriority(a.itemCategory);
    const catPriorityB = getCategorySortPriority(b.itemCategory);
    if (catPriorityA !== catPriorityB) return catPriorityA - catPriorityB;

    const catComp = a.itemCategory.localeCompare(b.itemCategory);
    if (catComp !== 0) return catComp;

    const qualComp = a.qualification.localeCompare(b.qualification);
    if (qualComp !== 0) return qualComp;

    if (a.rateCents !== b.rateCents) return a.rateCents - b.rateCents;

    const versionComp = a.priceVersionId.localeCompare(b.priceVersionId);
    if (versionComp !== 0) return versionComp;

    if (a.surchargeRatio && b.surchargeRatio) {
      const crossA = BigInt(a.surchargeRatio.numerator) * BigInt(b.surchargeRatio.denominator);
      const crossB = BigInt(b.surchargeRatio.numerator) * BigInt(a.surchargeRatio.denominator);
      if (crossA !== crossB) {
        return crossA < crossB ? -1 : 1;
      }
    } else if (a.surchargeRatio && !b.surchargeRatio) {
      return 1;
    } else if (!a.surchargeRatio && b.surchargeRatio) {
      return -1;
    }

    return 0;
  });

  const items: CalculatedLineItem[] = [];
  let subtotalBig = B_ZERO;
  let overallMinutesBig = B_ZERO;

  for (let i = 0; i < sortedBuckets.length; i++) {
    const bucket = sortedBuckets[i];
    overallMinutesBig += bucket.totalMinutesBig;

    if (overallMinutesBig > B_MAX_SAFE_INT || overallMinutesBig < B_MIN_SAFE_INT) {
      throw new ExactMoneyValidationError(
        "SAFE_INTEGER_EXCEEDED",
        "Die Gesamtsumme der Minuten aller Zeilen überschreitet das sichere Ganzzahllimit.",
        "minutes"
      );
    }

    const hundredthsBig = divideRoundHalfAwayFromZero(bucket.totalMinutesBig * B_HUNDRED, B_SIXTY);
    if (hundredthsBig > B_MAX_SAFE_INT || hundredthsBig < B_MIN_SAFE_INT) {
      throw new ExactMoneyValidationError(
        "SAFE_INTEGER_EXCEEDED",
        `Berechnete Stunden für Arbeiter '${bucket.workerId}' überschreiten das Ganzzahllimit.`
      );
    }
    const displayHourHundredths = Number(hundredthsBig);

    const rateBig = BigInt(bucket.rateCents);
    const lineCentsBig = divideRoundHalfAwayFromZero(hundredthsBig * rateBig, B_HUNDRED);
    if (lineCentsBig > B_MAX_SAFE_INT || lineCentsBig < B_MIN_SAFE_INT) {
      throw new ExactMoneyValidationError(
        "SAFE_INTEGER_EXCEEDED",
        `Berechneter Zeilenbetrag für Arbeiter '${bucket.workerId}' überschreitet das Ganzzahllimit.`
      );
    }
    const lineCents = Number(lineCentsBig);

    subtotalBig += lineCentsBig;
    if (subtotalBig > B_MAX_SAFE_INT || subtotalBig < B_MIN_SAFE_INT) {
      throw new ExactMoneyValidationError(
        "SAFE_INTEGER_EXCEEDED",
        "Die Zwischensumme (Netto) überschreitet das sichere Ganzzahllimit.",
        "subtotal"
      );
    }

    // Deduplicate and sort custom descriptions alphabetically for determinism
    const uniqueDescriptions = Array.from(new Set(bucket.customDescriptions)).sort((a, b) =>
      a.localeCompare(b)
    );
    const description =
      uniqueDescriptions.length > 0
        ? uniqueDescriptions.join(" / ")
        : defaultCategoryLabel(
            bucket.itemCategory,
            bucket.qualification,
            bucket.workerName,
            bucket.surchargeRatio
          );

    // Deterministic date range (min periodStart, max periodEnd) from valid ISO dates
    const validStarts = bucket.periodStarts
      .filter(isValidDateString)
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
    const validEnds = bucket.periodEnds
      .filter(isValidDateString)
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

    const allValidDates = [...validStarts, ...validEnds].sort(
      (a, b) => new Date(a).getTime() - new Date(b).getTime()
    );

    let periodStart: string | undefined = undefined;
    let periodEnd: string | undefined = undefined;

    if (allValidDates.length > 0) {
      periodStart = validStarts.length > 0 ? validStarts[0] : allValidDates[0];
      periodEnd =
        validEnds.length > 0
          ? validEnds[validEnds.length - 1]
          : allValidDates[allValidDates.length - 1];
      if (new Date(periodStart).getTime() > new Date(periodEnd).getTime()) {
        const temp = periodStart;
        periodStart = periodEnd;
        periodEnd = temp;
      }
    }

    const rawMinutesSafe = Number(bucket.totalMinutesBig);

    items.push({
      pos: i + 1,
      workerId: bucket.workerId,
      workerName: bucket.workerName,
      qualification: bucket.qualification,
      itemCategory: bucket.itemCategory,
      priceVersionId: bucket.priceVersionId,
      description,
      periodStart,
      periodEnd,
      rawMinutes: rawMinutesSafe,
      displayHourHundredths,
      hoursDisplay: formatHundredthsGerman(displayHourHundredths),
      hoursDecimal: formatHundredthsDecimal(displayHourHundredths),
      rateCents: bucket.rateCents,
      rateDisplay: formatCentsGerman(bucket.rateCents),
      rateDecimal: formatCentsDecimal(bucket.rateCents),
      amountCents: lineCents,
      amountDisplay: formatCentsGerman(lineCents),
      amountDecimal: formatCentsDecimal(lineCents),
    });
  }

  // VAT calculated once on net subtotal in cents
  const taxCentsBig = divideRoundHalfAwayFromZero(
    subtotalBig * BigInt(taxRatio.numerator),
    BigInt(taxRatio.denominator)
  );

  if (taxCentsBig > B_MAX_SAFE_INT || taxCentsBig < B_MIN_SAFE_INT) {
    throw new ExactMoneyValidationError(
      "SAFE_INTEGER_EXCEEDED",
      "Berechnete Mehrwertsteuer überschreitet das Ganzzahllimit."
    );
  }
  const taxAmountCents = Number(taxCentsBig);

  // Gross Total = Subtotal + VAT
  const totalCentsBig = subtotalBig + taxCentsBig;
  if (totalCentsBig > B_MAX_SAFE_INT || totalCentsBig < B_MIN_SAFE_INT) {
    throw new ExactMoneyValidationError(
      "SAFE_INTEGER_EXCEEDED",
      "Berechneter Bruttogesamtbetrag überschreitet das Ganzzahllimit."
    );
  }
  const totalCents = Number(totalCentsBig);
  const subtotalCents = Number(subtotalBig);
  const totalLineItemMinutes = Number(overallMinutesBig);

  // Format tax rate percentage for display
  const taxRateFormatted = formatRatioToPercentGerman(taxRatio);

  return {
    items,
    totals: {
      subtotalCents,
      subtotalDisplay: formatCentsGerman(subtotalCents),
      subtotalDecimal: formatCentsDecimal(subtotalCents),
      taxRatePercentFormatted: taxRateFormatted,
      taxRateRatio: taxRatio,
      taxAmountCents,
      taxAmountDisplay: formatCentsGerman(taxAmountCents),
      taxAmountDecimal: formatCentsDecimal(taxAmountCents),
      totalCents,
      totalDisplay: formatCentsGerman(totalCents),
      totalDecimal: formatCentsDecimal(totalCents),
      totalLineItemMinutes,
      totalMinutes: totalLineItemMinutes,
      lineItemCount: items.length,
      calculationVersion: "v2",
    },
  };
}
