/** Complete ISO country dataset for Country + Phone fields. */

import worldCountries from "world-countries";

export type Country = { code: string; name: string; dial: string };

const PRIORITY = new Map(["VN", "US", "CN", "JP", "KR", "SG"].map((code, index) => [code, index]));

export const COUNTRIES: Country[] = worldCountries
  .map((country) => ({
    code: country.cca2,
    name: country.name.common,
    dial: `${country.idd.root ?? ""}${country.idd.suffixes?.[0] ?? ""}`.replace("+", ""),
  }))
  .sort((a, b) => {
    const ap = PRIORITY.get(a.code);
    const bp = PRIORITY.get(b.code);
    if (ap !== undefined || bp !== undefined) return (ap ?? 999) - (bp ?? 999);
    return a.name.localeCompare(b.name);
  });

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
  searchText: `${c.name} ${c.code}`,
}));

/** Unique dial-code options for the phone selector, sorted by dial length desc. */
export const DIAL_OPTIONS = (() => {
  const seen = new Map<string, Country>();
  for (const c of COUNTRIES) if (c.dial && !seen.has(c.dial)) seen.set(c.dial, c);
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
