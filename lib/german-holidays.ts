/**
 * Pure German Statutory Calendar & Public Holiday Analyzer (Phase 4a)
 * RheinAhr Dienstleistungen GmbH - Invoice Engine Modernization
 *
 * Principles:
 * 1. Pure Deterministic Date Math: Zero external API calls, zero database queries, zero clock skew.
 * 2. Multi-State Federalism: Distinct rules for all 16 German Bundesländer (ISO 3166-2:DE).
 *    Never assumes NRW or any single state for Germany.
 * 3. Local & Municipal Precision: Explicit support for local exceptions (e.g. Augsburger Friedensfest,
 *    Mariä Himmelfahrt in Bayern) with documented statutory references.
 * 4. Strict Non-Guessing Policy: If a state is unknown or a local municipal rule is ambiguous/unresolved,
 *    the analyzer returns an explicit "unresolved" diagnostic state rather than guessing.
 *
 * Statutory References (Stand: 09. Oktober 2026):
 * - Bund: Gesetz über die Festlegung des Tages der Deutschen Einheit (BGBl. 1990 II S. 885, 889)
 * - BW: Gesetz über die Sonntage und Feiertage (FTG Baden-Württemberg § 1)
 * - BY: Gesetz über den Schutz der Sonn- und Feiertage (FTG Bayern Art. 1)
 * - BE: Gesetz über die Sonn- und Feiertage (Feiertagsgesetz Berlin § 1)
 * - BB: Gesetz über die Sonn- und Feiertage (Feiertagsgesetz Brandenburg § 2)
 * - HB: Gesetz über die Sonn- und Feiertage (Bremisches Feiertagsgesetz § 1)
 * - HH: Feiertagsgesetz Hamburg § 1
 * - HE: Hessisches Feiertagsgesetz (HFeiertagsG § 1)
 * - MV: Gesetz über Sonn- und Feiertage (Feiertagsgesetz Mecklenburg-Vorpommern § 1)
 * - NI: Niedersächsisches Gesetz über die Feiertage (NFeiertagsG § 1)
 * - NW: Gesetz über die Sonn- und Feiertage (Feiertagsgesetz NW § 2)
 * - RP: Landesgesetz über den Schutz der Sonn- und Feiertage (LFtG Rheinland-Pfalz § 2)
 * - SL: Gesetz Nr. 1018 über die Sonn- und Feiertage (Saarländisches Feiertagsgesetz § 2)
 * - SN: Gesetz über die Sonn- und Feiertage im Freistaat Sachsen (SächsSFG § 1)
 * - ST: Gesetz über die Sonn- und Feiertage (Feiertagsgesetz Sachsen-Anhalt § 1)
 * - SH: Gesetz über Sonn- und Feiertage (Schleswig-Holstein § 1)
 * - TH: Thüringer Feiertagsgesetz (ThürFtG § 2)
 */

export type GermanFederalState =
  | "BW" // Baden-Württemberg
  | "BY" // Bayern
  | "BE" // Berlin
  | "BB" // Brandenburg
  | "HB" // Bremen
  | "HH" // Hamburg
  | "HE" // Hessen
  | "MV" // Mecklenburg-Vorpommern
  | "NI" // Niedersachsen
  | "NW" // Nordrhein-Westfalen
  | "RP" // Rheinland-Pfalz
  | "SL" // Saarland
  | "SN" // Sachsen
  | "ST" // Sachsen-Anhalt
  | "SH" // Schleswig-Holstein
  | "TH"; // Thüringen

export const GERMAN_FEDERAL_STATES: readonly GermanFederalState[] = [
  "BW",
  "BY",
  "BE",
  "BB",
  "HB",
  "HH",
  "HE",
  "MV",
  "NI",
  "NW",
  "RP",
  "SL",
  "SN",
  "ST",
  "SH",
  "TH",
] as const;

export const GERMAN_STATE_NAMES_DE: Record<GermanFederalState, string> = {
  BW: "Baden-Württemberg",
  BY: "Bayern",
  BE: "Berlin",
  BB: "Brandenburg",
  HB: "Bremen",
  HH: "Hamburg",
  HE: "Hessen",
  MV: "Mecklenburg-Vorpommern",
  NI: "Niedersachsen",
  NW: "Nordrhein-Westfalen",
  RP: "Rheinland-Pfalz",
  SL: "Saarland",
  SN: "Sachsen",
  ST: "Sachsen-Anhalt",
  SH: "Schleswig-Holstein",
  TH: "Thüringen",
};

export const STATUTORY_LEGAL_BASES: Record<string, string> = {
  NATIONWIDE_DE: "Bundesweit gesetzlicher Feiertag (BGBl. 1990 II S. 885 / Landesfeiertagsgesetze)",
  BW: "Gesetz über die Sonntage und Feiertage (FTG Baden-Württemberg § 1)",
  BY: "Gesetz über den Schutz der Sonn- und Feiertage (FTG Bayern Art. 1)",
  BE: "Gesetz über die Sonn- und Feiertage (Feiertagsgesetz Berlin § 1)",
  BB: "Gesetz über die Sonn- und Feiertage (Feiertagsgesetz Brandenburg § 2)",
  HB: "Gesetz über die Sonn- und Feiertage (Bremisches Feiertagsgesetz § 1)",
  HH: "Feiertagsgesetz Hamburg § 1",
  HE: "Hessisches Feiertagsgesetz (HFeiertagsG § 1)",
  MV: "Gesetz über Sonn- und Feiertage (Feiertagsgesetz Mecklenburg-Vorpommern § 1)",
  NI: "Niedersächsisches Gesetz über die Feiertage (NFeiertagsG § 1)",
  NW: "Gesetz über die Sonn- und Feiertage (Feiertagsgesetz NW § 2)",
  RP: "Landesgesetz über den Schutz der Sonn- und Feiertage (LFtG Rheinland-Pfalz § 2)",
  SL: "Gesetz Nr. 1018 über die Sonn- und Feiertage (Saarländisches Feiertagsgesetz § 2)",
  SN: "Gesetz über die Sonn- und Feiertage im Freistaat Sachsen (SächsSFG § 1)",
  ST: "Gesetz über die Sonn- und Feiertage (Feiertagsgesetz Sachsen-Anhalt § 1)",
  SH: "Gesetz über Sonn- und Feiertage (Schleswig-Holstein § 1)",
  TH: "Thüringer Feiertagsgesetz (ThürFtG § 2)",
  AUGSBURG: "Augsburger Hohes Friedensfest (Art. 1 Abs. 2 FTG Bayern - nur Stadtgebiet Augsburg)",
  MARIA_HIMMELFAHRT_BY: "Mariä Himmelfahrt (Art. 1 Abs. 1 Nr. 2 FTG Bayern - nur katholische Gemeinden)",
};

export type HolidayRecord = {
  date: string; // "YYYY-MM-DD"
  name: string; // German canonical name, e.g. "Ostermontag"
  federalState: GermanFederalState;
  legalBasis: string;
  isNationwide: boolean;
  municipality?: string | null;
  isCustomException?: boolean;
};

export type HolidayException = {
  date: string; // "YYYY-MM-DD"
  name: string;
  legalBasis: string;
  action: "include" | "exclude";
};

export function isValidGermanFederalState(state: unknown): state is GermanFederalState {
  return typeof state === "string" && (GERMAN_FEDERAL_STATES as readonly string[]).includes(state);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatIso(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * Anonymous Gregorian Algorithm (Meeus/Jones/Butcher)
 * Calculates the exact Easter Sunday for any Gregorian year.
 */
export function calculateEasterSunday(year: number): { year: number; month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { year, month, day };
}

function addDaysToEaster(
  year: number,
  easter: { month: number; day: number },
  daysOffset: number
): string {
  const date = new Date(Date.UTC(year, easter.month - 1, easter.day));
  date.setUTCDate(date.getUTCDate() + daysOffset);
  return date.toISOString().slice(0, 10);
}

/**
 * Calculates Buß- und Bettag (Day of Repentance and Prayer) in Sachsen (§ 1 Abs. 1 SächsSFG).
 * By law: Wednesday before November 23 (between November 16 and November 22).
 */
export function calculateBussUndBettag(year: number): string {
  // Start from November 22
  const d22 = new Date(Date.UTC(year, 10, 22)); // Month 10 = November
  const dayOfWeek = d22.getUTCDay(); // 0 = Sun, 1 = Mon, 2 = Tue, 3 = Wed, 4 = Thu, 5 = Fri, 6 = Sat
  const diffToWednesday = (dayOfWeek - 3 + 7) % 7;
  const day = 22 - diffToWednesday;
  return formatIso(year, 11, day);
}

/**
 * Known predominantly Catholic municipalities in Bavaria (Bayerisches Landesamt für Statistik).
 * When municipality is provided for Mariä Himmelfahrt (15.08.), this allows deterministic resolution.
 */
const KNOWN_BAVARIAN_CATHOLIC_MUNICIPALITIES = new Set<string>([
  "münchen", "muenchen", "munich",
  "augsburg",
  "würzburg", "wuerzburg",
  "regensburg",
  "ingolstadt",
  "passau",
  "bamberg",
  "landshut",
  "aschaffenburg",
  "schweinfurt",
  "straubing",
  "rosenheim",
  "freising",
  "dachau",
  "kaufbeuren",
  "kempten",
  "memmingen",
  "amberg",
  "weiden",
]);

const KNOWN_BAVARIAN_PROTESTANT_MUNICIPALITIES = new Set<string>([
  "nürnberg", "nuernberg", "nuremberg",
  "ansbach",
  "bayreuth",
  "erlangen",
  "rothenburg ob der tauber", "rothenburg",
  "schwabach",
  "hof",
  "coburg",
  "fürth", "fuerth",
]);

export function isBavarianCatholicMunicipality(municipality?: string | null): boolean | null {
  if (!municipality || !municipality.trim()) return null;
  const normalized = municipality.trim().toLowerCase();
  if (KNOWN_BAVARIAN_CATHOLIC_MUNICIPALITIES.has(normalized)) return true;
  if (KNOWN_BAVARIAN_PROTESTANT_MUNICIPALITIES.has(normalized)) return false;
  return null;
}

export type HolidayCalendarOptions = {
  year: number;
  federalState: GermanFederalState;
  municipality?: string | null;
  customExceptions?: HolidayException[];
};

/**
 * Pure generator of all statutory public holidays for a specific German Federal State and year.
 */
export function getGermanHolidaysForYear(options: HolidayCalendarOptions): Map<string, HolidayRecord> {
  const { year, federalState, municipality, customExceptions } = options;
  const holidays = new Map<string, HolidayRecord>();

  const easter = calculateEasterSunday(year);

  const add = (date: string, name: string, isNationwide: boolean, legalBasis: string, mun?: string | null) => {
    holidays.set(date, {
      date,
      name,
      federalState,
      legalBasis,
      isNationwide,
      municipality: mun || null,
    });
  };

  // 1. Nationwide statutory holidays (9 days)
  add(formatIso(year, 1, 1), "Neujahr", true, STATUTORY_LEGAL_BASES.NATIONWIDE_DE);
  add(addDaysToEaster(year, easter, -2), "Karfreitag", true, STATUTORY_LEGAL_BASES.NATIONWIDE_DE);
  add(addDaysToEaster(year, easter, 1), "Ostermontag", true, STATUTORY_LEGAL_BASES.NATIONWIDE_DE);
  add(formatIso(year, 5, 1), "Tag der Arbeit", true, STATUTORY_LEGAL_BASES.NATIONWIDE_DE);
  add(addDaysToEaster(year, easter, 39), "Christi Himmelfahrt", true, STATUTORY_LEGAL_BASES.NATIONWIDE_DE);
  add(addDaysToEaster(year, easter, 50), "Pfingstmontag", true, STATUTORY_LEGAL_BASES.NATIONWIDE_DE);
  add(formatIso(year, 10, 3), "Tag der Deutschen Einheit", true, STATUTORY_LEGAL_BASES.NATIONWIDE_DE);
  add(formatIso(year, 12, 25), "1. Weihnachtstag", true, STATUTORY_LEGAL_BASES.NATIONWIDE_DE);
  add(formatIso(year, 12, 26), "2. Weihnachtstag", true, STATUTORY_LEGAL_BASES.NATIONWIDE_DE);

  // 2. State-specific statutory holidays
  const stateBasis = STATUTORY_LEGAL_BASES[federalState] || STATUTORY_LEGAL_BASES.NATIONWIDE_DE;

  // Heilige Drei Könige (06.01.): BW, BY, ST
  if (federalState === "BW" || federalState === "BY" || federalState === "ST") {
    add(formatIso(year, 1, 6), "Heilige Drei Könige", false, stateBasis);
  }

  // Internationaler Frauentag (08.03.): BE, MV
  if (federalState === "BE" || federalState === "MV") {
    add(formatIso(year, 3, 8), "Internationaler Frauentag", false, stateBasis);
  }

  // Ostersonntag & Pfingstsonntag: Gesetzliche Feiertage NUR in Brandenburg (§ 2 Abs. 1 BbgFtG)
  if (federalState === "BB") {
    add(addDaysToEaster(year, easter, 0), "Ostersonntag", false, stateBasis);
    add(addDaysToEaster(year, easter, 49), "Pfingstsonntag", false, stateBasis);
  }

  // Fronleichnam (Easter + 60): BW, BY, HE, NW, RP, SL
  if (
    federalState === "BW" ||
    federalState === "BY" ||
    federalState === "HE" ||
    federalState === "NW" ||
    federalState === "RP" ||
    federalState === "SL"
  ) {
    add(addDaysToEaster(year, easter, 60), "Fronleichnam", false, stateBasis);
  }

  // Augsburger Hohes Friedensfest (08.08.): Nur Stadtgebiet Augsburg (BY, Art. 1 Abs. 2 FTG Bayern)
  if (federalState === "BY" && municipality) {
    const munNorm = municipality.trim().toLowerCase();
    if (munNorm === "augsburg" || munNorm === "stadt augsburg") {
      add(formatIso(year, 8, 8), "Augsburger Hohes Friedensfest", false, STATUTORY_LEGAL_BASES.AUGSBURG, municipality);
    }
  }

  // Mariä Himmelfahrt (15.08.):
  // SL: Landesweit gesetzlicher Feiertag (§ 2 Abs. 1 SFG)
  // BY: Nur in Gemeinden mit überwiegend katholischer Bevölkerung (Art. 1 Abs. 1 Nr. 2 FTG Bayern)
  if (federalState === "SL") {
    add(formatIso(year, 8, 15), "Mariä Himmelfahrt", false, stateBasis);
  } else if (federalState === "BY" && municipality) {
    const isCath = isBavarianCatholicMunicipality(municipality);
    if (isCath === true) {
      add(formatIso(year, 8, 15), "Mariä Himmelfahrt", false, STATUTORY_LEGAL_BASES.MARIA_HIMMELFAHRT_BY, municipality);
    }
  }

  // Weltkindertag (20.09.): TH (§ 2 Abs. 1 ThürFtG)
  if (federalState === "TH") {
    add(formatIso(year, 9, 20), "Weltkindertag", false, stateBasis);
  }

  // Reformationstag (31.10.): BB, HB, HH, MV, NI, SN, ST, SH, TH
  if (
    federalState === "BB" ||
    federalState === "HB" ||
    federalState === "HH" ||
    federalState === "MV" ||
    federalState === "NI" ||
    federalState === "SN" ||
    federalState === "ST" ||
    federalState === "SH" ||
    federalState === "TH"
  ) {
    add(formatIso(year, 10, 31), "Reformationstag", false, stateBasis);
  }

  // Allerheiligen (01.11.): BW, BY, NW, RP, SL
  if (
    federalState === "BW" ||
    federalState === "BY" ||
    federalState === "NW" ||
    federalState === "RP" ||
    federalState === "SL"
  ) {
    add(formatIso(year, 11, 1), "Allerheiligen", false, stateBasis);
  }

  // Buß- und Bettag (Mittwoch vor dem 23. November): SN (§ 1 Abs. 1 SächsSFG)
  if (federalState === "SN") {
    const bussUndBettagDate = calculateBussUndBettag(year);
    add(bussUndBettagDate, "Buß- und Bettag", false, stateBasis);
  }

  // 3. Documented Custom Exceptions (if provided)
  if (customExceptions && customExceptions.length > 0) {
    for (const exc of customExceptions) {
      if (exc.action === "exclude") {
        holidays.delete(exc.date);
      } else if (exc.action === "include") {
        holidays.set(exc.date, {
          date: exc.date,
          name: exc.name,
          federalState,
          legalBasis: exc.legalBasis,
          isNationwide: false,
          municipality: municipality || null,
          isCustomException: true,
        });
      }
    }
  }

  return holidays;
}

export type HolidayResolutionSuccess = {
  status: "resolved";
  isHoliday: boolean;
  date: string; // YYYY-MM-DD
  federalState: GermanFederalState;
  holiday?: HolidayRecord;
};

export type HolidayResolutionUnresolved = {
  status: "policy_unresolved";
  code: "UNKNOWN_FEDERAL_STATE" | "AMBIGUOUS_MUNICIPAL_LOCATION" | "INVALID_DATE";
  message: string;
  diagnostics: {
    rawDate?: string;
    rawFederalState?: string;
    rawMunicipality?: string | null;
    reason: string;
  };
};

export type HolidayResolutionResult = HolidayResolutionSuccess | HolidayResolutionUnresolved;

/**
 * Resolves whether a specific calendar date is a statutory public holiday for a given state & municipality.
 * Returns explicit "policy_unresolved" error when state is invalid or municipal rule is ambiguous.
 */
export function resolveGermanHoliday(
  dateInput: Date | string,
  federalStateInput: unknown,
  municipalityInput?: string | null,
  customExceptions?: HolidayException[]
): HolidayResolutionResult {
  let isoDate: string;
  let year: number;

  if (dateInput instanceof Date) {
    if (isNaN(dateInput.getTime())) {
      return {
        status: "policy_unresolved",
        code: "INVALID_DATE",
        message: "Ungültiges Datumsformat übergeben.",
        diagnostics: { reason: "Date is NaN" },
      };
    }
    isoDate = dateInput.toISOString().slice(0, 10);
    year = dateInput.getUTCFullYear();
  } else if (typeof dateInput === "string") {
    const trimmed = dateInput.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return {
        status: "policy_unresolved",
        code: "INVALID_DATE",
        message: `Datumsstring "${dateInput}" entspricht nicht dem Format YYYY-MM-DD.`,
        diagnostics: { rawDate: dateInput, reason: "Date does not match YYYY-MM-DD" },
      };
    }
    isoDate = trimmed;
    year = Number(trimmed.slice(0, 4));
  } else {
    return {
      status: "policy_unresolved",
      code: "INVALID_DATE",
      message: "Datum muss ein Date-Objekt oder ISO-String sein.",
      diagnostics: { reason: "Invalid date type" },
    };
  }

  if (!isValidGermanFederalState(federalStateInput)) {
    return {
      status: "policy_unresolved",
      code: "UNKNOWN_FEDERAL_STATE",
      message: `Unbekanntes oder nicht spezifiziertes deutsches Bundesland: "${String(federalStateInput)}". Es muss ein gültiger ISO 3166-2:DE Code sein.`,
      diagnostics: {
        rawDate: isoDate,
        rawFederalState: String(federalStateInput),
        reason: "Federal state is not one of the 16 German states",
      },
    };
  }

  const federalState = federalStateInput;

  // Check Bavarian August 15 ambiguity (Mariä Himmelfahrt)
  if (federalState === "BY" && isoDate.endsWith("-08-15")) {
    const isCath = isBavarianCatholicMunicipality(municipalityInput);
    if (isCath === null) {
      return {
        status: "policy_unresolved",
        code: "AMBIGUOUS_MUNICIPAL_LOCATION",
        message:
          "Mariä Himmelfahrt (15. August) in Bayern ist nur in Gemeinden mit überwiegend katholischer Bevölkerung gesetzlicher Feiertag (Art. 1 Abs. 1 Nr. 2 FTG Bayern). Die Gemeinde ist nicht angegeben oder ungelöst.",
        diagnostics: {
          rawDate: isoDate,
          rawFederalState: "BY",
          rawMunicipality: municipalityInput || null,
          reason: "Mariä Himmelfahrt municipal status ambiguous without verified catholic majority municipality",
        },
      };
    }
  }

  const yearHolidays = getGermanHolidaysForYear({
    year,
    federalState,
    municipality: municipalityInput,
    customExceptions,
  });

  const holiday = yearHolidays.get(isoDate);

  if (holiday) {
    return {
      status: "resolved",
      isHoliday: true,
      date: isoDate,
      federalState,
      holiday,
    };
  }

  return {
    status: "resolved",
    isHoliday: false,
    date: isoDate,
    federalState,
  };
}
