"use client";

// Compact timeframe matrix: one row per timeframe, colored cells, no
// prose. Readable in a second. Clicking a row switches the chart to
// that timeframe.

import type { Alignment, MatrixRow } from "@/lib/timeframeMatrix";
import { fmt$ } from "@/lib/ui/format";
import { machineTone, TONE_TEXT, TONE_DOT, type Tone } from "@/lib/ui/tone";
import { memo } from "react";
import { Chip } from "@/components/ui/primitives";

const leanTone = (v: string): Tone => (v === "BULL" || v === "ABOVE" || v === "STACKED UP" || v === "POS" || v === "HH/HL" || v === "BREAKOUT" ? "bull"
  : v === "BEAR" || v === "BELOW" || v === "STACKED DOWN" || v === "NEG" || v === "LH/LL" || v === "BREAKDOWN" ? "bear"
  : v === "CHOP" || v === "IMPROVING" || v === "FADING" ? "warn"
  : v === "N/A" ? "faint" : "muted");

const short = (v: string) => ({ "STACKED UP": "UP", "STACKED DOWN": "DOWN", NEUTRAL: "NEUT", IMPROVING: "IMPR", FADING: "FADE", BREAKOUT: "BRK UP", BREAKDOWN: "BRK DN", RANGE: "RANGE" } as Record<string, string>)[v] ?? v;

function Cell({ v, dot = true }: { v: string; dot?: boolean }) {
  const tone = leanTone(v);
  return (
    <td>
      <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${TONE_TEXT[tone]}`}>
        {dot && <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[tone]}`} />}
        {short(v)}
      </span>
    </td>
  );
}

function TimeframeMatrixInner({ rows, align, selected, onSelect }: { rows: MatrixRow[]; align: Alignment | null; selected: string; onSelect: (tf: MatrixRow["tf"]) => void }) {
  if (!rows.length) return null;
  return (
    <div>
      <div className="flex h-8 items-center justify-between px-3">
        <span className="panel-title">Timeframes</span>
        {align && (
          <span className="flex items-center gap-1.5 text-xs">
            <Chip tone={align.conflict ? "warn" : leanTone(align.lean)} title={`${align.agree.join(", ") || "none"} agree${align.against.length ? `, ${align.against.join(", ")} against` : ""}`}>
              {align.conflict ? "CONFLICT" : `${align.lean} ${align.score}/10`}
            </Chip>
          </span>
        )}
      </div>
      <table className="tbl text-xs">
        <thead>
          <tr>
            {["TF", "Trend", "Momentum", "VWAP", "EMA", "MACD", "Structure", "Setup"].map((h) => <th key={h} className="!bg-transparent">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.tf} onClick={() => onSelect(r.tf)} data-on={r.tf === selected} className="cursor-pointer" title={`${r.detail}${r.support !== null ? ` · S ${fmt$(r.support)}` : ""}${r.resistance !== null ? ` · R ${fmt$(r.resistance)}` : ""}`}>
              <td className={`num font-semibold ${r.tf === selected ? "text-brand-glow" : "text-ink"}`}>{r.tf}</td>
              <Cell v={r.trend} />
              <Cell v={r.momentum} />
              <Cell v={r.vwap} />
              <Cell v={r.ema} dot={false} />
              <Cell v={r.macd} dot={false} />
              <Cell v={r.structure} dot={false} />
              <td className={`text-xs font-semibold ${TONE_TEXT[machineTone(r.setup)]}`}>{r.setup ?? <span className="font-normal text-ink-faint">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default memo(TimeframeMatrixInner);
