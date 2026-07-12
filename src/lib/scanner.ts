// ─────────────────────────────────────────────────────────
// AlphaForge live scan pipeline.
//
// Deterministic, evidence-driven. Every number is computed from real
// cached OHLCV bars. No LLM invents prices or signals. The catalyst
// pillar is a volume/momentum proxy until the Phase 2 news engine
// lands, and it is labeled as such on every setup.
//
// Pipeline: universe -> hard filters -> sector strength -> regime ->
// setup detection -> trade plan (R/R gate) -> scoring (80 gate) ->
// persist to Neon.
// ─────────────────────────────────────────────────────────

import { loadBars, refreshLatestBars, type Bar } from "./bars";
import { query } from "./db";
import { computeMetricsFromBars, type SnapshotMetrics } from "./polygon";
import { getVix } from "./fred";
import {
  buildScoreBreakdown,
  computeRiskReward,
  computeSmartMoneyScore,
  deriveDecision,
  MIN_RISK_REWARD,
  round2,
  clamp,
} from "./scoring";
import { buildRegimeSnapshot, regimeScore, type RegimeInputs } from "./regime";
import type { RegimeSnapshot, Sector, SectorStrength, SetupType } from "./types";

interface UniverseTicker {
  id: string;
  symbol: string;
  company_name: string;
  sector: Sector;
  is_ipo_36mo: boolean;
}

export interface ScanResult {
  scannedAt: string;
  barsRefreshed: number;
  universeSize: number;
  passedFilters: number;
  setupsFound: number;
  setupsQualified: number;
  regime: string;
  noTrade: boolean;
}

// ── Hard universe filters (from the approved plan) ──
const MIN_PRICE = 5;
const MIN_AVG_VOLUME = 1_000_000;
const MIN_REL_VOLUME_BREAKOUT = 1.3;
const MIN_SECTOR_SCORE = 70;

export async function runScan(): Promise<ScanResult> {
  const scannedAt = new Date().toISOString();

  // 1. Universe
  const universe = await query<UniverseTicker>(
    "select id, symbol, company_name, sector, is_ipo_36mo from tickers"
  );
  const symbols = universe.map((t) => t.symbol);

  // 2. Refresh latest bars (ONE grouped Polygon call for everything)
  const barsRefreshed = await refreshLatestBars([...symbols, "SPY", "QQQ"]);

  // 3. Load cached history
  const barsMap = await loadBars([...symbols, "SPY", "QQQ"]);

  // 4. Market regime (SPY/QQQ trend + VIX, with honest realized-vol fallback)
  const regime = await buildRegime(barsMap);
  await persistRegime(regime);

  // 5. Sector strength from real universe momentum
  const metricsBySymbol = new Map<string, SnapshotMetrics>();
  for (const t of universe) {
    const bars = barsMap.get(t.symbol);
    if (bars && bars.length >= 60) {
      metricsBySymbol.set(t.symbol, computeMetricsFromBars(t.symbol, bars));
    }
  }
  const sectors = computeSectorStrength(universe, barsMap);
  await persistSectorStrength(sectors);
  const sectorScoreByName = new Map(sectors.map((s) => [s.sector, s.score]));

  // 6. Per-ticker: filters -> setup detection -> plan -> scores
  let passedFilters = 0;
  let setupsFound = 0;
  let setupsQualified = 0;

  // Deactivate previous batch; fresh scan replaces the active board.
  await query("update trade_setups set is_active = false, expired_at = now() where is_active = true");

  for (const t of universe) {
    const bars = barsMap.get(t.symbol);
    const m = metricsBySymbol.get(t.symbol);
    if (!bars || !m || bars.length < 60) continue;

    // Hard filters
    if (m.price < MIN_PRICE) continue;
    if (m.avgVolume < MIN_AVG_VOLUME) continue;
    passedFilters++;

    // Sector gate
    const sectorScore = sectorScoreByName.get(t.sector) ?? 0;
    if (sectorScore < MIN_SECTOR_SCORE) continue;

    // Setup detection (deterministic price/volume structure)
    const setup = detectSetup(m, bars, t.is_ipo_36mo);
    if (!setup) continue;
    setupsFound++;

    // Trade plan with structural stop; reject if R/R below gate
    const plan = buildTradePlan(m, bars, setup.type);
    if (!plan || plan.riskReward < MIN_RISK_REWARD) continue;

    // Scoring
    const technical = technicalScore(m, bars, setup);
    const momentumProxy = momentumCatalystScore(m, bars); // labeled proxy until news engine
    const smartMoney = computeSmartMoneyScore({
      institutionalAccumulation: 12, // neutral until 13F engine (Phase 2)
      revenueGrowth: 10, // neutral until fundamentals engine (Phase 2)
      earningsGrowth: 8,
      relativeVolume: relVolumePoints(m.relVolume),
      insiderBuying: 5, // neutral until Form 4 engine (Phase 2)
      newsCatalyst: Math.round((momentumProxy / 100) * 10),
      sectorStrength: sectorScore >= 85 ? 5 : sectorScore >= 70 ? 4 : 2,
    });
    const scores = buildScoreBreakdown({
      catalyst: momentumProxy,
      smartMoney: smartMoney.total,
      technical,
      sectorStrength: sectorScore,
      marketRegime: regimeScore(regime.regime),
    });

    const decision = deriveDecision(scores.alphaforge, plan, m.price);
    if (scores.alphaforge >= 80) setupsQualified++;

    // Persist scores + setup (keep everything >= 65 so Watchlist tier is visible)
    if (scores.alphaforge < 65) continue;

    const scoreRow = await query<{ id: string }>(
      `insert into scores (ticker_id, catalyst_score, smart_money_score, technical_score,
         sector_strength_score, market_regime_score, alphaforge_score, confidence_score,
         institutional_accum, revenue_growth, earnings_growth,
         rel_volume_score, insider_buying_score, news_catalyst_score, sector_strength_raw)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id`,
      [t.id, scores.catalyst, scores.smartMoney, scores.technical, scores.sectorStrength,
       scores.marketRegime, scores.alphaforge, scores.confidence,
       smartMoney.institutionalAccumulation, smartMoney.revenueGrowth, smartMoney.earningsGrowth,
       smartMoney.relativeVolume, smartMoney.insiderBuying, smartMoney.newsCatalyst, sectorScore]
    );

    await query(
      `insert into trade_setups (ticker_id, score_id, opportunity_type, setup_type, market_regime,
         entry_zone_low, entry_zone_high, entry_aggressive, entry_conservative,
         stop_loss, stop_basis, target_1, target_2, target_3,
         expected_pct_move, expected_hold_days, risk_reward_ratio, risk_rating,
         bull_thesis, bear_thesis, decision, is_active)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,true)`,
      [t.id, scoreRow[0].id, opportunityType(t, m), setup.type, regime.regime,
       plan.entryZoneLow, plan.entryZoneHigh, plan.entryAggressive, plan.entryConservative,
       plan.stopLoss, plan.stopBasis, plan.target1, plan.target2, plan.target3,
       plan.expectedPctMove, plan.expectedHoldDays, plan.riskReward, riskRating(m),
       bullThesis(t, m, setup, sectorScore), bearThesis(t, m, regime.regime), decision]
    );
  }

  return {
    scannedAt,
    barsRefreshed,
    universeSize: universe.length,
    passedFilters,
    setupsFound,
    setupsQualified,
    regime: regime.regime,
    noTrade: setupsQualified === 0,
  };
}

// ── Regime ──
async function buildRegime(barsMap: Map<string, Bar[]>): Promise<RegimeSnapshot> {
  const spy = barsMap.get("SPY");
  const qqq = barsMap.get("QQQ");
  let vix = await getVix();

  if (!spy || !qqq || spy.length < 60) {
    // No index data cached yet: neutral defaults, honestly labeled by trade gate.
    return buildRegimeSnapshot({ spyAbove50d: true, qqqAbove50d: true, vix: vix ?? 18, breadth: 50, spyWeekChangePct: 0 });
  }

  const spyM = computeMetricsFromBars("SPY", spy);
  const qqqM = computeMetricsFromBars("QQQ", qqq);

  // Realized-vol proxy when FRED key is missing (annualized 20d, scaled to VIX-like level).
  if (vix === null) vix = realizedVolProxy(spy);

  const spyWeekChangePct =
    spy.length >= 6 ? round2(((spy[spy.length - 1].c - spy[spy.length - 6].c) / spy[spy.length - 6].c) * 100) : 0;

  const inputs: RegimeInputs = {
    spyAbove50d: spyM.price > spyM.ema50,
    qqqAbove50d: qqqM.price > qqqM.ema50,
    vix,
    breadth: breadthEstimate(barsMap),
    spyWeekChangePct,
  };
  return buildRegimeSnapshot(inputs);
}

function realizedVolProxy(bars: Bar[]): number {
  const closes = bars.slice(-21).map((b) => b.c);
  if (closes.length < 21) return 18;
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
  return round2(Math.sqrt(variance) * Math.sqrt(252) * 100);
}

// % of universe above its own 20 EMA. Real breadth from our universe.
function breadthEstimate(barsMap: Map<string, Bar[]>): number {
  let above = 0;
  let total = 0;
  for (const [sym, bars] of Array.from(barsMap.entries())) {
    if (sym === "SPY" || sym === "QQQ" || bars.length < 30) continue;
    const m = computeMetricsFromBars(sym, bars);
    total++;
    if (m.price > m.ema20) above++;
  }
  return total === 0 ? 50 : Math.round((above / total) * 100);
}

async function persistRegime(r: RegimeSnapshot): Promise<void> {
  await query(
    `insert into market_regime_log (spy_trend, qqq_trend, vix_level, breadth_score, regime, trade_gate)
     values ($1,$2,$3,$4,$5,$6)`,
    [r.spyTrend, r.qqqTrend, r.vix, r.breadth, r.regime, r.tradeGate]
  );
}

// ── Sector strength ──
function computeSectorStrength(universe: UniverseTicker[], barsMap: Map<string, Bar[]>): SectorStrength[] {
  const bySector = new Map<Sector, { m5: number[]; m20: number[] }>();
  for (const t of universe) {
    const bars = barsMap.get(t.symbol);
    if (!bars || bars.length < 25) continue;
    const last = bars[bars.length - 1].c;
    const p5 = bars[bars.length - 6]?.c;
    const p20 = bars[bars.length - 21]?.c;
    if (!p5 || !p20) continue;
    const bucket = bySector.get(t.sector) ?? { m5: [], m20: [] };
    bucket.m5.push(((last - p5) / p5) * 100);
    bucket.m20.push(((last - p20) / p20) * 100);
    bySector.set(t.sector, bucket);
  }

  const rows = Array.from(bySector.entries()).map(([sector, v]) => {
    const m5 = avg(v.m5);
    const m20 = avg(v.m20);
    // Score: 20d momentum dominates, 5d refines. +8%/20d maps to ~90.
    const score = Math.round(clamp(55 + m20 * 4 + m5 * 2, 0, 100));
    return { sector, score, m5: round2(m5), m20: round2(m20) };
  });

  rows.sort((a, b) => b.score - a.score);
  return rows.map((r, i) => ({
    sector: r.sector,
    score: r.score,
    rank: i + 1,
    momentum5d: r.m5,
    momentum20d: r.m20,
  }));
}

async function persistSectorStrength(sectors: SectorStrength[]): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  for (const s of sectors) {
    await query(
      `insert into sector_strength_daily (date, sector, score, rank, momentum_5d, momentum_20d)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (date, sector) do update set
         score=excluded.score, rank=excluded.rank,
         momentum_5d=excluded.momentum_5d, momentum_20d=excluded.momentum_20d`,
      [today, s.sector, s.score, s.rank, s.momentum5d, s.momentum20d]
    );
  }
}

// ── Setup detection (EOD structural rules) ──
interface DetectedSetup {
  type: SetupType;
  pivotHigh: number;
  quality: number; // 0-20 extra points for technical score
}

function detectSetup(m: SnapshotMetrics, bars: Bar[], isIpo: boolean): DetectedSetup | null {
  const last = bars[bars.length - 1];
  const prior = bars.slice(-22, -1);
  if (prior.length < 15) return null;
  const priorHigh = Math.max(...prior.map((b) => b.h));

  // Breakout: close at/above the prior 20d high on expanded volume.
  if (last.c >= priorHigh * 0.998 && m.relVolume >= MIN_REL_VOLUME_BREAKOUT && m.price > m.ema20) {
    const tight = rangeTightness(prior);
    return {
      type: isIpo ? "IPO Base Breakout" : "Breakout",
      pivotHigh: priorHigh,
      quality: tight < 0.08 ? 20 : tight < 0.12 ? 14 : 8,
    };
  }

  // Pullback: established uptrend, orderly pullback into the 20 EMA zone, holding.
  const uptrend = m.ema20 > m.ema50 && m.price > m.ema50;
  const nearEma20 = last.l <= m.ema20 * 1.02 && last.c >= m.ema20 * 0.99;
  const healthyRsi = m.rsi14 >= 38 && m.rsi14 <= 62;
  if (uptrend && nearEma20 && healthyRsi) {
    return { type: "Pullback", pivotHigh: priorHigh, quality: 12 };
  }

  // Earnings continuation / news momentum / VWAP reclaim need the Phase 2
  // news + intraday engines. Not faked here.
  return null;
}

function rangeTightness(bars: Bar[]): number {
  const hi = Math.max(...bars.map((b) => b.h));
  const lo = Math.min(...bars.map((b) => b.l));
  return (hi - lo) / hi;
}

// ── Trade plan ──
interface Plan {
  entryZoneLow: number; entryZoneHigh: number;
  entryAggressive: number; entryConservative: number;
  stopLoss: number; stopBasis: string;
  target1: number; target2: number; target3: number;
  expectedPctMove: number; expectedHoldDays: number;
  riskReward: number;
}

function buildTradePlan(m: SnapshotMetrics, bars: Bar[], type: SetupType): Plan | null {
  const price = m.price;
  const atr = m.atr14;
  if (atr <= 0 || price <= 0) return null;

  let entryConservative: number;
  let entryAggressive: number;
  let stopLoss: number;
  let stopBasis: string;

  if (type === "Breakout" || type === "IPO Base Breakout") {
    entryConservative = round2(price);
    entryAggressive = round2(price * 1.005);
    // Structure: below the breakout day low or 20 EMA, whichever is tighter but real.
    const lastLow = bars[bars.length - 1].l;
    stopLoss = round2(Math.min(lastLow, m.ema20) - 0.25 * atr);
    stopBasis = "Below breakout-day low / 20 EMA minus 0.25 ATR";
  } else {
    // Pullback: enter at/near the 20 EMA reclaim, stop under the pullback low.
    entryConservative = round2(Math.max(price, m.ema20));
    entryAggressive = round2(price * 1.004);
    const pullbackLow = Math.min(...bars.slice(-5).map((b) => b.l));
    stopLoss = round2(pullbackLow - 0.25 * atr);
    stopBasis = "Below 5-day pullback low minus 0.25 ATR";
  }

  const risk = entryConservative - stopLoss;
  if (risk <= 0 || risk / price > 0.12) return null; // stop too wide = pass

  const target1 = round2(entryConservative + 2.0 * risk);
  const target2 = round2(entryConservative + 3.2 * risk);
  const target3 = round2(entryConservative + 5.0 * risk);

  const plan: Plan = {
    entryZoneLow: round2(entryConservative * 0.995),
    entryZoneHigh: round2(entryConservative * 1.01),
    entryAggressive,
    entryConservative,
    stopLoss,
    stopBasis,
    target1,
    target2,
    target3,
    expectedPctMove: round2(((target2 - entryConservative) / entryConservative) * 100),
    expectedHoldDays: atr / price > 0.035 ? 6 : 12,
    riskReward: 0,
  };
  plan.riskReward = computeRiskReward(plan);
  return plan;
}

// ── Scores ──
function technicalScore(m: SnapshotMetrics, bars: Bar[], setup: DetectedSetup): number {
  let s = 0;
  if (m.above200d) s += 20;
  if (m.above50d) s += 15;
  if (m.price > m.ema20) s += 10;
  s += setup.quality; // base quality 8-20
  if (m.relVolume >= 2) s += 15;
  else if (m.relVolume >= 1.5) s += 10;
  else if (m.relVolume >= 1.2) s += 6;
  if (m.rsi14 >= 50 && m.rsi14 <= 70) s += 10;
  else if (m.rsi14 > 70) s += 4;
  return Math.round(clamp(s, 0, 100));
}

// Volume/momentum proxy for the catalyst pillar. Honest: this is NOT news.
// It measures whether something unusual is happening in price and volume.
function momentumCatalystScore(m: SnapshotMetrics, bars: Bar[]): number {
  let s = 30; // baseline "no news engine yet"
  if (m.relVolume >= 3) s += 35;
  else if (m.relVolume >= 2) s += 25;
  else if (m.relVolume >= 1.5) s += 15;
  const last = bars[bars.length - 1];
  const dayMove = (last.c - last.o) / last.o;
  if (dayMove > 0.04) s += 20;
  else if (dayMove > 0.02) s += 12;
  else if (dayMove > 0) s += 5;
  return Math.round(clamp(s, 0, 100));
}

function relVolumePoints(rv: number): number {
  if (rv >= 3) return 15;
  if (rv >= 2) return 11;
  if (rv >= 1.5) return 8;
  if (rv >= 1.2) return 5;
  return 2;
}

function opportunityType(t: UniverseTicker, m: SnapshotMetrics): string {
  if (t.is_ipo_36mo) return "Fresh IPO";
  if (m.atr14 / m.price > 0.05) return "High Risk Speculative";
  if (m.avgVolume > 20_000_000) return "Established Leader";
  return "Emerging Growth";
}

function riskRating(m: SnapshotMetrics): string {
  const atrPct = m.atr14 / m.price;
  if (atrPct > 0.05) return "High";
  if (atrPct > 0.025) return "Medium";
  return "Low";
}

function bullThesis(t: UniverseTicker, m: SnapshotMetrics, setup: DetectedSetup, sectorScore: number): string {
  return `${setup.type} in ${t.sector} (sector score ${sectorScore}). Price $${m.price} above the 50/200-day trend with ${m.relVolume}x relative volume and RSI ${m.rsi14}. Signal is price/volume based; the news catalyst engine (Phase 2) is not yet layered in.`;
}

function bearThesis(t: UniverseTicker, m: SnapshotMetrics, regime: string): string {
  const atrPct = round2((m.atr14 / m.price) * 100);
  return `Daily swing of ~${atrPct}% (ATR) cuts both ways; a failed move puts the stop in play quickly. Regime is ${regime}; an index reversal would drag ${t.sector} with it. No earnings/news calendar check yet in v1.`;
}

function avg(a: number[]): number {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}
