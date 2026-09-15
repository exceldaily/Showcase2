// ─────────────────────────────────────────────────────────
// Market-state engine (pure, unit-tested). One classifier for the
// broad market (SPX/SPY) and for single tickers:
//
//   STRONG BULL / BULLISH / NEUTRAL / CHOP / BEARISH / STRONG BEAR
//
// Never one indicator: every input becomes a piece of evidence with a
// direction and a weight; the state is the weighted net, with CHOP when
// the evidence disagrees or the timeframe rows are choppy. The evidence
// FOR and AGAINST the state is always returned with it.
// ─────────────────────────────────────────────────────────

import type { MatrixRow } from "./timeframeMatrix";

export type MarketStateLabel = "STRONG BULL" | "BULLISH" | "NEUTRAL" | "CHOP" | "BEARISH" | "STRONG BEAR";

export interface Evidence {
  text: string;
  dir: "bull" | "bear" | "flat";
  weight: number;
  /** Where the fact came from, for the tooltip (e.g. "5m", "EOD breadth"). */
  source: string;
}

export interface MarketState {
  state: MarketStateLabel;
  /** Net weighted score, positive is bullish. */
  net: number;
  evidenceFor: Evidence[];
  evidenceAgainst: Evidence[];
  neutral: Evidence[];
  notMeasured: string[];
}

export function classify(evidence: Evidence[], notMeasured: string[] = [], chopSignals = 0): MarketState {
  const bull = evidence.filter((e) => e.dir === "bull").reduce((a, e) => a + e.weight, 0);
  const bear = evidence.filter((e) => e.dir === "bear").reduce((a, e) => a + e.weight, 0);
  const total = bull + bear;
  const net = Math.round((bull - bear) * 10) / 10;
  let state: MarketStateLabel;
  if (total === 0) state = "NEUTRAL";
  else if (chopSignals >= 2 && Math.abs(net) < total * 0.5) state = "CHOP";
  else if (net >= total * 0.75 && total >= 5) state = "STRONG BULL";
  else if (net >= total * 0.3) state = "BULLISH";
  else if (net <= -total * 0.75 && total >= 5) state = "STRONG BEAR";
  else if (net <= -total * 0.3) state = "BEARISH";
  else state = Math.abs(net) < total * 0.15 && bull > 0 && bear > 0 && chopSignals >= 1 ? "CHOP" : "NEUTRAL";
  const bullish = state === "STRONG BULL" || state === "BULLISH";
  const bearish = state === "STRONG BEAR" || state === "BEARISH";
  const forDir = bullish ? "bull" : bearish ? "bear" : null;
  return {
    state, net,
    evidenceFor: forDir ? evidence.filter((e) => e.dir === forDir) : [],
    evidenceAgainst: forDir ? evidence.filter((e) => e.dir !== forDir && e.dir !== "flat") : evidence.filter((e) => e.dir !== "flat"),
    neutral: evidence.filter((e) => e.dir === "flat"),
    notMeasured,
  };
}

export interface TickerEvidenceInput {
  rows: MatrixRow[];
  price: number | null;
  vwap: number | null;
  rvol: number | null;
  trendLabel: string | null;
  choppy: boolean;
  changePct: number | null;
  /** Prev-day high/low for position context. */
  prevHigh: number | null;
  prevLow: number | null;
}

const pctFrom = (a: number, b: number) => ((a - b) / b) * 100;

/** Evidence for a single ticker from its matrix rows and session facts. */
export function tickerEvidence(i: TickerEvidenceInput): { evidence: Evidence[]; notMeasured: string[]; chopSignals: number } {
  const ev: Evidence[] = [];
  const nm: string[] = [];
  let chop = i.choppy ? 1 : 0;
  const row = (tf: MatrixRow["tf"]) => i.rows.find((r) => r.tf === tf);
  if (i.price !== null && i.vwap !== null) {
    const d = pctFrom(i.price, i.vwap);
    ev.push({ text: `${Math.abs(d) < 0.05 ? "At" : d > 0 ? "Above" : "Below"} VWAP (${d >= 0 ? "+" : ""}${d.toFixed(2)}%)`, dir: Math.abs(d) < 0.05 ? "flat" : d > 0 ? "bull" : "bear", weight: 2, source: "session" });
  } else nm.push("VWAP");
  for (const tf of ["5m", "15m", "1h"] as const) {
    const r = row(tf);
    if (!r || r.trend === "N/A") { nm.push(`${tf} trend`); continue; }
    if (r.trend === "CHOP") chop++;
    ev.push({ text: `${tf} ${r.structure === "N/A" ? r.trend.toLowerCase() : r.structure === "HH/HL" ? "higher highs and lows" : r.structure === "LH/LL" ? "lower highs and lows" : r.structure.toLowerCase()}, EMAs ${r.ema.toLowerCase()}`, dir: r.trend === "BULL" ? "bull" : r.trend === "BEAR" ? "bear" : "flat", weight: tf === "5m" ? 2 : 1.5, source: tf });
    if (r.macd !== "N/A" && r.macd !== "FLAT") ev.push({ text: `${tf} MACD ${r.macd === "POS" ? "positive" : "negative"}`, dir: r.macd === "POS" ? "bull" : "bear", weight: 1, source: tf });
  }
  const d = row("D");
  if (d && d.trend !== "N/A") ev.push({ text: `Daily ${d.trend === "CHOP" ? "choppy" : d.trend.toLowerCase()} (${d.structure.toLowerCase()})`, dir: d.trend === "BULL" ? "bull" : d.trend === "BEAR" ? "bear" : "flat", weight: 2, source: "D" });
  else nm.push("daily trend");
  if (i.price !== null && i.prevHigh !== null && i.prevLow !== null) {
    if (i.price > i.prevHigh) ev.push({ text: "Above yesterday's high", dir: "bull", weight: 1.5, source: "levels" });
    else if (i.price < i.prevLow) ev.push({ text: "Below yesterday's low", dir: "bear", weight: 1.5, source: "levels" });
    else ev.push({ text: "Inside yesterday's range", dir: "flat", weight: 0.5, source: "levels" });
  }
  if (i.rvol !== null) ev.push({ text: `Relative volume ${i.rvol.toFixed(2)}x`, dir: "flat", weight: 0, source: "volume" });
  else nm.push("relative volume");
  return { evidence: ev, notMeasured: nm, chopSignals: chop };
}

export interface MarketEvidenceInput {
  spy: TickerEvidenceInput;
  qqqChangePct: number | null;
  spyChangePct: number | null;
  /** CBOE delayed VIX print and its previous close. */
  vix: { level: number; prevClose: number } | null;
  vix1d: { level: number; prevClose: number } | null;
  /** End-of-day breadth from the whole-market table (advancers percent). */
  breadth: { advancersPct: number; upVolumePct: number; asOf: string } | null;
}

/** Evidence for the broad market: SPY tape plus QQQ, VIX and breadth. */
export function marketEvidence(i: MarketEvidenceInput): { evidence: Evidence[]; notMeasured: string[]; chopSignals: number } {
  const base = tickerEvidence(i.spy);
  const ev = base.evidence.map((e) => ({ ...e, source: e.source === "session" || e.source === "levels" ? `SPY ${e.source}` : `SPY ${e.source}` }));
  const nm = [...base.notMeasured];
  if (i.qqqChangePct !== null && i.spyChangePct !== null) {
    const agree = Math.sign(i.qqqChangePct) === Math.sign(i.spyChangePct) && Math.abs(i.qqqChangePct) > 0.1;
    ev.push({ text: `QQQ ${i.qqqChangePct >= 0 ? "+" : ""}${i.qqqChangePct.toFixed(2)}% ${agree ? "confirms" : "diverges from"} SPY`, dir: agree ? (i.qqqChangePct > 0 ? "bull" : "bear") : "flat", weight: 1, source: "QQQ" });
  } else nm.push("QQQ");
  if (i.vix) {
    const chg = pctFrom(i.vix.level, i.vix.prevClose);
    ev.push({ text: `VIX ${i.vix.level.toFixed(2)} (${chg >= 0 ? "+" : ""}${chg.toFixed(1)}% on the day${i.vix.level > 25 ? ", elevated" : ""})`, dir: Math.abs(chg) < 2 ? "flat" : chg > 0 ? "bear" : "bull", weight: 1.5, source: "CBOE delayed" });
  } else nm.push("VIX");
  if (i.vix1d) {
    const chg = pctFrom(i.vix1d.level, i.vix1d.prevClose);
    ev.push({ text: `VIX1D ${i.vix1d.level.toFixed(2)} (${chg >= 0 ? "+" : ""}${chg.toFixed(1)}%)`, dir: Math.abs(chg) < 3 ? "flat" : chg > 0 ? "bear" : "bull", weight: 1, source: "CBOE delayed" });
  } else nm.push("VIX1D");
  if (i.breadth) {
    const a = i.breadth.advancersPct;
    ev.push({ text: `Breadth ${a.toFixed(0)}% advancers, ${i.breadth.upVolumePct.toFixed(0)}% up volume (end of day ${i.breadth.asOf})`, dir: a >= 60 ? "bull" : a <= 40 ? "bear" : "flat", weight: 1, source: "EOD breadth" });
  } else nm.push("breadth");
  nm.push("NYSE TICK", "advance/decline intraday", "options positioning");
  return { evidence: ev, notMeasured: nm, chopSignals: base.chopSignals };
}
