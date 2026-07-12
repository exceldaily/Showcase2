import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { CatalystLevelBadge, DecisionBadge, DirectionBadge, ScoreRing } from "@/components/ScoreBadge";
import { getSetupById } from "@/lib/data";
import { getTickerNews } from "@/lib/news";
import { computePositionSizing } from "@/lib/scoring";

export const dynamic = "force-dynamic";

export default async function SetupPage({ params }: { params: { id: string } }) {
  const setup = await getSetupById(params.id);
  if (!setup) notFound();

  const { plan, scores, smartMoney } = setup;
  const isShort = setup.direction === "Short";
  const sizing = computePositionSizing(100, plan.entryConservative, plan.stopLoss, plan.target2);
  const news = await getTickerNews(setup.ticker, 6);

  return (
    <div className="space-y-6">
      <Link
        href="/scanner"
        className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
      >
        <ArrowLeft size={15} /> Back to scanner
      </Link>

      {/* Header */}
      <div className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold">{setup.ticker}</h1>
              <span className="font-mono text-xl text-ink-muted">${setup.currentPrice}</span>
              <span className="pill bg-bg-hover text-ink-faint" title="Source: Polygon.io daily aggregates">
                {setup.priceLabel}
                {setup.priceAsOf ? ` · ${setup.priceAsOf}` : ""}
              </span>
            </div>
            <p className="text-ink-muted">{setup.company}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <DirectionBadge direction={setup.direction} />
              <span className="pill bg-bg-hover text-ink-muted">{setup.sector}</span>
              <span className="pill bg-bg-hover text-ink-muted">{setup.opportunityType}</span>
              <span className="pill bg-bg-hover text-ink-muted">{setup.setupType}</span>
              <span className="pill bg-bg-hover text-ink-muted">{setup.marketRegime}</span>
            </div>
          </div>
          <div className="flex flex-col items-center gap-2">
            <ScoreRing score={scores.alphaforge} size={84} />
            <span className="text-xs text-ink-muted">AlphaForge Score</span>
            <DecisionBadge decision={setup.decision} />
          </div>
        </div>
      </div>

      {isShort && (
        <div className="card border-bear/30 bg-bear/5 p-4 text-sm">
          <span className="font-semibold text-bear">Short thesis only.</span>{" "}
          <span className="text-ink-muted">
            Current borrow availability, borrow fees, and easy-to-borrow status have not been
            verified (no broker integration yet). Short interest and squeeze-risk data are not
            integrated on the current data plan. Treat this as bearish structure analysis, not an
            executable short order.
          </span>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Trade plan */}
        <div className="card p-6 lg:col-span-2">
          <h2 className="mb-4 font-semibold">Trade Plan</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <PlanCell label="Conservative Entry" value={`$${plan.entryConservative}`} />
            <PlanCell label="Aggressive Entry" value={`$${plan.entryAggressive}`} />
            <PlanCell label="Entry Zone" value={`$${plan.entryZoneLow}–${plan.entryZoneHigh}`} />
            <PlanCell label="Stop Loss" value={`$${plan.stopLoss}`} tone="bear" />
            <PlanCell label="Target 1" value={`$${plan.target1}`} tone="bull" />
            <PlanCell label="Target 2" value={`$${plan.target2}`} tone="bull" />
            <PlanCell label="Target 3" value={`$${plan.target3}`} tone="bull" />
            <PlanCell label="Reward / Risk" value={`${plan.riskReward}:1`} />
            <PlanCell label="Expected Move" value={`+${plan.expectedPctMove}%`} tone="bull" />
            <PlanCell label="Hold Period" value={`~${plan.expectedHoldDays}d`} />
            <PlanCell label="Risk Rating" value={setup.riskRating} />
            <PlanCell label="Confidence" value={`${scores.confidence}%`} />
          </div>
          <div className="mt-4 rounded-lg border border-border bg-bg-elevated p-3 text-sm">
            <span className="font-semibold text-ink">Stop basis:</span>{" "}
            <span className="text-ink-muted">{plan.stopBasis}</span>
          </div>

          {/* Position sizing example */}
          <div className="mt-4 rounded-lg border border-brand/20 bg-brand/5 p-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-glow">
              $100 Position Example
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <PlanCell label="Shares" value={`${sizing.shares}`} />
              <PlanCell label="Max Loss" value={`-$${Math.abs(sizing.maxLoss)}`} tone="bear" />
              <PlanCell label="Expected Gain" value={`+$${sizing.expectedGain}`} tone="bull" />
              <PlanCell label="Risk : Reward" value={`${plan.riskReward}:1`} />
            </div>
          </div>
        </div>

        {/* Score breakdown */}
        <div className="card p-6">
          <h2 className="mb-4 font-semibold">Score Breakdown</h2>
          <ScoreBar label="Catalyst Quality (30%)" value={scores.catalyst} />
          <ScoreBar label="Smart Money (25%)" value={scores.smartMoney} />
          <ScoreBar label="Technical Setup (20%)" value={scores.technical} />
          <ScoreBar label="Sector Strength (15%)" value={scores.sectorStrength} />
          <ScoreBar label="Market Regime (10%)" value={scores.marketRegime} />
        </div>
      </div>

      {/* Target documentation */}
      <div className="card p-6">
        <h2 className="mb-4 font-semibold">How these targets were calculated</h2>
        <div className="space-y-3 text-sm">
          {[
            { label: "Target 1", price: plan.target1, basis: plan.targetBasis1 },
            { label: "Target 2", price: plan.target2, basis: plan.targetBasis2 },
            { label: "Target 3", price: plan.target3, basis: plan.targetBasis3 },
          ].map((t) => (
            <div key={t.label} className="rounded-lg border border-border bg-bg-elevated p-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold">{t.label}</span>
                <span className={`font-mono font-semibold ${isShort ? "text-bear" : "text-bull"}`}>
                  ${t.price}
                </span>
              </div>
              <p className="mt-1 text-ink-muted">
                {t.basis ?? "Risk-multiple target derived from the defined stop distance."}
              </p>
            </div>
          ))}
          <div className="rounded-lg border border-bear/25 bg-bear/5 p-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold">Invalidation (stop)</span>
              <span className="font-mono font-semibold text-bear">${plan.stopLoss}</span>
            </div>
            <p className="mt-1 text-ink-muted">{plan.stopBasis}. A close beyond this level voids the thesis.</p>
          </div>
        </div>
      </div>

      {/* Catalyst */}
      <div className="card p-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-semibold">Catalyst</h2>
          <CatalystLevelBadge level={setup.catalyst.level} />
        </div>
        <p className="font-medium">{setup.catalyst.headline}</p>
        <p className="mt-2 text-sm text-ink-muted">{setup.catalyst.summary}</p>
        <div className="mt-3 flex gap-3 text-xs text-ink-faint">
          <span>{setup.catalyst.source}</span>
          <span>·</span>
          <span>{setup.catalyst.type}</span>
        </div>
      </div>

      {/* News timeline (context only until the Phase 2 catalyst engine scores it) */}
      <div className="card p-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-semibold">Recent news for {setup.ticker}</h2>
          <span className="pill bg-bg-hover text-ink-faint">Context only, not scored yet</span>
        </div>
        {news.length === 0 ? (
          <p className="text-sm text-ink-muted">
            No recent ticker-tagged news returned by the data provider.
          </p>
        ) : (
          <ul className="space-y-3">
            {news.map((n) => (
              <li key={n.url} className="rounded-lg border border-border bg-bg-elevated p-3">
                <a
                  href={n.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-start justify-between gap-3"
                >
                  <span className="text-sm font-medium group-hover:text-brand-glow">
                    {n.headline}
                  </span>
                  <ExternalLink size={14} className="mt-0.5 shrink-0 text-ink-faint" />
                </a>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-faint">
                  <span className="pill bg-bg-hover text-ink-muted">Tier {n.tier} · {n.tierLabel}</span>
                  <span>{n.publisher}</span>
                  <span>{new Date(n.publishedAt).toISOString().slice(0, 10)}</span>
                  {n.sentiment && (
                    <span className="pill bg-bg-hover text-ink-muted">
                      Provider sentiment: {n.sentiment}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Smart money */}
      <div className="card p-6">
        <h2 className="mb-4 font-semibold">Smart Money — {smartMoney.total}/100</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <PlanCell label="Institutional" value={`${smartMoney.institutionalAccumulation}/25`} />
          <PlanCell label="Revenue Growth" value={`${smartMoney.revenueGrowth}/20`} />
          <PlanCell label="Earnings Growth" value={`${smartMoney.earningsGrowth}/15`} />
          <PlanCell label="Relative Volume" value={`${smartMoney.relativeVolume}/15`} />
          <PlanCell label="Insider Buying" value={`${smartMoney.insiderBuying}/10`} />
          <PlanCell label="News Catalyst" value={`${smartMoney.newsCatalyst}/10`} />
          <PlanCell label="Sector Strength" value={`${smartMoney.sectorStrength}/5`} />
        </div>
      </div>

      {/* Thesis: supporting case vs counter case, labeled by direction */}
      <div className="grid gap-6 md:grid-cols-2">
        <div className={`card p-6 ${isShort ? "border-bear/20" : "border-bull/20"}`}>
          <h2 className={`mb-2 font-semibold ${isShort ? "text-bear" : "text-bull"}`}>
            {isShort ? "Short Case" : "Bull Case"}
          </h2>
          <p className="text-sm text-ink-muted">{setup.bullThesis}</p>
        </div>
        <div className="card border-warn/20 p-6">
          <h2 className="mb-2 font-semibold text-warn">What Could Go Wrong</h2>
          <p className="text-sm text-ink-muted">{setup.bearThesis}</p>
        </div>
      </div>

      <p className="text-xs text-ink-faint">
        Research &amp; education only. Not financial advice. Every setup must have a defined
        invalidation level — never trade without the stop.
      </p>
    </div>
  );
}

function PlanCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "bull" | "bear";
}) {
  const color = tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : "text-ink";
  return (
    <div className="rounded-lg border border-border bg-bg-elevated p-3">
      <div className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</div>
      <div className={`mt-0.5 font-mono text-base font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const color = value >= 85 ? "#16c784" : value >= 80 ? "#60a5fa" : value >= 65 ? "#f0b90b" : "#ea3943";
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-ink-muted">{label}</span>
        <span className="font-mono font-semibold" style={{ color }}>
          {value}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-bg-hover">
        <div className="h-full rounded-full" style={{ width: `${value}%`, background: color }} />
      </div>
    </div>
  );
}
