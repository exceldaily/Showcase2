// Dense stat display with honest unavailable states (spec §23, §51).

import { METRIC_GLOSSARY, VERDICT_CLASS, VERDICT_DOT, interpret } from "@/lib/interpret";
import type { FieldValue } from "@/lib/stockDetail";

function fmt(v: number | string | boolean | null, kind?: string): string {
  if (v === null) return "—";
  if (typeof v === "boolean") return v ? "YES" : "NO";
  if (typeof v === "string") return v;
  switch (kind) {
    case "pct":
      return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
    case "money":
      return `$${v.toFixed(2)}`;
    case "big":
      return v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${v.toLocaleString()}`;
    case "shares":
      return v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v.toLocaleString();
    case "x":
      return `${v.toFixed(2)}x`;
    default:
      return Number.isInteger(v) ? v.toLocaleString() : v.toFixed(2);
  }
}

export default function StatRow({
  label,
  field,
  kind,
  tone,
  metricKey,
}: {
  label: string;
  field: FieldValue<number | string | boolean>;
  kind?: "pct" | "money" | "big" | "shares" | "x";
  tone?: "signed" | "plain";
  /** Enables the good/bad verdict dot + explanation for this metric. */
  metricKey?: string;
}) {
  const unavailable = Boolean(field.unavailable);
  const verdict = !unavailable && metricKey ? interpret(metricKey, field.value) : null;
  const glossary = metricKey ? METRIC_GLOSSARY[metricKey] : undefined;

  let cls = "text-ink";
  if (unavailable) cls = "text-ink-faint";
  else if (verdict) cls = VERDICT_CLASS[verdict.verdict];
  else if (tone === "signed" && typeof field.value === "number") {
    cls = field.value > 0 ? "text-bull" : field.value < 0 ? "text-bear" : "text-ink-muted";
  }

  const labelTitle = glossary
    ? `${glossary.title}\n\n${glossary.what}\n\nGOOD: ${glossary.goodWhen}\nWATCH: ${glossary.badWhen}`
    : undefined;

  return (
    <div className="flex items-baseline justify-between gap-2 px-2 py-[3px] text-[11px]">
      <span
        className={`text-ink-faint ${glossary ? "cursor-help underline decoration-dotted decoration-ink-faint/40 underline-offset-2" : ""}`}
        title={labelTitle}
      >
        {label}
      </span>
      {unavailable ? (
        <span className="cursor-help font-mono text-[10px] text-ink-faint" title={field.unavailable}>
          N/A
        </span>
      ) : (
        <span
          className={`flex items-center gap-1 font-mono ${cls} ${verdict ? "cursor-help" : ""}`}
          title={verdict ? `${verdict.label} — ${verdict.meaning}` : undefined}
        >
          {verdict && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${VERDICT_DOT[verdict.verdict]}`} />}
          {fmt(field.value, kind)}
        </span>
      )}
    </div>
  );
}
