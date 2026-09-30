// ─────────────────────────────────────────────────────────
// History replay (pure). Steps through one past session for one symbol
// five minutes at a time, showing each step only the bars that existed
// then, and runs BOTH models on it:
//
//   old  the original rules: direction from the instant trend read,
//        entry when the state machine says CONFIRMED
//   new  the quality engine: bias with memory, strict breakout states,
//        chop / chase / market / quality gates
//
// Every level either model locked becomes a record with what happened
// to it, so results can be compared and sliced without guessing.
// ─────────────────────────────────────────────────────────

import type { Bar } from "../bars";
import { buildLevels, etStamp, intradayTrend, resample, sameTimeRvol, sessionOf, sessionVwapSeries, type LevelZone } from "../intraday";
import { buildMatrix } from "../timeframeMatrix";
import { buildTradePlan, roomToMove, runMachine, DEFAULT_BREAKOUT_CONFIG, type SetupDirection, type TradePlan } from "../setupMachine";
import { lockDecision } from "../setupLock";
import { assembleRead, releaseReason, slotBaselineBefore, structuresOf, type SignalFeatures } from "./assemble";
import { stableBias, type BiasSample, type MarketLeg } from "./engine";

export type Model = "old" | "new";
export type RecordStatus = "ENTRY" | "NO ENTRY" | "FAILED BREAKOUT" | "NEVER TRIGGERED";
export type OutcomeResult = "WIN" | "LOSS" | "BREAKEVEN";

export interface Outcome {
  result: OutcomeResult;
  /** Result in units of the risk taken (entry to the wrong line). */
  r: number;
  /** Worst and best excursion before the exit, in R. */
  maeR: number;
  mfeR: number;
  exit: "target" | "stop" | "close";
  /** Closed back through the level within 30 minutes of the entry. */
  falseBreak: boolean;
  /** Reward to target 1 over risk at the entry price. */
  rr: number;
}

export interface ReplayRecord {
  symbol: string;
  day: string;
  model: Model;
  direction: SetupDirection;
  trigger: number;
  invalidation: number;
  target1: number | null;
  status: RecordStatus;
  /** For NO ENTRY: what held it back. */
  blockedBy: string | null;
  firedAt: number | null;
  price: number | null;
  features: SignalFeatures | null;
  /** Real for ENTRY. For NO ENTRY it is what entering at the confirmation would have done. */
  outcome: Outcome | null;
}

/** Entry at `price` at time `t`: stop on a touch of the wrong line, exit at the first target still ahead, else the close. */
export function resolveOutcome(s: { direction: SetupDirection; price: number; trigger: number; invalidation: number; targets: number[]; t: number }, m1day: Bar[]): Outcome | null {
  const long = s.direction === "long";
  const risk = long ? s.price - s.invalidation : s.invalidation - s.price;
  if (!(risk > 0)) return null;
  const target = s.targets.find((t) => (long ? t > s.price * 1.0005 : t < s.price * 0.9995));
  if (target === undefined) return null;
  const rr = Math.abs(target - s.price) / risk;
  const after = m1day.filter((b) => b.t >= s.t && sessionOf(b.t) === "rth");
  if (after.length === 0) return null;
  let mae = 0, mfe = 0, exit: Outcome["exit"] = "close", r = 0;
  const thirty = s.t + 30 * 60_000;
  let falseBreak = false;
  let done = false;
  for (const b of after) {
    if (!done) {
      const worst = long ? (s.price - b.l) / risk : (b.h - s.price) / risk;
      const best = long ? (b.h - s.price) / risk : (s.price - b.l) / risk;
      if (long ? b.l <= s.invalidation : b.h >= s.invalidation) { mae = Math.max(mae, 1); exit = "stop"; r = -1; done = true; }
      else if (long ? b.h >= target : b.l <= target) { mfe = Math.max(mfe, rr); mae = Math.max(mae, worst); exit = "target"; r = rr; done = true; }
      else { mae = Math.max(mae, worst); mfe = Math.max(mfe, best); }
    }
    // A 5-minute boundary close back through the level soon after the entry.
    if (b.t < thirty && etStamp(b.t).minutes % 5 === 4 && (long ? b.c < s.trigger : b.c > s.trigger)) falseBreak = true;
    if (done && b.t >= thirty) break;
  }
  if (!done) { const last = after[after.length - 1]; r = (long ? last.c - s.price : s.price - last.c) / risk; }
  const round = (n: number) => Math.round(n * 100) / 100;
  const result: OutcomeResult = exit === "target" ? "WIN" : exit === "stop" ? "LOSS" : r >= 0.25 ? "WIN" : r <= -0.25 ? "LOSS" : "BREAKEVEN";
  return { result, r: round(r), maeR: round(Math.max(0, mae)), mfeR: round(Math.max(0, mfe)), exit, falseBreak, rr: round(rr) };
}

/** Market legs at a moment of a past session, built from that symbol's own minute bars. */
export function marketLegAt(symbol: string, m1day: Bar[], prevClose: number | null, tMs: number): MarketLeg {
  const upTo = m1day.filter((b) => b.t < tMs);
  if (upTo.length === 0) return { symbol, aboveVwap: null, changePct: null };
  const price = upTo[upTo.length - 1].c;
  const vw = sessionVwapSeries(upTo);
  const v = vw[vw.length - 1];
  return { symbol, aboveVwap: v === null ? null : price >= v, changePct: prevClose ? ((price - prevClose) / prevClose) * 100 : null };
}

export interface ReplayInput {
  symbol: string;
  day: string;
  /** Minute bars, oldest first, covering at least five days before `day` and the day itself. */
  m1: Bar[];
  daily: Bar[];
  /** Regular-hours 5-minute bars of past sessions (relative volume and the per-slot volume baseline). */
  hist5: Bar[];
  /** Market context at a moment (ms). */
  marketAt: (tMs: number) => MarketLeg[];
  models?: Model[];
  stepMinutes?: number;
}

interface NewLock { dir: SetupDirection; trigger: number; inv: number; plan: TradePlan; pickedAt: number; strength: number; rec: ReplayRecord; sawBreak: boolean; failed: boolean; blocked: { by: string; t: number; price: number; features: SignalFeatures } | null; entered: boolean }
interface OldLock { dir: SetupDirection; trigger: number; inv: number; plan: TradePlan; pickedAt: number; strength: number; last: string | null; rec: ReplayRecord; sawBreak: boolean; entered: boolean; failed: boolean; alive: boolean }

const lowerBound = (arr: Bar[], t: number) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m].t < t) lo = m + 1; else hi = m; } return lo; };
const pickZone = (zones: LevelZone[], price: number, dir: SetupDirection): LevelZone | null =>
  zones.filter((z) => z.strength >= 60).filter((z) => (dir === "long" ? z.price > price * 1.0002 : z.price < price * 0.9998)).sort((a, b) => (dir === "long" ? a.price - b.price : b.price - a.price))[0] ?? null;

export function replayDay(i: ReplayInput): ReplayRecord[] {
  const models = i.models ?? ["old", "new"];
  const step = i.stepMinutes ?? 5;
  const dayIdx = i.m1.findIndex((b) => etStamp(b.t).date === i.day);
  if (dayIdx < 0) return [];
  const m1day = i.m1.filter((b) => etStamp(b.t).date === i.day);
  const rth = m1day.filter((b) => sessionOf(b.t) === "rth");
  if (rth.length < 200) return [];
  const prevDaily = i.daily.filter((d) => etStamp(d.t).date < i.day);
  const dtr = prevDaily.slice(-15).map((d, k, arr) => (k === 0 ? d.h - d.l : Math.max(d.h - d.l, Math.abs(d.h - arr[k - 1].c), Math.abs(d.l - arr[k - 1].c))));
  const dailyAtr = dtr.reduce((a, b) => a + b, 0) / Math.max(1, dtr.length);
  const baseline = slotBaselineBefore(i.hist5, i.day);
  const open = rth[0].t;
  const dayStartT = i.m1[dayIdx].t;
  const all5 = resample(i.m1.slice(lowerBound(i.m1, open - 6 * 86400e3)), 5);
  const records: ReplayRecord[] = [];
  const samples: BiasSample[] = [];
  let oldLock: OldLock | null = null;
  let newLock: NewLock | null = null;
  const blank = (model: Model, dir: SetupDirection, plan: TradePlan): ReplayRecord => ({ symbol: i.symbol, day: i.day, model, direction: dir, trigger: plan.trigger, invalidation: plan.invalidation, target1: plan.targets[0] ?? null, status: "NEVER TRIGGERED", blockedBy: null, firedAt: null, price: null, features: null, outcome: null });
  // The old machine reads the whole day, so a level that was crossed and lost BEFORE it was picked comes back
  // FAILED on its first evaluation and is dropped at once. Those never-alive picks are not setups and are not recorded.
  const closeOld = (l: OldLock) => { if (!l.alive) return; if (!l.entered) l.rec.status = l.sawBreak ? "FAILED BREAKOUT" : "NEVER TRIGGERED"; records.push(l.rec); };
  const closeNew = (l: NewLock) => {
    if (!l.entered) {
      if (l.blocked) {
        l.rec.status = "NO ENTRY"; l.rec.blockedBy = l.blocked.by; l.rec.firedAt = l.blocked.t; l.rec.price = l.blocked.price; l.rec.features = l.blocked.features;
        l.rec.outcome = resolveOutcome({ direction: l.dir, price: l.blocked.price, trigger: l.trigger, invalidation: l.inv, targets: l.plan.targets, t: l.blocked.t }, m1day);
      } else l.rec.status = l.sawBreak ? "FAILED BREAKOUT" : "NEVER TRIGGERED";
    }
    records.push(l.rec);
  };

  for (let min = 9 * 60 + 35; min <= 15 * 60 + 55; min += step) {
    const t = open + (min - 570) * 60_000;
    const end = lowerBound(i.m1, t);
    const w = i.m1.slice(lowerBound(i.m1, t - 5 * 86400e3), end);
    if (w.length < 60) continue;
    const levels = buildLevels({ minuteBars: w, dailyBars: prevDaily, nowMs: t - 1 });
    if (!levels) continue;
    const todayW = w.filter((b) => b.t >= dayStartT);
    const rv = sameTimeRvol(todayW, i.hist5, i.day, 570, min, 5)?.rvol ?? null;
    const trend = intradayTrend(w, { rvol: rv });
    const price = w[w.length - 1].c;
    const trendDir: SetupDirection = trend && /Bearish/.test(trend.label) ? "short" : "long";
    const atr = levels.atr5m ?? price * 0.004;
    const bars5 = all5.slice(Math.max(0, lowerBound(all5, t) - 400), lowerBound(all5, t));
    samples.push({ label: trend?.label ?? null, structure: structuresOf(bars5).s5 });
    const bias = stableBias(samples.slice(-24));
    const assemble = (dir: SetupDirection, plan: TradePlan | null, lockedAt: number | null, strength: number | null) => {
      const room = plan ? roomToMove(price, dir, levels.zones.filter((z) => Math.abs(z.price - plan.trigger) > atr * 0.2), atr) : null;
      const rows = buildMatrix({ m1: w, daily: prevDaily, nowMs: t - 1 });
      return assembleRead({ day: i.day, nowMs: t, session: "rth", marketOpen: true, direction: dir, plan, lockedAtMs: lockedAt, price, atr, vwap: levels.vwap, rvol: rv, bars5, slotBaseline: baseline, marketLegs: i.marketAt(t), rows, room, levelStrength: strength, biasSamples: samples.slice(-24) });
    };

    // ── old model ──
    if (models.includes("old") && min >= 9 * 60 + 45) {
      const todays5 = resample(todayW.filter((b) => sessionOf(b.t) !== "closed"), 5);
      const run = (l: { dir: SetupDirection; trigger: number; inv: number }) => runMachine(todays5, { direction: l.dir, trigger: l.trigger, invalidation: l.inv, atr, vwap: levels.vwap, rvol: rv }, DEFAULT_BREAKOUT_CONFIG);
      let ms = oldLock ? run(oldLock) : null;
      if (oldLock && ms && !lockDecision({ direction: oldLock.dir }, ms.state, trendDir).keep) { if (ms.state === "FAILED" || ms.state === "INVALIDATED") oldLock.failed = true; closeOld(oldLock); oldLock = null; ms = null; }
      if (!oldLock) {
        const z = pickZone(levels.zones, price, trendDir);
        if (z) {
          const plan = buildTradePlan(trendDir, z.price, levels.zones, atr, DEFAULT_BREAKOUT_CONFIG, 60, dailyAtr);
          oldLock = { dir: trendDir, trigger: z.price, inv: plan.invalidation, plan, pickedAt: t, strength: z.strength, last: null, rec: blank("old", trendDir, plan), sawBreak: false, entered: false, failed: false, alive: false };
          ms = run(oldLock);
        }
      }
      if (oldLock && ms) {
        if (ms.state !== "FAILED" && ms.state !== "INVALIDATED") oldLock.alive = true;
        if (["TRIGGERED", "CONFIRMING", "CONFIRMED", "RETESTING", "CONTINUATION", "FAILED"].includes(ms.state)) oldLock.sawBreak = true;
        if (ms.state === "CONFIRMED" && oldLock.last !== "RETESTING" && oldLock.last !== "CONTINUATION" && !oldLock.entered) {
          oldLock.entered = true;
          const a = assemble(oldLock.dir, oldLock.plan, oldLock.pickedAt, oldLock.strength);
          oldLock.rec.status = "ENTRY"; oldLock.rec.firedAt = t; oldLock.rec.price = price; oldLock.rec.features = a.features;
          oldLock.rec.outcome = resolveOutcome({ direction: oldLock.dir, price, trigger: oldLock.trigger, invalidation: oldLock.inv, targets: oldLock.plan.targets, t }, m1day);
        }
        oldLock.last = ms.state;
      }
    }

    // ── new model ──
    if (models.includes("new") && min >= 9 * 60 + 45) {
      const dir: SetupDirection = bias.bias === "BEARISH" ? "short" : bias.bias === "BULLISH" ? "long" : trendDir;
      let a = newLock ? assemble(newLock.dir, newLock.plan, newLock.pickedAt, newLock.strength) : null;
      if (newLock && a) {
        const st = a.read.breakout?.state ?? "WATCHING";
        if (st === "FAILED BREAKOUT") { newLock.sawBreak = true; newLock.failed = true; }
        if (releaseReason(a.read, newLock.dir, t) !== null) { closeNew(newLock); newLock = null; a = null; }
      }
      if (!newLock) {
        const z = pickZone(levels.zones, price, dir);
        if (z) {
          const plan = buildTradePlan(dir, z.price, levels.zones, atr, DEFAULT_BREAKOUT_CONFIG, 60, dailyAtr);
          newLock = { dir, trigger: z.price, inv: plan.invalidation, plan, pickedAt: t, strength: z.strength, rec: blank("new", dir, plan), sawBreak: false, failed: false, blocked: null, entered: false };
          a = assemble(dir, plan, t, z.strength);
        }
      }
      if (newLock && a) {
        const st = a.read.breakout?.state ?? "WATCHING";
        if (st === "BREAK ATTEMPT" || st === "BREAKOUT CONFIRMED") newLock.sawBreak = true;
        if (!newLock.entered && (a.read.call === "CALL" || a.read.call === "PUT")) {
          newLock.entered = true;
          newLock.rec.status = "ENTRY"; newLock.rec.firedAt = t; newLock.rec.price = price; newLock.rec.features = a.features;
          newLock.rec.outcome = resolveOutcome({ direction: newLock.dir, price, trigger: newLock.trigger, invalidation: newLock.inv, targets: newLock.plan.targets, t }, m1day);
        } else if (!newLock.entered && !newLock.blocked && st === "BREAKOUT CONFIRMED") {
          newLock.blocked = { by: `${a.read.call}: ${a.read.reason}`, t, price, features: a.features };
        }
      }
    }
  }
  if (oldLock) closeOld(oldLock);
  if (newLock) closeNew(newLock);
  return records;
}
