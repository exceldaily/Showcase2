"use client";

// Instant client-side refinement of scanner results (spec §26 sorting,
// §46 presets). These narrow what the server returned — they never
// invent rows — and each explains what it does.

import { useMemo, useState } from "react";
import { ArrowDownUp, Filter, X } from "lucide-react";
import ScannerTable from "./ScannerTable";
import { METRIC_GLOSSARY, VERDICT_DOT, interpret } from "@/lib/interpret";
import type { MetricRow } from "@/lib/scannerRules";

interface QuickFilter {
  key: string;
  label: string;
  hint: string;
  test: (r: MetricRow) => boolean;
}

const FILTERS: QuickFilter[] = [
  { key: "heavyVol", label: "Heavy Volume", hint: "RVOL 2x or more — unusual participation behind the move.", test: (r) => Number(r.rvol ?? 0) >= 2 },
  { key: "green", label: "Green Today", hint: "Up on the session.", test: (r) => Number(r.changePct ?? 0) > 0 },
  { key: "aboveVwap", label: "Above VWAP", hint: "Trading above the volume-weighted average — buyers in control.", test: (r) => Number(r.vwapDistancePct ?? -1) >= 0 },
  { key: "stacked", label: "EMA Stacked", hint: "EMA 9 > 20 > 50 — every timeframe agrees the trend is up.", test: (r) => String(r.emaState ?? "").includes("9>20>50") },
  { key: "coiled", label: "Tight Coil", hint: "8-day range under 6% — compression that often precedes a move.", test: (r) => Number(r.coilPct ?? 99) <= 6 },
  { key: "liquid", label: "Liquid", hint: "Over $10M traded daily — you can get in and out cleanly.", test: (r) => Number(r.dollarVolume ?? 0) >= 10e6 },
  { key: "notExtended", label: "Not Extended", hint: "Within 6% of VWAP — not chasing a stretched move.", test: (r) => Number(r.vwapDistancePct ?? 99) < 6 },
  { key: "healthyRsi", label: "Healthy RSI", hint: "RSI 45-75 — momentum present without being exhausted.", test: (r) => { const v = Number(r.rsi14 ?? 0); return v >= 45 && v <= 75; } },
];

const SORTS: { key: string; label: string; hint: string }[] = [
  { key: "rvol", label: "Volume", hint: "Highest relative volume first." },
  { key: "changePct", label: "% Change", hint: "Biggest movers first." },
  { key: "setupScore", label: "Setup Score", hint: "Best overall setup quality first." },
  { key: "coilPct", label: "Tightest Coil", hint: "Most compressed first." },
  { key: "dollarVolume", label: "Liquidity", hint: "Most dollar volume first." },
  { key: "atrPct", label: "Volatility", hint: "Widest daily range first." },
];

export default function QuickFilters({ columns, rows }: { columns: string[]; rows: MetricRow[] }) {
  const [active, setActive] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [asc, setAsc] = useState(false);

  const filtered = useMemo(() => {
    let out = rows;
    for (const k of active) {
      const f = FILTERS.find((x) => x.key === k);
      if (f) out = out.filter(f.test);
    }
    if (sortKey) {
      out = [...out].sort((a, b) => {
        const av = Number(a[sortKey] ?? -Infinity);
        const bv = Number(b[sortKey] ?? -Infinity);
        return asc ? av - bv : bv - av;
      });
    }
    return out;
  }, [rows, active, sortKey, asc]);

  const toggle = (k: string) => setActive((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));

  // Count how many rows each filter would keep, so buttons are informative.
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const f of FILTERS) m[f.key] = rows.filter(f.test).length;
    return m;
  }, [rows]);

  return (
    <div>
      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-1.5">
        <Filter size={11} className="mr-0.5 text-ink-faint" />
        {FILTERS.map((f) => {
          const on = active.includes(f.key);
          return (
            <button
              key={f.key}
              onClick={() => toggle(f.key)}
              title={f.hint}
              className={`rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                on
                  ? "border-brand/40 bg-brand/15 text-brand-glow"
                  : "border-border text-ink-muted hover:border-border-light hover:text-ink"
              }`}
            >
              {f.label}
              <span className={`ml-1 ${on ? "text-brand-glow/70" : "text-ink-faint"}`}>{counts[f.key]}</span>
            </button>
          );
        })}
        {active.length > 0 && (
          <button
            onClick={() => setActive([])}
            className="ml-1 flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-ink-faint hover:text-ink"
          >
            <X size={9} /> Clear
          </button>
        )}
      </div>

      {/* Sort chips */}
      <div className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-1.5">
        <ArrowDownUp size={11} className="mr-0.5 text-ink-faint" />
        <span className="mr-1 text-[10px] text-ink-faint">Sort</span>
        {SORTS.map((s) => {
          const on = sortKey === s.key;
          return (
            <button
              key={s.key}
              onClick={() => {
                if (on) setAsc((v) => !v);
                else {
                  setSortKey(s.key);
                  setAsc(false);
                }
              }}
              title={s.hint}
              className={`rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                on ? "border-brand/40 bg-brand/15 text-brand-glow" : "border-border text-ink-muted hover:text-ink"
              }`}
            >
              {s.label}
              {on && <span className="ml-0.5">{asc ? "↑" : "↓"}</span>}
            </button>
          );
        })}
        <span className="ml-auto text-[10px] text-ink-faint">
          Showing {filtered.length} of {rows.length}
        </span>
      </div>

      <div className="flex flex-col xl:flex-row">
        <div className="min-w-0 flex-1">
          <ScannerTable columns={columns} rows={filtered} />
        </div>

        {/* Legend / explanations */}
        <aside className="w-full shrink-0 border-t border-border xl:w-64 xl:border-l xl:border-t-0">
          <Legend columns={columns} />
        </aside>
      </div>
    </div>
  );
}

function Legend({ columns }: { columns: string[] }) {
  const explained = columns.filter((c) => METRIC_GLOSSARY[c]);
  return (
    <div>
      <div className="bg-bg-card px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
        What am I looking at?
      </div>

      <div className="border-b border-border px-2 py-1.5">
        <div className="mb-1 text-[10px] font-semibold text-ink-muted">Colour key</div>
        {[
          { v: "good" as const, t: "Constructive — supports the setup" },
          { v: "ok" as const, t: "Mildly positive" },
          { v: "neutral" as const, t: "No edge either way" },
          { v: "caution" as const, t: "Watch out — elevated risk" },
          { v: "bad" as const, t: "Works against the setup" },
        ].map((x) => (
          <div key={x.v} className="flex items-center gap-1.5 py-[1px] text-[10px] text-ink-muted">
            <span className={`h-1.5 w-1.5 rounded-full ${VERDICT_DOT[x.v]}`} />
            {x.t}
          </div>
        ))}
        <p className="mt-1 text-[9px] leading-snug text-ink-faint">
          Colours describe the reading, not a prediction. Hover any number for its meaning.
        </p>
      </div>

      <div className="max-h-[520px] overflow-y-auto">
        {explained.map((c) => {
          const g = METRIC_GLOSSARY[c];
          return (
            <div key={c} className="border-b border-border/50 px-2 py-1.5">
              <div className="text-[11px] font-semibold text-ink">{g.title}</div>
              <p className="mt-0.5 text-[10px] leading-snug text-ink-muted">{g.what}</p>
              <p className="mt-1 text-[10px] leading-snug">
                <span className="font-semibold text-bull">Good:</span>{" "}
                <span className="text-ink-faint">{g.goodWhen}</span>
              </p>
              <p className="mt-0.5 text-[10px] leading-snug">
                <span className="font-semibold text-warn">Watch:</span>{" "}
                <span className="text-ink-faint">{g.badWhen}</span>
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
