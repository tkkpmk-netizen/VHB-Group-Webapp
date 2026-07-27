export const NUMBER_FORMATS = [
  { value: "integer", label: "Integer" },
  { value: "decimal", label: "Decimal" },
  { value: "percent", label: "Percent" },
  { value: "currency", label: "Currency" },
  { value: "unit", label: "Measurement unit" },
] as const;

const ISO_4217_FALLBACK = [
  "AED", "AFN", "ALL", "AMD", "ANG", "AOA", "ARS", "AUD", "AWG", "AZN",
  "BAM", "BBD", "BDT", "BGN", "BHD", "BIF", "BMD", "BND", "BOB", "BOV",
  "BRL", "BSD", "BTN", "BWP", "BYN", "BZD", "CAD", "CDF", "CHE", "CHF",
  "CHW", "CLF", "CLP", "CNY", "COP", "COU", "CRC", "CUC", "CUP", "CVE",
  "CZK", "DJF", "DKK", "DOP", "DZD", "EGP", "ERN", "ETB", "EUR", "FJD",
  "FKP", "GBP", "GEL", "GHS", "GIP", "GMD", "GNF", "GTQ", "GYD", "HKD",
  "HNL", "HRK", "HTG", "HUF", "IDR", "ILS", "INR", "IQD", "IRR", "ISK",
  "JMD", "JOD", "JPY", "KES", "KGS", "KHR", "KMF", "KPW", "KRW", "KWD",
  "KYD", "KZT", "LAK", "LBP", "LKR", "LRD", "LSL", "LYD", "MAD", "MDL",
  "MGA", "MKD", "MMK", "MNT", "MOP", "MRU", "MUR", "MVR", "MWK", "MXN",
  "MXV", "MYR", "MZN", "NAD", "NGN", "NIO", "NOK", "NPR", "NZD", "OMR",
  "PAB", "PEN", "PGK", "PHP", "PKR", "PLN", "PYG", "QAR", "RON", "RSD",
  "RUB", "RWF", "SAR", "SBD", "SCR", "SDG", "SEK", "SGD", "SHP", "SLE",
  "SLL", "SOS", "SRD", "SSP", "STN", "SVC", "SYP", "SZL", "THB", "TJS",
  "TMT", "TND", "TOP", "TRY", "TTD", "TWD", "TZS", "UAH", "UGX", "USD",
  "USN", "UYI", "UYU", "UYW", "UZS", "VED", "VES", "VND", "VUV", "WST",
  "XAF", "XAG", "XAU", "XBA", "XBB", "XBC", "XBD", "XCD", "XDR", "XOF",
  "XPD", "XPF", "XPT", "XSU", "XTS", "XUA", "XXX", "YER", "ZAR", "ZMW",
  "ZWL",
];

const intlWithSupportedValues = Intl as typeof Intl & {
  supportedValuesOf?: (key: "currency") => string[];
};

export const CURRENCY_CODES = Array.from(
  new Set(
    intlWithSupportedValues.supportedValuesOf?.("currency") ??
      ISO_4217_FALLBACK,
  ),
).sort();

export const MEASUREMENT_UNITS = [
  { value: "mm", label: "Millimetre (mm)", category: "Length" },
  { value: "cm", label: "Centimetre (cm)", category: "Length" },
  { value: "m", label: "Metre (m)", category: "Length" },
  { value: "km", label: "Kilometre (km)", category: "Length" },
  { value: "in", label: "Inch (in)", category: "Length" },
  { value: "ft", label: "Foot (ft)", category: "Length" },
  { value: "yd", label: "Yard (yd)", category: "Length" },
  { value: "mi", label: "Mile (mi)", category: "Length" },
  { value: "mm²", label: "Square millimetre (mm²)", category: "Area" },
  { value: "cm²", label: "Square centimetre (cm²)", category: "Area" },
  { value: "m²", label: "Square metre (m²)", category: "Area" },
  { value: "km²", label: "Square kilometre (km²)", category: "Area" },
  { value: "ft²", label: "Square foot (ft²)", category: "Area" },
  { value: "acre", label: "Acre", category: "Area" },
  { value: "ha", label: "Hectare (ha)", category: "Area" },
  { value: "ml", label: "Millilitre (ml)", category: "Volume" },
  { value: "l", label: "Litre (l)", category: "Volume" },
  { value: "cm³", label: "Cubic centimetre (cm³)", category: "Volume" },
  { value: "m³", label: "Cubic metre (m³)", category: "Volume" },
  { value: "fl oz", label: "Fluid ounce (fl oz)", category: "Volume" },
  { value: "cup", label: "Cup", category: "Volume" },
  { value: "pt", label: "Pint (pt)", category: "Volume" },
  { value: "qt", label: "Quart (qt)", category: "Volume" },
  { value: "gal", label: "Gallon (gal)", category: "Volume" },
  { value: "mg", label: "Milligram (mg)", category: "Weight" },
  { value: "g", label: "Gram (g)", category: "Weight" },
  { value: "kg", label: "Kilogram (kg)", category: "Weight" },
  { value: "t", label: "Tonne (t)", category: "Weight" },
  { value: "oz", label: "Ounce (oz)", category: "Weight" },
  { value: "lb", label: "Pound (lb)", category: "Weight" },
  { value: "°C", label: "Celsius (°C)", category: "Temperature" },
  { value: "°F", label: "Fahrenheit (°F)", category: "Temperature" },
  { value: "K", label: "Kelvin (K)", category: "Temperature" },
  { value: "m/s", label: "Metres per second (m/s)", category: "Speed" },
  { value: "km/h", label: "Kilometres per hour (km/h)", category: "Speed" },
  { value: "mph", label: "Miles per hour (mph)", category: "Speed" },
  { value: "ms", label: "Millisecond (ms)", category: "Time" },
  { value: "s", label: "Second (s)", category: "Time" },
  { value: "min", label: "Minute (min)", category: "Time" },
  { value: "h", label: "Hour (h)", category: "Time" },
  { value: "day", label: "Day", category: "Time" },
] as const;

export function formatNumberValue(
  value: number,
  options: {
    format?: string;
    currency_code?: string;
    precision?: number;
    unit_code?: string;
  },
): string {
  const precision = Math.max(0, Math.min(10, options.precision ?? 2));
  if (options.format === "currency") {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: options.currency_code || "VND",
        minimumFractionDigits: precision,
        maximumFractionDigits: precision,
      }).format(value);
    } catch {
      return `${value.toLocaleString()} ${options.currency_code || ""}`.trim();
    }
  }
  if (options.format === "percent") {
    return `${value.toLocaleString(undefined, {
      maximumFractionDigits: precision,
    })}%`;
  }
  const formatted = value.toLocaleString(undefined, {
    minimumFractionDigits:
      options.format === "decimal" || options.format === "unit"
        ? precision
        : 0,
    maximumFractionDigits:
      options.format === "integer" ? 0 : precision,
  });
  return options.format === "unit" && options.unit_code
    ? `${formatted} ${options.unit_code}`
    : formatted;
}
