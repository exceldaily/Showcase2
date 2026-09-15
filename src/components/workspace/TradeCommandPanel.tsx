"use client";

// Trade Command Panel: the decision surface. Everything that matters
// is visible without scrolling, as structured facts rather than prose:
// bias, setup, status, trigger, confirmation, invalidation, targets,
// risk/reward, confidence, volume, VWAP, market trend, then the best
// contract, the trader's own position, the timeframe table and the
// deeper "why" and "what still needs to happen" folds.

import { useMemo } from "react";
import type { OptionsAnalysis, RankedContract } from "@/lib/optionsTerminal";
import type { DecisionRead } from "@/lib/decision/lifecycle";
import { volumeState, vwapState } from "@/lib/decision/lifecycle";
import type { MyTrade } from "@/lib/positionCoach";
import type { SetupTf } from "@/lib/multiTimeframe";
import { fmt$, pct, expiryLabel, contractLabel } from "@/lib/ui/format";
import { roomTone, scoreTone, signTone, trendTone, TONE_TEXT, type Tone } from "@/lib/ui/tone";
import type { Quote } from "@/components/options/types";
import { Chip, Disclosure, KV, Stat, StateBadge } from "@/components/ui/primitives";
import { LIFECYCLE_TONE } from "./CommandBar";
import MyTradePanel from "@/components/options/MyTradePanel";
import SetupsPanel from "@/components/options/SetupsPanel";
import { BestContractCard } from "@/components/options/OptionsPanels";

const BIAS_TONE: Record<DecisionRead["bias"], Tone> = { BULLISH: "bull", BEARISH: "bear", NEUTRAL: "muted" };
const VERDICT_TONE: Record<DecisionRead["verdict"], Tone> = { TRADE: "bull", WAIT: "warn", "NO TRADE": "bear", MANAGE: "mine" };

export default function TradeCommandPanel({
  analysis, quote, decision, myTrade, onTradeChange, isOwner, onRepick, onTicket, onCompare, setupTf, onSelectTf,
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
}) {
  const q = quote && quote.symbol === analysis.symbol && quote.price !== null ? quote : null;
  const price = q?.price ?? analysis.price;
  const prevClose = q?.prevClose ?? analysis.prevClose;
  const change = price !== null && prevClose ? ((price - prevClose) / prevClose) * 100 : analysis.changePct;
  const plan = analysis.plan;
  const up = analysis.direction === "long";
  const vol = volumeState(analysis.rvol);
  const vw = vwapState(price, analysis.vwap);
  const rr = plan?.rewardToTargets[0]?.rr ?? null;
  const daily = analysis.setups.find((s) => s.tf === "D")?.trend ?? null;
  const favored = up ? "call" : "put";
  const best = analysis.sides[favored].best;
  const distPct = plan && price !== null ? ((plan.trigger - price) / price) * 100 : null;
  const triggerZone = useMemo(() => (plan ? analysis.zones.find((z) => Math.abs(z.price - plan.trigger) / plan.trigger < 0.0015) ?? null : null), [analysis.zones, plan]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      {/* Header block: symbol, price, bias, setup, status */}
      <div className="px-3 pt-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-mono text-2xl font-semibold tracking-tight">{analysis.symbol}</span>
          <span className="flex items-baseline gap-2">
            <span className="num text-xl font-medium">{fmt$(price)}</span>
            <span className={`num text-md ${TONE_TEXT[signTone(change)]}`}>{pct(change)}</span>
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <StateBadge tone={BIAS_TONE[decision.bias]} size="lg" detail={decision.biasNote ?? (decision.biasStrength !== "NONE" ? decision.biasStrength.toLowerCase() : null)}>{decision.bias} BIAS</StateBadge>
          <StateBadge tone={VERDICT_TONE[decision.verdict]} size="lg" detail={decision.verdictReason}>{decision.verdict}</StateBadge>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
          <Stat label="Setup" size="sm">{decision.setup}</Stat>
          <div>
            <Stat label="Status" size="sm" tone={LIFECYCLE_TONE[decision.lifecycle]}>{decision.lifecycle}</Stat>
            {decision.lifecycleDetail && <div className="text-2xs text-ink-faint">{decision.lifecycleDetail}</div>}
          </div>
          <div className="col-span-2">
            <div className="stat-label">Entry</div>
            <div className={`text-sm font-semibold ${TONE_TEXT[decision.verdict === "TRADE" ? "bull" : decision.verdict === "MANAGE" ? "mine" : "warn"]}`}>{decision.entry}</div>
          </div>
        </div>
      </div>

      {/* Plan block */}
      <div className="mt-3 px-3">
        {plan ? (
          <div className="rounded-md bg-bg-elevated/60 p-2.5">
            <div className="grid grid-cols-3 gap-x-2 gap-y-2">
              <Stat label="Trigger" tone="ink" hint="Level that must break on a 5-minute close">{fmt$(plan.trigger)}</Stat>
              <Stat label="Distance" tone={distPct !== null && Math.abs(distPct) < 0.25 ? "warn" : "muted"} size="sm" hint="From the last print to the trigger">{distPct !== null ? pct(distPct) : "—"}</Stat>
              <Stat label="Invalidation" tone="bear" hint="A 5-minute close through here means the idea is wrong">{fmt$(plan.invalidation)}</Stat>
              {plan.targets.map((t, i) => (
                <Stat key={i} label={`Target ${i + 1}`} tone="brand" size="sm" hint={`${plan.rewardToTargets[i]?.rr.toFixed(1) ?? "—"}R from the trigger`}>{fmt$(t)} <span className="text-2xs text-ink-faint">{plan.rewardToTargets[i] ? `${plan.rewardToTargets[i].rr.toFixed(1)}R` : ""}</span></Stat>
              ))}
            </div>
            <div className="mt-2.5">
              <div className="stat-label mb-1">Confirmation</div>
              <ul className="space-y-0.5 text-sm">
                {decision.confirmation.map((c, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className={`inline-block h-1.5 w-1.5 rounded-full ${c.met === true ? "bg-bull" : c.met === false ? "bg-bear" : "bg-ink-faint"}`} />
                    <span className={c.met === true ? "text-ink" : c.met === false ? "text-ink-muted" : "text-ink-faint"}>{c.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <div className="rounded-md bg-bg-elevated/60 p-2.5 text-sm text-ink-muted">No meaningful level in the trend direction. Nothing to plan around yet.</div>
        )}
      </div>

      {/* Evidence row */}
      <div className="mt-3 grid grid-cols-3 gap-x-2 gap-y-2 px-3">
        <Stat label="Risk / Reward" size="sm" tone={rr === null ? "faint" : rr >= 2 ? "bull" : rr >= 1.5 ? "warn" : "bear"} hint="Reward to target 1 over risk to invalidation">{rr !== null ? `${rr.toFixed(1)}R` : "—"}</Stat>
        <Stat label="Confidence" size="sm" tone={scoreTone(analysis.opportunity?.total ?? null)} hint="Opportunity score, 0 to 100. Breakdown under Why.">{analysis.opportunity ? `${analysis.opportunity.total}%` : "—"}</Stat>
        <Stat label="Room" size="sm" tone={roomTone(analysis.room?.grade)} hint={analysis.room?.note}>{analysis.room?.grade ?? "—"}</Stat>
        <Stat label="Volume" size="sm" tone={vol.tone} hint="Relative volume for this time of day">{vol.label}{analysis.rvol !== null ? <span className="ml-1 text-xs text-ink-faint">{analysis.rvol.toFixed(2)}x</span> : null}</Stat>
        <Stat label="VWAP" size="sm" tone={vw.label === "ABOVE" ? "bull" : vw.label === "BELOW" ? "bear" : "muted"} hint="Price versus the session VWAP">{vw.label}{vw.pct !== null ? <span className="ml-1 text-xs text-ink-faint">{pct(vw.pct)}</span> : null}</Stat>
        <Stat label="Market" size="sm" tone={trendTone(analysis.trend?.label)} hint="5-minute trend read; daily in small text">
          {analysis.choppy ? "CHOPPY" : analysis.trend ? analysis.trend.label.toUpperCase().replace("SLIGHTLY ", "").replace("STRONGLY ", "") : "—"}
          {daily && <span className={`ml-1 text-xs ${TONE_TEXT[trendTone(daily)]}`}>D {daily.replace("Strong ", "S.").slice(0, 8)}</span>}
        </Stat>
        <div className="col-span-3 flex flex-wrap gap-1.5 text-xs">
          <Chip tone={signTone(analysis.context.spy)}>SPY {pct(analysis.context.spy)}</Chip>
          <Chip tone={signTone(analysis.context.qqq)}>QQQ {pct(analysis.context.qqq)}</Chip>
          {analysis.lock && <Chip tone="faint" title={`Level locked ${new Date(analysis.lock.pickedAt).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })} ET`}>LOCKED</Chip>}
          {analysis.history && analysis.history.stats.confirmed > 0 && (
            <Chip tone={scoreTone(Math.round((analysis.history.stats.t1Hit / analysis.history.stats.confirmed) * 100))} title={`${analysis.history.stats.sessions} sessions: ${analysis.history.stats.confirmed} confirmed breaks, ${analysis.history.stats.t1Hit} reached target 1`}>
              HIST {Math.round((analysis.history.stats.t1Hit / analysis.history.stats.confirmed) * 100)}% T1
            </Chip>
          )}
        </div>
      </div>

      {/* Why / needs */}
      <div className="mt-3 space-y-1.5 px-3">
        {decision.needs.length > 0 && (
          <Disclosure title="What still needs to happen" count={decision.needs.length} defaultOpen tone="warn">
            <ul className="space-y-0.5">
              {decision.needs.map((n, i) => <li key={i} className="flex gap-2 text-ink"><span className="text-ink-faint">{i + 1}.</span>{n}</li>)}
            </ul>
          </Disclosure>
        )}
        <Disclosure title="Why this setup exists" count={(analysis.trend?.signals.length ?? 0) + (triggerZone?.reasons.length ?? 0)}>
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
              <div className="stat-label">Trend signals ({analysis.trend.confidence}/100)</div>
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
          {analysis.opportunity && (
            <div className="mt-2">
              <div className="stat-label">Confidence breakdown</div>
              {analysis.opportunity.parts.map((p, i) => (
                <KV key={i} k={<span title={p.detail}>{p.name}</span>} v={`${p.score} / ${p.max}`} tone={p.max > 0 && p.score / p.max >= 0.7 ? "bull" : p.max > 0 && p.score / p.max < 0.35 ? "bear" : "muted"} />
              ))}
              <KV k="Total" v={`${analysis.opportunity.total} / 100`} tone="ink" />
            </div>
          )}
        </Disclosure>
      </div>

      {/* Best contract */}
      <div className="mt-3 px-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="panel-title">Best {favored}</span>
          {best && <span className="text-xs text-ink-faint">{expiryLabel(best.expiry, best.dte)}{best.dte <= 0 ? " (0DTE)" : ""}</span>}
        </div>
        <BestContractCard analysis={analysis} side={favored} onTicket={onTicket} onCompare={onCompare} canTicket={isOwner && !analysis.indexMode} />
        <details className="mt-1">
          <summary className="cursor-pointer text-xs text-ink-faint hover:text-ink">Against the bias: best {favored === "call" ? "put" : "call"}</summary>
          <div className="mt-1">
            <BestContractCard analysis={analysis} side={favored === "call" ? "put" : "call"} onTicket={onTicket} onCompare={onCompare} canTicket={isOwner && !analysis.indexMode} />
          </div>
        </details>
      </div>

      <div className="mt-3">
        <MyTradePanel analysis={analysis} trade={myTrade} onChange={onTradeChange} isOwner={isOwner} onRepick={onRepick} />
      </div>

      <div className="mt-1">
        <SetupsPanel setups={analysis.setups} selected={setupTf} onSelect={onSelectTf} />
      </div>

      <div className="px-3 pb-3 pt-2 text-2xs text-ink-faint">
        {best ? `Best ${favored}: ${contractLabel(best.strike, best.side, analysis.symbol)} ${expiryLabel(best.expiry, best.dte)}, ${fmt$(best.mid * 100, 0)} per contract.` : ""} Estimates, not predictions. Options can lose their entire premium.
      </div>
    </div>
  );
}
