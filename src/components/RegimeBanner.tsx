import { Gauge, TrendingDown, TrendingUp } from "lucide-react";
import type { RegimeSnapshot } from "@/lib/types";

const REGIME_STYLES: Record<string, { bar: string; text: string }> = {
  "Strong Bull": { bar: "from-bull/25 to-bull/5", text: "text-bull" },
  Bull: { bar: "from-brand/25 to-brand/5", text: "text-brand-glow" },
  Neutral: { bar: "from-warn/20 to-warn/5", text: "text-warn" },
  Bear: { bar: "from-bear/20 to-bear/5", text: "text-bear" },
  "High Volatility Risk-Off": { bar: "from-bear/30 to-bear/10", text: "text-bear" },
};

export default function RegimeBanner({ regime }: { regime: RegimeSnapshot }) {
  const style = REGIME_STYLES[regime.regime] ?? REGIME_STYLES.Neutral;
  return (
    <div className={`card overflow-hidden`}>
      <div className={`bg-gradient-to-r ${style.bar} p-5`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-bg/40">
              <Gauge className={style.text} size={22} />
            </span>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
                Market Regime
              </div>
              <div className={`text-xl font-bold ${style.text}`}>{regime.regime}</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-5 text-sm">
            <Stat label="SPY" value={regime.spyTrend} trend={regime.spyTrend} />
            <Stat label="QQQ" value={regime.qqqTrend} trend={regime.qqqTrend} />
            <div>
              <div className="text-xs text-ink-muted">VIX</div>
              <div className="font-mono font-semibold">{regime.vix.toFixed(1)}</div>
            </div>
            <div>
              <div className="text-xs text-ink-muted">Breadth</div>
              <div className="font-mono font-semibold">{regime.breadth}%</div>
            </div>
          </div>
        </div>
        <p className="mt-3 text-sm text-ink-muted">
          <span className="font-semibold text-ink">{regime.tradeGate}.</span> {regime.note}
        </p>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  trend,
}: {
  label: string;
  value: string;
  trend: "up" | "down" | "flat";
}) {
  return (
    <div>
      <div className="text-xs text-ink-muted">{label}</div>
      <div className="flex items-center gap-1 font-semibold">
        {trend === "up" ? (
          <TrendingUp size={15} className="text-bull" />
        ) : (
          <TrendingDown size={15} className="text-bear" />
        )}
        <span className="capitalize">{value}</span>
      </div>
    </div>
  );
}
