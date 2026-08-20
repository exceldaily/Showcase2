// ─────────────────────────────────────────────────────────
// Setup scoring with full transparency (spec §25, §44).
//
// Every point is attributable to a named component with its own max,
// the evidence that produced it, and a plain-English reason. There are
// NO mystery AI numbers here: the score is a sum you can audit line by
// line in the UI, including negative adjustments like extension risk.
// ─────────────────────────────────────────────────────────

import type { Bar } from "./bars";
import type { SnapshotMetrics } from "./polygon";
import { detectExtension, findLevels } from "./indicators";
import { swingAnchoredVwap } from "./vwap";
import { round2, clamp } from "./scoring";

export interface ScoreComponent {
  key: string;
  label: string;
  points: number;
  max: number;
  /** The measured values behind the points. */
  evidence: string;
  /** Why those values earned that score. */
  reason: string;
}

export interface SetupScore {
  total: number;
  grade: "A" | "B" | "C" | "D";
  components: ScoreComponent[];
  /** Negative adjustments shown separately so nothing is hidden. */
  penalties: ScoreComponent[];
  /** The narrative answer to "WHY is this on my screen?" */
  why: string[];
  /** Honest list of what could NOT be measured on the current feed. */
  notMeasured: string[];
}

export interface ScoreInputs {
  metrics: SnapshotMetrics;
  bars: Bar[];
  sectorScore?: number;
  /** Provider capability gating — unmeasurable inputs are excluded, not zeroed. */
  caps: { intraday: boolean; floatData: boolean; news: boolean };
  floatShares?: number | null;
  catalystFound?: boolean | null;
}

/**
 * Weights follow the spec §25 shape (momentum, volume, float, catalyst,
 * VWAP, structure, liquidity) but ONLY components we can actually
 * measure are included in the denominator. A component we cannot
 * measure is reported in `notMeasured` rather than silently scoring 0,
 * which would unfairly punish every stock on an EOD feed.
 */
export function scoreSetup(input: ScoreInputs): SetupScore {
  const { metrics: m, bars, caps } = input;
  const components: ScoreComponent[] = [];
  const penalties: ScoreComponent[] = [];
  const notMeasured: string[] = [];

  // ── Momentum (20) — trend alignment of price vs its own EMAs ──
  {
    const max = 20;
    let p = 0;
    const stacked = m.ema9 > m.ema20 && m.ema20 > m.ema50;
    if (stacked) p += 10;
    else if (m.ema9 > m.ema20) p += 6;
    if (m.price > m.ema9) p += 5;
    if (m.above200d) p += 5;
    components.push({
      key: "momentum",
      label: "Momentum",
      points: Math.min(p, max),
      max,
      evidence: `EMA9 ${m.ema9} / EMA20 ${m.ema20} / EMA50 ${m.ema50}; price ${m.price}; above 200d: ${m.above200d}`,
      reason: stacked
        ? "EMA 9 > 20 > 50 stacked with price leading — textbook trend alignment."
        : m.ema9 > m.ema20
          ? "Short-term EMA above medium, but the 50 is not yet aligned."
          : "EMAs are not aligned bullishly.",
    });
  }

  // ── Volume (20) — participation vs the stock's own norm ──
  {
    const max = 20;
    const rv = m.relVolume;
    const p = rv >= 5 ? 20 : rv >= 3 ? 17 : rv >= 2 ? 13 : rv >= 1.5 ? 9 : rv >= 1.2 ? 5 : 1;
    components.push({
      key: "volume",
      label: "Volume",
      points: p,
      max,
      evidence: `RVOL ${rv}x (${Math.round(m.volume).toLocaleString()} vs ${Math.round(m.avgVolume).toLocaleString()} avg)`,
      reason:
        rv >= 3
          ? "Volume far above this stock's normal pace — real participation, not drift."
          : rv >= 1.5
            ? "Above-average volume supporting the move."
            : "Volume is near or below average; the move lacks conviction.",
    });
  }

  // ── VWAP (10) — position relative to the accumulation average ──
  {
    const max = 10;
    const { value: avwap, rising } = swingAnchoredVwap(bars, 40);
    const dist = avwap > 0 ? ((m.price - avwap) / avwap) * 100 : 0;
    let p = 0;
    if (m.price >= avwap) p += 6;
    if (rising) p += 4;
    components.push({
      key: "vwap",
      label: "VWAP",
      points: p,
      max,
      evidence: `Anchored VWAP $${avwap}, price ${dist >= 0 ? "+" : ""}${round2(dist)}% vs VWAP, slope ${rising ? "rising" : "falling"}`,
      reason:
        m.price >= avwap && rising
          ? "Holding above a rising anchored VWAP — buyers since the base are in profit and defending."
          : m.price >= avwap
            ? "Above VWAP but the average is not rising."
            : "Below the anchored VWAP — the average buyer since the base is underwater.",
    });
  }

  // ── Structure (15) — coil tightness + proximity to a real level ──
  {
    const max = 15;
    const seg = bars.slice(-8);
    const hi = Math.max(...seg.map((b) => b.h));
    const lo = Math.min(...seg.map((b) => b.l));
    const mid = (hi + lo) / 2;
    const coil = mid > 0 ? ((hi - lo) / mid) * 100 : 100;
    const levels = findLevels(bars);
    const res = levels.find((l) => l.kind === "resistance" && l.price > m.price);
    const distToRes = res ? ((res.price - m.price) / m.price) * 100 : null;

    let p = 0;
    if (coil <= 4) p += 9;
    else if (coil <= 6) p += 7;
    else if (coil <= 9) p += 4;
    if (distToRes !== null && distToRes <= 2) p += 6;
    else if (distToRes !== null && distToRes <= 5) p += 3;

    components.push({
      key: "structure",
      label: "Price Structure",
      points: Math.min(p, max),
      max,
      evidence: `8-bar range ${round2(coil)}%${res ? `; nearest resistance $${res.price} (${round2(distToRes!)}% away, tested ${res.touches}x)` : "; no clear overhead level"}`,
      reason:
        coil <= 6 && distToRes !== null && distToRes <= 3
          ? "Tightly coiled directly beneath a tested level — the classic pre-breakout compression."
          : coil <= 9
            ? "Range is compressing but not yet at its tightest."
            : "Range is wide; no compression to trade against.",
    });
  }

  // ── Liquidity (5) — can you actually get in and out ──
  {
    const max = 5;
    const dv = m.price * m.avgVolume;
    const p = dv >= 50e6 ? 5 : dv >= 10e6 ? 4 : dv >= 2e6 ? 3 : dv >= 500e3 ? 1 : 0;
    components.push({
      key: "liquidity",
      label: "Liquidity",
      points: p,
      max,
      evidence: `Avg dollar volume $${(dv / 1e6).toFixed(1)}M/day`,
      reason:
        dv >= 10e6
          ? "Deep enough to enter and exit without moving the market."
          : dv >= 2e6
            ? "Adequate liquidity; expect some slippage on size."
            : "Thin. Slippage and spread risk are material here.",
    });
  }

  // ── Momentum health (10) — RSI in the constructive band ──
  {
    const max = 10;
    const r = m.rsi14;
    const p = r >= 55 && r <= 70 ? 10 : r >= 45 && r < 55 ? 7 : r > 70 && r <= 80 ? 5 : r > 80 ? 2 : 3;
    components.push({
      key: "rsiHealth",
      label: "Momentum Health",
      points: p,
      max,
      evidence: `RSI ${r}`,
      reason:
        r >= 55 && r <= 70
          ? "RSI in the strong-but-not-exhausted band."
          : r > 80
            ? "RSI is overbought; risk of a pause or pullback is elevated."
            : r < 45
              ? "RSI is weak; momentum is not yet on this side."
              : "RSI is neutral.",
    });
  }

  // ── Sector (5) ──
  if (input.sectorScore !== undefined) {
    const max = 5;
    const s = input.sectorScore;
    const p = s >= 85 ? 5 : s >= 70 ? 4 : s >= 55 ? 2 : 0;
    components.push({
      key: "sector",
      label: "Sector Strength",
      points: p,
      max,
      evidence: `Sector score ${s}/100`,
      reason: s >= 70 ? "Trading with a strong sector at its back." : "Sector is not leading.",
    });
  } else {
    notMeasured.push("Sector strength (no sector classification for this symbol)");
  }

  // ── Float (15) — gated on reference data ──
  if (caps.floatData && input.floatShares != null) {
    const max = 15;
    const f = input.floatShares;
    const p = f < 5e6 ? 15 : f < 20e6 ? 12 : f < 50e6 ? 8 : f < 150e6 ? 4 : 1;
    components.push({
      key: "float",
      label: "Float",
      points: p,
      max,
      evidence: `${(f / 1e6).toFixed(1)}M shares`,
      reason:
        f < 20e6
          ? "Low float — supply is thin, which amplifies moves in both directions."
          : "Larger float; moves require proportionally more volume.",
    });
  } else {
    notMeasured.push("Float (requires shares-outstanding / float reference data)");
  }

  // ── Catalyst (15) — gated on news feed ──
  if (caps.news && input.catalystFound !== null && input.catalystFound !== undefined) {
    const max = 15;
    const p = input.catalystFound ? 12 : 3;
    components.push({
      key: "catalyst",
      label: "Catalyst",
      points: p,
      max,
      evidence: input.catalystFound ? "Recent ticker-tagged news found" : "No recent ticker-tagged news",
      reason: input.catalystFound
        ? "A dated news item exists; classification of its materiality is not automated yet."
        : "No identifiable catalyst — the move is technical, not news-driven.",
    });
  } else {
    notMeasured.push("Catalyst quality (news classification not yet automated)");
  }

  // Intraday components we honestly cannot compute on an EOD feed.
  if (!caps.intraday) {
    notMeasured.push("Volume velocity / acceleration (requires intraday minute bars)");
    notMeasured.push("High-of-day proximity (requires intraday minute bars)");
    notMeasured.push("Premarket activity (requires extended-hours data)");
  }

  // ── Penalty: extension (spec §26) ──
  const ext = detectExtension(bars);
  if (ext && ext.state !== "Normal") {
    const cost = ext.state === "Parabolic" ? -12 : ext.state === "Very Extended" ? -8 : -4;
    penalties.push({
      key: "extension",
      label: "Extension Risk",
      points: cost,
      max: 0,
      evidence: `${ext.atrExtension} ATRs above EMA9, ${ext.pct5BarMove}% over 5 bars`,
      reason: ext.note,
    });
  }

  const earned = components.reduce((a, c) => a + c.points, 0);
  const possible = components.reduce((a, c) => a + c.max, 0);
  const penalty = penalties.reduce((a, c) => a + c.points, 0);
  // Normalize to 100 over what we could measure, then apply penalties.
  const total = possible > 0 ? Math.round(clamp((earned / possible) * 100 + penalty, 0, 100)) : 0;

  const grade: SetupScore["grade"] = total >= 85 ? "A" : total >= 70 ? "B" : total >= 55 ? "C" : "D";

  // ── The WHY narrative: top contributors, in plain English ──
  const why = [...components]
    .sort((a, b) => b.points / Math.max(b.max, 1) - a.points / Math.max(a.max, 1))
    .slice(0, 4)
    .map((c) => `${c.label}: ${c.evidence}. ${c.reason}`);
  for (const p of penalties) why.push(`${p.label}: ${p.evidence}. ${p.reason}`);

  return { total, grade, components, penalties, why, notMeasured };
}
