// ─────────────────────────────────────────────────────────
// Morning watch: the one or two names worth watching into the open.
// Pass 1 (pure, cheap): rank the whole universe from a single batched
// snapshot call on premarket gap, premarket volume vs a normal day, and
// how close price sits to yesterday's high/low. Pass 2: run the full
// options pipeline on a short list to add the trend, the trigger plan,
// the history check and the best contract. Plain-English reasons,
// honest about what premarket data can and cannot say.
// ─────────────────────────────────────────────────────────

import { getClock, getStockSnapshots, hasAlpacaKeys, type StockSnapshot } from "@/providers/alpaca";
import { hasDatabase, query, queryOne } from "@/lib/db";
import { etStamp, sessionOf } from "./intraday";
import { MEGACAPS, SP100 } from "./optionsScan";
import { buildOptionsAnalysis, type OptionsAnalysis } from "./optionsTerminal";
import { sendAlertEmail } from "./alertsEmail";
import { morningWatchEmail } from "./emailTemplates";
import type { Outcome, StrikeChoice } from "./strikeCoach";

export type Bias = "calls" | "puts" | "either";

export interface WatchCandidate {
  symbol: string;
  price: number;
  prevClose: number;
  prevHigh: number;
  prevLow: number;
  prevVolume: number;
  /** Volume traded so far today (premarket before the open; whole session after). */
  todayVolume: number;
  gapPct: number;
  /** todayVolume / prevVolume. 0.05 = 5% of a full normal day already traded. */
  volRatio: number;
  /** % price is below yesterday's high (negative = already above it). */
  toPrevHighPct: number;
  /** % price is above yesterday's low (negative = already below it). */
  toPrevLowPct: number;
  bias: Bias;
  score: number;
  parts: { name: string; score: number; max: number }[];
}

export interface WatchPick {
  rank: number;
  symbol: string;
  price: number;
  gapPct: number;
  volRatio: number;
  todayVolume: number;
  bias: Bias;
  score: number;
  preScore: number;
  opportunity: number | null;
  trend: string | null;
  dailyTrend: string | null;
  state: string | null;
  trigger: number | null;
  invalidation: number | null;
  target: number | null;
  history: { confirmed: number; t1Hit: number } | null;
  bestCall: { symbol: string; strike: number; expiry: string; mid: number; score: number } | null;
  bestPut: { symbol: string; strike: number; expiry: string; mid: number; score: number } | null;
  why: string[];
  /** The beginner's 3-step play on the leaning side, with what one contract could do. */
  play: WatchPlay;
  /** Recommended vs cheaper vs safer strike on the leaning side. */
  choices: StrikeChoice[];
  verdict: string | null;
}

export interface WatchPlay {
  side: "call" | "put";
  /** Level a 5-minute candle must close through first (null = no clean trigger drawn yet). */
  watch: number | null;
  buySymbol: string | null;
  buyLabel: string | null;     // "NVDA 235C"
  expiry: string | null;
  dte: number | null;
  perContract: number | null;
  sellAt: number | null;       // first target
  getOutAt: number | null;     // wrong line
  atTarget: Outcome | null;
  atWrong: Outcome | null;
  flatHour: Outcome | null;
}

export function buildPlay(a: OptionsAnalysis | null, bias: Bias): { play: WatchPlay; choices: StrikeChoice[]; verdict: string | null } {
  const side: "call" | "put" = bias === "puts" ? "put" : "call";
  const empty: WatchPlay = { side, watch: null, buySymbol: null, buyLabel: null, expiry: null, dte: null, perContract: null, sellAt: null, getOutAt: null, atTarget: null, atWrong: null, flatHour: null };
  if (!a) return { play: empty, choices: [], verdict: null };
  const v = a.sides[side];
  const rec = v.choices.find((c) => c.label === "Recommended") ?? null;
  const planMatches = a.plan && ((side === "call" && a.direction === "long") || (side === "put" && a.direction === "short"));
  const sellAt = v.ladder.find((r) => r.kind !== "wrong")?.price ?? (planMatches ? a.plan!.targets[0] : null);
  const getOutAt = v.ladder.find((r) => r.kind === "wrong")?.price ?? (planMatches ? a.plan!.invalidation : null);
  return {
    play: {
      side,
      watch: planMatches ? a.plan!.trigger : null,
      buySymbol: v.best?.symbol ?? null,
      buyLabel: v.best ? `${a.symbol} ${v.best.strike}${side === "call" ? "C" : "P"}` : null,
      expiry: v.best?.expiry ?? null,
      dte: v.best ? Math.floor(v.best.dte) : null,
      perContract: v.best ? Math.round(v.best.mid * 100) : null,
      sellAt, getOutAt,
      atTarget: rec?.atTarget ?? null, atWrong: rec?.atWrong ?? null, flatHour: rec?.flatHour ?? null,
    },
    choices: v.choices,
    verdict: v.verdict,
  };
}

export interface MorningWatch {
  day: string;
  computedAt: string;
  locked: boolean;
  lockedAt: string | null;
  /** premarket | rth | afterhours | closed at compute time */
  session: string;
  sessionToday: boolean;
  picks: WatchPick[];
  ranked: WatchCandidate[];
  notes: string[];
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/**
 * Pure pass-1 ranking over batched snapshots. Overnight (session "closed"
 * or after hours) the last official close is used as the price: stray
 * after-hours prints are thin and often odd lots, and any real move will
 * show up again once premarket opens at 4:00 ET.
 */
export function rankPremarket(snaps: Record<string, StockSnapshot>, nowMs: number, session: string = sessionOf(nowMs)): WatchCandidate[] {
  const today = etStamp(nowMs).date;
  const livePrices = session === "premarket" || session === "rth";
  const out: WatchCandidate[] = [];
  for (const [symbol, s] of Object.entries(snaps)) {
    const d = s.dailyBar;
    const p = s.prevDailyBar;
    if (!d) continue;
    const dailyIsToday = etStamp(Date.parse(d.t)).date === today;
    const prev = dailyIsToday ? p : d;
    if (!prev || !prev.c || !prev.v) continue;
    const price = livePrices ? (s.latestTrade?.p ?? s.minuteBar?.c ?? prev.c) : (dailyIsToday ? d.c : prev.c);
    if (!(price >= 5) || prev.v < 500_000) continue;
    const todayVolume = dailyIsToday ? d.v : 0;
    const gapPct = ((price - prev.c) / prev.c) * 100;
    const volRatio = todayVolume / prev.v;
    const toPrevHighPct = ((prev.h - price) / price) * 100;
    const toPrevLowPct = ((price - prev.l) / price) * 100;

    const parts: WatchCandidate["parts"] = [];
    const gapScore = clamp01(Math.abs(gapPct) / 3) * 40;
    parts.push({ name: "gap", score: Math.round(gapScore), max: 40 });
    const volScore = clamp01(volRatio / 0.1) * 30;
    parts.push({ name: "premarket volume", score: Math.round(volScore), max: 30 });
    // Sitting at yesterday's high/low only matters with some participation
    // behind it; a flat, quiet name parked near a level is not a setup yet.
    const active = Math.abs(gapPct) >= 0.3 || volRatio >= 0.02;
    let levelScore = 0;
    if (gapPct > 0 && toPrevHighPct <= 0.75 && toPrevHighPct >= -1.5) levelScore = active ? 20 : 10;
    else if (gapPct < 0 && toPrevLowPct <= 0.75 && toPrevLowPct >= -1.5) levelScore = active ? 20 : 10;
    else if (Math.min(Math.abs(toPrevHighPct), Math.abs(toPrevLowPct)) < 2) levelScore = active ? 10 : 5;
    parts.push({ name: "near yesterday's high/low", score: levelScore, max: 20 });
    const liq = prev.v >= 5_000_000 ? 10 : prev.v >= 1_000_000 ? 5 : 0;
    parts.push({ name: "liquidity", score: liq, max: 10 });
    const score = Math.round(gapScore + volScore + levelScore + liq);
    const bias: Bias = gapPct > 0.3 ? "calls" : gapPct < -0.3 ? "puts" : "either";
    out.push({
      symbol, price, prevClose: prev.c, prevHigh: prev.h, prevLow: prev.l, prevVolume: prev.v, todayVolume,
      gapPct: Math.round(gapPct * 100) / 100, volRatio: Math.round(volRatio * 1000) / 1000,
      toPrevHighPct: Math.round(toPrevHighPct * 100) / 100, toPrevLowPct: Math.round(toPrevLowPct * 100) / 100,
      bias, score, parts,
    });
  }
  return out.sort((a, b) => b.score - a.score || Math.abs(b.gapPct) - Math.abs(a.gapPct) || b.prevVolume - a.prevVolume);
}

const $ = (n: number) => `$${n.toFixed(2)}`;
function fmtVol(v: number): string {
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${Math.round(v / 1e3)}K`;
  return String(Math.round(v));
}

/** Plain-English reasons. `session` decides whether "so far" means premarket or the live session. */
export function whyLines(c: WatchCandidate, session: string, a: OptionsAnalysis | null): string[] {
  const out: string[] = [];
  const up = c.gapPct >= 0;
  const pre = session === "premarket";
  const ctx = pre ? "premarket" : session === "rth" ? "so far today" : "since the last close";
  if (Math.abs(c.gapPct) >= 0.3) out.push(`${up ? "Up" : "Down"} ${Math.abs(c.gapPct).toFixed(2)}% ${ctx} (last close ${$(c.prevClose)}).`);
  else if (pre || session === "rth") out.push(`Flat ${ctx} (${c.gapPct >= 0 ? "+" : ""}${c.gapPct.toFixed(2)}%), so the move has not started yet.`);
  else out.push(`Last close ${$(c.prevClose)}. Premarket opens at 4:00 ET; overnight prints are ignored until then.`);

  if (c.todayVolume > 0) {
    const pctDay = Math.round(c.volRatio * 100);
    out.push(
      c.volRatio >= 0.05
        ? `Heavy interest: ${fmtVol(c.todayVolume)} shares already, ${pctDay}% of a full normal day${pre ? " before the open" : ""}.`
        : c.volRatio >= 0.015
          ? `${fmtVol(c.todayVolume)} shares so far (${pctDay}% of a normal day), decent for ${pre ? "premarket" : "this point"}.`
          : `Volume is light so far (${fmtVol(c.todayVolume)} shares), so treat the gap with caution.`
    );
  } else if (pre) {
    out.push("No premarket prints yet; ranking is on the last session's close and levels.");
  }

  if (up) {
    if (c.toPrevHighPct < 0) out.push(`Already above yesterday's high ${$(c.prevHigh)}. The question is whether it holds above it after the open.`);
    else if (c.toPrevHighPct <= 1.5) out.push(`Sitting ${c.toPrevHighPct.toFixed(2)}% under yesterday's high ${$(c.prevHigh)}. A push through that is the breakout to watch.`);
    else out.push(`Yesterday's high ${$(c.prevHigh)} is ${c.toPrevHighPct.toFixed(1)}% away, so there is room before the first big level.`);
  } else {
    if (c.toPrevLowPct < 0) out.push(`Already below yesterday's low ${$(c.prevLow)}. Watch whether it stays under it after the open.`);
    else if (c.toPrevLowPct <= 1.5) out.push(`Sitting ${c.toPrevLowPct.toFixed(2)}% above yesterday's low ${$(c.prevLow)}. A break under that is the breakdown to watch.`);
    else out.push(`Yesterday's low ${$(c.prevLow)} is ${c.toPrevLowPct.toFixed(1)}% away, so there is room before the first big level.`);
  }

  if (a) {
    const daily = a.setups.find((s) => s.tf === "D");
    if (daily?.trend) out.push(`Daily chart reads ${String(daily.trend).toLowerCase()}${a.trend ? `; the 5-minute chart reads ${a.trend.label.toLowerCase()}` : ""}.`);
    if (a.plan) {
      const long = a.direction === "long";
      const conflict = (c.bias === "calls" && !long) || (c.bias === "puts" && long);
      out.push(
        `${conflict ? "Current level plan (from the last session, leaning the other way from the gap)" : "Plan"}: ${long ? "calls" : "puts"} only on a 5-minute close ${long ? "above" : "below"} ${$(a.plan.trigger)}. Wrong if it closes back ${long ? "below" : "above"} ${$(a.plan.invalidation)}. First target ${$(a.plan.targets[0])}.${conflict ? " Fresh levels get drawn in the first 15 minutes; do not chase the gap against them." : ""}`
      );
    } else {
      out.push("No clean level in the trend direction inside today's structure yet, so wait for the first 15 minutes to draw one.");
    }
    if (a.history && a.history.stats.confirmed >= 5) {
      out.push(`History check: ${a.history.stats.t1Hit} of ${a.history.stats.confirmed} confirmed breaks reached the first target over the last ${a.history.sessions} sessions.`);
    }
  }
  return out;
}

function pickContract(c: OptionsAnalysis["sides"]["call"]["best"]): WatchPick["bestCall"] {
  return c ? { symbol: c.symbol, strike: c.strike, expiry: c.expiry, mid: c.mid, score: c.score } : null;
}

export const WATCH_UNIVERSE = Array.from(new Set([...MEGACAPS, ...SP100]));

/** Full compute: batched snapshot ranking, then the pipeline on a short list. */
export async function computeMorningWatch(topN = 2, shortlist = 6): Promise<MorningWatch> {
  const now = Date.now();
  const day = etStamp(now).date;
  const session = sessionOf(now);
  const notes: string[] = [];
  if (!hasAlpacaKeys()) {
    return { day, computedAt: new Date(now).toISOString(), locked: false, lockedAt: null, session, sessionToday: false, picks: [], ranked: [], notes: ["Alpaca keys not configured."] };
  }
  const clock = await getClock().catch(() => null);
  const sessionToday = Boolean(clock && (clock.is_open || etStamp(Date.parse(clock.next_open)).date === day));
  if (!sessionToday) notes.push("The market is closed today. This ranking uses the last session's close and levels.");
  if (session === "premarket") notes.push("Premarket prices are thin. Gaps can fill or reverse in the first minutes after 9:30.");
  else if (session === "closed" || session === "afterhours") notes.push("Premarket has not started (it opens at 4:00 ET), so this is a levels-only ranking from the last session. It firms up as premarket volume comes in and locks at 9:10 ET.");

  const snaps = await getStockSnapshots(WATCH_UNIVERSE, 60_000);
  const ranked = rankPremarket(snaps, now, session);
  const short = ranked.slice(0, shortlist);
  const analyses = new Map<string, OptionsAnalysis>();
  for (let i = 0; i < short.length; i += 3) {
    await Promise.all(
      short.slice(i, i + 3).map(async (c) => {
        try {
          analyses.set(c.symbol, await buildOptionsAnalysis(c.symbol, { profile: "DAY" }));
        } catch (e) {
          notes.push(`${c.symbol}: ${e instanceof Error ? e.message.slice(0, 80) : "analysis failed"}`);
        }
      })
    );
  }

  const scored = short.map((c) => {
    const a = analyses.get(c.symbol) ?? null;
    const opp = a?.opportunity?.total ?? null;
    const hist = a?.history?.stats && a.history.stats.confirmed >= 5 ? a.history.stats : null;
    const histBonus = hist ? (hist.t1Hit / hist.confirmed) * 10 : 0;
    const score = Math.round(c.score * 0.65 + (opp ?? 40) * 0.35 + histBonus);
    const daily = a?.setups.find((s) => s.tf === "D");
    const pick: WatchPick = {
      rank: 0, symbol: c.symbol, price: a?.price ?? c.price, gapPct: c.gapPct, volRatio: c.volRatio, todayVolume: c.todayVolume,
      bias: c.bias, score, preScore: c.score, opportunity: opp,
      trend: a?.trend?.label ?? null, dailyTrend: daily?.trend ? String(daily.trend) : null,
      state: a?.machine?.state ?? (a?.plan ? "WATCHING" : null),
      trigger: a?.plan?.trigger ?? null, invalidation: a?.plan?.invalidation ?? null, target: a?.plan?.targets[0] ?? null,
      history: hist ? { confirmed: hist.confirmed, t1Hit: hist.t1Hit } : null,
      bestCall: a ? pickContract(a.sides.call.best) : null, bestPut: a ? pickContract(a.sides.put.best) : null,
      why: whyLines(c, session, a),
      ...buildPlay(a, c.bias),
    };
    return pick;
  });
  scored.sort((a, b) => b.score - a.score);
  const picks = scored.slice(0, topN).map((p, i) => ({ ...p, rank: i + 1 }));
  return { day, computedAt: new Date(now).toISOString(), locked: false, lockedAt: null, session, sessionToday, picks, ranked: ranked.slice(0, 12), notes };
}

// ── Persistence ──

interface Row {
  day: string;
  computed_at: string;
  locked: boolean;
  locked_at: string | null;
  picks: WatchPick[];
  ranked: WatchCandidate[];
  meta: { session: string; sessionToday: boolean; notes: string[] } | null;
}

let memo: { at: number; data: MorningWatch } | null = null;
const LIVE_TTL_MS = 5 * 60_000;

function fromRow(r: Row): MorningWatch {
  return {
    day: r.day, computedAt: r.computed_at, locked: r.locked, lockedAt: r.locked_at,
    session: r.meta?.session ?? "closed", sessionToday: r.meta?.sessionToday ?? true,
    picks: r.picks, ranked: r.ranked, notes: r.meta?.notes ?? [],
  };
}

async function save(w: MorningWatch, locked: boolean): Promise<void> {
  if (!hasDatabase()) return;
  await query(
    `insert into morning_watch (day, computed_at, locked, locked_at, picks, ranked)
     values ($1, now(), $2, case when $2 then now() else null end, $3::jsonb, $4::jsonb)
     on conflict (day) do update set
       computed_at = now(), locked = morning_watch.locked or excluded.locked,
       locked_at = coalesce(morning_watch.locked_at, excluded.locked_at),
       picks = excluded.picks, ranked = excluded.ranked`,
    [w.day, locked, JSON.stringify(w.picks), JSON.stringify({ ranked: w.ranked, meta: { session: w.session, sessionToday: w.sessionToday, notes: w.notes } })]
  );
}

async function loadRow(day: string): Promise<MorningWatch | null> {
  if (!hasDatabase()) return null;
  const r = await queryOne<{ day: string; computed_at: string; locked: boolean; locked_at: string | null; picks: WatchPick[]; ranked: { ranked: WatchCandidate[]; meta: Row["meta"] } | WatchCandidate[] }>(
    "select day, computed_at::text, locked, locked_at::text, picks, ranked from morning_watch where day = $1",
    [day]
  );
  if (!r) return null;
  const packed = Array.isArray(r.ranked) ? { ranked: r.ranked, meta: null } : r.ranked;
  return fromRow({ day: r.day, computed_at: r.computed_at, locked: r.locked, locked_at: r.locked_at, picks: r.picks, ranked: packed.ranked, meta: packed.meta });
}

/** Today's watch: the locked list if there is one, else a live computation (cached 5 minutes). */
export async function getMorningWatch(opts: { topN?: number; refresh?: boolean } = {}): Promise<MorningWatch> {
  const topN = opts.topN ?? 2;
  const day = etStamp(Date.now()).date;
  const stored = await loadRow(day);
  if (stored?.locked) return { ...stored, picks: stored.picks.slice(0, Math.max(topN, 1)) };
  if (!opts.refresh && memo && memo.data.day === day && Date.now() - memo.at < LIVE_TTL_MS) {
    return { ...memo.data, picks: memo.data.picks.slice(0, topN) };
  }
  if (!opts.refresh && stored && Date.now() - Date.parse(stored.computedAt) < LIVE_TTL_MS) {
    memo = { at: Date.parse(stored.computedAt), data: stored };
    return { ...stored, picks: stored.picks.slice(0, topN) };
  }
  const fresh = await computeMorningWatch(3);
  memo = { at: Date.now(), data: fresh };
  await save(fresh, false).catch(() => undefined);
  return { ...fresh, picks: fresh.picks.slice(0, topN) };
}

/** Freezes today's list and emails it. Idempotent: a second call returns the stored locked list. */
export async function lockMorningWatch(topN = 2): Promise<MorningWatch & { emailed: boolean; emailReason?: string }> {
  const day = etStamp(Date.now()).date;
  const stored = await loadRow(day);
  if (stored?.locked) return { ...stored, emailed: false, emailReason: "already locked" };
  const fresh = await computeMorningWatch(3);
  const locked: MorningWatch = { ...fresh, locked: true, lockedAt: new Date().toISOString() };
  await save(locked, true);
  memo = { at: Date.now(), data: locked };
  const view = { ...locked, picks: locked.picks.slice(0, topN) };
  const mail = morningWatchEmail(view, locked.session === "premarket" ? `locked premarket at ${etStamp(Date.now()).hm} ET` : `locked at ${etStamp(Date.now()).hm} ET`);
  const r = await sendAlertEmail(mail.subject, mail.text, mail.html);
  if (hasDatabase()) await query("update morning_watch set email_sent = $2, email_error = $3 where day = $1", [day, r.sent, r.sent ? null : (r.reason ?? null)]).catch(() => undefined);
  return { ...view, emailed: r.sent, emailReason: r.reason };
}

/**
 * Called by the siren sweep (runs every minute 9:00-15:59 ET on weekdays).
 * Locks today's list once, the first time it runs at or after 9:10 ET on a
 * session day. Cheap when already locked.
 */
export async function maybeLockMorningWatch(clock: { is_open: boolean; next_open: string } | null): Promise<boolean> {
  if (!hasDatabase() || !hasAlpacaKeys()) return false;
  const now = Date.now();
  const st = etStamp(now);
  if (st.minutes < 9 * 60 + 10 || st.minutes >= 12 * 60) return false;
  const sessionToday = Boolean(clock && (clock.is_open || etStamp(Date.parse(clock.next_open)).date === st.date));
  if (!sessionToday) return false;
  const stored = await loadRow(st.date);
  if (stored?.locked) return false;
  await lockMorningWatch(2);
  return true;
}
