// ─────────────────────────────────────────────────────────
// Data access layer.
// Single seam between the UI and the data source. Today it returns
// mock data; once Neon is seeded by the scanner cron, these
// functions switch to live queries without the UI changing.
// ─────────────────────────────────────────────────────────

import { MOCK_REGIME, MOCK_SECTORS, MOCK_SETUPS, getMockSetupById } from "@/data/mock";
import { hasDatabase } from "@/lib/db";
import { buildLiveRegime, canBuildLiveRegime } from "@/lib/liveRegime";
import type { RegimeSnapshot, SectorStrength, TradeSetup } from "@/lib/types";

export interface DataSourceStatus {
  live: boolean;
  label: string;
}

export function dataSourceStatus(): DataSourceStatus {
  const live = hasDatabase() && Boolean(process.env.POLYGON_API_KEY);
  return {
    live,
    label: live ? "Live data" : "Demo data",
  };
}

export async function getRegime(): Promise<RegimeSnapshot> {
  // Prefer live regime (Polygon SPY/QQQ + FRED VIX). Falls back to mock
  // if keys are missing or an upstream call fails.
  if (canBuildLiveRegime()) {
    const live = await buildLiveRegime();
    if (live) return live;
  }
  return MOCK_REGIME;
}

export async function getSectorStrength(): Promise<SectorStrength[]> {
  // TODO(phase1): read sector_strength_daily for today.
  return MOCK_SECTORS;
}

export async function getSetups(): Promise<TradeSetup[]> {
  // TODO(phase1): query trade_setups where alphaforge_score >= 80 and is_active.
  return MOCK_SETUPS;
}

export async function getSetupById(id: string): Promise<TradeSetup | undefined> {
  return getMockSetupById(id);
}

// Daily digest selection: top 3 overall, top 3 emerging growth, top 3 fresh IPO.
export async function getDailyDigest(): Promise<{
  topTrades: TradeSetup[];
  emergingGrowth: TradeSetup[];
  freshIpos: TradeSetup[];
  noTrade: boolean;
}> {
  const all = await getSetups();
  const byScore = [...all].sort((a, b) => b.scores.alphaforge - a.scores.alphaforge);
  const qualified = byScore.filter((s) => s.scores.alphaforge >= 80);

  return {
    topTrades: qualified.slice(0, 3),
    emergingGrowth: qualified.filter((s) => s.opportunityType === "Emerging Growth").slice(0, 3),
    freshIpos: qualified.filter((s) => s.opportunityType === "Fresh IPO").slice(0, 3),
    noTrade: qualified.length === 0,
  };
}
