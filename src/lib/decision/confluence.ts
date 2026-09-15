// ─────────────────────────────────────────────────────────
// Confluence score (pure, unit-tested). The one confidence number is
// never shown alone: it is the sum of eight documented components,
// each with its own max and a one-line reason.
//
//   Trend            20   5-minute trend read, aligned with the plan
//   Momentum         15   MACD histogram sign and slope on the 5-minute
//   Volume           15   relative volume for this time of day
//   VWAP             10   price on the plan's side of session VWAP
//   Structure        10   level strength, room to run, break quality
//   Multi-timeframe  10   how much of the stack leans the same way
//   Catalyst         10   a recent headline for the name
//   Options quality  10   the best contract's score and spread
//
// A component that cannot be measured (no catalyst feed for the name,
// no relative volume yet) is listed as NOT MEASURED and excluded from
// the denominator, so the percentage never quietly assumes a zero.
// Confidence never replaces confirmation: it is an input to the
// verdict, not a trigger.
// ─────────────────────────────────────────────────────────

import type { Alignment, MatrixRow } from "../timeframeMatrix";
import type { SetupDirection, RoomResult } from "../setupMachine";

export interface ConfluencePart {
  key: "trend" | "momentum" | "volume" | "vwap" | "structure" | "mtf" | "catalyst" | "options";
  name: string;
  score: number;
  max: number;
  measured: boolean;
  detail: string;
  /** Longer explanation of the rule for the expandable row. */
  rule: string;
}

export interface Confluence {
  /** Sum of the measured parts. */
  total: number;
  /** Sum of the measured maxima. */
  max: number;
  /** total / max as a percentage, the number the panel shows. */
  pct: number;
  parts: ConfluencePart[];
  notMeasured: string[];
}

export interface ConfluenceInput {
  direction: SetupDirection;
  trendLabel: string | null;
  trendConfidence: number | null;
  choppy: boolean;
  rows: MatrixRow[];
  align: Alignment | null;
  rvol: number | null;
  price: number | null;
  vwap: number | null;
  triggerStrength: number | null;
  room: RoomResult | null;
  machineQuality: number;
  machineState: string | null;
  catalyst: { ageHours: number; tier: number } | null;
  /** Null when no catalyst feed covers this name. */
  catalystMeasured: boolean;
  contract: { score: number; spreadPct: number | null; volume: number; openInterest: number } | null;
  maxSpreadPct: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function confluence(i: ConfluenceInput): Confluence {
  const parts: ConfluencePart[] = [];
  const add = (p: Omit<ConfluencePart, "score"> & { score: number }) => parts.push({ ...p, score: Math.round(clamp(p.score, 0, p.max)) });
  const up = i.direction === "long";

  // Trend 20: aligned label scaled by confidence; choppy caps at 4.
  {
    const aligned = i.trendLabel ? (up ? /Bull/i.test(i.trendLabel) : /Bear/i.test(i.trendLabel)) : false;
    const against = i.trendLabel ? (up ? /Bear/i.test(i.trendLabel) : /Bull/i.test(i.trendLabel)) : false;
    const conf = i.trendConfidence ?? 0;
    const score = i.choppy ? Math.min(4, conf / 25) : aligned ? (conf / 100) * 20 : against ? 0 : 5;
    add({ key: "trend", name: "Trend", max: 20, measured: i.trendLabel !== null, score, detail: i.choppy ? "choppy 5m read" : i.trendLabel ? `${i.trendLabel}, confidence ${conf}` : "no read", rule: "Full credit when the 5-minute trend leans the plan's way at 100 confidence, scaled down with confidence. Neutral earns 5, against earns 0, choppy caps at 4." });
  }
  // Momentum 15: 5m MACD state.
  {
    const r5 = i.rows.find((r) => r.tf === "5m");
    const mom = r5?.momentum ?? "N/A";
    const withUs = up ? mom === "BULL" : mom === "BEAR";
    const improving = up ? mom === "IMPROVING" : mom === "FADING";
    const score = mom === "N/A" ? 0 : withUs ? 15 : improving ? 9 : mom === "FLAT" ? 5 : 2;
    add({ key: "momentum", name: "Momentum", max: 15, measured: mom !== "N/A", score, detail: mom === "N/A" ? "not enough 5m bars" : `5m MACD ${mom.toLowerCase()}`, rule: "5-minute MACD histogram on the plan's side and expanding earns 15; turning toward the plan earns 9; flat 5; against 2." });
  }
  // Volume 15: RVOL bands.
  {
    const v = i.rvol;
    const score = v === null ? 0 : v >= 2 ? 15 : v >= 1.5 ? 12 : v >= 1.2 ? 9 : v >= 0.9 ? 6 : v >= 0.7 ? 3 : 1;
    add({ key: "volume", name: "Volume", max: 15, measured: v !== null, score, detail: v === null ? "relative volume unknown" : `RVOL ${v.toFixed(2)}x`, rule: "Relative volume for this time of day: 2x or more earns 15, 1.5x 12, 1.2x 9, 0.9x 6, 0.7x 3, lighter 1." });
  }
  // VWAP 10.
  {
    const measured = i.price !== null && i.vwap !== null && i.vwap > 0;
    const d = measured ? ((i.price! - i.vwap!) / i.vwap!) * 100 : 0;
    const side = !measured ? "N/A" : Math.abs(d) < 0.05 ? "AT" : d > 0 ? "ABOVE" : "BELOW";
    const withUs = up ? side === "ABOVE" : side === "BELOW";
    const score = !measured ? 0 : side === "AT" ? 5 : withUs ? (Math.abs(d) >= 0.2 ? 10 : 7) : 2;
    add({ key: "vwap", name: "VWAP", max: 10, measured, score, detail: measured ? `${side.toLowerCase()} VWAP by ${Math.abs(d).toFixed(2)}%` : "no session VWAP", rule: "Price on the plan's side of session VWAP by 0.2% or more earns 10, closer 7, sitting on it 5, wrong side 2." });
  }
  // Structure 10: trigger strength, room, and break quality once triggered.
  {
    const strength = i.triggerStrength;
    const measured = strength !== null || i.room !== null;
    const roomPts = i.room ? ({ OPEN: 4, GOOD: 4, OK: 3, TIGHT: 1, POOR: 0 } as Record<string, number>)[i.room.grade] ?? 0 : 0;
    const levelPts = strength !== null ? (strength / 100) * 4 : 0;
    const post = i.machineState && ["TRIGGERED", "CONFIRMING", "CONFIRMED", "RETESTING", "CONTINUATION"].includes(i.machineState);
    const qualityPts = post ? (i.machineQuality / 100) * 2 : 1;
    add({ key: "structure", name: "Structure", max: 10, measured, score: roomPts + levelPts + qualityPts, detail: measured ? `level ${strength ?? "—"}/100, room ${i.room?.grade ?? "—"}${post ? `, break quality ${i.machineQuality}` : ""}` : "no plan", rule: "Up to 4 for the trigger level's strength, 4 for room to the next opposing level (OPEN/GOOD 4, OK 3, TIGHT 1, POOR 0), and 2 for break quality once triggered." });
  }
  // Multi-timeframe 10.
  {
    const a = i.align;
    const measured = a !== null && a.lean !== "N/A";
    const score = measured ? (a!.conflict ? Math.min(a!.score, 5) : a!.score) : 0;
    add({ key: "mtf", name: "Multi-timeframe", max: 10, measured, score, detail: measured ? `${a!.agree.length ? a!.agree.join(" ") + " agree" : "none agree"}${a!.against.length ? `, ${a!.against.join(" ")} against` : ""}${a!.conflict ? ", conflict" : ""}` : "matrix unavailable", rule: "Share of the 1m to daily stack leaning the plan's way, daily weighted double. A daily lean against the plan, or an even intraday split, caps this at 5." });
  }
  // Catalyst 10.
  {
    const c = i.catalyst;
    const measured = i.catalystMeasured;
    const score = !measured || !c ? 0 : c.ageHours <= 24 ? (c.tier <= 1 ? 10 : 7) : c.ageHours <= 72 ? 4 : 1;
    add({ key: "catalyst", name: "Catalyst", max: 10, measured, score, detail: !measured ? "no catalyst feed for this name" : c ? `headline ${Math.round(c.ageHours)}h ago (tier ${c.tier})` : "no recent headline", rule: "A tier-1 headline within 24 hours earns 10, other publishers 7, within 3 days 4, older 1. Names outside the catalyst sweep are not measured." });
  }
  // Options quality 10.
  {
    const c = i.contract;
    const wide = c && c.spreadPct !== null && c.spreadPct > i.maxSpreadPct;
    const thin = c && (c.openInterest < 100 || c.volume < 50);
    let score = c ? (c.score / 100) * 10 : 0;
    if (wide) score = Math.min(score, 4);
    if (thin) score = Math.min(score, 6);
    add({ key: "options", name: "Options quality", max: 10, measured: true, score, detail: c ? `best contract ${c.score}/100${wide ? ", spread wide" : ""}${thin ? ", thin" : ""}` : "no scored contract", rule: "The best contract's score over 10. A spread beyond the profile's limit caps this at 4; under 100 open interest or 50 volume caps it at 6." });
  }

  const measuredParts = parts.filter((p) => p.measured);
  const total = measuredParts.reduce((a, p) => a + p.score, 0);
  const max = measuredParts.reduce((a, p) => a + p.max, 0);
  return { total, max, pct: max > 0 ? Math.round((total / max) * 100) : 0, parts, notMeasured: parts.filter((p) => !p.measured).map((p) => p.name) };
}
