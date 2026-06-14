import RegimeBanner from "@/components/RegimeBanner";
import { getRegime } from "@/lib/data";

export const dynamic = "force-dynamic";

const REGIME_LADDER = [
  { name: "Strong Bull", gate: "Aggressive growth & breakout trades allowed" },
  { name: "Bull", gate: "Favor growth, AI, semis, crypto, energy momentum" },
  { name: "Neutral", gate: "Require stronger setups — be selective" },
  { name: "Bear", gate: "Reduce trade frequency — defense first" },
  { name: "High Volatility Risk-Off", gate: "Avoid new swing trades unless exceptional" },
];

export default async function MarketRegimePage() {
  const regime = await getRegime();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Market Regime</h1>
        <p className="text-sm text-ink-muted">
          The market is classified before any trade is generated. Regime gates how aggressive the
          scanner is allowed to be.
        </p>
      </div>

      <RegimeBanner regime={regime} />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card p-6">
          <h2 className="mb-4 font-semibold">Inputs Tracked</h2>
          <ul className="space-y-2 text-sm text-ink-muted">
            {[
              "SPY trend vs 50-day moving average",
              "QQQ trend vs 50-day moving average",
              "VIX level (fear gauge)",
              "Market breadth (% advancing)",
              "Sector rotation signal",
              "Interest rates & Treasury yields",
              "US Dollar strength",
            ].map((x) => (
              <li key={x} className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-brand-glow" />
                {x}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-ink-faint">
            Live values arrive once the Polygon and FRED keys are connected. Demo values shown now.
          </p>
        </div>

        <div className="card p-6">
          <h2 className="mb-4 font-semibold">Regime Ladder</h2>
          <div className="space-y-2">
            {REGIME_LADDER.map((r) => {
              const active = r.name === regime.regime;
              return (
                <div
                  key={r.name}
                  className={`rounded-lg border p-3 ${
                    active
                      ? "border-brand/40 bg-brand/10"
                      : "border-border bg-bg-elevated"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`font-semibold ${active ? "text-brand-glow" : ""}`}>
                      {r.name}
                    </span>
                    {active && <span className="pill bg-brand/20 text-brand-glow">Current</span>}
                  </div>
                  <p className="mt-0.5 text-xs text-ink-muted">{r.gate}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
