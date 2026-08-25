// ─────────────────────────────────────────────────────────
// Quick filter + sort definitions (pure, unit-tested).
// These refine rows the server already returned; they never invent
// rows. Kept outside the component so every predicate is testable.
// ─────────────────────────────────────────────────────────

import type { MetricRow } from "./scannerRules";

export interface QuickFilterDef {
  key: string;
  label: string;
  /** Plain-English description shown on hover. */
  hint: string;
  /** Group for layout: "checklist" = momentum checklist gates, "quality" = structure. */
  group: "checklist" | "quality";
  test: (r: MetricRow) => boolean;
}

const num = (v: unknown, fallback: number) =>
  v === null || v === undefined || v === "" ? fallback : Number(v);

export const QUICK_FILTERS: QuickFilterDef[] = [
  // ── Momentum checklist gates (demand + supply) ──
  { key: "under20", label: "$2–$20", group: "checklist", hint: "Price between $2 and $20 — the range most active momentum traders prefer.", test: (r) => { const p = num(r.price, -1); return p >= 2 && p <= 20; } },
  { key: "up10", label: "Up 10%+", group: "checklist", hint: "Already up 10% or more on the day — demand is visible.", test: (r) => num(r.changePct, -Infinity) >= 10 },
  { key: "rvol5", label: "5x Volume", group: "checklist", hint: "Relative volume 5x or higher — five times this stock's normal participation.", test: (r) => num(r.rvol, 0) >= 5 },
  { key: "lowFloat", label: "Float <20M", group: "checklist", hint: "Under 20M shares — thin supply. Uses shares outstanding as a conservative upper bound when true float is unavailable.", test: (r) => num(r.floatShares, Infinity) < 20_000_000 },
  { key: "catalyst", label: "Has Catalyst", group: "checklist", hint: "A news article within the last 3 days. Unknown until the catalyst sweep has checked the symbol.", test: (r) => String(r.catalystStatus ?? "") === "Found" },

  // ── Structure / quality ──
  { key: "heavyVol", label: "Heavy Volume", group: "quality", hint: "RVOL 2x or more — unusual participation behind the move.", test: (r) => num(r.rvol, 0) >= 2 },
  { key: "green", label: "Green Today", group: "quality", hint: "Up on the session.", test: (r) => num(r.changePct, 0) > 0 },
  { key: "aboveVwap", label: "Above VWAP", group: "quality", hint: "Trading above the volume-weighted average — buyers in control.", test: (r) => num(r.vwapDistancePct, -1) >= 0 },
  { key: "stacked", label: "EMA Stacked", group: "quality", hint: "EMA 9 > 20 > 50 — every timeframe agrees the trend is up.", test: (r) => /9\s*>\s*20\s*>\s*50/.test(String(r.emaState ?? "")) },
  { key: "coiled", label: "Tight Coil", group: "quality", hint: "8-day range under 6% — compression that often precedes a move.", test: (r) => num(r.coilPct, 99) <= 6 },
  { key: "liquid", label: "Liquid", group: "quality", hint: "Over $10M traded daily — you can get in and out cleanly.", test: (r) => num(r.dollarVolume, 0) >= 10e6 },
  { key: "notExtended", label: "Not Extended", group: "quality", hint: "Within 6% of VWAP — not chasing a stretched move.", test: (r) => num(r.vwapDistancePct, 99) < 6 },
  { key: "healthyRsi", label: "Healthy RSI", group: "quality", hint: "RSI 45-75 — momentum present without being exhausted.", test: (r) => { const v = num(r.rsi14, 0); return v >= 45 && v <= 75; } },
  { key: "gradeAB", label: "Grade A/B", group: "quality", hint: "Setup score 70 or better — most components aligned.", test: (r) => num(r.setupScore, 0) >= 70 },
];

export const QUICK_SORTS: { key: string; label: string; hint: string }[] = [
  { key: "rvol", label: "Volume", hint: "Highest relative volume first." },
  { key: "changePct", label: "% Change", hint: "Biggest movers first." },
  { key: "setupScore", label: "Setup Score", hint: "Best overall setup quality first." },
  { key: "criteriaMet", label: "Criteria Met", hint: "Most checklist criteria satisfied first." },
  { key: "coilPct", label: "Tightest Coil", hint: "Most compressed first." },
  { key: "dollarVolume", label: "Liquidity", hint: "Most dollar volume first." },
  { key: "atrPct", label: "Volatility", hint: "Widest daily range first." },
];

export function applyQuickFilters(rows: MetricRow[], activeKeys: string[]): MetricRow[] {
  let out = rows;
  for (const k of activeKeys) {
    const f = QUICK_FILTERS.find((x) => x.key === k);
    if (f) out = out.filter(f.test);
  }
  return out;
}

export function applyQuickSort(rows: MetricRow[], sortKey: string | null, asc: boolean): MetricRow[] {
  if (!sortKey) return rows;
  return [...rows].sort((a, b) => {
    const av = Number(a[sortKey] ?? -Infinity);
    const bv = Number(b[sortKey] ?? -Infinity);
    // Missing values always sink to the bottom regardless of direction.
    if (!Number.isFinite(av) && !Number.isFinite(bv)) return 0;
    if (!Number.isFinite(av)) return 1;
    if (!Number.isFinite(bv)) return -1;
    return asc ? av - bv : bv - av;
  });
}
