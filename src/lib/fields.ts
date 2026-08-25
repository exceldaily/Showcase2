// ─────────────────────────────────────────────────────────
// Scanner field registry (spec §19, §21).
// ONE typed definition per field, shared by the rule engine, the
// Scanner Builder UI, and the column system — so filters, columns and
// evaluation can never drift apart.
//
// `requires` marks fields that need a data entitlement we may not have.
// The builder greys these out with an honest reason instead of
// silently returning nothing.
// ─────────────────────────────────────────────────────────

export type FieldKind = "number" | "percent" | "money" | "integer" | "string" | "enum" | "boolean";

export type Entitlement = "eod" | "intraday" | "quotes" | "float" | "halts" | "news";

export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  group: "Price" | "Volume" | "Technical" | "Fundamental" | "Catalyst" | "Meta";
  /** Data entitlement required; "eod" is always available. */
  requires: Entitlement;
  options?: string[]; // for enum
  hint?: string;
}

export const FIELDS: FieldDef[] = [
  // Price
  { key: "price", label: "Price", kind: "money", group: "Price", requires: "eod" },
  { key: "changePct", label: "Day Change %", kind: "percent", group: "Price", requires: "eod" },
  { key: "gapPct", label: "Gap %", kind: "percent", group: "Price", requires: "eod", hint: "Open vs prior close" },
  { key: "premarketChangePct", label: "Premarket Change %", kind: "percent", group: "Price", requires: "intraday" },
  { key: "hodDistancePct", label: "Distance From HOD %", kind: "percent", group: "Price", requires: "intraday" },
  { key: "lodDistancePct", label: "Distance From LOD %", kind: "percent", group: "Price", requires: "intraday" },
  { key: "spreadPct", label: "Spread %", kind: "percent", group: "Price", requires: "quotes" },
  { key: "priceVelocity1m", label: "Price Velocity 1m %", kind: "percent", group: "Price", requires: "intraday" },
  { key: "priceVelocity5m", label: "Price Velocity 5m %", kind: "percent", group: "Price", requires: "intraday" },

  // Volume
  { key: "volume", label: "Volume", kind: "integer", group: "Volume", requires: "eod" },
  { key: "avgVolume", label: "Avg Volume (30d)", kind: "integer", group: "Volume", requires: "eod" },
  { key: "rvol", label: "RVOL", kind: "number", group: "Volume", requires: "eod", hint: "Relative volume vs 30-day average" },
  { key: "premarketVolume", label: "Premarket Volume", kind: "integer", group: "Volume", requires: "intraday" },
  { key: "volumeVelocity1m", label: "Volume Velocity 1m", kind: "number", group: "Volume", requires: "intraday" },
  { key: "volumeAcceleration", label: "Volume Acceleration", kind: "number", group: "Volume", requires: "intraday", hint: "Current vs normal pace, e.g. 7.2x" },
  { key: "dollarVolume", label: "Dollar Volume", kind: "money", group: "Volume", requires: "eod" },

  // Technical
  { key: "vwapDistancePct", label: "VWAP Distance %", kind: "percent", group: "Technical", requires: "eod", hint: "Anchored VWAP on EOD data; session VWAP with intraday" },
  { key: "vwapState", label: "VWAP State", kind: "enum", group: "Technical", requires: "eod", options: ["Above", "Below", "Reclaim", "Rejection"] },
  { key: "emaState", label: "EMA State", kind: "enum", group: "Technical", requires: "eod", options: ["9>20>50", "9>20", "9<20", "Compressed", "Breakdown"] },
  { key: "ema9", label: "EMA 9", kind: "money", group: "Technical", requires: "eod" },
  { key: "ema20", label: "EMA 20", kind: "money", group: "Technical", requires: "eod" },
  { key: "ema50", label: "EMA 50", kind: "money", group: "Technical", requires: "eod" },
  { key: "rsi14", label: "RSI 14", kind: "number", group: "Technical", requires: "eod" },
  { key: "atr14", label: "ATR", kind: "money", group: "Technical", requires: "eod" },
  { key: "atrPct", label: "ATR %", kind: "percent", group: "Technical", requires: "eod" },
  { key: "macdState", label: "MACD State", kind: "enum", group: "Technical", requires: "eod", options: ["Bullish Cross", "Bearish Cross", "Above Zero", "Below Zero", "Expanding", "Contracting"] },
  { key: "aboveSma200", label: "Above 200-day", kind: "boolean", group: "Technical", requires: "eod" },
  { key: "coilPct", label: "Coil Tightness %", kind: "percent", group: "Technical", requires: "eod" },
  { key: "setupScore", label: "Setup Score", kind: "integer", group: "Technical", requires: "eod" },
  { key: "setupGrade", label: "Grade", kind: "string", group: "Technical", requires: "eod" },
  { key: "criteria", label: "Criteria Met", kind: "string", group: "Technical", requires: "eod", hint: "Preferred criteria satisfied / total, with unknowns called out" },
  { key: "criteriaMet", label: "Criteria Count", kind: "integer", group: "Technical", requires: "eod" },

  // Fundamental
  { key: "marketCap", label: "Market Cap", kind: "money", group: "Fundamental", requires: "eod" },
  { key: "floatShares", label: "Float", kind: "integer", group: "Fundamental", requires: "eod", hint: "True float when available; otherwise shares outstanding (an upper bound, so low-float flags stay conservative)" },
  { key: "sharesOutstanding", label: "Shares Outstanding", kind: "integer", group: "Fundamental", requires: "float" },
  { key: "sector", label: "Sector", kind: "string", group: "Fundamental", requires: "eod" },
  { key: "industry", label: "Industry", kind: "string", group: "Fundamental", requires: "eod" },
  { key: "exchange", label: "Exchange", kind: "string", group: "Fundamental", requires: "eod" },

  // Catalyst
  { key: "catalystStatus", label: "Catalyst Status", kind: "enum", group: "Catalyst", requires: "news", options: ["Found", "None", "Negative", "Unknown"] },
  { key: "newsAgeHours", label: "News Age (hours)", kind: "number", group: "Catalyst", requires: "news" },
  { key: "dilutionRisk", label: "Dilution Risk", kind: "boolean", group: "Catalyst", requires: "news" },
  { key: "halted", label: "Halted", kind: "boolean", group: "Catalyst", requires: "halts" },
];

export const FIELD_BY_KEY = new Map(FIELDS.map((f) => [f.key, f]));

export type Operator = "gt" | "gte" | "lt" | "lte" | "eq" | "neq" | "between" | "in" | "isTrue" | "isFalse";

export const OPERATORS_FOR: Record<FieldKind, Operator[]> = {
  number: ["gt", "gte", "lt", "lte", "eq", "between"],
  percent: ["gt", "gte", "lt", "lte", "between"],
  money: ["gt", "gte", "lt", "lte", "between"],
  integer: ["gt", "gte", "lt", "lte", "between"],
  string: ["eq", "neq", "in"],
  enum: ["eq", "neq", "in"],
  boolean: ["isTrue", "isFalse"],
};

/** Which entitlements the current provider satisfies. */
export function availableEntitlements(caps: {
  intraday: boolean; quotes: boolean; halts: boolean; floatData: boolean; news: boolean;
}): Set<Entitlement> {
  const s = new Set<Entitlement>(["eod"]);
  if (caps.intraday) s.add("intraday");
  if (caps.quotes) s.add("quotes");
  if (caps.halts) s.add("halts");
  if (caps.floatData) s.add("float");
  if (caps.news) s.add("news");
  return s;
}

export function entitlementReason(e: Entitlement): string {
  const map: Record<Entitlement, string> = {
    eod: "",
    intraday: "requires intraday minute bars (paid data plan)",
    quotes: "requires real-time quotes (paid data plan)",
    float: "requires float / shares-outstanding reference data",
    halts: "requires real-time halt status",
    news: "requires a news feed",
  };
  return map[e];
}
