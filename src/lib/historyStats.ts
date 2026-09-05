// ─────────────────────────────────────────────────────────
// Per-symbol history stats from Alpaca's multi-year minute data.
//
// 1. Volume profile: how THIS symbol distributes volume through the
//    session (15-minute bins, averaged over N sessions). Replaces the
//    generic curve in time-of-day RVOL, so "1.8x" means 1.8x what this
//    stock normally does by this time of day.
// 2. Breakout backtest: replays the same level engine + setup machine
//    used live over each past session (levels fixed at 10:00 ET, no
//    lookahead), and records how often a CONFIRMED break went on to
//    reach Target 1 before invalidation. Sample sizes are shown
//    because 40 sessions is a small sample, not a law.
// Pure functions first; IO (fetch + cache) at the bottom.
// ─────────────────────────────────────────────────────────

import { getStockBars, hasAlpacaKeys } from "@/providers/alpaca";
import type { Bar } from "./bars";
import { hasDatabase, query } from "./db";
import { buildLevels, etStamp, intradayTrend, resample, sessionOf, sessionVwapSeries, timeAdjustedRvol } from "./intraday";
import { buildTradePlan, runMachine, DEFAULT_BREAKOUT_CONFIG, type SetupDirection } from "./setupMachine";

export const PROFILE_BIN_MIN = 15;
export const PROFILE_BINS = 390 / PROFILE_BIN_MIN; // 26

/** Cumulative fraction of RTH volume by bin end (index 0 = 9:45, 25 = 16:00). */
export type VolumeProfile = number[];

export function volumeProfileFromMinutes(minuteBars: Bar[]): { profile: VolumeProfile; sessions: number } | null {
  const byDay = new Map<string, number[]>();
  for (const b of minuteBars) {
    if (sessionOf(b.t) !== "rth") continue;
    const s = etStamp(b.t);
    const bin = Math.min(PROFILE_BINS - 1, Math.floor((s.minutes - (9 * 60 + 30)) / PROFILE_BIN_MIN));
    const arr = byDay.get(s.date) ?? new Array<number>(PROFILE_BINS).fill(0);
    arr[bin] += b.v;
    byDay.set(s.date, arr);
  }
  // Only complete sessions (volume in the last bin) count.
  const days = Array.from(byDay.values()).filter((arr) => arr[PROFILE_BINS - 1] > 0 && arr.reduce((a, b) => a + b, 0) > 0);
  if (days.length < 5) return null;
  const cum = new Array<number>(PROFILE_BINS).fill(0);
  for (const arr of days) {
    const total = arr.reduce((a, b) => a + b, 0);
    let run = 0;
    arr.forEach((v, i) => {
      run += v;
      cum[i] += run / total;
    });
  }
  return { profile: cum.map((c) => c / days.length), sessions: days.length };
}

/** Expected cumulative fraction at `minutesIntoRth` from a symbol profile (linear inside a bin). */
export function expectedFractionFromProfile(profile: VolumeProfile, minutesIntoRth: number): number {
  const m = Math.max(0, Math.min(390, minutesIntoRth));
  const bin = Math.min(PROFILE_BINS - 1, Math.floor(m / PROFILE_BIN_MIN));
  const prev = bin === 0 ? 0 : profile[bin - 1];
  const within = (m - bin * PROFILE_BIN_MIN) / PROFILE_BIN_MIN;
  return prev + (profile[bin] - prev) * Math.min(1, within);
}

export function rvolFromProfile(todayCumVolume: number, avgDailyVolume: number, profile: VolumeProfile, nowMs: number): number | null {
  if (avgDailyVolume <= 0) return null;
  const s = etStamp(nowMs);
  const open = 9 * 60 + 30;
  if (s.minutes < open) return timeAdjustedRvol(todayCumVolume, avgDailyVolume, nowMs); // premarket: generic approximation
  const expected = avgDailyVolume * Math.max(0.01, expectedFractionFromProfile(profile, s.minutes - open));
  return Math.round((todayCumVolume / expected) * 100) / 100;
}

export interface BreakoutStats {
  sessions: number;
  setups: number;         // sessions with a usable trigger at 10:00
  confirmed: number;      // reached CONFIRMED that session
  t1Hit: number;          // confirmed AND touched T1 before invalidation
  failed: number;         // confirmed then FAILED (closed back past invalidation)
  longs: number;
  shorts: number;
  avgMfeAtr: number | null; // mean best excursion after confirmation, in 5m ATRs
}

/**
 * Replay the morning-setup logic over past sessions. Levels/trend are
 * evaluated with bars up to 10:00 ET only; the machine then steps
 * through the rest of the session bar by bar.
 */
export function backtestBreakouts(minuteBars: Bar[], dailyBars: Bar[], maxSessions = 40): BreakoutStats {
  const dates = Array.from(new Set(minuteBars.filter((b) => sessionOf(b.t) === "rth").map((b) => etStamp(b.t).date))).sort();
  const todayDate = dates[dates.length - 1];
  const usable = dates.filter((d) => d !== todayDate).slice(-maxSessions); // last (possibly partial) day excluded
  const stats: BreakoutStats = { sessions: usable.length, setups: 0, confirmed: 0, t1Hit: 0, failed: 0, longs: 0, shorts: 0, avgMfeAtr: null };
  const mfes: number[] = [];
  const tenAm = 10 * 60;
  // Stamp every bar ONCE (Intl formatting is the hot path) and index
  // session boundaries so each replay slices instead of re-filtering.
  const stamped = minuteBars.map((b) => ({ b, s: etStamp(b.t) }));
  const LOOKBACK_MS = 4 * 86400e3; // the level engine only needs a few sessions of context

  for (const date of usable) {
    const cutIdx = stamped.findIndex((x) => x.s.date === date && x.s.minutes >= tenAm);
    if (cutIdx < 0) continue;
    const cutT = stamped[cutIdx].b.t;
    const upto = stamped.filter((x) => x.b.t < cutT && x.b.t >= cutT - LOOKBACK_MS).map((x) => x.b);
    if (upto.length < 60) continue;
    const anchor = upto[upto.length - 1].t;
    const priorDaily = dailyBars.filter((d) => etStamp(d.t).date < date);
    const levels = buildLevels({ minuteBars: upto, dailyBars: priorDaily, nowMs: anchor });
    const trend = intradayTrend(upto);
    if (!levels || !trend) continue;
    const price = levels.price;
    const direction: SetupDirection = /Bearish/.test(trend.label) ? "short" : "long";
    const opposing = levels.zones
      .filter((z) => z.strength >= 60)
      .filter((z) => (direction === "long" ? z.price > price * 1.0002 : z.price < price * 0.9998))
      .sort((a, b) => (direction === "long" ? a.price - b.price : b.price - a.price));
    const trigger = opposing[0]?.price;
    if (trigger === undefined) continue;
    const atr = levels.atr5m ?? price * 0.004;
    const dtr = priorDaily.slice(-15).map((d, i, arr) => (i === 0 ? d.h - d.l : Math.max(d.h - d.l, Math.abs(d.h - arr[i - 1].c), Math.abs(d.l - arr[i - 1].c))));
    const dailyAtr = dtr.length ? dtr.reduce((a, b) => a + b, 0) / dtr.length : price * 0.02;
    const plan = buildTradePlan(direction, trigger, levels.zones, atr, DEFAULT_BREAKOUT_CONFIG, 60, dailyAtr);
    stats.setups++;
    if (direction === "long") stats.longs++;
    else stats.shorts++;

    const dayStamped = stamped.filter((x) => x.s.date === date && x.s.minutes >= 9 * 60 + 30 && x.s.minutes < 16 * 60);
    const dayMin = dayStamped.map((x) => x.b);
    const vwapArr = sessionVwapSeries(dayMin);
    const idx10 = dayStamped.findIndex((x) => x.s.minutes >= tenAm);
    const vwapAt10 = vwapArr[Math.max(0, idx10 - 1)] ?? null;
    const avgDaily = priorDaily.slice(-20).reduce((a, b) => a + b.v, 0) / Math.max(1, Math.min(20, priorDaily.length));
    const volTo10 = dayStamped.filter((x) => x.s.minutes < tenAm).reduce((a, x) => a + x.b.v, 0);
    const rvol = timeAdjustedRvol(volTo10, avgDaily, anchor);
    const rest5 = resample(dayStamped.filter((x) => x.s.minutes >= tenAm).map((x) => x.b), 5);
    const ms = runMachine(rest5, { direction, trigger, invalidation: plan.invalidation, atr, vwap: vwapAt10, rvol }, DEFAULT_BREAKOUT_CONFIG);
    const confirmedAt = ms.transitions.find((t) => t.to === "CONFIRMED")?.index;
    if (confirmedAt === undefined) continue;
    stats.confirmed++;
    const after = rest5.slice(confirmedAt);
    const t1 = plan.targets[0];
    let hit = false;
    let fail = false;
    let mfe = 0;
    for (const b of after) {
      const fav = direction === "long" ? b.h - trigger : trigger - b.l;
      mfe = Math.max(mfe, fav);
      const inv = direction === "long" ? b.c < plan.invalidation : b.c > plan.invalidation;
      const reached = direction === "long" ? b.h >= t1 : b.l <= t1;
      if (reached) { hit = true; break; }
      if (inv) { fail = true; break; }
    }
    if (hit) stats.t1Hit++;
    if (fail) stats.failed++;
    mfes.push(mfe / Math.max(1e-9, atr));
  }
  stats.avgMfeAtr = mfes.length ? Math.round((mfes.reduce((a, b) => a + b, 0) / mfes.length) * 100) / 100 : null;
  return stats;
}

// ── IO: compute + cache ──

export interface SymbolHistory {
  symbol: string;
  computedAt: string;
  sessions: number;
  volumeProfile: VolumeProfile | null;
  stats: BreakoutStats;
}

export async function getCachedHistory(symbol: string, maxAgeHours = 20): Promise<SymbolHistory | null> {
  if (!hasDatabase()) return null;
  const rows = await query<{ symbol: string; computed_at: string; sessions: number; volume_profile: VolumeProfile | null; stats: BreakoutStats }>(
    `select symbol, computed_at, sessions, volume_profile, stats from symbol_history
     where symbol = $1 and computed_at > now() - ($2 || ' hours')::interval limit 1`,
    [symbol, String(maxAgeHours)]
  );
  const r = rows[0];
  return r ? { symbol: r.symbol, computedAt: r.computed_at, sessions: r.sessions, volumeProfile: r.volume_profile, stats: r.stats } : null;
}

export async function computeAndCacheHistory(symbol: string, sessions = 40): Promise<SymbolHistory | null> {
  if (!hasAlpacaKeys() || !hasDatabase()) return null;
  const calendarDays = Math.ceil(sessions * 1.55) + 5;
  const start = new Date(Date.now() - calendarDays * 86400e3).toISOString();
  const [m1raw, dailyRaw] = await Promise.all([
    getStockBars(symbol, "1Min", start, undefined, 600_000),
    getStockBars(symbol, "1Day", new Date(Date.now() - 260 * 86400e3).toISOString(), undefined, 600_000),
  ]);
  const toBar = (b: { t: string; o: number; h: number; l: number; c: number; v: number; vw?: number }): Bar =>
    ({ t: Date.parse(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, vw: b.vw ?? b.c });
  const m1 = m1raw.map(toBar);
  const daily = dailyRaw.map(toBar);
  if (m1.length < 1000) return null;
  const vp = volumeProfileFromMinutes(m1);
  const stats = backtestBreakouts(m1, daily, sessions);
  const out: SymbolHistory = {
    symbol, computedAt: new Date().toISOString(), sessions: vp?.sessions ?? stats.sessions,
    volumeProfile: vp?.profile ?? null, stats,
  };
  await query(
    `insert into symbol_history (symbol, computed_at, sessions, volume_profile, stats)
     values ($1, now(), $2, $3, $4)
     on conflict (symbol) do update set computed_at = now(), sessions = excluded.sessions,
       volume_profile = excluded.volume_profile, stats = excluded.stats`,
    [symbol, out.sessions, JSON.stringify(out.volumeProfile), JSON.stringify(out.stats)]
  );
  return out;
}
