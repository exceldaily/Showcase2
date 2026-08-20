// Journal entry creation. Market context is attached server-side from
// REAL data at save time (spec §42) — regime, sector strength, RVOL,
// setup score — so the entry records the conditions, not a guess.

import { NextResponse } from "next/server";
import { hasDatabase, query } from "@/lib/db";
import { getSymbolScore } from "@/lib/scoreLookup";
import { loadBars } from "@/lib/bars";
import { computeMetricsFromBars } from "@/lib/polygon";
import { round2 } from "@/lib/scoring";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!hasDatabase()) {
    return NextResponse.json({ error: "database not configured" }, { status: 503 });
  }

  let body: Record<string, string>;
  try {
    body = (await request.json()) as Record<string, string>;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const symbol = (body.symbol ?? "").trim().toUpperCase();
  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });

  const num = (v: string | undefined) => (v && v.trim() !== "" ? Number(v) : null);
  const entryPrice = num(body.entryPrice);
  const exitPrice = num(body.exitPrice);
  const shares = num(body.shares);
  const pnl =
    entryPrice !== null && exitPrice !== null && shares !== null
      ? round2((exitPrice - entryPrice) * shares)
      : null;

  // ── Attach real market context ──
  const context: Record<string, unknown> = {};
  try {
    const regime = await query<{ regime: string; vix_level: string; breadth_score: string }>(
      `select regime, vix_level, breadth_score from market_regime_log order by ts desc limit 1`
    );
    if (regime[0]) {
      context.marketRegime = regime[0].regime;
      context.vix = Number(regime[0].vix_level);
      context.breadth = Number(regime[0].breadth_score);
    }

    const ref = await query<{ symbol: string; sector: string | null }>(
      `select symbol, sector from tickers where symbol = $1 or symbol = $2 limit 1`,
      [symbol, `X:${symbol}`]
    );
    if (ref[0]?.sector) {
      context.sector = ref[0].sector;
      const sect = await query<{ score: string; rank: number }>(
        `select score, rank from sector_strength_daily where sector = $1 order by date desc limit 1`,
        [ref[0].sector]
      );
      if (sect[0]) {
        context.sectorScore = Number(sect[0].score);
        context.sectorRank = sect[0].rank;
      }
    }

    if (ref[0]) {
      const barsMap = await loadBars([ref[0].symbol], 60);
      const bars = barsMap.get(ref[0].symbol);
      if (bars && bars.length >= 30) {
        const m = computeMetricsFromBars(symbol, bars);
        context.rvol = m.relVolume;
        context.atrPct = m.price > 0 ? round2((m.atr14 / m.price) * 100) : null;
        context.rsi = m.rsi14;
        context.barDate = new Date(bars[bars.length - 1].t).toISOString().slice(0, 10);
      }
      const score = await getSymbolScore(symbol, false);
      if (score) {
        context.setupScore = score.total;
        context.setupGrade = score.grade;
      }
    }
  } catch {
    context.note = "Market context partially unavailable at save time.";
  }

  const rows = await query<{ id: string }>(
    `insert into journal_entries
       (symbol, trade_date, entry_price, exit_price, shares, pnl, setup,
        scanner_source, notes, mistakes, emotion, catalyst, market_context)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
     returning id`,
    [
      symbol,
      body.tradeDate || null,
      entryPrice,
      exitPrice,
      shares,
      pnl,
      body.setup || null,
      body.scannerSource || null,
      body.notes || null,
      body.mistakes || null,
      body.emotion || null,
      body.catalyst || null,
      JSON.stringify(context),
    ]
  );

  return NextResponse.json({ ok: true, id: rows[0]?.id, context });
}
