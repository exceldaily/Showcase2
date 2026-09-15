"use client";

// Developer view: raw values behind every number on the screen, data
// timestamps, provider status, latencies and the alert log. Hidden
// unless developer mode is on.

import type { OptionsAnalysis } from "@/lib/optionsTerminal";
import type { DecisionRead } from "@/lib/decision/lifecycle";
import type { AlertEvent } from "@/lib/alertTransitions";
import type { MarketSnapshot } from "@/lib/marketStateLive";
import type { Quote } from "@/components/options/types";
import { etClock } from "@/lib/ui/format";

export interface Latencies { analysisMs: number | null; quoteMs: number | null; marketMs: number | null }

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-md bg-bg-elevated/60 p-2">
      <div className="stat-label mb-1">{title}</div>
      <div className="font-mono text-2xs leading-4 text-ink-muted">{children}</div>
    </div>
  );
}
const pre = (v: unknown) => <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(v, null, 1)}</pre>;

export default function DevTab({ analysis, decision, quote, market, latencies, alertLog }: { analysis: OptionsAnalysis; decision: DecisionRead | null; quote: Quote | null; market: MarketSnapshot | null; latencies: Latencies; alertLog: (AlertEvent & { at: number })[] }) {
  const now = Date.now();
  return (
    <div className="grid h-full gap-2 overflow-auto p-2 md:grid-cols-2 xl:grid-cols-3">
      <Block title="Data timestamps and provider status">
        <div>analysis asOf {analysis.asOf} ({Math.round((now - Date.parse(analysis.asOf)) / 1000)}s ago)</div>
        <div>last trade {analysis.lastTradeTs ? `${etClock(analysis.lastTradeTs, true)} ET` : "—"} · dataStale {String(analysis.dataStale)} · connected {String(analysis.connected)}</div>
        <div>quote tradeTs {quote?.tradeTs ? `${etClock(quote.tradeTs, true)} ET` : "—"} · session {analysis.session} · slot {analysis.slot} · marketOpen {String(analysis.marketOpen)}</div>
        <div>index mode {analysis.indexMode ? `${analysis.indexMode.proxy} x ${analysis.indexMode.ratio} (delayed ${analysis.indexMode.delayedPrice})` : "off"}</div>
        <div>server compute {analysis.timingMs ?? "—"} ms · bars m1 {analysis.bars.m1.length} m5 {analysis.bars.m5.length} daily {analysis.bars.daily.length} · contracts {analysis.contracts.length}</div>
        <div>websocket: none (polling; Vercel functions cannot hold a socket)</div>
        <div>notes: {analysis.notes.join(" | ") || "—"}</div>
      </Block>
      <Block title="API latency (last round trip)">
        <div>/api/options/analyze {latencies.analysisMs ?? "—"} ms</div>
        <div>/api/options/quote {latencies.quoteMs ?? "—"} ms</div>
        <div>/api/market/state {latencies.marketMs ?? "—"} ms{market ? ` · asOf ${market.asOf}` : ""}</div>
      </Block>
      <Block title="Signal inputs and decision">{pre({ direction: analysis.direction, choppy: analysis.choppy, trendFlips: analysis.trendFlips, rvol: analysis.rvol, vwap: analysis.vwap, atr5m: analysis.atr5m, room: analysis.room, lock: analysis.lock, machine: analysis.machine ? { state: analysis.machine.state, quality: analysis.machine.quality, extreme: analysis.machine.extreme, checks: analysis.machine.checks } : null, decision })}</Block>
      <Block title="Trend signals">{pre(analysis.trend)}</Block>
      <Block title="Timeframe matrix (raw)">{pre(analysis.matrix.map((r) => ({ tf: r.tf, bars: r.bars, trend: r.trend, mom: r.momentum, vwap: r.vwapPct, ema: r.ema, macd: r.macd, st: r.structure, s: r.support, r: r.resistance, detail: r.detail })))}</Block>
      <Block title="Score calculations">{pre({ confluence: analysis.confluence, opportunity: analysis.opportunity, align: analysis.align, bestContractParts: analysis.best ? { symbol: analysis.best.symbol, score: analysis.best.score, parts: analysis.best.parts, penalties: analysis.best.penalties, warnings: analysis.best.warnings } : null })}</Block>
      <Block title="Plan and levels">{pre({ plan: analysis.plan, zones: analysis.zones.slice(0, 12).map((z) => ({ p: z.price, k: z.kind, s: z.strength, tf: z.timeframes })) })}</Block>
      <Block title="Signal log (this session)">
        {alertLog.length === 0 ? <div>no alerts yet</div> : alertLog.slice(-30).reverse().map((a, i) => <div key={i}>{etClock(a.at, true)} {a.symbol} {a.kind} · {a.detail}</div>)}
      </Block>
    </div>
  );
}
