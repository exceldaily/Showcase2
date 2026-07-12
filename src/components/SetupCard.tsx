import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { TradeSetup } from "@/lib/types";
import { DecisionBadge, ScoreRing, scoreColor } from "./ScoreBadge";

export default function SetupCard({ setup }: { setup: TradeSetup }) {
  const { plan } = setup;
  return (
    <Link
      href={`/setup/${setup.id}`}
      className="card group block p-5 transition-colors hover:border-border-light hover:bg-bg-elevated"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold">{setup.ticker}</span>
            <span className="text-xs text-ink-faint">{setup.sector}</span>
          </div>
          <div className="text-sm text-ink-muted">{setup.company}</div>
        </div>
        <ScoreRing score={setup.scores.alphaforge} size={56} />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className="pill bg-bg-hover text-ink-muted">{setup.opportunityType}</span>
        <span className="pill bg-bg-hover text-ink-muted">{setup.setupType}</span>
        <span className="pill bg-bg-hover text-ink-faint" title="Every price on this card comes from this data snapshot">
          {setup.priceLabel}
          {setup.priceAsOf ? ` · ${setup.priceAsOf}` : ""}
        </span>
      </div>

      <p className="mt-3 line-clamp-2 text-sm text-ink-muted">{setup.catalyst.headline}</p>

      <div className="mt-4 grid grid-cols-4 gap-2 border-t border-border pt-4 text-center">
        <Metric label="Entry" value={`$${plan.entryConservative}`} />
        <Metric label="Stop" value={`$${plan.stopLoss}`} tone="bear" />
        <Metric label="Target" value={`$${plan.target2}`} tone="bull" />
        <Metric label="R/R" value={`${plan.riskReward}:1`} />
      </div>

      <div className="mt-4 flex items-center justify-between">
        <DecisionBadge decision={setup.decision} />
        <span className="flex items-center gap-1 text-xs text-ink-muted">
          <span className={scoreColor(setup.scores.confidence)}>
            {setup.scores.confidence}% conf
          </span>
          <ArrowUpRight size={14} className="opacity-0 transition-opacity group-hover:opacity-100" />
        </span>
      </div>
    </Link>
  );
}

function Metric({
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
    <div>
      <div className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</div>
      <div className={`font-mono text-sm font-semibold ${color}`}>{value}</div>
    </div>
  );
}
