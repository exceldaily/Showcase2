"use client";

// One chart card on the board: light analysis every 10s + the 2-second
// quote for the live candle. Reuses the workspace chart so labels,
// levels, and the locked plan look identical everywhere.

import { useEffect, useMemo, useState } from "react";
import OptionsChart from "@/components/options/OptionsChart";
import { etStamp, resample, sessionOf } from "@/lib/intraday";
import { liveCandle, type LiveQuote } from "@/lib/liveCandle";
import type { LiteAnalysis } from "@/lib/liteAnalysis";
import type { WidgetTf } from "@/lib/board";
import { DEFAULT_CHART_PREFS, effectiveToggles, loadChartPrefs, onChartPrefs, type ChartPrefs } from "@/lib/chartPrefs";
import { fmt$, pct } from "@/lib/ui/format";
import { machineTone, signTone, TONE_TEXT } from "@/lib/ui/tone";

const BUCKET: Record<WidgetTf, number> = { "1m": 60e3, "5m": 300e3, "15m": 900e3, "1h": 3600e3 };

export function useLite(symbol: string, everyMs = 10_000): { lite: LiteAnalysis | null; error: string | null } {
  const [lite, setLite] = useState<LiteAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLite(null);
    const pull = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await fetch(`/api/options/lite?symbol=${symbol}`, { cache: "no-store" });
        const d = (await r.json()) as LiteAnalysis & { error?: string };
        if (cancelled) return;
        if (!r.ok || d.error) setError(d.error ?? `HTTP ${r.status}`);
        else {
          setLite(d);
          setError(null);
        }
      } catch {
        if (!cancelled) setError("network error");
      }
    };
    void pull();
    const id = setInterval(pull, everyMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [symbol, everyMs]);
  return { lite, error };
}

export function useQuote(symbol: string): LiveQuote | null {
  const [q, setQ] = useState<LiveQuote | null>(null);
  useEffect(() => {
    let cancelled = false;
    setQ(null);
    const pull = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await fetch(`/api/options/quote?symbol=${symbol}`, { cache: "no-store" });
        if (!r.ok) return;
        const d = (await r.json()) as { price: number | null; tradeTs: number | null };
        if (!cancelled && d.price !== null && d.tradeTs !== null) setQ({ t: d.tradeTs, price: d.price });
      } catch {
        /* transient */
      }
    };
    void pull();
    const id = setInterval(pull, sessionOf(Date.now()) === "closed" ? 30_000 : 3_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [symbol]);
  return q;
}

export default function ChartWidget({ symbol, tf, height }: { symbol: string; tf: WidgetTf; height: number }) {
  const { lite, error } = useLite(symbol);
  const quote = useQuote(symbol);
  const [prefs, setPrefs] = useState<ChartPrefs>(DEFAULT_CHART_PREFS);
  useEffect(() => {
    setPrefs(loadChartPrefs());
    return onChartPrefs(setPrefs);
  }, []);
  const toggles = useMemo(() => effectiveToggles(prefs), [prefs]);

  const bars = useMemo(() => {
    if (!lite) return [];
    switch (tf) {
      case "1m": return lite.bars.m1;
      case "5m": return lite.bars.m5;
      case "15m": return resample(lite.bars.m5, 15);
      case "1h": return resample(lite.bars.m5, 60);
    }
  }, [lite, tf]);

  const machineBars = useMemo(() => {
    if (!lite || lite.bars.m5.length === 0) return [];
    const day = etStamp(lite.bars.m5[lite.bars.m5.length - 1].t).date;
    return lite.bars.m5.filter((b) => etStamp(b.t).date === day && sessionOf(b.t) !== "closed");
  }, [lite]);

  const livePrice = quote && bars.length ? liveCandle(bars, quote, BUCKET[tf])?.c ?? null : null;
  const price = livePrice ?? lite?.price ?? null;

  if (error && !lite) return <div className="p-3 text-xs text-bear">{error}</div>;
  if (!lite) return <div className="p-3 text-xs text-ink-faint">Loading {symbol}…</div>;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 px-2 py-1 font-mono text-xs">
        <span className="font-semibold text-ink">{fmt$(price)}</span>
        <span className={TONE_TEXT[signTone(lite.changePct)]}>{pct(lite.changePct)}</span>
        {lite.state && <span className={`font-semibold ${TONE_TEXT[machineTone(lite.state)]}`}>{lite.direction === "short" ? "↓" : "↑"} {lite.state}</span>}
        {lite.plan && <span className="text-ink-faint">{lite.direction === "long" ? "calls above" : "puts below"} {lite.plan.trigger.toFixed(2)}</span>}
        {lite.indexMode && <span className="rounded bg-warn/15 px-1 text-2xs text-warn">INDEX est.</span>}
      </div>
      <div className="min-h-0 flex-1">
        <OptionsChart
          bars={bars}
          zones={lite.zones}
          plan={lite.plan}
          minStrength={65}
          toggles={toggles}
          resetKey={`${symbol}:${tf}`}
          height={Math.max(160, height - 30)}
          live={quote}
          bucketMs={BUCKET[tf]}
          context={{
            symbol: lite.symbol,
            direction: lite.direction,
            state: lite.state,
            lockedAt: lite.lockedAt,
            machine: lite.machine,
            machineBars,
          }}
        />
      </div>
    </div>
  );
}
