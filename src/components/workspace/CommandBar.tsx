"use client";

// Top bar: symbol search, the ticker block (symbol, price, change,
// lifecycle state), market phase and data status, scoring profile,
// replay, siren, and the panel toggles.

import { type ReactNode, type RefObject } from "react";
import { PanelLeft, PanelRight, PanelBottom, Search, Sunrise } from "lucide-react";
import type { OptionsAnalysis } from "@/lib/optionsTerminal";
import type { DecisionRead } from "@/lib/decision/lifecycle";
import type { LayoutPrefs, LayoutMode } from "@/lib/layoutPrefs";
import { ALL_SYMBOLS } from "@/lib/universes";
import { fmt$, pct, etClock } from "@/lib/ui/format";
import { dataState, marketPhase } from "@/lib/ui/marketStatus";
import { signTone, TONE_TEXT, type Tone } from "@/lib/ui/tone";
import type { Broker, Quote } from "@/components/options/types";
import { Chip, IconButton, Seg, StateBadge } from "@/components/ui/primitives";

export const LIFECYCLE_TONE: Record<DecisionRead["lifecycle"], Tone> = {
  "NO SETUP": "faint", WATCHING: "muted", APPROACHING: "warn", TRIGGERED: "brand", CONFIRMING: "brand",
  CONFIRMED: "bull", "IN TRADE": "mine", "TARGET HIT": "bull", INVALIDATED: "bear", EXPIRED: "faint",
};

const PROFILES: [string, string][] = [["DAY", "0-1 DTE (same day)"], ["SCALP", "Scalp"], ["AGGRESSIVE", "Aggressive"], ["BALANCED", "Balanced (3-30 DTE)"], ["CONSERVATIVE", "Conservative"]];
const MODES: { key: LayoutMode; label: string; title: string }[] = [
  { key: "COMMAND", label: "Command", title: "Scanner, chart, panel, chain" },
  { key: "CHART", label: "Chart", title: "Chart and Trade Command Panel" },
  { key: "SCANNER", label: "Scanner", title: "Scanner and chart" },
  { key: "OPTIONS", label: "Options", title: "Chart, panel and the full chain" },
  { key: "JOURNAL", label: "Journal", title: "Trades, skipped setups and statistics" },
];

export default function CommandBar({
  searchRef, searchText, setSearchText, onSearch, analysis, quote, decision, broker, profile, setProfile, replayAt, setReplayAt,
  layout, setLayout, siren, error, nextEvent = null, eventBuffer = 15,
}: {
  searchRef: RefObject<HTMLInputElement>;
  searchText: string; setSearchText: (s: string) => void; onSearch: () => void;
  analysis: OptionsAnalysis | null; quote: Quote | null; decision: DecisionRead | null; broker: Broker | null;
  profile: string; setProfile: (p: string) => void;
  replayAt: string; setReplayAt: (s: string) => void;
  layout: LayoutPrefs; setLayout: (fn: (p: LayoutPrefs) => LayoutPrefs) => void;
  siren: ReactNode;
  error: string | null;
  nextEvent?: { minutes: number; title: string } | null;
  eventBuffer?: number;
}) {
  const q = quote && analysis && quote.symbol === analysis.symbol && quote.price !== null ? quote : null;
  const nowPrice = q?.price ?? analysis?.price ?? null;
  const prevClose = q?.prevClose ?? analysis?.prevClose ?? null;
  const nowChange = nowPrice !== null && prevClose ? ((nowPrice - prevClose) / prevClose) * 100 : analysis?.changePct ?? null;
  const phase = marketPhase(analysis?.session);
  const data = analysis
    ? dataState({ connected: analysis.connected, error: error !== null, analysisStale: analysis.dataStale, delayed: analysis.indexMode !== null, quoteTs: q?.tradeTs ?? null, session: analysis.session, nowMs: Date.now() })
    : error ? "DISCONNECTED" : "LIVE";
  const dataTone: Tone = data === "LIVE" ? "bull" : data === "DELAYED" ? "warn" : data === "STALE" ? "warn" : "bear";
  const live = decision ? ["APPROACHING", "TRIGGERED", "CONFIRMING", "CONFIRMED", "IN TRADE"].includes(decision.lifecycle) : false;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 bg-bg-panel px-3 py-1.5">
      <form onSubmit={(e) => { e.preventDefault(); onSearch(); }} className="flex items-center gap-1">
        <Search size={13} className="text-ink-faint" />
        <input
          ref={searchRef}
          value={searchText}
          // Keep the raw value: rewriting it (uppercasing) while an Android
          // keyboard is mid-composition makes letters double.
          onChange={(e) => setSearchText(e.target.value)}
          className="input w-24 font-mono uppercase"
          placeholder="NVDA"
          maxLength={6}
          title="Search ( / )"
          autoCapitalize="characters" autoCorrect="off" autoComplete="off" spellCheck={false} enterKeyHint="go"
          list="af-symbols"
        />
        <datalist id="af-symbols">{ALL_SYMBOLS.map((sym) => <option key={sym} value={sym} />)}</datalist>
      </form>

      {analysis && (
        <div className="flex items-center gap-3">
          <span className="font-mono text-xl font-semibold tracking-tight text-ink">{analysis.symbol}</span>
          <span className="num text-xl font-medium text-ink" title={q?.tradeTs ? `Last print ${etClock(q.tradeTs, true)} ET` : "From the last analysis refresh"}>{fmt$(nowPrice)}</span>
          <span className={`num text-md font-medium ${TONE_TEXT[signTone(nowChange)]}`}>{pct(nowChange)}</span>
          {decision && <StateBadge tone={LIFECYCLE_TONE[decision.lifecycle]} detail={decision.lifecycleDetail} live={live}>{decision.lifecycle}</StateBadge>}
          {analysis.indexMode && <Chip tone="warn" title={`Index mode: ${analysis.indexMode.proxy} x ${analysis.indexMode.ratio}. Options quotes delayed about 15 minutes.`}>INDEX via {analysis.indexMode.proxy}</Chip>}
        </div>
      )}

      <div className="flex items-center gap-1.5">
        <Chip tone={phase === "MARKET OPEN" ? "bull" : phase === "MARKET CLOSED" ? "faint" : "warn"} dot>{phase}</Chip>
        <Chip tone={dataTone} title={data === "DELAYED" ? "Index options from CBOE are delayed about 15 minutes" : data === "STALE" ? "Last print is older than expected" : data === "DISCONNECTED" ? "Analysis is not updating" : "Live SIP / OPRA feed"}>{data}</Chip>
        {broker && <Chip tone={broker.paper === false ? "bear" : "muted"} title="Broker mode. Paper account, no live execution.">{broker.paper === false ? "LIVE" : "PAPER"}</Chip>}
        {nextEvent && nextEvent.minutes <= 90 && <Chip tone={nextEvent.minutes <= eventBuffer ? "bear" : "warn"} dot title={`${nextEvent.title}. No new entries inside ${eventBuffer} minutes.`}>{nextEvent.title.slice(0, 28)} in {nextEvent.minutes}m</Chip>}
      </div>

      <span className="ml-auto flex flex-wrap items-center gap-2">
        {siren}
        <select value={profile} onChange={(e) => setProfile(e.target.value)} className="select py-0.5 text-xs" title="Contract scoring profile">
          {PROFILES.map(([p, label]) => <option key={p} value={p}>{label}</option>)}
        </select>
        <label className="flex items-center gap-1 text-xs text-ink-faint" title="Replay the full analysis at a past moment (no lookahead)">
          <input type="datetime-local" value={replayAt} onChange={(e) => setReplayAt(e.target.value)} className="input py-0.5 text-xs" />
          {replayAt && <button onClick={() => setReplayAt("")} className="btn-quiet btn-sm text-bear" title="Back to live">live</button>}
        </label>
        <Seg value={layout.mode} onChange={(m) => setLayout((p) => ({ ...p, mode: m }))} options={MODES.map((m) => ({ key: m.key, label: m.label, title: m.title }))} />
        <span className="flex items-center gap-0.5">
          <IconButton title="Today's watch" on={layout.watch} onClick={() => setLayout((p) => ({ ...p, watch: !p.watch }))}><Sunrise size={13} /></IconButton>
          <IconButton title="Scanner (S)" on={layout.left} onClick={() => setLayout((p) => ({ ...p, left: !p.left }))}><PanelLeft size={13} /></IconButton>
          <IconButton title="Options chain (O)" on={layout.bottom} onClick={() => setLayout((p) => ({ ...p, bottom: !p.bottom }))}><PanelBottom size={13} /></IconButton>
          <IconButton title="Trade Command Panel (P)" on={layout.right} onClick={() => setLayout((p) => ({ ...p, right: !p.right }))}><PanelRight size={13} /></IconButton>
        </span>
      </span>
    </div>
  );
}
