// Market-hours and data-freshness words for the status pills (pure).

import { quoteStaleMs } from "../liveCandle";

export type MarketPhase = "PREMARKET" | "MARKET OPEN" | "AFTER HOURS" | "MARKET CLOSED";
export type DataState = "LIVE" | "DELAYED" | "STALE" | "DISCONNECTED";

export function marketPhase(session: string | null | undefined): MarketPhase {
  switch (session) {
    case "premarket": return "PREMARKET";
    case "rth": return "MARKET OPEN";
    case "afterhours": return "AFTER HOURS";
    default: return "MARKET CLOSED";
  }
}

export function dataState(i: {
  connected: boolean;
  error: boolean;
  analysisStale: boolean;
  delayed: boolean;
  quoteTs: number | null;
  session: string;
  nowMs: number;
}): DataState {
  if (!i.connected || i.error) return "DISCONNECTED";
  if (i.analysisStale) return "STALE";
  if (i.quoteTs !== null && i.session !== "closed" && i.nowMs - i.quoteTs > quoteStaleMs(i.session)) return "STALE";
  if (i.delayed) return "DELAYED";
  return "LIVE";
}
