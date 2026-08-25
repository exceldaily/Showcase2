// ─────────────────────────────────────────────────────────
// Opening Range Breakout (ORB) backtest — 15-minute bars.
//
// Strategy under test (user-supplied description):
//   1. Opening range = high/low of the first 15-minute candle (9:30-9:45 ET).
//   2. "Liquidity candle" confirmed with ATR(14) on 15-min bars.
//   3. Limit order placed at the edge of the range.
//   4. Fixed 2:1 reward-to-risk. Everything inside the first 90 minutes
//      (entries allowed 9:45-11:00 ET).
//
// The video's exact rules aren't published, so two faithful readings
// are tested side by side:
//   A. BREAKOUT-RETEST: a candle CLOSES beyond the range edge with
//      true range >= 1.0x ATR(14) (a real expansion candle, not drift).
//      Limit order at the broken edge catches the retest. Stop at the
//      confirmation candle's opposite extreme, target = 2x risk.
//   B. SWEEP-REVERSAL: a candle WICKS beyond the edge but closes back
//      inside with TR >= 1.0x ATR(14) (liquidity grab). Limit order at
//      the swept edge fades the retest. Stop at the sweep extreme,
//      target = 2x risk.
//
// Honesty rules: fills only if a later bar trades through the limit;
// when stop and target are both inside one bar the STOP is assumed to
// hit first; unresolved trades exit at the session close. One trade
// per symbol per day.
// Usage: node scripts/backtest-orb.mjs [fromDate] [toDate]
// ─────────────────────────────────────────────────────────

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = resolve(root, ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
const KEY = process.env.POLYGON_API_KEY;
if (!KEY) {
  console.error("Need POLYGON_API_KEY");
  process.exit(1);
}

const FROM = process.argv[2] ?? "2026-02-01";
const TO = process.argv[3] ?? "2026-08-22";
const ATR_MULT = 1.0;
const RR = 2.0;

// Liquid mix: index ETFs, large-cap movers, and the $2-$20 momentum
// names the site's scanners target.
const SYMBOLS = ["SPY","QQQ","TSLA","NVDA","AMD","PLTR","META","AAPL","AMZN","COIN",
  "HOOD","INTC","BAC","MARA","RIOT","SOFI","RIVN","AAL","F","NIO",
  "LCID","NOK","WULF","CIFR","ONDS"];

const etFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", hour12: false,
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
});
function etParts(ms) {
  const p = Object.fromEntries(etFmt.formatToParts(ms).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}` };
}

async function fetchBars(sym) {
  const url = `https://api.polygon.io/v2/aggs/ticker/${sym}/range/15/minute/${FROM}/${TO}?adjusted=true&sort=asc&limit=50000&apiKey=${KEY}`;
  let r = await fetch(url);
  if (r.status === 429) {
    await new Promise((x) => setTimeout(x, 61_000));
    r = await fetch(url);
  }
  if (!r.ok) throw new Error(`${sym}: HTTP ${r.status}`);
  return (await r.json()).results ?? [];
}

// Wilder-style ATR (simple average of true range) over the continuous
// regular-session bar sequence.
function atrAt(bars, i, period = 14) {
  if (i < period) return null;
  let sum = 0;
  for (let k = i - period + 1; k <= i; k++) {
    const tr = Math.max(
      bars[k].h - bars[k].l,
      Math.abs(bars[k].h - bars[k - 1].c),
      Math.abs(bars[k].l - bars[k - 1].c)
    );
    sum += tr;
  }
  return sum / period;
}

function simulate(session, entryIdx, side, entry, stop, target) {
  for (let i = entryIdx; i < session.length; i++) {
    const b = session[i];
    if (side === "long") {
      if (b.l <= stop) return { r: -1, exit: "stop" };
      if (b.h >= target) return { r: RR, exit: "target" };
    } else {
      if (b.h >= stop) return { r: -1, exit: "stop" };
      if (b.l <= target) return { r: RR, exit: "target" };
    }
  }
  const last = session[session.length - 1].c;
  const risk = Math.abs(entry - stop);
  const r = side === "long" ? (last - entry) / risk : (entry - last) / risk;
  return { r, exit: "eod" };
}

function runVariant(sessions, allBars, variant) {
  const trades = [];
  for (const { bars, offset } of sessions) {
    if (bars.length < 8) continue;
    const or = bars[0]; // the 9:30 candle
    const orHigh = or.h, orLow = or.l;
    if (orHigh <= orLow) continue;

    // Confirmation candles starting 9:45 through 10:45.
    for (let i = 1; i <= Math.min(5, bars.length - 2); i++) {
      const b = bars[i];
      const atr = atrAt(allBars, offset + i);
      if (!atr) break;
      const tr = Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c));
      if (tr < ATR_MULT * atr) continue;

      let side = null, entry = null, stop = null;
      if (variant === "A") {
        if (b.c > orHigh) { side = "long"; entry = orHigh; stop = b.l; }
        else if (b.c < orLow) { side = "short"; entry = orLow; stop = b.h; }
      } else {
        if (b.h > orHigh && b.c < orHigh) { side = "short"; entry = orHigh; stop = b.h; }
        else if (b.l < orLow && b.c > orLow) { side = "long"; entry = orLow; stop = b.l; }
      }
      if (!side) continue;
      const risk = Math.abs(entry - stop);
      if (risk < entry * 0.0005) continue;

      // Wait for the limit fill on later bars, still inside the 90 min.
      let fillIdx = -1;
      for (let j = i + 1; j <= Math.min(6, bars.length - 1); j++) {
        const fb = bars[j];
        const touches = side === "long" ? fb.l <= entry : fb.h >= entry;
        if (touches) { fillIdx = j; break; }
      }
      if (fillIdx === -1) break; // no retest, no trade today

      const target = side === "long" ? entry + RR * risk : entry - RR * risk;
      const res = simulate(bars, fillIdx, side, entry, stop, target);
      trades.push({ side, ...res });
      break; // one trade per symbol per day
    }
  }
  return trades;
}

function stats(trades) {
  if (!trades.length) return { n: 0 };
  const n = trades.length;
  const wins = trades.filter((t) => t.r > 0).length;
  const sumR = trades.reduce((s, t) => s + t.r, 0);
  const gross = trades.filter((t) => t.r > 0).reduce((s, t) => s + t.r, 0);
  const loss = -trades.filter((t) => t.r < 0).reduce((s, t) => s + t.r, 0);
  return { n, winPct: (100 * wins) / n, avgR: sumR / n, totalR: sumR, pf: loss ? gross / loss : Infinity };
}

const out = { A: [], B: [] };
for (const sym of SYMBOLS) {
  try {
    const raw = await fetchBars(sym);
    // Regular session bars only (start times 09:30-15:45 ET).
    const rth = [];
    for (const b of raw) {
      const { date, hm } = etParts(b.t);
      if (hm >= "09:30" && hm <= "15:45") rth.push({ ...b, date, hm });
    }
    const sessions = [];
    let cur = null;
    rth.forEach((b, idx) => {
      if (!cur || cur.date !== b.date) {
        cur = { date: b.date, bars: [], offset: idx };
        sessions.push(cur);
      }
      cur.bars.push(b);
    });
    const usable = sessions.filter((s) => s.bars[0]?.hm === "09:30");
    const a = runVariant(usable, rth, "A");
    const bb = runVariant(usable, rth, "B");
    out.A.push(...a);
    out.B.push(...bb);
    const sa = stats(a), sb = stats(bb);
    console.log(
      `${sym.padEnd(6)} A: n=${String(sa.n ?? 0).padStart(3)} avgR=${sa.n ? sa.avgR.toFixed(2) : "  - "}  ` +
      `B: n=${String(sb.n ?? 0).padStart(3)} avgR=${sb.n ? sb.avgR.toFixed(2) : "  - "}  (${usable.length} sessions)`
    );
  } catch (e) {
    console.log(`${sym} FAILED: ${e.message}`);
  }
  await new Promise((x) => setTimeout(x, 13_000));
}

for (const v of ["A", "B"]) {
  const s = stats(out[v]);
  const name = v === "A" ? "A breakout-retest" : "B sweep-reversal ";
  if (!s.n) {
    console.log(`\n${name}: no trades`);
    continue;
  }
  console.log(`\n${name}: trades=${s.n} win%=${s.winPct.toFixed(1)} avgR=${s.avgR.toFixed(3)} totalR=${s.totalR.toFixed(1)} PF=${s.pf.toFixed(2)}`);
  for (const side of ["long", "short"]) {
    const ss = stats(out[v].filter((t) => t.side === side));
    if (ss.n) console.log(`  ${side.padEnd(5)}: trades=${ss.n} win%=${ss.winPct.toFixed(1)} avgR=${ss.avgR.toFixed(3)} PF=${ss.pf.toFixed(2)}`);
  }
}
console.log(`\nBreakeven win rate at fixed 2:1 R/R = 33.3%. Fees/slippage NOT modelled.`);
