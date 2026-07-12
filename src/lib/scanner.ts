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
  computeAlphaForgeScoreV1,
  computeConfidenceV1,
  computeSmartMoneyScore,
  MIN_RISK_REWARD,
  round2,
  clamp,
} from "./scoring";
import { buildRegimeSnapshot, regimeScore, type RegimeInputs } from "./regime";
import { buildPlan, detectLongSetup, detectShortSetup, type Detected, type Direction, type PlanSpec } from "./setups";
import type { Decision, RegimeSnapshot, Sector, SectorStrength } from "./types";

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

    // Hard filters. Crypto is exempt from the share-volume floor:
    // BTC volume is denominated in coins, not shares, and its dollar
    // volume is orders of magnitude above the liquidity bar.
    const isCrypto = t.symbol.startsWith("X:");
    if (m.price < MIN_PRICE) continue;
    if (!isCrypto && m.avgVolume < MIN_AVG_VOLUME) continue;
    passedFilters++;

    const sectorScore = sectorScoreByName.get(t.sector) ?? 0;

    // Detect in BOTH directions with the shared engine.
    const candidates = [
      detectLongSetup(m, bars, t.is_ipo_36mo),
      detectShortSetup(m, bars),
    ].filter((d): d is NonNullable<typeof d> => d !== null);

    for (const det of candidates) {
      const isShort = det.direction === "Short";

      // Directional sector gate: longs need a strong sector, shorts a weak one.
      if (!isShort && sectorScore < MIN_SECTOR_SCORE) continue;
      if (isShort && sectorScore > 45) continue;

      setupsFound++;

      const plan = buildPlan(m, bars, det);
      if (!plan || plan.riskReward < MIN_RISK_REWARD) continue;

      // Directional pillar values.
      const technical = technicalScore(m, bars, det);
      const momentumProxy = momentumCatalystScore(m, bars, det.direction);
      const sectorPillar = isShort ? 100 - sectorScore : sectorScore;
      const regimePillar = isShort ? 100 - regimeScore(regime.regime) : regimeScore(regime.regime);

      const smartMoney = computeSmartMoneyScore({
        institutionalAccumulation: 12, // neutral until 13F engine (Phase 2)
        revenueGrowth: 10, // neutral until fundamentals engine (Phase 2)
        earningsGrowth: 8,
        relativeVolume: relVolumePoints(m.relVolume),
        insiderBuying: 5, // neutral until Form 4 engine (Phase 2)
        newsCatalyst: Math.round((momentumProxy / 100) * 10),
        sectorStrength: sectorPillar >= 85 ? 5 : sectorPillar >= 70 ? 4 : 2,
      });

      const v1parts = {
        technical,
        sectorStrength: sectorPillar,
        momentum: momentumProxy,
        marketRegime: regimePillar,
      };
      const scores = {
        catalyst: momentumProxy,
        smartMoney: smartMoney.total,
        technical,
        sectorStrength: sectorPillar,
        marketRegime: regimePillar,
        alphaforge: computeAlphaForgeScoreV1(v1parts),
        confidence: computeConfidenceV1(v1parts),
      };

      const decision = deriveDirectionalDecision(scores.alphaforge, plan, m.price, det.direction);
      if (scores.alphaforge >= 80) setupsQualified++;

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
        `insert into trade_setups (ticker_id, score_id, opportunity_type, setup_type, direction, market_regime,
           entry_zone_low, entry_zone_high, entry_aggressive, entry_conservative,
           stop_loss, stop_basis, target_1, target_2, target_3,
           target_basis_1, target_basis_2, target_basis_3,
           expected_pct_move, expected_hold_days, risk_reward_ratio, risk_rating,
           bull_thesis, bear_thesis, decision, is_active)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,true)`,
        [t.id, scoreRow[0].id, opportunityType(t, m), det.type, det.direction, regime.regime,
         plan.entryZoneLow, plan.entryZoneHigh, plan.entryAggressive, plan.entryConservative,
         plan.stopLoss, plan.stopBasis,
         plan.targets[0].price, plan.targets[1].price, plan.targets[2].price,
         `${plan.targets[0].method}: ${plan.targets[0].evidence}`,
         `${plan.targets[1].method}: ${plan.targets[1].evidence}`,
         `${plan.targets[2].method}: ${plan.targets[2].evidence}`,
         plan.expectedPctMove, plan.expectedHoldDays, plan.riskReward, riskRating(m),
         directionThesis(t, m, det, sectorScore, true),
         directionThesis(t, m, det, sectorScore, false),
         decision]
      );
    }
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

// ── Directional decision ──
// Long: buy inside the zone, wait when extended or below.
// Short: sell short inside the zone, wait for a bounce otherwise.
function deriveDirectionalDecision(
  score: number,
  plan: PlanSpec,
  price: number,
  direction: Direction
): Decision {
  if (score < 60 || plan.riskReward < MIN_RISK_REWARD) return "Avoid";
  if (score < 80) return "Watchlist Only";
  const inZone = price >= plan.entryZoneLow && price <= plan.entryZoneHigh;
  if (direction === "Long") return inZone ? "Buy Now" : "Wait For Pullback";
  return inZone ? "Short Now" : "Wait For Bounce";
}

// ── Scores (directional) ──
function technicalScore(m: SnapshotMetrics, bars: Bar[], det: Detected): number {
  let s = 0;
  const short = det.direction === "Short";
  // Trend alignment in the trade's direction.
  if (short ? !m.above200d : m.above200d) s += 20;
  if (short ? !m.above50d : m.above50d) s += 15;
  if (short ? m.price < m.ema20 : m.price > m.ema20) s += 10;
  s += det.quality; // structural quality 8-20
  if (m.relVolume >= 2) s += 15;
  else if (m.relVolume >= 1.5) s += 10;
  else if (m.relVolume >= 1.2) s += 6;
  // Momentum health for the direction.
  if (!short) {
    if (m.rsi14 >= 50 && m.rsi14 <= 70) s += 10;
    else if (m.rsi14 > 70) s += 4;
  } else {
    if (m.rsi14 >= 30 && m.rsi14 <= 50) s += 10;
    else if (m.rsi14 < 30) s += 4; // already washed out: less edge
  }
  return Math.round(clamp(s, 0, 100));
}

// Volume/momentum proxy for the catalyst pillar. Honest: this is NOT news.
// It measures whether something unusual is happening in price and volume,
// in the direction of the trade.
function momentumCatalystScore(m: SnapshotMetrics, bars: Bar[], direction: Direction): number {
  let s = 30; // baseline "no news engine yet"
  if (m.relVolume >= 3) s += 35;
  else if (m.relVolume >= 2) s += 25;
  else if (m.relVolume >= 1.5) s += 15;
  const last = bars[bars.length - 1];
  const rawMove = (last.c - last.o) / last.o;
  const dayMove = direction === "Short" ? -rawMove : rawMove;
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

// Supporting case (bull thesis column for longs, bear thesis for shorts)
// and the counter-case, both computed from real values only.
function directionThesis(
  t: UniverseTicker,
  m: SnapshotMetrics,
  det: Detected,
  sectorScore: number,
  supporting: boolean
): string {
  const atrPct = round2((m.atr14 / m.price) * 100);
  const short = det.direction === "Short";
  if (supporting) {
    if (!short) {
      return `${det.type} in ${t.sector} (sector score ${sectorScore}). Price $${m.price} above the 50/200-day trend with ${m.relVolume}x relative volume and RSI ${m.rsi14}. Signal is price/volume based; the news catalyst engine (Phase 2) is not yet layered in.`;
    }
    return `${det.type} in ${t.sector} (weak sector, score ${sectorScore}). Price $${m.price} below its 20/50-day trend with ${m.relVolume}x relative volume and RSI ${m.rsi14}. Short thesis only: borrow availability and fees have not been verified. Signal is price/volume based.`;
  }
  if (!short) {
    return `Daily swing of ~${atrPct}% (ATR) cuts both ways; a failed move puts the stop in play quickly. An index reversal would drag ${t.sector} with it. No earnings/news calendar check yet in v1.`;
  }
  return `Short squeezes move fast: ~${atrPct}% daily swings (ATR) against the position hit the cover stop quickly. A sector bounce or index rally would lift ${t.sector} names first. Short interest and borrow data are not yet integrated; squeeze risk is unmeasured. No earnings calendar check yet in v1.`;
}

function avg(a: number[]): number {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}
