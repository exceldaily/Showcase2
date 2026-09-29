// ─────────────────────────────────────────────────────────
// Indicator warm-up history (pure, unit-tested).
// An EMA only equals the one on a broker's chart once it has several
// times its period of history behind it. The chart window is short (a
// day of 1-minute bars, 280 daily bars), so an EMA200 computed from the
// window alone is either missing or visibly off. The server therefore
// sends, per timeframe, the closes that came BEFORE the window; the
// chart computes over [history, window] and draws only the window.
// ─────────────────────────────────────────────────────────

import type { Bar } from "./bars";
import { resample } from "./intraday";
import { resampleWeekly } from "./multiTimeframe";

export type WarmTf = "1m" | "2m" | "5m" | "15m" | "30m" | "1h" | "D" | "W";
export type WarmCloses = Partial<Record<WarmTf, number[]>>;

export const WARM_MAX = 600;

/**
 * Long history followed by the fresh bars. The first fresh bar can be a
 * partial bucket (the minute window starts at an arbitrary minute), so the
 * long series is trusted up to the second fresh bar.
 */
export function stitch(long: Bar[], fresh: Bar[]): Bar[] {
  if (long.length === 0 || fresh.length === 0) return long.length ? long : fresh;
  const cut = fresh.length > 1 ? fresh[1].t : fresh[0].t;
  const head = long.filter((b) => b.t < cut);
  if (head.length === 0) return fresh;
  // A long series that stops days before the fresh bars would leave a hole
  // in the middle of an EMA; better no history than a broken one.
  if (cut - head[head.length - 1].t > 5 * 86400e3) return fresh;
  return [...head, ...fresh.filter((b) => b.t >= cut)];
}

const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** Closes of `history` bars that precede the first shown bar. */
export function closesBefore(history: Bar[], shown: Bar[], max = WARM_MAX): number[] {
  if (shown.length === 0) return [];
  const t0 = shown[0].t;
  const out: number[] = [];
  for (const b of history) {
    if (b.t >= t0) break;
    out.push(r4(b.c));
  }
  return out.length > max ? out.slice(-max) : out;
}

export interface WarmInput {
  /** Everything fetched at 1 minute (about five days). */
  m1All: Bar[];
  /** The bars the client receives. */
  shown: { m1: Bar[]; m5: Bar[]; daily: Bar[] };
  /** Long history: 5-minute and 30-minute bars stitched to the fresh minutes, and every daily bar. */
  m5Full: Bar[];
  m30Full: Bar[];
  dailyAll: Bar[];
  max?: number;
}

/** Warm-up closes for each chart timeframe, mirroring how the client builds its bars. */
export function buildWarm(i: WarmInput): WarmCloses {
  const max = i.max ?? WARM_MAX;
  return {
    "1m": closesBefore(i.m1All, i.shown.m1, max),
    "2m": closesBefore(resample(i.m1All, 2), resample(i.shown.m1, 2), max),
    "5m": closesBefore(i.m5Full, i.shown.m5, max),
    "15m": closesBefore(resample(i.m5Full, 15), resample(i.shown.m5, 15), max),
    "30m": closesBefore(i.m30Full, resample(i.shown.m5, 30), max),
    "1h": closesBefore(resample(i.m30Full, 60), resample(i.shown.m5, 60), max),
    D: closesBefore(i.dailyAll, i.shown.daily, max),
    W: closesBefore(resampleWeekly(i.dailyAll), resampleWeekly(i.shown.daily), max),
  };
}

/** Warm-up for a shorter slice of an already-sent window: the sent history plus the bars the slice dropped. */
export function warmForSlice(sentWarm: number[] | undefined, fullShown: Bar[], sliceShown: Bar[], max = WARM_MAX): number[] {
  const extra = closesBefore(fullShown, sliceShown, max);
  const all = [...(sentWarm ?? []), ...extra];
  return all.length > max ? all.slice(-max) : all;
}
