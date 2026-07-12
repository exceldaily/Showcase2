// ─────────────────────────────────────────────────────────
// Data access layer.
// Reads live setups/regime/sectors from Neon when the scanner has
// populated them. Falls back to demo data only when nothing live
// exists yet, so the UI always renders.
// ─────────────────────────────────────────────────────────

import { MOCK_REGIME, MOCK_SECTORS, MOCK_SETUPS, getMockSetupById } from "@/data/mock";
import { hasDatabase, query } from "@/lib/db";
import { buildLiveRegime, canBuildLiveRegime } from "@/lib/liveRegime";
import { computeSmartMoneyScore } from "@/lib/scoring";
import type {
  CatalystLevel,
  Decision,
  MarketRegime,
  OpportunityType,
  RegimeSnapshot,
  RiskRating,
  Sector,
  SectorStrength,
  SetupType,
  TradeDirection,
  TradeSetup,
} from "@/lib/types";

export interface DataSourceStatus {
  live: boolean;
  label: string;
}

export function dataSourceStatus(): DataSourceStatus {
  const live = hasDatabase() && Boolean(process.env.POLYGON_API_KEY);
  return { live, label: live ? "Live data" : "Demo data" };
}

// ── Regime ──
export async function getRegime(): Promise<RegimeSnapshot> {
  // 1. Latest scanner-written regime (fresh within 26h — scans run daily)
  if (hasDatabase()) {
    const rows = await query<{
      spy_trend: string; qqq_trend: string; vix_level: string;
      breadth_score: string; regime: string; trade_gate: string; ts: string;
    }>(
      `select spy_trend, qqq_trend, vix_level, breadth_score, regime, trade_gate, ts::text
       from market_regime_log
       where ts > now() - interval '26 hours'
       order by ts desc limit 1`
    );
    if (rows.length > 0) {
      const r = rows[0];
      return {
        regime: r.regime as MarketRegime,
        spyTrend: r.spy_trend as "up" | "down" | "flat",
        qqqTrend: r.qqq_trend as "up" | "down" | "flat",
        vix: Number(r.vix_level),
        breadth: Number(r.breadth_score),
        tradeGate: r.trade_gate,
        note: "",
        updatedAt: r.ts,
      };
    }
  }
  // 2. Live build from Polygon + FRED
  if (canBuildLiveRegime()) {
    const live = await buildLiveRegime();
    if (live) return live;
  }
  // 3. Demo
  return MOCK_REGIME;
}

// ── Sector strength ──
export async function getSectorStrength(): Promise<SectorStrength[]> {
  if (hasDatabase()) {
    const rows = await query<{
      sector: string; score: string; rank: number; momentum_5d: string; momentum_20d: string;
    }>(
      `select sector, score, rank, momentum_5d, momentum_20d
       from sector_strength_daily
       where date = (select max(date) from sector_strength_daily)
       order by rank asc`
    );
    if (rows.length > 0) {
      return rows.map((r) => ({
        sector: r.sector as Sector,
        score: Number(r.score),
        rank: Number(r.rank),
        momentum5d: Number(r.momentum_5d),
        momentum20d: Number(r.momentum_20d),
      }));
    }
  }
  return MOCK_SECTORS;
}

// ── Setups ──
interface SetupRow {
  id: string;
  symbol: string;
  company_name: string;
  sector: string;
  opportunity_type: string;
  setup_type: string;
  direction: string;
  target_basis_1: string | null;
  target_basis_2: string | null;
  target_basis_3: string | null;
  market_regime: string;
  generated_at: string;
  entry_zone_low: string; entry_zone_high: string;
  entry_aggressive: string; entry_conservative: string;
  stop_loss: string; stop_basis: string;
  target_1: string; target_2: string; target_3: string;
  expected_pct_move: string; expected_hold_days: number;
  risk_reward_ratio: string; risk_rating: string;
  bull_thesis: string; bear_thesis: string; decision: string;
  catalyst_score: string; smart_money_score: string; technical_score: string;
  sector_strength_score: string; market_regime_score: string;
  alphaforge_score: string; confidence_score: string;
  institutional_accum: string; revenue_growth: string; earnings_growth: string;
  rel_volume_score: string; insider_buying_score: string; news_catalyst_score: string;
  sector_strength_raw: string;
  current_price: string | null;
  price_as_of: string | null;
}

const SETUP_SELECT = `
  select ts.id, tk.symbol, tk.company_name, tk.sector,
    ts.opportunity_type, ts.setup_type, ts.direction,
    ts.target_basis_1, ts.target_basis_2, ts.target_basis_3,
    ts.market_regime, ts.generated_at::text,
    ts.entry_zone_low, ts.entry_zone_high, ts.entry_aggressive, ts.entry_conservative,
    ts.stop_loss, ts.stop_basis, ts.target_1, ts.target_2, ts.target_3,
    ts.expected_pct_move, ts.expected_hold_days, ts.risk_reward_ratio, ts.risk_rating,
    ts.bull_thesis, ts.bear_thesis, ts.decision,
    s.catalyst_score, s.smart_money_score, s.technical_score,
    s.sector_strength_score, s.market_regime_score, s.alphaforge_score, s.confidence_score,
    s.institutional_accum, s.revenue_growth, s.earnings_growth,
    s.rel_volume_score, s.insider_buying_score, s.news_catalyst_score, s.sector_strength_raw,
    (select b.close from daily_bars b where b.symbol = tk.symbol order by b.date desc limit 1) as current_price,
    (select b.date::text from daily_bars b where b.symbol = tk.symbol order by b.date desc limit 1) as price_as_of
  from trade_setups ts
  join tickers tk on tk.id = ts.ticker_id
  left join scores s on s.id = ts.score_id`;

function rowToSetup(r: SetupRow): TradeSetup {
  const momentum = Number(r.catalyst_score ?? 0);
  const level: CatalystLevel = momentum >= 70 ? 3 : momentum >= 45 ? 2 : 1;
  return {
    id: r.id,
    ticker: r.symbol.replace(/^X:/, ""), // X:BTCUSD renders as BTCUSD
    company: r.company_name,
    sector: r.sector as Sector,
    opportunityType: r.opportunity_type as OpportunityType,
    setupType: r.setup_type as SetupType,
    currentPrice: r.current_price ? Number(r.current_price) : Number(r.entry_conservative),
    priceAsOf: r.price_as_of,
    priceLabel: "End-of-day",
    direction: (r.direction as TradeDirection) ?? "Long",
    marketRegime: r.market_regime as MarketRegime,
    catalyst: {
      headline: `Price and volume momentum signal on ${r.symbol} (${r.setup_type})`,
      source: "AlphaForge Momentum Engine",
      publishedAt: r.generated_at,
      level,
      type: "Volume/Momentum Signal — news catalyst engine arrives in Phase 2",
      summary:
        "This signal is computed from real price and volume structure only. Headline/news classification, SEC filings and earnings context are layered in during Phase 2.",
    },
    scores: {
      catalyst: Number(r.catalyst_score ?? 0),
      smartMoney: Number(r.smart_money_score ?? 0),
      technical: Number(r.technical_score ?? 0),
      sectorStrength: Number(r.sector_strength_score ?? 0),
      marketRegime: Number(r.market_regime_score ?? 0),
      alphaforge: Number(r.alphaforge_score ?? 0),
      confidence: Number(r.confidence_score ?? 0),
    },
    smartMoney: computeSmartMoneyScore({
      institutionalAccumulation: Number(r.institutional_accum ?? 0),
      revenueGrowth: Number(r.revenue_growth ?? 0),
      earningsGrowth: Number(r.earnings_growth ?? 0),
      relativeVolume: Number(r.rel_volume_score ?? 0),
      insiderBuying: Number(r.insider_buying_score ?? 0),
      newsCatalyst: Number(r.news_catalyst_score ?? 0),
      sectorStrength: Number(r.sector_strength_raw ?? 0) >= 85 ? 5 : Number(r.sector_strength_raw ?? 0) >= 70 ? 4 : 2,
    }),
    plan: {
      entryZoneLow: Number(r.entry_zone_low),
      entryZoneHigh: Number(r.entry_zone_high),
      entryAggressive: Number(r.entry_aggressive),
      entryConservative: Number(r.entry_conservative),
      stopLoss: Number(r.stop_loss),
      stopBasis: r.stop_basis,
      target1: Number(r.target_1),
      target2: Number(r.target_2),
      target3: Number(r.target_3),
      targetBasis1: r.target_basis_1 ?? undefined,
      targetBasis2: r.target_basis_2 ?? undefined,
      targetBasis3: r.target_basis_3 ?? undefined,
      expectedPctMove: Number(r.expected_pct_move),
      expectedHoldDays: Number(r.expected_hold_days),
      riskReward: Number(r.risk_reward_ratio),
    },
    riskRating: r.risk_rating as RiskRating,
    bullThesis: r.bull_thesis,
    bearThesis: r.bear_thesis,
    decision: r.decision as Decision,
    generatedAt: r.generated_at,
  };
}

export async function getSetups(): Promise<TradeSetup[]> {
  if (hasDatabase()) {
    const rows = await query<SetupRow>(
      `${SETUP_SELECT} where ts.is_active = true order by s.alphaforge_score desc nulls last`
    );
    if (rows.length > 0) return rows.map(rowToSetup);
  }
  return MOCK_SETUPS;
}

export async function getSetupById(id: string): Promise<TradeSetup | undefined> {
  // Demo ids are slugs; DB ids are UUIDs.
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  if (isUuid && hasDatabase()) {
    const rows = await query<SetupRow>(`${SETUP_SELECT} where ts.id = $1`, [id]);
    if (rows.length > 0) return rowToSetup(rows[0]);
  }
  return getMockSetupById(id);
}

// Daily digest: top 3 overall, top 3 emerging growth, top 3 fresh IPO.
export async function getDailyDigest(): Promise<{
  topTrades: TradeSetup[];
  emergingGrowth: TradeSetup[];
  freshIpos: TradeSetup[];
  noTrade: boolean;
}> {
  const all = await getSetups();
  const byScore = [...all].sort((a, b) => b.scores.alphaforge - a.scores.alphaforge);
  const qualified = byScore.filter((s) => s.scores.alphaforge >= 80);

  return {
    topTrades: qualified.slice(0, 3),
    emergingGrowth: qualified.filter((s) => s.opportunityType === "Emerging Growth").slice(0, 3),
    freshIpos: qualified.filter((s) => s.opportunityType === "Fresh IPO").slice(0, 3),
    noTrade: qualified.length === 0,
  };
}
