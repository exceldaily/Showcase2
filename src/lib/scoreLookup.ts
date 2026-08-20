// Server-side helper: compute the transparent setup score for one
// symbol from cached bars + reference data + today's sector strength.

import { loadBars } from "./bars";
import { query } from "./db";
import { computeMetricsFromBars } from "./polygon";
import { scoreSetup, type SetupScore } from "./setupScore";
import { polygonCapabilities } from "@/providers/polygonProvider";

export async function getSymbolScore(symbol: string, hasNews: boolean): Promise<SetupScore | null> {
  const sym = symbol.toUpperCase();
  const caps = polygonCapabilities();

  const refRows = await query<{ symbol: string; sector: string | null; float_shares: string | null }>(
    `select symbol, sector, float_shares from tickers where symbol = $1 or symbol = $2 limit 1`,
    [sym, `X:${sym}`]
  );
  const ref = refRows[0];
  const barsMap = await loadBars([ref?.symbol ?? sym], 260);
  const bars = barsMap.get(ref?.symbol ?? sym) ?? [];
  if (bars.length < 30) return null;

  let sectorScore: number | undefined;
  if (ref?.sector) {
    const s = await query<{ score: string }>(
      `select score from sector_strength_daily
       where sector = $1 order by date desc limit 1`,
      [ref.sector]
    );
    if (s[0]) sectorScore = Number(s[0].score);
  }

  return scoreSetup({
    metrics: computeMetricsFromBars(sym, bars),
    bars,
    sectorScore,
    caps: { intraday: caps.intraday, floatData: caps.floatData, news: caps.news },
    floatShares: ref?.float_shares ? Number(ref.float_shares) : null,
    catalystFound: caps.news ? hasNews : null,
  });
}
