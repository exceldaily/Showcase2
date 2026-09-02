// ─────────────────────────────────────────────────────────
// Market Pulse: regime + momentum-day score + options grade.
//
// Three DELIBERATELY separate reads (direction is not volatility):
//   1. Regime (6 states incl. Chop) — WHICH WAY the tape leans,
//      requiring several independent confirmations, never one signal.
//   2. Momentum Day Score (0-100) — HOW MUCH is happening, direction
//      agnostic: Strong Bearish + score 91 is a great put environment.
//   3. Options Environment (A+..Avoid) — the combination.
//
// Honesty rules (house style, same as setupScore):
//   - Signals the current data feed cannot measure (premarket, opening
//     range, intraday VWAP) are LISTED as not measured and their score
//     weight is renormalized away — never silently zeroed or guessed.
//   - Every output carries the signals responsible ("why"), because
//     this is decision support from measurable conditions, not a
//     prediction that anything will go up or down.
//
// This module is pure. IO lives in marketPulseLive.ts.
// ─────────────────────────────────────────────────────────

import type { Bar } from "./bars";
import { emaSeries, macdSeries, atrSeries } from "./indicators";

export type PulseRegime =
  | "Strong Bullish"
  | "Bullish"
  | "Neutral"
  | "Chop"
  | "Bearish"
  | "Strong Bearish";

export type SignalDir = "bull" | "bear" | "flat";

export interface PulseSignal {
  name: string;
  dir: SignalDir;
  detail: string;
}

// ── Per-symbol daily-structure trend read ──

export interface TrendRead {
  symbol: string;
  label: PulseRegime;
  bull: number;
  bear: number;
  /** close-vs-EMA10 side changes over the last 10 bars — chop fuel. */
  flips: number;
  compressed: boolean;
  changePct: number | null;
  gapPct: number | null;
  rvol: number | null;
  atrExpansion: number | null;
  macdAccelerating: boolean;
  signals: PulseSignal[];
}

const last = <T>(a: T[] | (T | null)[]): T | null => (a.length ? (a[a.length - 1] as T | null) : null);
const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

function pivots(bars: Bar[], get: (b: Bar) => number, findHigh: boolean): number[] {
  const out: number[] = [];
  for (let i = 2; i < bars.length - 2; i++) {
    const v = get(bars[i]);
    const win = [bars[i - 2], bars[i - 1], bars[i + 1], bars[i + 2]].map(get);
    if (findHigh ? win.every((w) => v >= w) : win.every((w) => v <= w)) out.push(v);
  }
  return out;
}

/**
 * Read one symbol's daily structure: EMA 5/10/20 stack + slopes,
 * anchored VWAP side + slope, MACD direction, higher-highs/lower-lows,
 * RVOL, ATR expansion, and a flip count for chop detection.
 */
export function readTrend(symbol: string, bars: Bar[]): TrendRead | null {
  if (bars.length < 30) return null;
  const closes = bars.map((b) => b.c);
  const signals: PulseSignal[] = [];
  let bull = 0;
  let bear = 0;

  const price = closes[closes.length - 1];
  const prevClose = closes[closes.length - 2];
  const lastBar = bars[bars.length - 1];
  const changePct = prevClose > 0 ? round1(((price - prevClose) / prevClose) * 100) : null;
  const gapPct = prevClose > 0 ? round1(((lastBar.o - prevClose) / prevClose) * 100) : null;

  // EMA 5/10/20 structure + slope (short-horizon day-trading lens; the
  // swing engine keeps its separate 9/20/50 stack).
  const e5s = emaSeries(closes, 5);
  const e10s = emaSeries(closes, 10);
  const e20s = emaSeries(closes, 20);
  const e5 = last<number>(e5s);
  const e10 = last<number>(e10s);
  const e20 = last<number>(e20s);
  const e10back = e10s[e10s.length - 4];
  const atrArr = atrSeries(bars, 14);
  const atr = last<number>(atrArr);
  const atrPct = atr && price > 0 ? (atr / price) * 100 : null;

  let compressed = false;
  if (e5 !== null && e10 !== null && e20 !== null) {
    const spreadPct = price > 0 ? (Math.abs(e5 - e20) / price) * 100 : 0;
    compressed = atrPct !== null && spreadPct < atrPct * 0.35;
    if (compressed) {
      signals.push({ name: "EMA 5/10/20", dir: "flat", detail: "compressed — spread inside noise" });
    } else if (e5 > e10 && e10 > e20) {
      bull++;
      signals.push({ name: "EMA 5/10/20", dir: "bull", detail: "stacked upward (5 > 10 > 20)" });
    } else if (e5 < e10 && e10 < e20) {
      bear++;
      signals.push({ name: "EMA 5/10/20", dir: "bear", detail: "stacked downward (5 < 10 < 20)" });
    } else {
      signals.push({ name: "EMA 5/10/20", dir: "flat", detail: "crossing — no clean stack" });
    }
    if (e10back !== null && e10back > 0) {
      const slope = ((e10 - e10back) / e10back) * 100;
      if (slope > 0.15) {
        bull++;
        signals.push({ name: "EMA slope", dir: "bull", detail: `EMA10 rising ${round1(slope)}%/3d` });
      } else if (slope < -0.15) {
        bear++;
        signals.push({ name: "EMA slope", dir: "bear", detail: `EMA10 falling ${round1(slope)}%/3d` });
      }
    }
  }

  // Rolling 20-day VWAP: a direction-NEUTRAL anchor (the swing-low
  // anchored VWAP used elsewhere is a long-entry convention that would
  // sit on top of price in a downtrend). Noise-gated: a distance
  // inside half an ATR is "hugging VWAP" — chop evidence, not a
  // directional vote. One signal each either way, so "above VWAP"
  // alone can never carry a bullish call.
  const rollingVwap = (upto: number): number => {
    const win = bars.slice(Math.max(0, upto - 20), upto);
    let pv = 0;
    let vv = 0;
    for (const b of win) {
      pv += (b.vw || b.c) * b.v;
      vv += b.v;
    }
    return vv > 0 ? pv / vv : 0;
  };
  const vwap = rollingVwap(bars.length);
  const vwapBack = rollingVwap(bars.length - 3);
  const rising = vwapBack > 0 && vwap > vwapBack;
  const noisePct = atrPct ?? 1.5;
  let huggingVwap = false;
  if (vwap > 0) {
    const distPct = round1(((price - vwap) / vwap) * 100);
    if (Math.abs(distPct) < noisePct * 0.5) {
      huggingVwap = true;
      signals.push({ name: "VWAP", dir: "flat", detail: "hugging VWAP — neither side in control" });
    } else if (price > vwap) {
      bull++;
      signals.push({ name: "VWAP", dir: "bull", detail: `${distPct}% above anchored VWAP` });
      if (rising) bull++;
      signals.push({ name: "VWAP slope", dir: rising ? "bull" : "flat", detail: rising ? "rising" : "flattening" });
    } else {
      bear++;
      signals.push({ name: "VWAP", dir: "bear", detail: `${Math.abs(distPct)}% below anchored VWAP` });
      if (!rising) bear++;
      signals.push({ name: "VWAP slope", dir: !rising ? "bear" : "flat", detail: !rising ? "falling" : "flattening" });
    }
  }

  // MACD direction + histogram acceleration.
  const macd = macdSeries(closes);
  const hi = macd.histogram.length - 1;
  const h0 = macd.histogram[hi];
  const h1 = macd.histogram[hi - 1];
  let macdAccelerating = false;
  if (h0 !== null && h1 !== null) {
    macdAccelerating = Math.abs(h0) > Math.abs(h1);
    // Near-zero histogram is noise, not direction.
    if (Math.abs(h0) < price * 0.002) {
      signals.push({ name: "MACD", dir: "flat", detail: "histogram near zero" });
    } else if (h0 > 0) {
      bull++;
      signals.push({ name: "MACD", dir: "bull", detail: macdAccelerating ? "positive and expanding" : "positive, contracting" });
    } else if (h0 < 0) {
      bear++;
      signals.push({ name: "MACD", dir: "bear", detail: macdAccelerating ? "negative and expanding" : "negative, contracting" });
    }
  }

  // Higher highs / higher lows from 5-bar pivots over the last ~50 bars.
  const win = bars.slice(-50);
  const highs = pivots(win, (b) => b.h, true).slice(-2);
  const lows = pivots(win, (b) => b.l, false).slice(-2);
  if (highs.length === 2 && lows.length === 2) {
    if (highs[1] > highs[0] && lows[1] > lows[0]) {
      bull++;
      signals.push({ name: "Structure", dir: "bull", detail: "higher highs and higher lows" });
    } else if (highs[1] < highs[0] && lows[1] < lows[0]) {
      bear++;
      signals.push({ name: "Structure", dir: "bear", detail: "lower highs and lower lows" });
    } else {
      signals.push({ name: "Structure", dir: "flat", detail: "mixed swing structure" });
    }
  }

  // Chop fuel: how often price has switched sides of EMA10 lately.
  let flips = 0;
  if (e10 !== null) {
    let prevSide = 0;
    for (let i = Math.max(0, bars.length - 11); i < bars.length; i++) {
      const e = e10s[i];
      if (e === null) continue;
      const side = Math.sign(bars[i].c - e);
      if (prevSide !== 0 && side !== 0 && side !== prevSide) flips++;
      if (side !== 0) prevSide = side;
    }
  }
  if (flips >= 4) signals.push({ name: "Whipsaw", dir: "flat", detail: `${flips} EMA10 side-flips in 10 bars` });

  // RVOL + ATR expansion (feed the momentum score; RVOL also counts as
  // a *confirmation* only, never a direction by itself).
  const vols = bars.map((b) => b.v);
  const avgVol = vols.slice(-21, -1).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(20, vols.length - 1));
  const rvol = avgVol > 0 ? Math.round((lastBar.v / avgVol) * 100) / 100 : null;
  if (rvol !== null && rvol >= 1.5) {
    signals.push({ name: "Volume", dir: "flat", detail: `RVOL ${rvol}x — participation elevated` });
  }
  const atrBack = atrArr[atrArr.length - 21] ?? null;
  const atrExpansion = atr !== null && atrBack !== null && atrBack > 0 ? Math.round((atr / atrBack) * 100) / 100 : null;

  // Label from confirmation counts. Strong needs a wide margin AND
  // volume behind it; chop needs actual whipsaw evidence.
  const net = bull - bear;
  let label: PulseRegime;
  if ((flips >= 4 || compressed || huggingVwap) && Math.abs(net) <= 1) label = "Chop";
  else if (net >= 5 && bear <= 1 && (rvol ?? 0) >= 1.2) label = "Strong Bullish";
  else if (net >= 3) label = "Bullish";
  else if (net <= -5 && bull <= 1 && (rvol ?? 0) >= 1.2) label = "Strong Bearish";
  else if (net <= -3) label = "Bearish";
  else label = "Neutral";

  return { symbol, label, bull, bear, flips, compressed, changePct, gapPct, rvol, atrExpansion, macdAccelerating, signals };
}

// ── Market/context regime (multi-signal, confirmation-gated) ──

export interface PulseContext {
  spy: TrendRead | null;
  qqq: TrendRead | null;
  /** The stock being viewed; omit for a market-only read. */
  stock?: TrendRead | null;
  /** Real breadth from the whole-market snapshot. */
  breadth?: { advancersPct: number; upVolumePct: number } | null;
  sector?: { name: string; score: number; change5d: number | null } | null;
  vix?: { level: number; prev: number | null } | null;
}

export interface RegimeResult {
  regime: PulseRegime;
  bull: number;
  bear: number;
  signals: PulseSignal[];
  notMeasured: string[];
}

const dirOf = (label: PulseRegime): SignalDir =>
  label === "Strong Bullish" || label === "Bullish" ? "bull" : label === "Strong Bearish" || label === "Bearish" ? "bear" : "flat";

export function classifyPulseRegime(ctx: PulseContext): RegimeResult {
  const signals: PulseSignal[] = [];
  const notMeasured: string[] = [];
  let bull = 0;
  let bear = 0;
  let chopVotes = 0;

  const addRead = (name: string, read: TrendRead | null | undefined, weight: number) => {
    if (!read) {
      notMeasured.push(`${name} trend (no bar history)`);
      return;
    }
    const dir = dirOf(read.label);
    if (dir === "bull") bull += read.label.startsWith("Strong") ? weight + 1 : weight;
    if (dir === "bear") bear += read.label.startsWith("Strong") ? weight + 1 : weight;
    if (read.label === "Chop") chopVotes++;
    signals.push({ name, dir, detail: `${read.label} (${read.bull} bull / ${read.bear} bear signals)` });
  };

  addRead("SPY", ctx.spy, 2);
  addRead("QQQ", ctx.qqq, 2);
  if (ctx.stock !== undefined) addRead(ctx.stock?.symbol ?? "Stock", ctx.stock, 2);

  if (ctx.breadth) {
    const { advancersPct, upVolumePct } = ctx.breadth;
    if (advancersPct >= 62) {
      bull++;
      signals.push({ name: "Breadth", dir: "bull", detail: `${Math.round(advancersPct)}% of stocks advancing` });
    } else if (advancersPct <= 38) {
      bear++;
      signals.push({ name: "Breadth", dir: "bear", detail: `only ${Math.round(advancersPct)}% advancing` });
    } else {
      chopVotes += advancersPct > 45 && advancersPct < 55 ? 1 : 0;
      signals.push({ name: "Breadth", dir: "flat", detail: `${Math.round(advancersPct)}% advancing — split tape` });
    }
    if (upVolumePct >= 65) {
      bull++;
      signals.push({ name: "Up-volume", dir: "bull", detail: `${Math.round(upVolumePct)}% of volume in gainers` });
    } else if (upVolumePct <= 35) {
      bear++;
      signals.push({ name: "Up-volume", dir: "bear", detail: `${Math.round(100 - upVolumePct)}% of volume in decliners` });
    }
  } else {
    notMeasured.push("Market breadth (snapshot table empty)");
  }

  if (ctx.sector) {
    const rising = ctx.sector.change5d !== null && ctx.sector.change5d > 0;
    if (ctx.sector.score >= 60 && rising) {
      bull++;
      signals.push({ name: "Sector", dir: "bull", detail: `${ctx.sector.name} strong and rising (${Math.round(ctx.sector.score)})` });
    } else if (ctx.sector.score <= 40 && !rising) {
      bear++;
      signals.push({ name: "Sector", dir: "bear", detail: `${ctx.sector.name} weak (${Math.round(ctx.sector.score)})` });
    } else {
      signals.push({ name: "Sector", dir: "flat", detail: `${ctx.sector.name} mixed (${Math.round(ctx.sector.score)})` });
    }
  } else if (ctx.stock !== undefined) {
    notMeasured.push("Sector strength (no sector classification)");
  }

  if (ctx.vix) {
    const rising = ctx.vix.prev !== null && ctx.vix.level > ctx.vix.prev * 1.03;
    const falling = ctx.vix.prev !== null && ctx.vix.level < ctx.vix.prev * 0.97;
    if (ctx.vix.level > 28 || (rising && ctx.vix.level > 22)) {
      bear++;
      signals.push({ name: "VIX", dir: "bear", detail: `${round1(ctx.vix.level)}${rising ? " and rising" : ""} — fear elevated` });
    } else if (ctx.vix.level < 17 && !rising) {
      bull++;
      signals.push({ name: "VIX", dir: "bull", detail: `${round1(ctx.vix.level)}${falling ? " and falling" : ""} — calm` });
    } else {
      signals.push({ name: "VIX", dir: "flat", detail: `${round1(ctx.vix.level)} — unremarkable` });
    }
  } else {
    notMeasured.push("VIX (FRED unavailable)");
  }

  const net = bull - bear;
  const total = bull + bear;

  // Confirmation floor: a strong call needs a broad one-sided majority;
  // a plain directional call still needs three net confirmations. Chop
  // wins when the reads themselves are whipsawing and neither side has
  // a majority worth trading.
  let regime: PulseRegime;
  if (chopVotes >= 2 && Math.abs(net) <= 2) regime = "Chop";
  else if (net >= 6 && bear <= 1) regime = "Strong Bullish";
  else if (net >= 3) regime = "Bullish";
  else if (net <= -6 && bull <= 1) regime = "Strong Bearish";
  else if (net <= -3) regime = "Bearish";
  else if (chopVotes >= 1 && total >= 4 && Math.abs(net) <= 1) regime = "Chop";
  else regime = "Neutral";

  return { regime, bull, bear, signals, notMeasured };
}

// ── Momentum Day Score (direction-agnostic, weight-configurable) ──

export interface MomentumWeights {
  rvol: number;
  gapAndPremarket: number;
  vwapStructure: number;
  emaStructure: number;
  openingRange: number;
  indexAlignment: number;
  macdAcceleration: number;
  atrExpansion: number;
  context: number;
}

/** Editable in one place; momentumDayScore also accepts an override. */
export const DEFAULT_MOMENTUM_WEIGHTS: MomentumWeights = {
  rvol: 20,
  gapAndPremarket: 15,
  vwapStructure: 15,
  emaStructure: 10,
  openingRange: 15,
  indexAlignment: 10,
  macdAcceleration: 5,
  atrExpansion: 5,
  context: 5,
};

export interface MomentumResult {
  score: number;
  band: string;
  why: string[];
  notMeasured: string[];
  /** Component name -> 0-1 raw reading, for the transparent breakdown. */
  components: { name: string; weightPct: number; value01: number; detail: string }[];
}

export function momentumBand(score: number): string {
  if (score <= 20) return "Dead / Avoid";
  if (score <= 40) return "Low Momentum";
  if (score <= 60) return "Normal";
  if (score <= 75) return "Active";
  if (score <= 89) return "High Momentum";
  return "Extreme Momentum";
}

export interface MomentumInputs {
  stock: TrendRead;
  spy: TrendRead | null;
  qqq: TrendRead | null;
  sectorAligned: boolean | null;
  breadth?: { advancersPct: number; upVolumePct: number } | null;
  vixMoving?: boolean | null;
  catalystFound?: boolean | null;
  /** True only when a live intraday feed supplies these. */
  intraday?: { openingRangeBroke: boolean; premarketVolumeRatio: number } | null;
}

export function momentumDayScore(
  inputs: MomentumInputs,
  weights: MomentumWeights = DEFAULT_MOMENTUM_WEIGHTS
): MomentumResult {
  const { stock } = inputs;
  const components: MomentumResult["components"] = [];
  const notMeasured: string[] = [];
  const why: string[] = [];

  const add = (name: keyof MomentumWeights, label: string, value01: number | null, detail: string) => {
    if (value01 === null) {
      notMeasured.push(detail);
      return;
    }
    components.push({ name: label, weightPct: weights[name], value01: clamp01(value01), detail });
    if (value01 >= 0.5) why.push(detail);
  };

  // Relative volume: 1x is nothing, 2x is real, 5x+ is max.
  add(
    "rvol",
    "Relative volume",
    stock.rvol === null ? null : clamp01((stock.rvol - 0.8) / 4.2),
    stock.rvol === null ? "RVOL (no volume baseline)" : `RVOL ${stock.rvol}x`
  );

  // Gap magnitude (direction-agnostic). Premarket volume needs an
  // intraday feed; with one connected the ratio sharpens this reading.
  if (inputs.intraday) {
    const g = Math.abs(stock.gapPct ?? 0);
    const mix = clamp01(g / 8) * 0.6 + clamp01(inputs.intraday.premarketVolumeRatio / 3) * 0.4;
    add("gapAndPremarket", "Gap + premarket", mix, `gap ${stock.gapPct}% with premarket volume`);
  } else {
    add(
      "gapAndPremarket",
      "Gap",
      stock.gapPct === null ? null : clamp01(Math.abs(stock.gapPct) / 8),
      stock.gapPct === null ? "Gap (no prior close)" : `gapped ${Math.abs(stock.gapPct)}%`
    );
  }

  // VWAP structure: persistence on one side of VWAP; whipsaw kills it.
  add(
    "vwapStructure",
    "VWAP structure",
    clamp01(1 - stock.flips / 5),
    stock.flips <= 1 ? "holding one side of VWAP" : `${stock.flips} side-flips — VWAP whipsaw`
  );

  // EMA structure: a clean stack either way scores; compression is 0.
  const stacked = stock.signals.find((s) => s.name === "EMA 5/10/20");
  add(
    "emaStructure",
    "EMA structure",
    stock.compressed ? 0 : stacked && stacked.dir !== "flat" ? 1 : 0.35,
    stock.compressed ? "EMAs compressed" : stacked && stacked.dir !== "flat" ? `EMAs stacked (${stacked.dir})` : "EMAs crossing"
  );

  // Opening range: intraday only. Honesty over guessing.
  if (inputs.intraday) {
    add("openingRange", "Opening range", inputs.intraday.openingRangeBroke ? 1 : 0.2, inputs.intraday.openingRangeBroke ? "opening range broken and held" : "inside opening range");
  } else {
    add("openingRange", "Opening range", null, "Opening range break (needs intraday data)");
  }

  // Index/sector alignment: stock direction matching SPY/QQQ/sector —
  // in EITHER direction. A bearish stock in a bearish tape aligns.
  const sDir = dirOf(stock.label);
  let aligned = 0;
  let checked = 0;
  for (const idx of [inputs.spy, inputs.qqq]) {
    if (!idx) continue;
    checked++;
    if (sDir !== "flat" && dirOf(idx.label) === sDir) aligned++;
  }
  if (inputs.sectorAligned !== null) {
    checked++;
    if (inputs.sectorAligned) aligned++;
  }
  add(
    "indexAlignment",
    "Index/sector alignment",
    checked === 0 ? null : aligned / checked,
    checked === 0 ? "Index alignment (no index data)" : `${aligned}/${checked} of SPY/QQQ/sector aligned with the stock`
  );

  add(
    "macdAcceleration",
    "MACD acceleration",
    stock.macdAccelerating ? 1 : 0.25,
    stock.macdAccelerating ? "MACD histogram expanding" : "MACD flat/contracting"
  );

  add(
    "atrExpansion",
    "Volatility expansion",
    stock.atrExpansion === null ? null : clamp01((stock.atrExpansion - 0.9) / 0.8),
    stock.atrExpansion === null ? "ATR expansion (short history)" : `ATR ${stock.atrExpansion}x vs a month ago`
  );

  // Context: breadth extremity (either direction), VIX in motion, catalyst.
  const ctxParts: number[] = [];
  const ctxNotes: string[] = [];
  if (inputs.breadth) {
    ctxParts.push(clamp01(Math.abs(inputs.breadth.advancersPct - 50) / 30));
    ctxNotes.push(`breadth ${Math.round(inputs.breadth.advancersPct)}% one-sided`);
  }
  if (inputs.vixMoving !== null && inputs.vixMoving !== undefined) {
    ctxParts.push(inputs.vixMoving ? 0.8 : 0.3);
  }
  if (inputs.catalystFound !== null && inputs.catalystFound !== undefined) {
    ctxParts.push(inputs.catalystFound ? 1 : 0.2);
    if (inputs.catalystFound) ctxNotes.push("news catalyst present");
  }
  add(
    "context",
    "Breadth/VIX/catalyst",
    ctxParts.length ? ctxParts.reduce((a, b) => a + b, 0) / ctxParts.length : null,
    ctxNotes.join(", ") || "context conditions"
  );

  // Renormalize over what was measurable — unmeasured weight is
  // excluded, not counted as zero.
  const totalWeight = components.reduce((a, c) => a + c.weightPct, 0);
  const raw = totalWeight > 0 ? components.reduce((a, c) => a + c.value01 * c.weightPct, 0) / totalWeight : 0;
  const score = Math.round(raw * 100);

  return { score, band: momentumBand(score), why, notMeasured, components };
}

// ── Options environment grade ──

export type OptionsGrade = "A+" | "A" | "B" | "C" | "Avoid";

export function optionsEnvironment(regime: PulseRegime, momentumScore: number): { grade: OptionsGrade; reason: string } {
  const strong = regime === "Strong Bullish" || regime === "Strong Bearish";
  const directional = strong || regime === "Bullish" || regime === "Bearish";

  if (regime === "Chop") return { grade: "Avoid", reason: "Choppy tape — whipsaw eats short-dated premium in both directions." };
  if (momentumScore <= 25) return { grade: "Avoid", reason: "Not enough movement — theta decay outruns the move." };
  if (!directional) {
    return momentumScore >= 61
      ? { grade: "C", reason: "Volatility without directional agreement — scalps only, no conviction holds." }
      : { grade: "C", reason: "No directional edge and modest momentum." };
  }
  if (strong && momentumScore >= 76) {
    return { grade: "A+", reason: `${regime} with ${momentumScore}/100 momentum — direction and energy agree.` };
  }
  if (momentumScore >= 61) {
    return { grade: "A", reason: `${regime} with active momentum (${momentumScore}/100).` };
  }
  if (momentumScore >= 41) {
    return { grade: "B", reason: `${regime} but only normal momentum — direction without much fuel.` };
  }
  return { grade: "C", reason: `${regime} direction but weak momentum (${momentumScore}/100) — bad for short-dated options.` };
}
