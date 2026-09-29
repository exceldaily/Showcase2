// ─────────────────────────────────────────────────────────
// Bad-print filter (pure, unit-tested).
// Consolidated-tape bars occasionally carry an erroneous print: a daily
// low of 69.00 on a 690 stock, a one-minute wick of several percent that
// no other bar confirms. One of those wrecks the price scale, the ATR and
// every support level built from lows. A wick is only treated as bad when
// it is far outside BOTH a multiple of the typical range of its
// neighbours and a percentage of price; it is then pulled back to the
// bar's own open/close (real prints), never to an invented number, and
// the correction is reported so the UI can say so.
// ─────────────────────────────────────────────────────────

import type { Bar } from "./bars";

export interface BarFix {
  t: number;
  field: "h" | "l";
  from: number;
  to: number;
}

export interface SanityOptions {
  /** A wick must exceed this many typical ranges. */
  rangeMult?: number;
  /** ...and this fraction of price (0.03 = 3%). */
  minPct?: number;
  /** Neighbours on each side used for the typical range. */
  window?: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function sanitizeBars(bars: Bar[], opts: SanityOptions = {}): { bars: Bar[]; fixes: BarFix[] } {
  const rangeMult = opts.rangeMult ?? 10;
  const minPct = opts.minPct ?? 0.03;
  const win = opts.window ?? 10;
  const fixes: BarFix[] = [];
  if (bars.length < 5) return { bars, fixes };
  // Body-to-body span is immune to a bad wick, so the typical range is
  // measured on bodies plus the gap from the previous close.
  const span = bars.map((b, i) => {
    const prev = i > 0 ? bars[i - 1].c : b.o;
    return Math.max(b.o, b.c, prev) - Math.min(b.o, b.c, prev);
  });
  const out = bars.map((b, i) => {
    const top = Math.max(b.o, b.c);
    const bot = Math.min(b.o, b.c);
    if (!(top > 0) || !(bot > 0)) return b;
    const near: number[] = [];
    for (let k = Math.max(0, i - win); k <= Math.min(bars.length - 1, i + win); k++) if (k !== i) near.push(span[k]);
    const typical = Math.max(median(near), bot * 0.0002);
    const limit = Math.max(rangeMult * typical, minPct * bot);
    let next = b;
    if (bot - b.l > limit) {
      fixes.push({ t: b.t, field: "l", from: b.l, to: bot });
      next = { ...next, l: bot };
    }
    if (b.h - top > limit) {
      fixes.push({ t: b.t, field: "h", from: b.h, to: top });
      next = { ...next, h: top };
    }
    return next;
  });
  return { bars: fixes.length ? out : bars, fixes };
}
