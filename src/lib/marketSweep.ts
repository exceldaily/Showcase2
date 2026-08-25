// ─────────────────────────────────────────────────────────
// Whole-market scanning from the market_daily snapshot table.
// The daily grouped download covers ~10,000 US stocks; this module
// turns the latest snapshot into MetricRows (price, change%, gap%,
// volume, dollar volume, RVOL) so the rule engine can sweep the
// entire market on the free EOD feed. Chart-derived fields (EMA,
// RSI, VWAP...) are absent by design and fail closed in rules.
// ─────────────────────────────────────────────────────────

import { query } from "./db";
import { floatCategory } from "./metrics";
import type { MetricRow } from "./scannerRules";

/** Catalyst freshness window: news this recent counts as a catalyst. */
export const CATALYST_FRESH_HOURS = 72;
/** A news check this old is considered stale and shows as unknown again. */
export const CATALYST_CHECK_TTL_HOURS = 7 * 24;

export interface CatalystRow {
  symbol: string;
  checked_at: string | Date;
  published_at: string | Date | null;
  headline?: string | null;
}

/**
 * Found  = article within CATALYST_FRESH_HOURS of now.
 * None   = we checked recently and nothing fresh was tagged.
 * undefined = never checked / check too old -> field stays unknown
 *             and fails closed in rules.
 */
export function catalystStatusFrom(
  row: Pick<CatalystRow, "checked_at" | "published_at"> | undefined,
  now: Date = new Date()
): "Found" | "None" | undefined {
  if (!row) return undefined;
  const checked = new Date(row.checked_at).getTime();
  if (!Number.isFinite(checked) || now.getTime() - checked > CATALYST_CHECK_TTL_HOURS * 3600e3) {
    return undefined;
  }
  if (row.published_at) {
    const pub = new Date(row.published_at).getTime();
    if (Number.isFinite(pub) && now.getTime() - pub <= CATALYST_FRESH_HOURS * 3600e3) return "Found";
  }
  return "None";
}

export interface SweepRaw {
  symbol: string;
  open: string | number | null;
  close: string | number;
  volume: string | number;
  prev_close: string | number | null;
  avg_vol: string | number | null;
  hist_n: string | number;
}

export interface SweepTickerRef {
  company_name?: string | null;
  sector?: string | null;
  market_cap?: string | number | null;
  shares_outstanding?: string | number | null;
  float_shares?: string | number | null;
}

const num = (v: string | number | null | undefined): number | undefined => {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Snapshot row -> MetricRow. Pure; unit-tested. */
export function buildSweepRow(
  raw: SweepRaw,
  ref?: SweepTickerRef,
  catalyst?: "Found" | "None"
): MetricRow {
  const close = num(raw.close) ?? 0;
  const open = num(raw.open);
  const prev = num(raw.prev_close);
  const vol = num(raw.volume) ?? 0;
  const avgVol = num(raw.avg_vol);
  const histN = num(raw.hist_n) ?? 0;

  const row: MetricRow = {
    symbol: raw.symbol,
    price: close,
    volume: vol,
    dollarVolume: Math.round(close * vol),
  };
  if (prev && prev > 0) {
    row.changePct = round2(((close - prev) / prev) * 100);
    if (open !== undefined) row.gapPct = round2(((open - prev) / prev) * 100);
  }
  // RVOL needs a real baseline; fewer than 10 prior sessions stays unknown.
  if (avgVol && avgVol > 0 && histN >= 10) {
    row.rvol = round2(vol / avgVol);
    row.avgVolume = Math.round(avgVol);
  }
  if (ref) {
    if (ref.company_name) row.companyName = ref.company_name;
    if (ref.sector) row.sector = ref.sector;
    const mc = num(ref.market_cap);
    if (mc !== undefined) row.marketCap = mc;
    // Conservative float: true float when known, else shares outstanding
    // (an upper bound -- if it is under the threshold, so is the float).
    const fl = num(ref.float_shares) ?? num(ref.shares_outstanding);
    if (fl !== undefined) {
      row.floatShares = fl;
      row.floatCategory = floatCategory(fl);
    }
  }
  if (catalyst) row.catalystStatus = catalyst;
  return row;
}

export interface SweepBounds {
  minPrice: number;
  maxPrice: number | null;
  minDollarVolume: number;
}

/**
 * Load the latest whole-market snapshot as MetricRows.
 * One windowed query over ~45 days of market_daily; tracked-ticker
 * reference data and cached catalyst checks are joined in.
 */
export async function loadMarketSweepRows(bounds: SweepBounds): Promise<MetricRow[]> {
  const raws = await query<SweepRaw>(
    `with recent as (
       select symbol, date, open, close, volume
       from market_daily
       where date > (select max(date) from market_daily) - interval '45 days'
     ), w as (
       select symbol, open, close, volume,
         lag(close) over (partition by symbol order by date) as prev_close,
         avg(volume) over (partition by symbol order by date rows between 20 preceding and 1 preceding) as avg_vol,
         count(*) over (partition by symbol order by date rows between 20 preceding and 1 preceding) as hist_n,
         row_number() over (partition by symbol order by date desc) as rn
       from recent
     )
     select symbol, open, close, volume, prev_close, avg_vol, hist_n
     from w
     where rn = 1
       and close >= $1
       and ($2::numeric is null or close <= $2)
       and close * volume >= $3`,
    [bounds.minPrice, bounds.maxPrice, bounds.minDollarVolume]
  );
  if (raws.length === 0) return [];

  const [refs, catalysts] = await Promise.all([
    query<SweepTickerRef & { symbol: string }>(
      `select symbol, company_name, sector, market_cap, shares_outstanding, float_shares
       from tickers where symbol not like 'X:%'`
    ),
    query<CatalystRow>(`select symbol, checked_at, published_at from catalyst_news`),
  ]);
  const refBySym = new Map(refs.map((r) => [r.symbol, r]));
  const now = new Date();
  const catBySym = new Map(catalysts.map((c) => [c.symbol, catalystStatusFrom(c, now)]));

  return raws.map((raw) =>
    buildSweepRow(raw, refBySym.get(raw.symbol), catBySym.get(raw.symbol) ?? undefined)
  );
}
