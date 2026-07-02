// Spoken-language options for worker profiles. We store ISO 639-1 codes and
// render localized names at display time via Intl.DisplayNames (full ICU is
// bundled with Node ≥13 and every modern browser), so there are no hand-kept
// translation tables to drift — every world language shows correctly in de/en/ar.

// The three most-used languages, pinned to the top of every picker so the
// common case needs no search.
export const PRIMARY_LANGUAGES = ["de", "en", "ar"] as const;

// Full ISO 639-1 living-language set (constructed/dead codes omitted).
export const LANGUAGE_CODES = [
  "aa", "ab", "af", "ak", "am", "ar", "as", "av", "ay", "az", "ba", "be", "bg",
  "bi", "bm", "bn", "bo", "br", "bs", "ca", "ce", "ch", "co", "cr", "cs", "cv",
  "cy", "da", "de", "dv", "dz", "ee", "el", "en", "es", "et", "eu", "fa", "ff",
  "fi", "fj", "fo", "fr", "fy", "ga", "gd", "gl", "gn", "gu", "gv", "ha", "he",
  "hi", "ho", "hr", "ht", "hu", "hy", "hz", "id", "ig", "ii", "ik", "is", "it",
  "iu", "ja", "jv", "ka", "kg", "ki", "kj", "kk", "kl", "km", "kn", "ko", "kr",
  "ks", "ku", "kv", "kw", "ky", "lb", "lg", "ln", "lo", "lt", "lu", "lv", "mg",
  "mh", "mi", "mk", "ml", "mn", "mr", "ms", "mt", "my", "na", "nb", "nd", "ne",
  "ng", "nl", "nn", "no", "nr", "nv", "ny", "oc", "oj", "om", "or", "os", "pa",
  "pl", "ps", "pt", "qu", "rm", "rn", "ro", "ru", "rw", "sa", "sc", "sd", "se",
  "sg", "si", "sk", "sl", "sm", "sn", "so", "sq", "sr", "ss", "st", "su", "sv",
  "sw", "ta", "te", "tg", "th", "ti", "tk", "tl", "tn", "to", "tr", "ts", "tt",
  "tw", "ty", "ug", "uk", "ur", "uz", "ve", "vi", "wa", "wo", "xh", "yi", "yo",
  "za", "zh", "zu",
] as const;

// All codes with the primary three moved to the front (de-duplicated).
export const LANGUAGE_OPTIONS: string[] = [
  ...PRIMARY_LANGUAGES,
  ...LANGUAGE_CODES.filter((c) => !PRIMARY_LANGUAGES.includes(c as never)),
];

const displayCache = new Map<string, Intl.DisplayNames>();
function displayNames(locale: string): Intl.DisplayNames {
  let d = displayCache.get(locale);
  if (!d) {
    d = new Intl.DisplayNames([locale], { type: "language", fallback: "code" });
    displayCache.set(locale, d);
  }
  return d;
}

// Localized language name for a code, e.g. languageLabel("fr", "ar") → "الفرنسية".
export function languageLabel(code: string, locale: string): string {
  try {
    return displayNames(locale).of(code) ?? code;
  } catch {
    return code;
  }
}
