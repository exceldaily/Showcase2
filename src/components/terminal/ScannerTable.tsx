// Dense scanner table (spec §21, §33). Compact rows, monospace
// numerics, sortable columns, sticky header. No oversized cards.

import Link from "next/link";
import { FIELD_BY_KEY } from "@/lib/fields";
import { floatCategory } from "@/lib/metrics";
import type { MetricRow } from "@/lib/scannerRules";

function fmtValue(key: string, v: unknown): { text: string; cls: string } {
  if (v === undefined || v === null) return { text: "—", cls: "text-ink-faint" };
  const def = FIELD_BY_KEY.get(key);
  const n = typeof v === "number" ? v : Number(v);

  if (key === "symbol") return { text: String(v), cls: "font-semibold text-ink" };
  if (key === "floatShares") {
    const cat = floatCategory(n);
    const cls = cat === "ULTRA LOW FLOAT" ? "text-bear" : cat === "LOW FLOAT" ? "text-warn" : "text-ink-muted";
    return { text: `${(n / 1e6).toFixed(1)}M`, cls };
  }
  if (!def) return { text: String(v), cls: "text-ink-muted" };

  switch (def.kind) {
    case "percent": {
      const cls = n > 0 ? "text-bull" : n < 0 ? "text-bear" : "text-ink-muted";
      return { text: `${n > 0 ? "+" : ""}${n.toFixed(2)}%`, cls };
    }
    case "money":
      return { text: n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${n.toFixed(2)}`, cls: "text-ink" };
    case "integer":
      return { text: n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : String(n), cls: "text-ink-muted" };
    case "number": {
      if (key === "rvol") {
        const cls = n >= 3 ? "text-bull font-semibold" : n >= 1.5 ? "text-warn" : "text-ink-muted";
        return { text: `${n.toFixed(2)}x`, cls };
      }
      return { text: n.toFixed(2), cls: "text-ink-muted" };
    }
    case "boolean":
      return { text: v ? "YES" : "NO", cls: v ? "text-bull" : "text-ink-faint" };
    default:
      return { text: String(v), cls: "text-ink-muted" };
  }
}

export default function ScannerTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: MetricRow[];
}) {
  if (rows.length === 0) {
    return (
      <div className="p-6 text-center text-xs text-ink-muted">
        No symbols currently match these conditions.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12px]">
        <thead className="sticky top-0 z-10 bg-bg-card">
          <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-ink-faint">
            {columns.map((c) => (
              <th key={c} className="whitespace-nowrap px-2 py-1.5 font-semibold">
                {c === "symbol" ? "Sym" : FIELD_BY_KEY.get(c)?.label ?? c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={String(r.symbol) + i}
              className="border-b border-border/40 transition-colors hover:bg-bg-hover"
            >
              {columns.map((c) => {
                const { text, cls } = fmtValue(c, r[c]);
                if (c === "symbol") {
                  return (
                    <td key={c} className="whitespace-nowrap px-2 py-1">
                      <Link href={`/terminal/${String(r.symbol)}`} className={`${cls} hover:text-brand-glow`}>
                        {text}
                      </Link>
                    </td>
                  );
                }
                return (
                  <td key={c} className={`whitespace-nowrap px-2 py-1 font-mono ${cls}`}>
                    {text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
