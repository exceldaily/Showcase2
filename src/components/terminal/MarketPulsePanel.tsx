// ─────────────────────────────────────────────────────────
// Compact Market Pulse strip: regime + momentum + options grade with
// SPY/QQQ/sector alignment lines and an on-demand "Why?" breakdown.
// Direction and momentum are shown as separate readings on purpose.
// Server component; <details> keeps the expandable zero-JS.
// ─────────────────────────────────────────────────────────

import { Activity, Gauge, HelpCircle, Rocket, TrendingDown, TrendingUp, Waves } from "lucide-react";
import type { PulseSnapshot } from "@/lib/marketPulseLive";
import type { PulseRegime, SignalDir } from "@/lib/marketPulse";

const REGIME_STYLE: Record<PulseRegime, { cls: string; Icon: typeof Rocket }> = {
  "Strong Bullish": { cls: "text-bull", Icon: Rocket },
  Bullish: { cls: "text-bull", Icon: TrendingUp },
  Neutral: { cls: "text-ink-muted", Icon: Gauge },
  Chop: { cls: "text-warn", Icon: Waves },
  Bearish: { cls: "text-bear", Icon: TrendingDown },
  "Strong Bearish": { cls: "text-bear", Icon: TrendingDown },
};

const GRADE_STYLE: Record<string, string> = {
  "A+": "bg-bull/15 text-bull border-bull/40",
  A: "bg-bull/10 text-bull border-bull/30",
  B: "bg-brand/10 text-brand-glow border-brand/30",
  C: "bg-warn/10 text-warn border-warn/30",
  Avoid: "bg-bear/15 text-bear border-bear/40",
};

const DIR_MARK: Record<SignalDir, { mark: string; cls: string }> = {
  bull: { mark: "▲", cls: "text-bull" },
  bear: { mark: "▼", cls: "text-bear" },
  flat: { mark: "■", cls: "text-ink-faint" },
};

function labelCls(label: PulseRegime | null): string {
  if (!label) return "text-ink-faint";
  return REGIME_STYLE[label]?.cls ?? "text-ink-muted";
}

function momentumCls(score: number): string {
  if (score >= 76) return "text-bull";
  if (score >= 61) return "text-brand-glow";
  if (score >= 41) return "text-ink";
  if (score >= 21) return "text-warn";
  return "text-bear";
}

export default function MarketPulsePanel({ pulse }: { pulse: PulseSnapshot }) {
  const { regime, momentum, options } = pulse;
  const { cls, Icon } = REGIME_STYLE[regime.regime];

  return (
    <div className="border-b border-border bg-bg-card">
      <div className="flex flex-wrap items-stretch divide-x divide-border">
        {/* Regime = direction */}
        <div className="flex min-w-[150px] flex-col justify-center px-3 py-1.5">
          <div className="text-[9px] font-semibold uppercase tracking-wide text-ink-faint">Market Regime</div>
          <div className={`flex items-center gap-1.5 text-[14px] font-bold ${cls}`}>
            <Icon size={14} /> {regime.regime}
          </div>
          <div className="text-[9px] text-ink-faint">
            {regime.bull} bull / {regime.bear} bear confirmations
          </div>
        </div>

        {/* Momentum = energy, direction-agnostic */}
        {momentum && (
          <div className="flex min-w-[130px] flex-col justify-center px-3 py-1.5">
            <div className="text-[9px] font-semibold uppercase tracking-wide text-ink-faint">Momentum</div>
            <div className={`flex items-center gap-1.5 font-mono text-[14px] font-bold ${momentumCls(momentum.score)}`}>
              <Activity size={13} /> {momentum.score} / 100
            </div>
            <div className="text-[9px] text-ink-faint">{momentum.band}</div>
          </div>
        )}

        {/* Options grade = the combination */}
        {options && (
          <div className="flex min-w-[120px] flex-col justify-center px-3 py-1.5">
            <div className="text-[9px] font-semibold uppercase tracking-wide text-ink-faint">Options Environment</div>
            <span
              className={`mt-0.5 inline-flex w-fit items-center rounded border px-2 py-0.5 text-[13px] font-bold ${GRADE_STYLE[options.grade]}`}
              title={options.reason}
            >
              {options.grade}
            </span>
          </div>
        )}

        {/* Alignment lines */}
        <div className="flex flex-col justify-center gap-0 px-3 py-1.5 text-[10px]">
          <div>
            <span className="text-ink-faint">SPY: </span>
            <span className={`font-semibold ${labelCls(pulse.spyLabel)}`}>{pulse.spyLabel ?? "no data"}</span>
          </div>
          <div>
            <span className="text-ink-faint">QQQ: </span>
            <span className={`font-semibold ${labelCls(pulse.qqqLabel)}`}>{pulse.qqqLabel ?? "no data"}</span>
          </div>
          {pulse.stockLabel && (
            <div>
              <span className="text-ink-faint">This stock: </span>
              <span className={`font-semibold ${labelCls(pulse.stockLabel)}`}>{pulse.stockLabel}</span>
              {pulse.sectorLabel && (
                <span className="text-ink-faint">
                  {" "}
                  · sector {pulse.sectorLabel.toLowerCase()}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Why? — the actual signals, plus what could not be measured */}
      <details className="group border-t border-border/50">
        <summary className="flex cursor-pointer items-center gap-1 px-3 py-1 text-[10px] text-ink-faint hover:text-ink [&::-webkit-details-marker]:hidden">
          <HelpCircle size={10} /> Why? <span className="group-open:hidden">show the signals</span>
          <span className="hidden group-open:inline">hide</span>
        </summary>
        <div className="grid gap-x-6 gap-y-0.5 px-3 pb-2 sm:grid-cols-2">
          <div>
            {regime.signals.map((s, i) => (
              <div key={i} className="flex gap-1.5 text-[10px] leading-relaxed">
                <span className={DIR_MARK[s.dir].cls}>{DIR_MARK[s.dir].mark}</span>
                <span className="text-ink-muted">
                  <span className="font-semibold text-ink">{s.name}:</span> {s.detail}
                </span>
              </div>
            ))}
          </div>
          <div>
            {momentum && momentum.components.length > 0 && (
              <>
                <div className="text-[9px] font-semibold uppercase tracking-wide text-ink-faint">Momentum inputs</div>
                {momentum.components.map((c, i) => (
                  <div key={i} className="flex justify-between gap-2 text-[10px] text-ink-muted">
                    <span>{c.detail}</span>
                    <span className="font-mono text-ink-faint">{Math.round(c.value01 * 100)}% × {c.weightPct}w</span>
                  </div>
                ))}
              </>
            )}
            {(regime.notMeasured.length > 0 || (momentum?.notMeasured.length ?? 0) > 0) && (
              <div className="mt-1">
                <div className="text-[9px] font-semibold uppercase tracking-wide text-ink-faint">Not measured on this feed</div>
                {Array.from(new Set([...regime.notMeasured, ...(momentum?.notMeasured ?? [])])).map((n, i) => (
                  <div key={i} className="text-[10px] text-ink-faint">— {n}</div>
                ))}
              </div>
            )}
            <p className="mt-1 text-[9px] leading-snug text-ink-faint">
              Reads the latest end-of-day session and refreshes as new data lands. Decision support from
              measurable conditions — not a prediction that anything will go up or down.
            </p>
          </div>
        </div>
      </details>
    </div>
  );
}
