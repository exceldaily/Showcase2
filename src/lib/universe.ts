// ─────────────────────────────────────────────────────────
// Configurable universes + default scanner presets (spec §2, §46).
// NOTHING here is hard-coded strategy: these are seed defaults the
// user can edit, clone, or delete. Cheap stocks are first-class:
// the floor is $0.25, not $5.
// ─────────────────────────────────────────────────────────

import type { RuleGroup } from "./scannerRules";

export interface UniverseDef {
  slug: string;
  name: string;
  minPrice: number;
  maxPrice: number | null;
  minDollarVolume: number;
  description: string;
}

export const DEFAULT_UNIVERSES: UniverseDef[] = [
  { slug: "low-price", name: "Low Price", minPrice: 0.25, maxPrice: 5, minDollarVolume: 500_000,
    description: "$0.25–$5. Small caps and momentum runners. Higher volatility and spread risk." },
  { slug: "small-cap-momentum", name: "Small-Cap Momentum", minPrice: 1, maxPrice: 20, minDollarVolume: 1_000_000,
    description: "$1–$20 with meaningful liquidity." },
  { slug: "mid-price-momentum", name: "Mid-Price Momentum", minPrice: 5, maxPrice: 50, minDollarVolume: 2_000_000,
    description: "$5–$50 momentum names." },
  { slug: "large-cap", name: "Large Cap", minPrice: 20, maxPrice: null, minDollarVolume: 10_000_000,
    description: "$20+ established liquid names." },
  { slug: "all-stocks", name: "All Stocks", minPrice: 0.25, maxPrice: null, minDollarVolume: 250_000,
    description: "Everything above the minimum liquidity floor." },
];

export interface ScannerPresetDef {
  slug: string;
  name: string;
  universeSlug: string;
  description: string;
  rules: RuleGroup;
  columns: string[];
  /** Entitlements this preset needs beyond EOD; shown as a badge when unmet. */
  needs: ("intraday" | "quotes" | "float" | "halts" | "news")[];
}

const BASE_COLUMNS = ["symbol", "price", "changePct", "volume", "rvol", "atrPct", "vwapDistancePct", "sector"];

export const DEFAULT_PRESETS: ScannerPresetDef[] = [
  {
    slug: "premarket-gappers",
    name: "Premarket Gappers",
    universeSlug: "all-stocks",
    description: "Stocks gapping before the open on premarket volume.",
    needs: ["intraday"],
    rules: {
      logic: "AND",
      conditions: [
        { field: "gapPct", op: "gte", value: 5 },
        { field: "premarketVolume", op: "gte", value: 50_000 },
        { field: "price", op: "gte", value: 0.5 },
      ],
    },
    columns: ["symbol", "price", "gapPct", "premarketChangePct", "premarketVolume", "floatShares", "rvol", "marketCap", "catalystStatus"],
  },
  {
    slug: "low-float-under-5",
    name: "Low Float Under $5",
    universeSlug: "low-price",
    description: "Editable defaults: $0.50–$5, float under 50M, +10% day, RVOL 2+.",
    needs: ["float"],
    rules: {
      logic: "AND",
      conditions: [
        { field: "price", op: "between", value: 0.5, value2: 5 },
        { field: "floatShares", op: "lt", value: 50_000_000 },
        { field: "changePct", op: "gte", value: 10 },
        { field: "rvol", op: "gte", value: 2 },
      ],
    },
    columns: ["symbol", "price", "changePct", "floatShares", "rvol", "volume", "atrPct", "catalystStatus", "dilutionRisk"],
  },
  {
    slug: "high-rvol",
    name: "High RVOL",
    universeSlug: "all-stocks",
    description: "Unusual volume relative to the 30-day average.",
    needs: [],
    rules: {
      logic: "AND",
      conditions: [
        { field: "rvol", op: "gte", value: 3 },
        { field: "price", op: "gte", value: 0.25 },
        { field: "dollarVolume", op: "gte", value: 1_000_000 },
      ],
    },
    columns: BASE_COLUMNS,
  },
  {
    slug: "hod-break",
    name: "High Of Day Break",
    universeSlug: "all-stocks",
    description: "Trading at or breaking the intraday high.",
    needs: ["intraday"],
    rules: {
      logic: "AND",
      conditions: [
        { field: "hodDistancePct", op: "lte", value: 1 },
        { field: "changePct", op: "gte", value: 3 },
        { field: "rvol", op: "gte", value: 2 },
      ],
    },
    columns: ["symbol", "price", "changePct", "hodDistancePct", "rvol", "volumeAcceleration", "vwapDistancePct", "catalystStatus"],
  },
  {
    slug: "vwap-reclaim",
    name: "VWAP Reclaim",
    universeSlug: "all-stocks",
    description: "Price reclaiming VWAP with the EMA stack aligned.",
    needs: [],
    rules: {
      logic: "AND",
      conditions: [
        { field: "vwapState", op: "eq", value: "Reclaim" },
        { field: "emaState", op: "in", values: ["9>20>50", "9>20"] },
        { field: "rvol", op: "gte", value: 1.5 },
      ],
    },
    columns: BASE_COLUMNS,
  },
  {
    slug: "volume-surge",
    name: "Volume Surge",
    universeSlug: "all-stocks",
    description: "Volume accelerating well above its normal pace.",
    needs: ["intraday"],
    rules: {
      logic: "AND",
      conditions: [
        { field: "volumeAcceleration", op: "gte", value: 3 },
        { field: "changePct", op: "gte", value: 2 },
      ],
    },
    columns: ["symbol", "price", "changePct", "volumeAcceleration", "volumeVelocity1m", "rvol", "catalystStatus"],
  },
  {
    slug: "large-cap-momentum",
    name: "Large Cap Momentum",
    universeSlug: "large-cap",
    description: "Liquid large caps trending with the EMA stack and above VWAP.",
    needs: [],
    rules: {
      logic: "AND",
      conditions: [
        { field: "emaState", op: "eq", value: "9>20>50" },
        { field: "vwapDistancePct", op: "gte", value: 0 },
        { field: "rvol", op: "gte", value: 1.2 },
        { field: "aboveSma200", op: "isTrue" },
      ],
    },
    columns: BASE_COLUMNS,
  },
  {
    slug: "coiled-breakout",
    name: "Coiled / Primed To Break",
    universeSlug: "all-stocks",
    description: "Tight coil under resistance with EMA 9>20>50 and rising VWAP.",
    needs: [],
    rules: {
      logic: "AND",
      conditions: [
        { field: "emaState", op: "eq", value: "9>20>50" },
        { field: "coilPct", op: "lte", value: 9 },
        { field: "vwapDistancePct", op: "gte", value: 0 },
      ],
    },
    columns: ["symbol", "price", "changePct", "coilPct", "rvol", "vwapDistancePct", "setupScore", "sector"],
  },
  {
    slug: "oversold-reversal",
    name: "Oversold Reversal",
    universeSlug: "all-stocks",
    description: "Washed-out RSI with volume returning.",
    needs: [],
    rules: {
      logic: "AND",
      conditions: [
        { field: "rsi14", op: "lte", value: 32 },
        { field: "rvol", op: "gte", value: 1.5 },
        { field: "price", op: "gte", value: 1 },
      ],
    },
    columns: BASE_COLUMNS,
  },
];
