/** Country dataset for Country + Phone fields. dial = calling code without "+". */

export type Country = { code: string; name: string; dial: string };

export const COUNTRIES: Country[] = [
  { code: "VN", name: "Vietnam", dial: "84" },
  { code: "US", name: "United States", dial: "1" },
  { code: "CA", name: "Canada", dial: "1" },
  { code: "GB", name: "United Kingdom", dial: "44" },
  { code: "CN", name: "China", dial: "86" },
  { code: "JP", name: "Japan", dial: "81" },
  { code: "KR", name: "South Korea", dial: "82" },
  { code: "TH", name: "Thailand", dial: "66" },
  { code: "SG", name: "Singapore", dial: "65" },
  { code: "MY", name: "Malaysia", dial: "60" },
  { code: "ID", name: "Indonesia", dial: "62" },
  { code: "PH", name: "Philippines", dial: "63" },
  { code: "IN", name: "India", dial: "91" },
  { code: "AU", name: "Australia", dial: "61" },
  { code: "NZ", name: "New Zealand", dial: "64" },
  { code: "DE", name: "Germany", dial: "49" },
  { code: "FR", name: "France", dial: "33" },
  { code: "IT", name: "Italy", dial: "39" },
  { code: "ES", name: "Spain", dial: "34" },
  { code: "PT", name: "Portugal", dial: "351" },
  { code: "NL", name: "Netherlands", dial: "31" },
  { code: "BE", name: "Belgium", dial: "32" },
  { code: "CH", name: "Switzerland", dial: "41" },
  { code: "AT", name: "Austria", dial: "43" },
  { code: "SE", name: "Sweden", dial: "46" },
  { code: "NO", name: "Norway", dial: "47" },
  { code: "DK", name: "Denmark", dial: "45" },
  { code: "FI", name: "Finland", dial: "358" },
  { code: "PL", name: "Poland", dial: "48" },
  { code: "CZ", name: "Czechia", dial: "420" },
  { code: "RU", name: "Russia", dial: "7" },
  { code: "UA", name: "Ukraine", dial: "380" },
  { code: "TR", name: "Turkey", dial: "90" },
  { code: "GR", name: "Greece", dial: "30" },
  { code: "IE", name: "Ireland", dial: "353" },
  { code: "HK", name: "Hong Kong", dial: "852" },
  { code: "TW", name: "Taiwan", dial: "886" },
  { code: "AE", name: "United Arab Emirates", dial: "971" },
  { code: "SA", name: "Saudi Arabia", dial: "966" },
  { code: "QA", name: "Qatar", dial: "974" },
  { code: "KW", name: "Kuwait", dial: "965" },
  { code: "IL", name: "Israel", dial: "972" },
  { code: "EG", name: "Egypt", dial: "20" },
  { code: "ZA", name: "South Africa", dial: "27" },
  { code: "NG", name: "Nigeria", dial: "234" },
  { code: "KE", name: "Kenya", dial: "254" },
  { code: "MA", name: "Morocco", dial: "212" },
  { code: "BR", name: "Brazil", dial: "55" },
  { code: "MX", name: "Mexico", dial: "52" },
  { code: "AR", name: "Argentina", dial: "54" },
  { code: "CL", name: "Chile", dial: "56" },
  { code: "CO", name: "Colombia", dial: "57" },
  { code: "PE", name: "Peru", dial: "51" },
  { code: "KH", name: "Cambodia", dial: "855" },
  { code: "LA", name: "Laos", dial: "856" },
  { code: "MM", name: "Myanmar", dial: "95" },
  { code: "BD", name: "Bangladesh", dial: "880" },
  { code: "PK", name: "Pakistan", dial: "92" },
  { code: "LK", name: "Sri Lanka", dial: "94" },
  { code: "NP", name: "Nepal", dial: "977" },
];

const BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));

export function countryByCode(code?: string): Country | undefined {
  return code ? BY_CODE.get(code) : undefined;
}

/** Unicode flag emoji from a 2-letter ISO code. */
export function flagEmoji(code: string): string {
  if (!code || code.length !== 2) return "🏳️";
  return String.fromCodePoint(
    ...code
      .toUpperCase()
      .split("")
      .map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65),
  );
}

/** Country dropdown options (flag + name). */
export const COUNTRY_OPTIONS = COUNTRIES.map((c) => ({
  value: c.code,
  label: `${flagEmoji(c.code)} ${c.name}`,
}));

/** Unique dial-code options for the phone selector, sorted by dial length desc. */
export const DIAL_OPTIONS = (() => {
  const seen = new Map<string, Country>();
  for (const c of COUNTRIES) if (!seen.has(c.dial)) seen.set(c.dial, c);
  return [...seen.values()]
    .sort((a, b) => Number(a.dial) - Number(b.dial))
    .map((c) => ({
      value: `+${c.dial}`,
      label: `${flagEmoji(c.code)} +${c.dial}`,
    }));
})();

const DIALS_BY_LEN = [...new Set(COUNTRIES.map((c) => c.dial))].sort(
  (a, b) => b.length - a.length,
);

/** Parse a raw phone string into { dial (with +), number }. Detects +84 / 84… */
export function parsePhone(raw: string): { dial: string; number: string } {
  if (!raw) return { dial: "", number: "" };
  let s = raw.replace(/\s+/g, "");
  let plus = false;
  if (s.startsWith("+")) {
    plus = true;
    s = s.slice(1);
  }
  // Only auto-detect a dial code when there's a leading "+" or it's a long
  // international-looking number; otherwise treat as a local number.
  if (plus || s.length >= 10) {
    for (const d of DIALS_BY_LEN) {
      if (s.startsWith(d) && s.length > d.length) {
        return { dial: `+${d}`, number: s.slice(d.length) };
      }
    }
  }
  return { dial: plus ? "" : "", number: s };
}
