"use client";

// Setups by timeframe: the same read (trend, key level, state, T1,
// invalidation, room) on 1m / 5m / 15m / 1h / D / W. Clicking a row
// switches the chart to that timeframe AND draws that frame's plan.
// Phase 2 grows this into the full timeframe matrix.

import type { TfSetup, SetupTf } from "@/lib/multiTimeframe";
import { fmt$ } from "@/lib/ui/format";
import { machineTone, roomTone, trendTone, TONE_TEXT } from "@/lib/ui/tone";

export default function SetupsPanel({
  setups, selected, onSelect,
}: {
  setups: TfSetup[];
  selected: SetupTf;
  onSelect: (tf: SetupTf) => void;
}) {
  if (!setups.length) return null;
  return (
    <div>
      <div className="flex items-center justify-between px-3 py-1">
        <span className="panel-title">Timeframes</span>
        <span className="text-2xs text-ink-faint">row = chart + plan</span>
      </div>
      <table className="tbl text-xs">
        <thead>
          <tr>
            {["TF", "Trend", "Setup", "Trigger", "T1", "Invalid", "Room"].map((h) => <th key={h} className="!bg-transparent">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {setups.map((s) => {
            const on = s.tf === selected;
            return (
              <tr
                key={s.tf}
                onClick={() => onSelect(s.tf)}
                data-on={on}
                title={s.note ?? (s.trend ? `${s.trend} (${s.trendBull} bull / ${s.trendBear} bear signals) · ${s.bars} bars` : "")}
                className="cursor-pointer"
              >
                <td className={`num font-semibold ${on ? "text-brand-glow" : "text-ink"}`}>{s.tf}</td>
                <td className={TONE_TEXT[trendTone(s.trend)]}>{s.trend ?? "—"}</td>
                <td className={`font-semibold ${TONE_TEXT[machineTone(s.state)]}`}>
                  {s.state ? `${s.direction === "short" ? "↓" : "↑"} ${s.state}` : <span className="font-normal text-ink-faint">{s.note ? "none" : "—"}</span>}
                </td>
                <td className="num text-ink-muted">{fmt$(s.trigger)}</td>
                <td className="num text-ink-muted">{fmt$(s.plan?.targets[0])}</td>
                <td className="num text-bear">{fmt$(s.plan?.invalidation)}</td>
                <td className={TONE_TEXT[roomTone(s.room?.grade)]}>{s.room?.grade ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
