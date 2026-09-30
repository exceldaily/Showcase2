"use client";

// Trade Command Panel: the decision center. Top to bottom it answers, in
// order, the eight things a trader needs in two seconds: is there a trade,
// which way, is it confirmed, what has to happen first, where it is wrong,
// where the targets are, whether volume supports it, whether the market
// does. Everything else is still here, folded away until asked for.

import { useMemo } from "react";
import type { OptionsAnalysis, RankedContract } from "@/lib/optionsTerminal";
import type { DecisionRead, FinalCall } from "@/lib/decision/lifecycle";
import { volumeState, vwapState } from "@/lib/decision/lifecycle";
import type { MyTrade } from "@/lib/positionCoach";
import type { SetupTf } from "@/lib/multiTimeframe";
import { fmt$, pct, expiryLabel, contractLabel } from "@/lib/ui/format";
import { roomTone, signTone, trendTone, TONE_TEXT, TONE_CHIP, type Tone } from "@/lib/ui/tone";
import type { Quote } from "@/components/options/types";
import { Chip, Disclosure, KV, Stat } from "@/components/ui/primitives";
import MyTradePanel from "@/components/options/MyTradePanel";
import TimeframeMatrix from "./TimeframeMatrix";
import MarketPanel, { EvidenceList, MARKET_TONE } from "./MarketPanel";
import type { MarketSnapshot } from "@/lib/marketStateLive";
import type { MarketState } from "@/lib/marketState";
import { SKIP_REASONS } from "@/lib/journal/types";
import Link from "next/link";
import type { NewsFeedItem } from "./useFeeds";
import { etClock } from "@/lib/ui/format";
import type { ChartTf } from "@/components/options/types";
import { BestContractCard } from "@/components/options/OptionsPanels";
import { Check, Minus, X } from "lucide-react";

const CALL_TONE: Record<FinalCall, Tone> = { CALL: "bull", PUT: "bear", WAIT: "warn", "NO TRADE": "muted", "DO NOT CHASE": "warn", MANAGE: "mine" };
const STATE_TONE: Record<string, Tone> = {
  "NO SETUP": "faint", WATCHING: "muted", APPROACHING: "warn", TESTING: "warn", "BREAK ATTEMPT": "brand", "BREAKOUT CONFIRMED": "bull",
  "FAILED BREAKOUT": "bear", "TARGET REACHED": "bull", "SESSION OVER": "faint",
};
const QUALITY_TONE: Record<string, Tone> = { Strong: "bull", Moderate: "warn", Weak: "bear" };

function Big({ label, value, tone = "ink", hint }: { label: string; value: string; tone?: Tone; hint?: string }) {
  return (
    <div className="rounded-md bg-bg-elevated/70 px-2.5 py-2" data-tip={hint}>
      <div className="text-2xs font-semibold uppercase tracking-[0.12em] text-ink-faint">{label}</div>
      <div className={`num mt-0.5 text-[26px] font-semibold leading-none tracking-tight ${TONE_TEXT[tone]}`}>{value}</div>
    </div>
  );
}

export default function TradeCommandPanel({
  analysis, quote, decision, myTrade, onTradeChange, isOwner, onRepick, onTicket, onCompare, chartTf, onSelectChartTf, onPlan, market, tickerState, onSkip, focus = false, news,
}: {
  analysis: OptionsAnalysis;
  quote: Quote | null;
  decision: DecisionRead;
  myTrade: MyTrade | null;
  onTradeChange: (t: MyTrade | null) => void;
  isOwner: boolean;
  onRepick: () => void;
  onTicket: (c: RankedContract) => void;
  onCompare: (symbol: string) => void;
  setupTf: SetupTf;
  onSelectTf: (tf: SetupTf) => void;
  chartTf: ChartTf;
  onSelectChartTf: (tf: ChartTf) => void;
  onPlan: (c: RankedContract) => void;
  market: MarketSnapshot | null;
  tickerState: MarketState | null;
  onSkip: (reason: string) => void;
  focus?: boolean;
  news?: { items: NewsFeedItem[]; refreshedAt: string | null; sourcesOk: number | null; note: string | null; loading: boolean };
}) {
  const q = quote && quote.symbol === analysis.symbol && quote.price !== null ? quote : null;
  const price = q?.price ?? analysis.price;
  const prevClose = q?.prevClose ?? analysis.prevClose;
  const change = price !== null && prevClose ? ((price - prevClose) / prevClose) * 100 : analysis.changePct;
  const plan = analysis.plan;
  const read = analysis.read;
  const up = analysis.direction === "long";
  const vol = volumeState(analysis.rvol);
  const vw = vwapState(price, analysis.vwap);
  const rr = plan?.rewardToTargets[0]?.rr ?? null;
  const daily = analysis.setups.find((s) => s.tf === "D")?.trend ?? null;
  const favored = up ? "call" : "put";
  const best = analysis.sides[favored].best;
  const distPct = plan && price !== null ? ((plan.trigger - price) / price) * 100 : null;
  const isIndex = analysis.indexMode !== null || ["SPY", "QQQ"].includes(analysis.symbol);
  const triggerZone = useMemo(() => (plan ? analysis.zones.find((z) => Math.abs(z.price - plan.trigger) / plan.trigger < 0.0015) ?? null : null), [analysis.zones, plan]);
  const quality = read?.quality ?? null;
  const state = read?.state ?? (plan ? "WATCHING" : "NO SETUP");
  const call = decision.call;
  // Warnings: the engine's own, then any no-trade rule that is holding the call back.
  const warnings = useMemo(() => {
    const out = [...(read?.warnings ?? [])];
    for (const b of decision.blockers) {
      if (b.key === "closed" || b.key === "no-level") continue;
      if (b.key === "choppy" && read?.chop.chop) continue;
      if (b.key === "volume" && out.some((w) => /Volume is light/.test(w))) continue;
      out.push(`${b.reason}.`);
    }
    return out;
  }, [read, decision.blockers]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      {/* Symbol and price */}
      <div className="flex items-baseline justify-between gap-2 px-3 pt-2.5">
        <span className="font-mono text-xl font-semibold tracking-tight">{analysis.symbol}</span>
        <span className="flex items-baseline gap-2">
          <span className="num text-lg font-medium">{fmt$(price)}</span>
          <span className={`num text-sm ${TONE_TEXT[signTone(change)]}`}>{pct(change)}</span>
        </span>
      </div>

      {/* 1. The decision */}
      <div className="px-3 pt-2">
        <div className={`rounded-lg px-3 py-2.5 ${TONE_CHIP[CALL_TONE[call]]}`}>
          <div className="text-[34px] font-bold leading-none tracking-tight">{call}</div>
          <div className="mt-1.5 text-sm font-medium text-ink">{decision.verdictReason ? decision.verdictReason.charAt(0).toUpperCase() + decision.verdictReason.slice(1) : " "}</div>
        </div>
        <div className="mt-2.5 grid grid-cols-[1.35fr_1fr_1.1fr] gap-x-2">
          <div>
            <Stat label="Setup" size="sm" tone={plan ? (up ? "bull" : "bear") : "faint"}>{read?.setup ?? decision.setup}</Stat>
            {read?.premarket && <div className="text-2xs font-semibold uppercase tracking-wide text-warn">Premarket</div>}
          </div>
          <Stat label="Quality" size="sm" tone={quality ? QUALITY_TONE[quality.label] : "faint"} hint="Setup score: how much lines up, with price structure weighted heaviest. It is a score, not a probability. Measured results are on the Signals page.">
            {quality ? <>{quality.label} <span className="text-xs text-ink-faint">{quality.score}</span></> : "—"}
          </Stat>
          <div>
            <Stat label="State" size="sm" tone={STATE_TONE[state] ?? "muted"}>{state === "BREAKOUT CONFIRMED" ? (up ? "CONFIRMED" : "CONFIRMED") : state}</Stat>
            {read?.stateDetail && <div className="text-2xs text-ink-faint">{read.stateDetail}</div>}
          </div>
        </div>
      </div>

      {/* 2. The four numbers */}
      <div className="mt-2.5 px-3">
        {plan ? (
          <div className="grid grid-cols-2 gap-1.5">
            <Big label="Trigger" value={fmt$(plan.trigger)} hint={`Level that must break on a closed 5-minute candle${distPct !== null ? `. ${Math.abs(distPct).toFixed(2)}% from the last print.` : ""}`} />
            <Big label="Invalid" value={fmt$(plan.invalidation)} tone="bear" hint="A 5-minute close through here means the idea is wrong" />
            <Big label="Target" value={fmt$(plan.targets[0])} tone="brand" hint={`Target 1. Then ${plan.targets.slice(1).map((t) => fmt$(t)).join(" and ")}.`} />
            <Big label="R:R" value={rr !== null ? rr.toFixed(1) : "—"} tone={rr === null ? "faint" : rr >= 2 ? "bull" : rr >= 1.5 ? "warn" : "bear"} hint="Reward to target 1 over the risk to the invalidation" />
          </div>
        ) : (
          <div className="rounded-md bg-bg-elevated/60 p-2.5 text-sm text-ink-muted">No clean level to trade against right now. Nothing to plan around yet.</div>
        )}
      </div>

      {/* 3. Why */}
      {read && read.why.length > 0 && (
        <div className="mt-3 px-3">
          <div className="panel-title mb-1">Why</div>
          <ul className="space-y-1">
            {read.why.map((w, i) => (
              <li key={i} className="flex items-start gap-2 text-sm leading-snug">
                <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm ${w.ok === true ? "bg-bull/15 text-bull" : w.ok === false ? "bg-bear/15 text-bear" : "bg-bg-elevated text-ink-faint"}`}>
                  {w.ok === true ? <Check size={11} strokeWidth={3} /> : w.ok === false ? <X size={11} strokeWidth={3} /> : <Minus size={11} strokeWidth={3} />}
                </span>
                <span className={w.ok === false ? "text-ink" : w.ok === true ? "text-ink" : "text-ink-muted"}>{w.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 4. Waiting for */}
      {decision.needs.length > 0 && call !== "MANAGE" && (
        <div className="mt-3 px-3">
          <div className="panel-title mb-1">Waiting for</div>
          <ul className="space-y-1">
            {decision.needs.map((n, i) => (
              <li key={i} className="flex gap-2 text-sm leading-snug text-ink"><span className="num text-ink-faint">{i + 1}</span>{n}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 5. Warning */}
      {warnings.length > 0 && (
        <div className="mt-3 px-3">
          <div className="rounded-md bg-warn/10 px-2.5 py-2">
            <div className="text-2xs font-semibold uppercase tracking-[0.12em] text-warn">Warning</div>
            <ul className="mt-1 space-y-1 text-sm leading-snug text-ink">
              {warnings.slice(0, 3).map((w, i) => <li key={i}>{w}</li>)}
            </ul>
            {warnings.length > 3 && (
              <details className="mt-1">
                <summary className="cursor-pointer text-xs text-ink-muted hover:text-ink">{warnings.length - 3} more</summary>
                <ul className="mt-1 space-y-1 text-sm leading-snug text-ink-muted">
                  {warnings.slice(3).map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </details>
            )}
          </div>
        </div>
      )}

      {focus && (
        <div className="mt-3">
          <MyTradePanel analysis={analysis} trade={myTrade} onChange={onTradeChange} isOwner={isOwner} onRepick={onRepick} />
          <div className="px-3 pt-2 text-2xs text-ink-faint">Focus mode hides everything but the decision. Press F to bring the rest back.</div>
        </div>
      )}
      {!focus && <>
      {/* Best contract: one line, the full card on demand */}
      <div className="mt-3 px-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="panel-title">Best {favored}</span>
          {best && <span className="text-xs text-ink-faint">{expiryLabel(best.expiry, best.dte)}{best.dte <= 0 ? " (0DTE)" : ""}</span>}
        </div>
        <BestContractCard analysis={analysis} side={favored} onTicket={onTicket} onCompare={onCompare} canTicket={isOwner && !analysis.indexMode} onPlan={onPlan} />
      </div>

      {(myTrade || call === "CALL" || call === "PUT" || call === "MANAGE") && (
        <div className="mt-3">
          <MyTradePanel analysis={analysis} trade={myTrade} onChange={onTradeChange} isOwner={isOwner} onRepick={onRepick} />
        </div>
      )}

      {/* Everything else, folded */}
      <div className="mt-3 space-y-1.5 px-3">
        {quality && (
          <Disclosure title={`Setup score ${quality.score} (${quality.label})`} count={quality.categories.length}>
            <div className="space-y-1">
              {quality.categories.map((c) => (
                <div key={c.key}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-ink-muted">{c.name} <span className="text-2xs text-ink-faint">weight {c.weight}</span></span>
                    <span className={`num ${c.score === null ? "text-ink-faint" : c.score >= 65 ? "text-bull" : c.score < 35 ? "text-bear" : "text-ink"}`}>{c.score === null ? "not measured" : `${c.score} / 100`}</span>
                  </div>
                  <div className="text-xs text-ink-faint">{c.detail}</div>
                </div>
              ))}
              {quality.caps.length > 0 && (
                <div className="pt-1 text-xs text-warn">Held down by: {quality.caps.join("; ")}.</div>
              )}
              <div className="pt-1 text-2xs text-ink-faint">Six categories, one score each, so stacking indicators from one category cannot inflate the total. Structure weighs most. This is a score, not a win rate: see <Link href="/signals" className="underline decoration-dotted hover:text-ink">Signals</Link> for measured results.</div>
            </div>
          </Disclosure>
        )}
        {read?.breakout && plan && (
          <Disclosure title="Breakout checklist" count={read.breakout.checks.length}>
            <ul className="space-y-1">
              {read.breakout.checks.map((c) => (
                <li key={c.key} className="flex items-start gap-2 text-sm">
                  <span className={`mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${c.pass === true ? "bg-bull" : c.pass === false ? "bg-bear" : "bg-ink-faint"}`} />
                  <span><span className={c.pass === true ? "text-ink" : "text-ink-muted"}>{c.name}</span><span className="block text-xs text-ink-faint">{c.detail}</span></span>
                </li>
              ))}
            </ul>
            <div className="mt-1 text-2xs text-ink-faint">A level cross alone is a break attempt. It is confirmed only after a closed candle beyond the level with volume, followed by a follow-through candle or a retest that holds.</div>
          </Disclosure>
        )}
        {read && (
          <Disclosure title={`Bias ${read.bias.bias}${read.chop.chop ? " · CHOP" : ""}`} count={read.chop.signals.length || undefined}>
            <div className="space-y-1 text-sm">
              <KV k="Held bias" v={read.bias.bias} tone={read.bias.bias === "BULLISH" ? "bull" : read.bias.bias === "BEARISH" ? "bear" : "muted"} hint="Changes side only on sustained reads, or sooner when the price structure has turned" />
              <KV k="Latest momentum" v={read.bias.momentum} tone={read.bias.momentum === "BULLISH" ? "bull" : read.bias.momentum === "BEARISH" ? "bear" : "muted"} />
              {read.bias.note && <div className="text-xs text-ink-muted">{read.bias.note}.</div>}
              <KV k="Chop score" v={read.chop.measured ? `${read.chop.score} (chop at 50)` : "too early to judge"} tone={read.chop.chop ? "warn" : "ink"} />
              {read.chop.signals.length > 0 && <ul className="text-xs text-ink-faint">{read.chop.signals.map((s) => <li key={s.key}>• {s.text}</li>)}</ul>}
            </div>
          </Disclosure>
        )}
        <Disclosure title="Volume, VWAP, room, market">
          <div className="grid grid-cols-3 gap-x-2 gap-y-2">
            <Stat label="Volume" size="sm" tone={vol.tone} hint={analysis.rvolBasis ? (analysis.rvolBasis.method === "same-time" ? `Today's volume ${analysis.rvolBasis.window} against the average for that same window over the last ${analysis.rvolBasis.sessions} sessions` : `Estimate from a volume curve (${analysis.rvolBasis.window}); the like-for-like history has not loaded yet`) : "Relative volume for this time of day"}>{vol.label}{analysis.rvol !== null ? <span className="ml-1 text-xs text-ink-faint">{analysis.rvol.toFixed(2)}x</span> : null}</Stat>
            <Stat label="VWAP" size="sm" tone={vw.label === "ABOVE" ? "bull" : vw.label === "BELOW" ? "bear" : "muted"} hint="Price versus the session VWAP">{vw.label}{vw.pct !== null ? <span className="ml-1 text-xs text-ink-faint">{pct(vw.pct)}</span> : null}</Stat>
            <Stat label="Room" size="sm" tone={roomTone(analysis.room?.grade)} hint={analysis.room?.note}>{analysis.room?.grade ?? "—"}</Stat>
            <div className="col-span-3 flex flex-wrap gap-1.5 text-xs">
              {read?.market.legs.map((l) => <Chip key={l.symbol} tone={l.with === true ? "bull" : l.with === false ? "bear" : "faint"} title={l.detail}>{l.symbol} {l.with === true ? "with" : l.with === false ? "against" : "n/a"}</Chip>)}
              {market?.state && <Chip tone={MARKET_TONE[market.state.state]} title="Broad market state (SPY tape, QQQ, VIX, breadth)">MKT {market.state.state}</Chip>}
              <Chip tone={signTone(analysis.context.spy)}>SPY {pct(analysis.context.spy)}</Chip>
              <Chip tone={signTone(analysis.context.qqq)}>QQQ {pct(analysis.context.qqq)}</Chip>
              {daily && <Chip tone={trendTone(daily)}>Daily {daily}</Chip>}
              {analysis.lock && <Chip tone="faint" title={`Level locked ${new Date(analysis.lock.pickedAt).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })} ET`}>LOCKED</Chip>}
            </div>
            {plan && plan.targets.length > 1 && (
              <div className="col-span-3 grid grid-cols-3 gap-x-2">
                {plan.targets.map((t, i) => <Stat key={i} label={`Target ${i + 1}`} tone="brand" size="sm">{fmt$(t)} <span className="text-2xs text-ink-faint">{plan.rewardToTargets[i] ? `${plan.rewardToTargets[i].rr.toFixed(1)}R` : ""}</span></Stat>)}
              </div>
            )}
          </div>
        </Disclosure>
        {isIndex && <Disclosure title="Market"><MarketPanel snap={market} expanded /></Disclosure>}
        <Disclosure title="Timeframes" count={analysis.matrix.length}>
          <div className="-mx-2"><TimeframeMatrix rows={analysis.matrix} align={analysis.align} selected={chartTf} onSelect={onSelectChartTf} /></div>
        </Disclosure>
        {tickerState && (
          <Disclosure title={`Evidence: ${tickerState.state}`} count={tickerState.evidenceFor.length + tickerState.evidenceAgainst.length}>
            <EvidenceList state={tickerState} />
          </Disclosure>
        )}
        <Disclosure title="Why this level" count={(triggerZone?.reasons.length ?? 0) + (analysis.trend?.signals.length ?? 0)}>
          {triggerZone && (
            <div className="mb-2">
              <div className="stat-label">Level {fmt$(triggerZone.price)} · strength {triggerZone.strength}</div>
              <ul className="mt-0.5 space-y-0.5 text-ink-muted">
                {triggerZone.reasons.slice(0, 5).map((r, i) => <li key={i}>• {r}</li>)}
                {triggerZone.timeframes.length > 0 && <li className="text-ink-faint">seen on {triggerZone.timeframes.join(", ")}</li>}
              </ul>
            </div>
          )}
          {analysis.trend && (
            <div>
              <div className="stat-label">Indicator read, this instant ({analysis.trend.label})</div>
              <ul className="mt-0.5 space-y-0.5">
                {analysis.trend.signals.map((s, i) => (
                  <li key={i} className="flex gap-1.5">
                    <span className={s.dir === "bull" ? "text-bull" : s.dir === "bear" ? "text-bear" : "text-ink-faint"}>{s.dir === "bull" ? "▲" : s.dir === "bear" ? "▼" : "■"}</span>
                    <span className="text-ink">{s.name}</span>
                    <span className="text-ink-faint">{s.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Disclosure>
        {news && (
          <Disclosure title="News" count={news.items.length}>
            {news.loading && news.items.length === 0 && <div className="text-xs text-ink-faint">Fetching feeds…</div>}
            {!news.loading && news.items.length === 0 && <div className="text-xs text-ink-faint">NO HEADLINES FOUND{news.note ? ` · ${news.note}` : ""}</div>}
            <ul className="space-y-1">
              {news.items.slice(0, 12).map((n) => (
                <li key={n.url} className="text-xs leading-snug">
                  <a href={n.url} target="_blank" rel="noreferrer" className="text-ink hover:text-brand-glow">{n.title}</a>
                  <div className="flex flex-wrap items-center gap-1.5 text-2xs text-ink-faint">
                    <span className={n.tier === 1 ? "text-bull" : n.tier === 2 ? "text-ink-muted" : ""}>{n.publisher ?? n.source}</span>
                    {n.publishedAt && <span>{ageOf(n.publishedAt)}</span>}
                    {!n.direct && <span className="text-ink-faint/70">related</span>}
                    {n.tags.map((t) => <Chip key={t} tone={t === "FILING" || t === "EARNINGS" ? "warn" : "faint"} className="!px-1 !py-0 text-2xs">{t}</Chip>)}
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-1 text-2xs text-ink-faint">Publishers' own feeds (Yahoo Finance, Google News, SEC EDGAR), refreshed every 10 minutes{news.refreshedAt ? `, last ${etClock(news.refreshedAt)} ET` : ""}. Headlines only, no summaries or sentiment are generated.</div>
          </Disclosure>
        )}
        <Disclosure title={`Against the bias: best ${favored === "call" ? "put" : "call"}`}>
          <BestContractCard analysis={analysis} side={favored === "call" ? "put" : "call"} onTicket={onTicket} onCompare={onCompare} canTicket={isOwner && !analysis.indexMode} />
        </Disclosure>
        {!(myTrade || call === "CALL" || call === "PUT" || call === "MANAGE") && (
          <Disclosure title="My trade">
            <div className="-mx-2"><MyTradePanel analysis={analysis} trade={myTrade} onChange={onTradeChange} isOwner={isOwner} onRepick={onRepick} /></div>
          </Disclosure>
        )}
      </div>

      {plan && !myTrade && (
        <div className="mt-2 flex items-center gap-2 px-3">
          <select defaultValue="" onChange={(e) => { if (e.target.value) { onSkip(e.target.value); e.target.value = ""; } }} className="select py-0.5 text-xs" title="Log this setup as skipped; the journal tracks whether it would have worked">
            <option value="" disabled>Skip this setup because…</option>
            {SKIP_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <Link href="/journal" className="btn-quiet btn-sm">Journal</Link>
          <Link href="/signals" className="btn-quiet btn-sm">Signals</Link>
        </div>
      )}
      </>}
      {!focus && <div className="px-3 pb-3 pt-2 text-2xs text-ink-faint">
        {best ? `Best ${favored}: ${contractLabel(best.strike, best.side, analysis.symbol)} ${expiryLabel(best.expiry, best.dte)}, ${fmt$(best.mid * 100, 0)} per contract.` : ""} Estimates, not predictions. Options can lose their entire premium.
      </div>}
    </div>
  );
}

function ageOf(iso: string): string {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60e3));
  return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`;
}
