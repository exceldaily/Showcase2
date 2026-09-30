// ─────────────────────────────────────────────────────────
// Replays recent sessions for one symbol from provider bars and stores
// the result (server only). Used by the "update history" action so the
// analytics keep growing without anyone having to be watching.
// ─────────────────────────────────────────────────────────

import type { Bar } from "../bars";
import { getStockBars, hasAlpacaKeys } from "@/providers/alpaca";
import { hasDatabase, queryOne } from "../db";
import { etStamp, sessionOf } from "../intraday";
import { sanitizeBars } from "../barSanity";
import { marketSymbols } from "../quality/assemble";
import { marketLegAt, replayDay } from "../quality/replay";
import { fromReplay, upsertSignals } from "./store";

const toBar = (b: { t: string; o: number; h: number; l: number; c: number; v: number; vw?: number }): Bar => ({ t: Date.parse(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, vw: b.vw ?? b.c });
const dayFloor = (ms: number) => new Date(Math.floor(ms / 86400e3) * 86400e3).toISOString();

export interface ReplayRun { symbol: string; days: string[]; written: number; note: string | null }

export async function replaySymbolSessions(symbolRaw: string, maxSessions = 3): Promise<ReplayRun> {
  const symbol = symbolRaw.toUpperCase().replace(/[^A-Z.]/g, "").slice(0, 6);
  if (!hasAlpacaKeys() || !hasDatabase()) return { symbol, days: [], written: 0, note: "not configured" };
  const now = Date.now();
  const today = etStamp(now).date;
  const todayDone = sessionOf(now) === "afterhours" || sessionOf(now) === "closed";
  // Forty-five days of 5-minute bars: the relative-volume history and the per-slot baseline.
  const m5raw = await getStockBars(symbol, "5Min", dayFloor(now - 45 * 86400e3), undefined, 600_000);
  const hist5 = m5raw.map(toBar).filter((b) => sessionOf(b.t) === "rth");
  const sessions = Array.from(new Set(hist5.map((b) => etStamp(b.t).date))).sort().filter((d) => d < today || (d === today && todayDone));
  if (sessions.length < 8) return { symbol, days: [], written: 0, note: "not enough history" };
  const covered = await queryOne<{ last: string | null }>("select max(day)::text as last from signal_log where source = 'replay' and symbol = $1", [symbol]).catch(() => null);
  const todo = sessions.slice(6).filter((d) => !covered?.last || d > covered.last).slice(-Math.max(1, Math.min(8, maxSessions)));
  if (todo.length === 0) return { symbol, days: [], written: 0, note: "up to date" };
  const firstMs = Date.parse(`${todo[0]}T00:00:00Z`);
  const legs = marketSymbols(symbol);
  const [m1raw, dailyRaw, ...legData] = await Promise.all([
    getStockBars(symbol, "1Min", dayFloor(firstMs - 9 * 86400e3), undefined, 600_000),
    getStockBars(symbol, "1Day", dayFloor(now - 300 * 86400e3), undefined, 600_000),
    ...legs.flatMap((l) => [
      getStockBars(l, "1Min", dayFloor(firstMs - 86400e3), undefined, 600_000).catch(() => []),
      getStockBars(l, "1Day", dayFloor(now - 40 * 86400e3), undefined, 600_000).catch(() => []),
    ]),
  ]);
  const m1 = sanitizeBars(m1raw.map(toBar), { minPct: 0.012 }).bars;
  const daily = sanitizeBars(dailyRaw.map(toBar), { minPct: 0.03 }).bars;
  const legBars = new Map<string, { byDay: Map<string, Bar[]>; prevClose: Map<string, number> }>();
  legs.forEach((l, k) => {
    const lm1 = (legData[k * 2] ?? []).map(toBar);
    const ld = (legData[k * 2 + 1] ?? []).map(toBar);
    const byDay = new Map<string, Bar[]>();
    for (const b of lm1) { const d = etStamp(b.t).date; const a = byDay.get(d) ?? []; a.push(b); byDay.set(d, a); }
    const prevClose = new Map<string, number>();
    const ds = ld.map((b) => ({ d: etStamp(b.t).date, c: b.c }));
    for (let i = 1; i < ds.length; i++) prevClose.set(ds[i].d, ds[i - 1].c);
    legBars.set(l, { byDay, prevClose });
  });
  let written = 0;
  const done: string[] = [];
  for (const day of todo) {
    const records = replayDay({
      symbol, day, m1, daily, hist5,
      marketAt: (t) => legs.map((l) => marketLegAt(l, legBars.get(l)?.byDay.get(day) ?? [], legBars.get(l)?.prevClose.get(day) ?? null, t)),
    });
    written += await upsertSignals(records.map((r) => fromReplay(r, "replay")), "replace");
    done.push(day);
  }
  return { symbol, days: done, written, note: null };
}
