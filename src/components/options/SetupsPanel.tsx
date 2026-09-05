"use client";

// Setups by timeframe: the same read (trend, key level, state, T1,
// invalidation, room) on 1m / 5m / 15m / 1h / D / W. Clicking a row
// switches the chart to that timeframe AND draws that frame's plan.

import type { TfSetup, SetupTf } from "@/lib/multiTimeframe";
import { STATE_TONE, fmt$ } from "./OptionsPanels";

const trendCls = (t: string | null) =>
  !t ? "text-ink-faint" : /Bullish/.test(t) ? "text-bull" : /Bearish/.test(t) ? "text-bear" : t === "Chop" ? "text-warn" : "text-ink-muted";

export default function SetupsPanel({
  setups, selected, onSelect,
}: {
  setups: TfSetup[];
  selected: SetupTf;
  onSelect: (tf: SetupTf) => void;
}) {
  if (!setups.length) return null;
  return (
    <div className="border-b border-border">
      <div className="flex items-center justify-between px-2 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Setups by timeframe</span>
        <span className="text-[9px] text-ink-faint">click a row: chart + plan follow it</span>
      </div>
      <table className="w-full text-[10px]">
        <thead>
          <tr className="text-left text-[9px] uppercase tracking-wide text-ink-faint">
            {["TF", "Trend", "Setup", "Trigger", "T1", "Wrong", "Room"].map((h) => (
              <th key={h} className="px-2 pb-1 font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {setups.map((s) => {
            const on = s.tf === selected;
            return (
              <tr
                key={s.tf}
                onClick={() => onSelect(s.tf)}
                title={s.note ?? (s.trend ? `${s.trend} (${s.trendBull} bull / ${s.trendBear} bear signals) · ${s.bars} bars` : "")}
                className={`cursor-pointer border-t border-border/40 ${on ? "bg-brand/10" : "hover:bg-bg-hover"}`}
              >
                <td className={`px-2 py-[3px] font-mono font-bold ${on ? "text-brand-glow" : "text-ink"}`}>{s.tf}</td>
                <td className={`px-2 py-[3px] ${trendCls(s.trend)}`}>{s.trend ?? "—"}</td>
                <td className={`px-2 py-[3px] font-semibold ${STATE_TONE[s.state ?? ""] ?? "text-ink-faint"}`}>
                  {s.state ? `${s.direction === "short" ? "↓" : "↑"} ${s.state}` : <span className="font-normal text-ink-faint">{s.note ?? "—"}</span>}
                </td>
                <td className="px-2 py-[3px] font-mono text-ink-muted">{fmt$(s.trigger)}</td>
                <td className="px-2 py-[3px] font-mono text-ink-muted">{fmt$(s.plan?.targets[0])}</td>
                <td className="px-2 py-[3px] font-mono text-bear">{fmt$(s.plan?.invalidation)}</td>
                <td className={`px-2 py-[3px] ${s.room?.grade === "POOR" ? "text-bear" : s.room?.grade === "GOOD" || s.room?.grade === "OPEN" ? "text-bull" : "text-ink-muted"}`}>{s.room?.grade ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
