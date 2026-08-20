// Dense stat display with honest unavailable states (spec §23, §51).

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
}: {
  label: string;
  field: FieldValue<number | string | boolean>;
  kind?: "pct" | "money" | "big" | "shares" | "x";
  tone?: "signed" | "plain";
}) {
  const unavailable = Boolean(field.unavailable);
  let cls = "text-ink";
  if (unavailable) cls = "text-ink-faint";
  else if (tone === "signed" && typeof field.value === "number") {
    cls = field.value > 0 ? "text-bull" : field.value < 0 ? "text-bear" : "text-ink-muted";
  }

  return (
    <div className="flex items-baseline justify-between gap-2 px-2 py-[3px] text-[11px]">
      <span className="text-ink-faint">{label}</span>
      {unavailable ? (
        <span className="cursor-help font-mono text-[10px] text-ink-faint" title={field.unavailable}>
          N/A
        </span>
      ) : (
        <span className={`font-mono ${cls}`}>{fmt(field.value, kind)}</span>
      )}
    </div>
  );
}
