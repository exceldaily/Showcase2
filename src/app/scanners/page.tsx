import Link from "next/link";
import { AlertTriangle, Filter } from "lucide-react";
import StatusBar from "@/components/terminal/StatusBar";
import QuickFilters from "@/components/terminal/QuickFilters";
import { getPresets, getUniverses, runScannerPreset } from "@/lib/terminal";

export const dynamic = "force-dynamic";

export default async function ScannersPage({
  searchParams,
}: {
  searchParams: { s?: string };
}) {
  const [presets, universes] = await Promise.all([getPresets(), getUniverses()]);
  const active = searchParams.s ?? presets[0]?.slug ?? "high-rvol";
  const run = await runScannerPreset(active, 100);

  return (
    <div className="-mx-4 -my-8 sm:-mx-6">
      <StatusBar lastUpdate={run?.ranAt} />

      <div className="flex flex-col lg:flex-row">
        {/* Scanner list */}
        <aside className="w-full shrink-0 border-b border-border lg:w-56 lg:border-b-0 lg:border-r">
          <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
            Scanners
          </div>
          <nav className="flex flex-wrap gap-1 px-2 pb-2 lg:flex-col lg:gap-0">
            {presets.map((p) => (
              <Link
                key={p.slug}
                href={`/scanners?s=${p.slug}`}
                className={`rounded px-2 py-1.5 text-[12px] transition-colors ${
                  p.slug === active
                    ? "bg-brand/15 font-semibold text-brand-glow"
                    : "text-ink-muted hover:bg-bg-hover hover:text-ink"
                }`}
              >
                {p.name}
              </Link>
            ))}
          </nav>

          <div className="border-t border-border px-3 py-2">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
              Universes
            </div>
            <ul className="space-y-0.5 text-[11px] text-ink-muted">
              {universes.map((u) => (
                <li key={u.slug} className="flex justify-between gap-2">
                  <span>{u.name}</span>
                  <span className="font-mono text-ink-faint">
                    ${Number(u.min_price)}
                    {u.max_price ? `–${Number(u.max_price)}` : "+"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        {/* Results */}
        <main className="min-w-0 flex-1">
          {!run ? (
            <div className="p-6 text-sm text-ink-muted">Scanner not found.</div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3 border-b border-border px-3 py-2">
                <Filter size={13} className="text-ink-faint" />
                <span className="text-[13px] font-semibold">{run.preset.name}</span>
                <span className="text-[11px] text-ink-muted">{run.preset.description}</span>
                <div className="ml-auto flex items-center gap-3 text-[11px] text-ink-faint">
                  <span>{run.rows.length} matches</span>
                  <span>{run.evaluated} evaluated</span>
                  <span>{run.universeSize} universe</span>
                </div>
              </div>

              {run.blockedFields.length > 0 && (
                <div className="flex items-start gap-2 border-b border-warn/25 bg-warn/5 px-3 py-2 text-[11px]">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warn" />
                  <div>
                    <span className="font-semibold text-warn">
                      Partial results — {run.blockedFields.length} filter
                      {run.blockedFields.length > 1 ? "s" : ""} cannot be evaluated on the current data
                      feed.
                    </span>
                    <ul className="mt-1 space-y-0.5 text-ink-muted">
                      {run.blockedFields.map((b) => (
                        <li key={b.field}>
                          <span className="text-ink">{b.label}</span> — {b.reason}
                        </li>
                      ))}
                    </ul>
                    <div className="mt-1 text-ink-faint">
                      Rules on missing data fail closed: symbols are excluded rather than silently
                      passing the filter.
                    </div>
                  </div>
                </div>
              )}

              <QuickFilters columns={run.preset.columns} rows={run.rows} />
            </>
          )}
        </main>
      </div>
    </div>
  );
}
