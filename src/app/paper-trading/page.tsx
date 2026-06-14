import { Activity } from "lucide-react";

export const dynamic = "force-dynamic";

// Phase 3 builds the full engine. This page establishes the layout and
// the metrics that will populate from the paper_trades table.
const STATS = [
  { label: "Win Rate", value: "—", hint: "wins / total" },
  { label: "Profit Factor", value: "—", hint: "gross win / gross loss" },
  { label: "Expectancy", value: "—", hint: "per-trade edge" },
  { label: "Max Drawdown", value: "—", hint: "peak-to-trough" },
  { label: "Avg Win", value: "—", hint: "% per winning trade" },
  { label: "Avg Loss", value: "—", hint: "% per losing trade" },
];

export default function PaperTradingPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Paper Trading</h1>
        <p className="text-sm text-ink-muted">
          Simulated entries and exits with full performance tracking. No real money, ever.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {STATS.map((s) => (
          <div key={s.label} className="card p-4">
            <div className="text-xs text-ink-muted">{s.label}</div>
            <div className="mt-1 font-mono text-2xl font-bold">{s.value}</div>
            <div className="text-[11px] text-ink-faint">{s.hint}</div>
          </div>
        ))}
      </div>

      <div className="card flex flex-col items-center justify-center gap-3 p-12 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand/15">
          <Activity size={22} className="text-brand-glow" />
        </span>
        <h2 className="font-semibold">No open paper trades yet</h2>
        <p className="max-w-md text-sm text-ink-muted">
          Once you add a setup from the scanner to paper trading, simulated fills, stop/target
          tracking, and performance by sector, setup type and market regime will populate here.
          This engine is built in Phase 3.
        </p>
      </div>
    </div>
  );
}
