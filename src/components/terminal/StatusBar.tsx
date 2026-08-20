// Terminal status bar (spec §49, §50): market session, data quality,
// and last-update timestamp. Users must always know what they're
// looking at — never silently stale.

import { getSessionState } from "@/lib/session";
import { polygonCapabilities } from "@/providers/polygonProvider";

const QUALITY_LABEL: Record<string, { text: string; cls: string }> = {
  realtime: { text: "LIVE", cls: "bg-bull/15 text-bull border-bull/30" },
  delayed15: { text: "DELAYED 15M", cls: "bg-warn/15 text-warn border-warn/30" },
  eod: { text: "END OF DAY", cls: "bg-bg-hover text-ink-muted border-border" },
  cached: { text: "CACHED", cls: "bg-bg-hover text-ink-muted border-border" },
  unavailable: { text: "NO DATA", cls: "bg-bear/15 text-bear border-bear/30" },
};

const SESSION_CLS: Record<string, string> = {
  premarket: "text-warn",
  regular: "text-bull",
  afterhours: "text-brand-glow",
  closed: "text-ink-faint",
};

export default function StatusBar({ lastUpdate }: { lastUpdate?: string | null }) {
  const s = getSessionState();
  const caps = polygonCapabilities();
  const q = QUALITY_LABEL[caps.quality] ?? QUALITY_LABEL.unavailable;

  return (
    <div className="flex h-8 items-center gap-4 border-b border-border bg-bg-card px-3 text-[11px]">
      <div className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${s.session === "regular" ? "bg-bull animate-pulse" : s.session === "closed" ? "bg-ink-faint" : "bg-warn"}`} />
        <span className={`font-semibold uppercase tracking-wide ${SESSION_CLS[s.session]}`}>{s.label}</span>
      </div>

      <span className="font-mono text-ink-muted">{s.etTime} ET</span>

      {s.minutesToNextBoundary !== null && (
        <span className="text-ink-faint">
          {s.nextBoundaryLabel} in {Math.floor(s.minutesToNextBoundary / 60)}h {s.minutesToNextBoundary % 60}m
        </span>
      )}

      <div className="ml-auto flex items-center gap-3">
        {lastUpdate && (
          <span className="font-mono text-ink-faint">
            Updated {new Date(lastUpdate).toISOString().slice(11, 19)} UTC
          </span>
        )}
        <span className="text-ink-faint">{caps.name}</span>
        <span className={`rounded border px-1.5 py-0.5 font-semibold tracking-wide ${q.cls}`}>{q.text}</span>
      </div>
    </div>
  );
}
