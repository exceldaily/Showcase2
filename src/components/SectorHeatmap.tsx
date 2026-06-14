import type { SectorStrength } from "@/lib/types";

function bandColor(score: number): string {
  if (score >= 80) return "bg-bull/20 text-bull border-bull/30";
  if (score >= 70) return "bg-brand/15 text-brand-glow border-brand/30";
  if (score >= 55) return "bg-warn/15 text-warn border-warn/30";
  return "bg-bear/15 text-bear border-bear/30";
}

export default function SectorHeatmap({ sectors }: { sectors: SectorStrength[] }) {
  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold">Sector Strength</h2>
        <span className="text-xs text-ink-muted">Only sectors &gt; 70 are traded</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {sectors.map((s) => (
          <div
            key={s.sector}
            className={`rounded-lg border p-3 ${bandColor(s.score)}`}
            title={`5d ${s.momentum5d > 0 ? "+" : ""}${s.momentum5d}% · 20d ${
              s.momentum20d > 0 ? "+" : ""
            }${s.momentum20d}%`}
          >
            <div className="text-2xl font-bold tabular-nums">{s.score}</div>
            <div className="mt-0.5 text-xs font-medium opacity-90">{s.sector}</div>
            <div className="mt-1 text-[11px] opacity-70">
              20d {s.momentum20d > 0 ? "+" : ""}
              {s.momentum20d}%
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
