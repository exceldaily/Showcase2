// Transparent score breakdown + WHY panel (spec §25, §44).
// Every point is traceable; nothing is a mystery number.

import { HelpCircle, Minus } from "lucide-react";
import type { SetupScore } from "@/lib/setupScore";

const GRADE_CLS: Record<string, string> = {
  A: "text-bull",
  B: "text-brand-glow",
  C: "text-warn",
  D: "text-ink-muted",
};

export default function ScorePanel({ score }: { score: SetupScore }) {
  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-2 py-2">
        <div className="flex items-baseline gap-1">
          <span className={`font-mono text-2xl font-bold ${GRADE_CLS[score.grade]}`}>{score.total}</span>
          <span className="text-[11px] text-ink-faint">/100</span>
        </div>
        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${GRADE_CLS[score.grade]} border-current/30`}>
          {score.grade}
        </span>
        <span className="text-[11px] text-ink-muted">Setup Score</span>
      </div>

      {/* Components */}
      <div className="px-2 py-1.5">
        {score.components.map((c) => {
          const pct = c.max > 0 ? (c.points / c.max) * 100 : 0;
          return (
            <div key={c.key} className="group py-1" title={`${c.evidence}\n\n${c.reason}`}>
              <div className="flex items-baseline justify-between text-[11px]">
                <span className="text-ink-muted">{c.label}</span>
                <span className="font-mono text-ink">
                  {c.points}
                  <span className="text-ink-faint">/{c.max}</span>
                </span>
              </div>
              <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-bg-hover">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${pct}%`,
                    background: pct >= 80 ? "#16c784" : pct >= 50 ? "#60a5fa" : pct >= 25 ? "#f0b90b" : "#ea3943",
                  }}
                />
              </div>
              <div className="mt-0.5 text-[10px] leading-snug text-ink-faint">{c.evidence}</div>
            </div>
          );
        })}

        {score.penalties.map((p) => (
          <div key={p.key} className="py-1" title={p.reason}>
            <div className="flex items-baseline justify-between text-[11px]">
              <span className="flex items-center gap-1 text-bear">
                <Minus size={10} /> {p.label}
              </span>
              <span className="font-mono text-bear">{p.points}</span>
            </div>
            <div className="mt-0.5 text-[10px] leading-snug text-ink-faint">{p.evidence}</div>
          </div>
        ))}
      </div>

      {/* WHY */}
      <div className="border-t border-border">
        <div className="flex items-center gap-1 bg-bg-card px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
          <HelpCircle size={11} /> Why is this on my screen?
        </div>
        <ul className="space-y-1 px-2 py-1.5">
          {score.why.map((w, i) => (
            <li key={i} className="flex gap-1.5 text-[11px] leading-snug text-ink-muted">
              <span className="text-ink-faint">·</span>
              <span>{w}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Honest gaps */}
      {score.notMeasured.length > 0 && (
        <div className="border-t border-border px-2 py-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
            Not measured on this feed
          </div>
          <ul className="mt-1 space-y-0.5">
            {score.notMeasured.map((n, i) => (
              <li key={i} className="text-[10px] leading-snug text-ink-faint">
                — {n}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[10px] leading-snug text-ink-faint">
            The score is normalized over what could actually be measured, so missing inputs neither
            inflate nor unfairly penalize it.
          </p>
        </div>
      )}
    </div>
  );
}
