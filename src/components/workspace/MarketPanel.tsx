"use client";

// Market state and the SPX / SPY command center. Compact in the rail;
// expanded (levels, evidence, matrix) when the loaded symbol is an
// index or index ETF.

import type { MarketSnapshot } from "@/lib/marketStateLive";
import type { MarketState } from "@/lib/marketState";
import { fmt$, pct, etClock } from "@/lib/ui/format";
import { signTone, TONE_TEXT, type Tone } from "@/lib/ui/tone";
import { Chip, Disclosure, Panel, Stat, StateBadge } from "@/components/ui/primitives";

export const MARKET_TONE: Record<MarketState["state"], Tone> = { "STRONG BULL": "bull", BULLISH: "bull", NEUTRAL: "muted", CHOP: "warn", BEARISH: "bear", "STRONG BEAR": "bear" };

export function EvidenceList({ state }: { state: MarketState }) {
  const line = (e: MarketState["evidenceFor"][number], i: number) => (
    <li key={i} className="flex items-start gap-1.5 text-xs">
      <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${e.dir === "bull" ? "bg-bull" : e.dir === "bear" ? "bg-bear" : "bg-ink-faint"}`} />
      <span className="text-ink-muted"><span className="text-ink">{e.text}</span> <span className="text-ink-faint">{e.source}</span></span>
    </li>
  );
  return (
    <div className="space-y-1.5">
      {state.evidenceFor.length > 0 && <div><div className="stat-label">Evidence</div><ul className="mt-0.5 space-y-0.5">{state.evidenceFor.map(line)}</ul></div>}
      {state.evidenceAgainst.length > 0 && <div><div className="stat-label">Counter-evidence</div><ul className="mt-0.5 space-y-0.5">{state.evidenceAgainst.map(line)}</ul></div>}
      {state.neutral.length > 0 && <div><div className="stat-label">Neutral</div><ul className="mt-0.5 space-y-0.5">{state.neutral.map(line)}</ul></div>}
      {state.notMeasured.length > 0 && <div className="text-2xs text-ink-faint">Not measured: {state.notMeasured.join(", ")}.</div>}
    </div>
  );
}

export default function MarketPanel({ snap, expanded = false, error }: { snap: MarketSnapshot | null; expanded?: boolean; error?: string | null }) {
  if (!snap) {
    return <Panel title="Market" collapsible><div className="text-xs text-ink-faint">{error ? "MARKET STATE UNAVAILABLE" : "Loading…"}</div></Panel>;
  }
  const s = snap.state;
  const lv = snap.spy?.levels ?? null;
  const head = (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      {snap.spy && <Chip tone={signTone(snap.spy.changePct)}>SPY {fmt$(snap.spy.price)} {pct(snap.spy.changePct)}</Chip>}
      {snap.qqq && <Chip tone={signTone(snap.qqq.changePct)}>QQQ {pct(snap.qqq.changePct)}</Chip>}
      {snap.spx ? <Chip tone={signTone(snap.spx.changePct)} title={`CBOE delayed print ${etClock(snap.spx.asOf)} ET`}>SPX {snap.spx.price.toFixed(2)}</Chip> : <Chip tone="faint">SPX n/a</Chip>}
      {snap.vix ? <Chip tone={snap.vix.changePct > 2 ? "bear" : snap.vix.changePct < -2 ? "bull" : "muted"} title="CBOE delayed">VIX {snap.vix.price.toFixed(2)} {pct(snap.vix.changePct, 1)}</Chip> : <Chip tone="faint">VIX n/a</Chip>}
      {snap.vix1d ? <Chip tone={snap.vix1d.changePct > 3 ? "bear" : snap.vix1d.changePct < -3 ? "bull" : "muted"} title="CBOE delayed">VIX1D {snap.vix1d.price.toFixed(2)}</Chip> : null}
      {snap.breadth ? <Chip tone={snap.breadth.advancersPct >= 60 ? "bull" : snap.breadth.advancersPct <= 40 ? "bear" : "muted"} title={`End of day ${snap.breadth.asOf}`}>Breadth {snap.breadth.advancersPct.toFixed(0)}% EOD</Chip> : <Chip tone="faint">Breadth n/a</Chip>}
    </div>
  );

  if (!expanded) {
    return (
      <Panel title="Market" collapsible right={s && <StateBadge tone={MARKET_TONE[s.state]}>{s.state}</StateBadge>} bodyClassName="space-y-1.5">
        {head}
        {s && <Disclosure title="Why" count={s.evidenceFor.length + s.evidenceAgainst.length}><EvidenceList state={s} /></Disclosure>}
      </Panel>
    );
  }
  return (
    <div className="px-3 pb-2">
      <div className="flex items-center justify-between">
        <span className="panel-title">SPX / SPY command center</span>
        {s && <StateBadge tone={MARKET_TONE[s.state]} size="lg">{s.state}</StateBadge>}
      </div>
      <div className="mt-2">{head}</div>
      {lv && (
        <div className="mt-2 grid grid-cols-4 gap-x-2 gap-y-1.5 rounded-md bg-bg-elevated/60 p-2">
          <Stat label="VWAP" size="sm" tone="warn">{fmt$(snap.spy?.vwap)}</Stat>
          <Stat label="Opening range" size="sm">{lv.openingRangeLow !== null ? `${fmt$(lv.openingRangeLow)} – ${fmt$(lv.openingRangeHigh)}` : "—"}</Stat>
          <Stat label="Overnight H / L" size="sm">{lv.overnightHigh !== null ? `${fmt$(lv.overnightHigh)} / ${fmt$(lv.overnightLow)}` : "—"}</Stat>
          <Stat label="Premarket H / L" size="sm">{lv.premarketHigh !== null ? `${fmt$(lv.premarketHigh)} / ${fmt$(lv.premarketLow)}` : "—"}</Stat>
          <Stat label="Prev day H / L" size="sm">{lv.prevHigh !== null ? `${fmt$(lv.prevHigh)} / ${fmt$(lv.prevLow)}` : "—"}</Stat>
          <Stat label="Today H / L" size="sm">{lv.todayHigh !== null ? `${fmt$(lv.todayHigh)} / ${fmt$(lv.todayLow)}` : "—"}</Stat>
          <Stat label="Major support" size="sm" tone="bull">{snap.spy?.support.length ? snap.spy.support.map((p) => p.toFixed(2)).join(" · ") : "—"}</Stat>
          <Stat label="Major resistance" size="sm" tone="bear">{snap.spy?.resistance.length ? snap.spy.resistance.map((p) => p.toFixed(2)).join(" · ") : "—"}</Stat>
        </div>
      )}
      {s && <div className="mt-2 rounded-md bg-bg-elevated/60 p-2"><EvidenceList state={s} /></div>}
      <div className="mt-1 text-2xs text-ink-faint">SPY levels in ETF dollars. {snap.notes.join(" ")} Market internals, TICK and options positioning are not available from the current data provider.</div>
    </div>
  );
}
