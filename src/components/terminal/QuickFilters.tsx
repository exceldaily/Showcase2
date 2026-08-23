"use client";

// Instant client-side refinement of scanner results. Predicates live
// in lib/quickFilterDefs.ts (unit-tested). Two groups: the momentum
// checklist gates, and structure/quality refinements.

import { useMemo, useState } from "react";
import { ArrowDownUp, BookOpen, Filter, X } from "lucide-react";
import ScannerTable from "./ScannerTable";
import { METRIC_GLOSSARY, VERDICT_DOT } from "@/lib/interpret";
import { QUICK_FILTERS, QUICK_SORTS, applyQuickFilters, applyQuickSort } from "@/lib/quickFilterDefs";
import type { MetricRow } from "@/lib/scannerRules";

export default function QuickFilters({ columns, rows }: { columns: string[]; rows: MetricRow[] }) {
  const [active, setActive] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [asc, setAsc] = useState(false);
  const [showLegend, setShowLegend] = useState(false);

  const filtered = useMemo(
    () => applyQuickSort(applyQuickFilters(rows, active), sortKey, asc),
    [rows, active, sortKey, asc]
  );

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const f of QUICK_FILTERS) m[f.key] = rows.filter(f.test).length;
    return m;
  }, [rows]);

  const toggle = (k: string) => setActive((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));

  const chip = (f: (typeof QUICK_FILTERS)[number]) => {
    const on = active.includes(f.key);
    const n = counts[f.key];
    return (
      <button
        key={f.key}
        onClick={() => toggle(f.key)}
        title={f.hint}
        disabled={n === 0 && !on}
        className={`rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
          on
            ? "border-brand/40 bg-brand/15 text-brand-glow"
            : "border-border text-ink-muted hover:border-border-light hover:text-ink"
        }`}
      >
        {f.label}
        <span className={`ml-1 ${on ? "text-brand-glow/70" : "text-ink-faint"}`}>{n}</span>
      </button>
    );
  };

  const checklist = QUICK_FILTERS.filter((f) => f.group === "checklist");
  const quality = QUICK_FILTERS.filter((f) => f.group === "quality");

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-1.5">
        <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
          <Filter size={10} /> Checklist
        </span>
        {checklist.map(chip)}
        <span className="mx-1 h-3 w-px bg-border" />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Quality</span>
        {quality.map(chip)}
        {active.length > 0 && (
          <button
            onClick={() => setActive([])}
            className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-ink-faint hover:text-ink"
          >
            <X size={9} /> Clear
          </button>
        )}
      </div>

      {/* Sort + legend toggle */}
      <div className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-1.5">
        <ArrowDownUp size={11} className="mr-0.5 text-ink-faint" />
        {QUICK_SORTS.map((s) => {
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
        <span className="ml-auto flex items-center gap-2 text-[10px] text-ink-faint">
          <span>
            {filtered.length} of {rows.length}
          </span>
          <button
            onClick={() => setShowLegend((v) => !v)}
            className={`flex items-center gap-1 rounded border px-1.5 py-0.5 ${
              showLegend ? "border-brand/40 text-brand-glow" : "border-border hover:text-ink"
            }`}
            title="Explain the columns and colours"
          >
            <BookOpen size={10} /> Explain
          </button>
        </span>
      </div>

      <div className="flex flex-col xl:flex-row">
        <div className="min-w-0 flex-1">
          <ScannerTable columns={columns} rows={filtered} />
        </div>
        {showLegend && (
          <aside className="w-full shrink-0 border-t border-border xl:w-64 xl:border-l xl:border-t-0">
            <Legend columns={columns} />
          </aside>
        )}
      </div>
    </div>
  );
}

function Legend({ columns }: { columns: string[] }) {
  const explained = columns.filter((c) => METRIC_GLOSSARY[c]);
  return (
    <div>
      <div className="border-b border-border px-2 py-1.5">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Colour key</div>
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
          Colours describe the reading, not a prediction. Hover any number for its meaning; hover a
          symbol for why it matched.
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
