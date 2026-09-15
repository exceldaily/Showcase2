"use client";

// The "read this first" card for one symbol, as a board widget.

import Link from "next/link";
import { lifecycleTone, TONE_TEXT } from "@/lib/ui/tone";
import { useLite } from "./ChartWidget";

export default function PlanWidget({ symbol }: { symbol: string }) {
  const { lite, error } = useLite(symbol, 15_000);
  if (error && !lite) return <div className="p-3 text-xs text-bear">{error}</div>;
  if (!lite) return <div className="p-3 text-xs text-ink-faint">Loading {symbol}…</div>;
  const long = lite.direction === "long";
  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2 font-mono">
        <span className="text-sm font-bold text-ink">{lite.symbol}</span>
        {lite.price !== null && <span className="text-ink-muted">${lite.price.toFixed(2)}</span>}
        <span className={`font-semibold ${TONE_TEXT[lifecycleTone(lite.lifecycle, lite.state)]}`}>{lite.lifecycle}</span>
        {lite.choppy ? <span className="text-warn">CHOPPY</span> : lite.trend && <span className={/Bull/.test(lite.trend.label) ? "text-bull" : /Bear/.test(lite.trend.label) ? "text-bear" : "text-ink-muted"}>{lite.trend.label} {lite.trend.confidence}/100</span>}
      </div>
      <div className="rounded-md border border-border bg-bg-elevated/60 px-2 py-1.5 text-ink">
        <span className="text-ink-faint">Now: </span>{lite.actionLine}
      </div>
      {lite.plan && (
        <div className="grid grid-cols-3 gap-1 font-mono">
          <div className="rounded border border-border px-2 py-1"><div className="text-[10px] uppercase text-ink-faint">{long ? "Calls above" : "Puts below"}</div><div className={long ? "text-bull" : "text-bear"}>${lite.plan.trigger.toFixed(2)}</div></div>
          <div className="rounded border border-border px-2 py-1"><div className="text-[10px] uppercase text-ink-faint">{long ? "Wrong below" : "Wrong above"}</div><div className="text-bear">${lite.plan.invalidation.toFixed(2)}</div></div>
          <div className="rounded border border-border px-2 py-1"><div className="text-[10px] uppercase text-ink-faint">Target 1</div><div className="text-brand-glow">${lite.plan.targets[0].toFixed(2)}</div></div>
        </div>
      )}
      <ul className="space-y-1 leading-snug text-ink-muted">
        {lite.summary.map((l, i) => <li key={i}>• {l}</li>)}
      </ul>
      <div className="mt-auto flex flex-wrap items-center gap-3 font-mono text-[11px] text-ink-muted">
        {lite.bestCall && <span>best call <span className="text-ink">{lite.bestCall.strike}C {lite.bestCall.expiry.slice(5)}</span> ~${(lite.bestCall.mid * 100).toFixed(0)}</span>}
        {lite.bestPut && <span>best put <span className="text-ink">{lite.bestPut.strike}P {lite.bestPut.expiry.slice(5)}</span> ~${(lite.bestPut.mid * 100).toFixed(0)}</span>}
        <Link href={`/options?s=${lite.symbol}`} className="ml-auto rounded bg-brand/20 px-2 py-0.5 font-semibold text-brand-glow hover:bg-brand/30">Open terminal</Link>
      </div>
    </div>
  );
}
