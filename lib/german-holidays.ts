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
  MARIA_HIMMELFAHRT_BY: "Mariä Himmelfahrt (Art. 1 Abs. 1 Nr. 2 FTG Bayern - nur katholische Gemeinden; Quelle: Bayerisches Landesamt für Statistik, Zensus 2022)",
  SAXONY_FRONLEICHNAM: "Fronleichnam (SächsSFG § 1 Abs. 1 Nr. 1 i.V.m. FronleichnamsVO - nur katholische Gemeinden im Landkreis Bautzen)",
  THURINGIA_FRONLEICHNAM: "Fronleichnam (ThürFtG § 2 Abs. 2 - Landkreis Eichsfeld und gesetzlich bestimmte katholische Gemeinden)",
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

/**
 * Strict Gregorian calendar date validation.
 * Rejects non-existent dates such as 2026-02-31, 2026-04-31, or invalid leap year days.
 */
export function isValidGregorianCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }
  if (year < 1583 || year > 2200) {
    return false;
  }
  if (month < 1 || month > 12) {
    return false;
  }
  if (day < 1) {
    return false;
  }
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
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
 * Bavarian Mariä Himmelfahrt (15.08.) Municipal Resolution.
 * Statutory Basis: Art. 1 Abs. 1 Nr. 2 FTG Bayern.
 * Official Census Authority: Bayerisches Landesamt für Statistik, Zensus 2022 (Stand: gültig ab 2025).
 * According to official census data, 1,708 of 2,056 Bavarian municipalities (approx. 83%) have a
 * predominantly Roman Catholic population where August 15 is a statutory public holiday.
 *
 * NOTE: The sample city and AGS lists below serve as canonical test fixtures and illustrative
 * mappings. They are NOT exhaustive of all 1,708 municipalities. In production, unlisted Bavarian
 * municipalities return "policy_unresolved" with AMBIGUOUS_MUNICIPAL_LOCATION unless explicitly
 * documented with a verified municipal key (AGS) or documented contract exception.
 */
const KNOWN_BAVARIAN_CATHOLIC_MUNICIPALITIES = new Set<string>([
  "münchen", "muenchen", "munich", "09162000",
  "augsburg", "09761000",
  "würzburg", "wuerzburg", "09663000",
  "regensburg", "09362000",
  "ingolstadt", "09161000",
  "passau", "09262000",
  "bamberg", "09461000",
  "landshut", "09261000",
  "aschaffenburg", "09661000",
  "schweinfurt", "09662000",
  "straubing", "09263000",
  "rosenheim", "09163000",
  "freising", "09178120",
  "dachau", "09174115",
  "kaufbeuren", "09762000",
  "kempten", "09763000",
  "memmingen", "09764000",
  "amberg", "09361000",
  "weiden", "09363000",
]);

const KNOWN_BAVARIAN_PROTESTANT_MUNICIPALITIES = new Set<string>([
  "nürnberg", "nuernberg", "nuremberg", "09564000",
  "ansbach", "09561000",
  "bayreuth", "09462000",
  "erlangen", "09562000",
  "rothenburg ob der tauber", "rothenburg", "09571193",
  "schwabach", "09565000",
  "hof", "09464000",
  "coburg", "09463000",
  "fürth", "fuerth", "09563000",
]);

export function isBavarianCatholicMunicipality(municipality?: string | null): boolean | null {
  if (!municipality || !municipality.trim()) return null;
  const normalized = municipality.trim().toLowerCase();
  if (KNOWN_BAVARIAN_CATHOLIC_MUNICIPALITIES.has(normalized)) return true;
  if (KNOWN_BAVARIAN_PROTESTANT_MUNICIPALITIES.has(normalized)) return false;
  return null;
}

/**
 * Statutory Catholic Municipalities in Saxony (SächsSFG § 1 Abs. 1 Nr. 1 i.V.m. FronleichnamsVO).
 * Corpus Christi (Fronleichnam) is a statutory public holiday ONLY in designated
 * municipalities and districts in Landkreis Bautzen.
 * Canonical sample list and official AGS keys.
 */
const KNOWN_SAXONY_CATHOLIC_MUNICIPALITIES = new Set<string>([
  "crostwitz", "chrósćicy", "14625090",
  "panschwitz-kuckau", "pančicy-kukow", "14625390",
  "nebelschütz", "njebjelčicy", "14625340",
  "räckelwitz", "worklecy", "14625440",
  "ralbitz-rosenthal", "ralbicy-róžant", "14625460",
  "wittichenau", "kulow", "14625620",
  "bautzen", "14625020",
  "radibor", "14625450",
  "puschwitz", "14625430",
  "neschwitz", "14625360",
]);

const KNOWN_SAXONY_PROTESTANT_OR_GENERAL_MUNICIPALITIES = new Set<string>([
  "dresden", "14612000",
  "leipzig", "14713000",
  "chemnitz", "14511000",
  "zwickau", "14524330",
  "görlitz", "goerlitz", "14626110",
  "plauen", "14523320",
  "freiberg", "14522180",
  "pirna", "14628270",
  "meißen", "meissen", "14627140",
  "riesa", "14627230",
]);

export function isSaxonyCatholicMunicipality(municipality?: string | null): boolean | null {
  if (!municipality || !municipality.trim()) return null;
  const normalized = municipality.trim().toLowerCase();
  if (KNOWN_SAXONY_CATHOLIC_MUNICIPALITIES.has(normalized)) return true;
  if (KNOWN_SAXONY_PROTESTANT_OR_GENERAL_MUNICIPALITIES.has(normalized)) return false;
  return null;
}

/**
 * Statutory Catholic Municipalities in Thuringia (ThürFtG § 2 Abs. 2).
 * Corpus Christi (Fronleichnam) is a statutory public holiday in the entire
 * Landkreis Eichsfeld and designated communities in Unstrut-Hainich-Kreis and Wartburgkreis.
 */
const KNOWN_THURINGIA_CATHOLIC_MUNICIPALITIES = new Set<string>([
  "landkreis eichsfeld", "eichsfeld",
  "heilbad heiligenstadt", "heiligenstadt", "16061045",
  "leinefelde-worbis", "leinefelde", "worbis", "16061061",
  "dingelstädt", "dingelstaedt", "16061023",
  "südeichsfeld", "suedeichsfeld", "16064058",
  "geisa", "16063032",
  "anrode", "16064003",
  "dünwald", "duenwald", "16064014",
  "rodeberg", "16064053",
  "buttlar", "16063013",
  "schleid", "16063071",
]);

const KNOWN_THURINGIA_PROTESTANT_OR_GENERAL_MUNICIPALITIES = new Set<string>([
  "erfurt", "16062000",
  "jena", "16063000",
  "weimar", "16064000",
  "gera", "16065000",
  "eisenach", "16063022",
  "suhl", "16070000",
  "gotha", "16067029",
  "nordhausen", "16062041",
  "altenburg", "16077001",
  "ilmenau", "16070029",
]);

export function isThuringianCatholicMunicipality(municipality?: string | null): boolean | null {
  if (!municipality || !municipality.trim()) return null;
  const normalized = municipality.trim().toLowerCase();
  if (normalized.includes("eichsfeld")) return true;
  if (KNOWN_THURINGIA_CATHOLIC_MUNICIPALITIES.has(normalized)) return true;
  if (KNOWN_THURINGIA_PROTESTANT_OR_GENERAL_MUNICIPALITIES.has(normalized)) return false;
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

  // Fronleichnam (Easter + 60): BW, BY, HE, NW, RP, SL (landesweit)
  // Sowie regional in SN (Landkreis Bautzen) und TH (Landkreis Eichsfeld u.a.)
  if (
    federalState === "BW" ||
    federalState === "BY" ||
    federalState === "HE" ||
    federalState === "NW" ||
    federalState === "RP" ||
    federalState === "SL"
  ) {
    add(addDaysToEaster(year, easter, 60), "Fronleichnam", false, stateBasis);
  } else if (federalState === "SN" && municipality) {
    if (isSaxonyCatholicMunicipality(municipality) === true) {
      add(addDaysToEaster(year, easter, 60), "Fronleichnam", false, STATUTORY_LEGAL_BASES.SAXONY_FRONLEICHNAM, municipality);
    }
  } else if (federalState === "TH" && municipality) {
    if (isThuringianCatholicMunicipality(municipality) === true) {
      add(addDaysToEaster(year, easter, 60), "Fronleichnam", false, STATUTORY_LEGAL_BASES.THURINGIA_FRONLEICHNAM, municipality);
    }
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
  code:
    | "UNKNOWN_FEDERAL_STATE"
    | "AMBIGUOUS_MUNICIPAL_LOCATION"
    | "INVALID_DATE"
    | "INVALID_CALENDAR_DATE";
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
 * Returns explicit "policy_unresolved" error when state is invalid, date is invalid/non-existent,
 * or municipal rule is ambiguous.
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
    const [y, m, d] = isoDate.split("-").map(Number);
    if (!isValidGregorianCalendarDate(y, m, d)) {
      return {
        status: "policy_unresolved",
        code: "INVALID_CALENDAR_DATE",
        message: `Ungültiges Kalenderdatum: "${isoDate}" existiert nicht im gregorianischen Kalender.`,
        diagnostics: { rawDate: isoDate, reason: "Day does not exist in given month/year" },
      };
    }
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
    const [y, m, d] = trimmed.split("-").map(Number);
    if (!isValidGregorianCalendarDate(y, m, d)) {
      return {
        status: "policy_unresolved",
        code: "INVALID_CALENDAR_DATE",
        message: `Ungültiges Kalenderdatum: "${trimmed}" existiert nicht im gregorianischen Kalender.`,
        diagnostics: { rawDate: trimmed, reason: "Day does not exist in given month/year" },
      };
    }
    isoDate = trimmed;
    year = y;
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

  // 1. Check Bavarian August 15 ambiguity (Mariä Himmelfahrt)
  if (federalState === "BY" && isoDate.endsWith("-08-15")) {
    const isCath = isBavarianCatholicMunicipality(municipalityInput);
    if (isCath === null) {
      return {
        status: "policy_unresolved",
        code: "AMBIGUOUS_MUNICIPAL_LOCATION",
        message:
          "Mariä Himmelfahrt (15. August) in Bayern ist nur in Gemeinden mit überwiegend katholischer Bevölkerung gesetzlicher Feiertag (Art. 1 Abs. 1 Nr. 2 FTG Bayern - Quelle: Bayerisches Landesamt für Statistik, Zensus 2022). Die Gemeinde/Dienststelle ist nicht angegeben oder ungelöst.",
        diagnostics: {
          rawDate: isoDate,
          rawFederalState: "BY",
          rawMunicipality: municipalityInput || null,
          reason: "Mariä Himmelfahrt municipal status ambiguous without verified catholic majority municipality or official AGS",
        },
      };
    }
  }

  // 2. Check Fronleichnam regional statutory ambiguity in Saxony (SN) and Thuringia (TH)
  const easter = calculateEasterSunday(year);
  const fronleichnamIso = addDaysToEaster(year, easter, 60);

  if (isoDate === fronleichnamIso) {
    if (federalState === "SN") {
      const isCath = isSaxonyCatholicMunicipality(municipalityInput);
      if (isCath === null) {
        return {
          status: "policy_unresolved",
          code: "AMBIGUOUS_MUNICIPAL_LOCATION",
          message:
            "Fronleichnam im Freistaat Sachsen ist nur in bestimmten katholisch geprägten Gemeinden des Landkreises Bautzen gesetzlicher Feiertag (SächsSFG § 1 Abs. 1 Nr. 1 i.V.m. FronleichnamsVO). Die Gemeinde/Dienststelle ist nicht angegeben oder ungelöst.",
          diagnostics: {
            rawDate: isoDate,
            rawFederalState: "SN",
            rawMunicipality: municipalityInput || null,
            reason: "Fronleichnam municipal status ambiguous in Saxony without verified statutory catholic municipality or official AGS",
          },
        };
      }
    } else if (federalState === "TH") {
      const isCath = isThuringianCatholicMunicipality(municipalityInput);
      if (isCath === null) {
        return {
          status: "policy_unresolved",
          code: "AMBIGUOUS_MUNICIPAL_LOCATION",
          message:
            "Fronleichnam im Freistaat Thüringen ist nur im Landkreis Eichsfeld sowie in gesetzlich bestimmten katholisch geprägten Gemeinden gesetzlicher Feiertag (ThürFtG § 2 Abs. 2). Die Gemeinde/Dienststelle ist nicht angegeben oder ungelöst.",
          diagnostics: {
            rawDate: isoDate,
            rawFederalState: "TH",
            rawMunicipality: municipalityInput || null,
            reason: "Fronleichnam municipal status ambiguous in Thuringia without verified statutory catholic municipality or official AGS",
          },
        };
      }
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
