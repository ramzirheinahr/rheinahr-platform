// Nationality options. We store the ISO 3166-1 alpha-2 country code and render
// the localized country name via Intl.DisplayNames (same approach as languages),
// so nationality shows correctly in de/en/ar without hand-kept tables.

// Full ISO 3166-1 alpha-2 set.
export const COUNTRY_CODES = [
  "AD", "AE", "AF", "AG", "AL", "AM", "AO", "AR", "AT", "AU", "AZ", "BA", "BB",
  "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BN", "BO", "BR", "BS", "BT", "BW",
  "BY", "BZ", "CA", "CD", "CF", "CG", "CH", "CI", "CL", "CM", "CN", "CO", "CR",
  "CU", "CV", "CY", "CZ", "DE", "DJ", "DK", "DM", "DO", "DZ", "EC", "EE", "EG",
  "ER", "ES", "ET", "FI", "FJ", "FM", "FR", "GA", "GB", "GD", "GE", "GH", "GM",
  "GN", "GQ", "GR", "GT", "GW", "GY", "HN", "HR", "HT", "HU", "ID", "IE", "IL",
  "IN", "IQ", "IR", "IS", "IT", "JM", "JO", "JP", "KE", "KG", "KH", "KI", "KM",
  "KN", "KP", "KR", "KW", "KZ", "LA", "LB", "LC", "LI", "LK", "LR", "LS", "LT",
  "LU", "LV", "LY", "MA", "MC", "MD", "ME", "MG", "MH", "MK", "ML", "MM", "MN",
  "MR", "MT", "MU", "MV", "MW", "MX", "MY", "MZ", "NA", "NE", "NG", "NI", "NL",
  "NO", "NP", "NR", "NZ", "OM", "PA", "PE", "PG", "PH", "PK", "PL", "PS", "PT",
  "PW", "PY", "QA", "RO", "RS", "RU", "RW", "SA", "SB", "SC", "SD", "SE", "SG",
  "SI", "SK", "SL", "SM", "SN", "SO", "SR", "SS", "ST", "SV", "SY", "SZ", "TD",
  "TG", "TH", "TJ", "TL", "TM", "TN", "TO", "TR", "TT", "TV", "TW", "TZ", "UA",
  "UG", "US", "UY", "UZ", "VA", "VC", "VE", "VN", "VU", "WS", "YE", "ZA", "ZM",
  "ZW",
] as const;

const displayCache = new Map<string, Intl.DisplayNames>();
function displayNames(locale: string): Intl.DisplayNames {
  let d = displayCache.get(locale);
  if (!d) {
    d = new Intl.DisplayNames([locale], { type: "region", fallback: "code" });
    displayCache.set(locale, d);
  }
  return d;
}

// Localized country name for a code, e.g. countryLabel("SY", "ar") → "سوريا".
export function countryLabel(code: string, locale: string): string {
  try {
    return displayNames(locale).of(code) ?? code;
  } catch {
    return code;
  }
}
