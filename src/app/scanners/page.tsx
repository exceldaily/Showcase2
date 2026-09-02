import Link from "next/link";
import MarketPulsePanel from "@/components/terminal/MarketPulsePanel";
import { buildMarketPulse } from "@/lib/marketPulseLive";
import { AlertTriangle, Filter, Lock } from "lucide-react";
import StatusBar from "@/components/terminal/StatusBar";
import QuickFilters from "@/components/terminal/QuickFilters";
import { getPresets, getUniverses, presetReadiness, runScannerPreset } from "@/lib/terminal";
import { polygonCapabilities } from "@/providers/polygonProvider";

export const dynamic = "force-dynamic";

export default async function ScannersPage({
  searchParams,
}: {
  searchParams: { s?: string };
}) {
  const [presets, universes] = await Promise.all([getPresets(), getUniverses()]);
  const caps = polygonCapabilities();

  // Split scanners into ones that can run today vs ones gated on a
  // data plan, so the list is honest instead of a wall of empty results.
  const ready = presets.filter((p) => presetReadiness(p.rules, caps).ready);
  const gated = presets.filter((p) => !presetReadiness(p.rules, caps).ready);

  const active = searchParams.s ?? ready[0]?.slug ?? presets[0]?.slug ?? "high-rvol";
  const [run, pulse] = await Promise.all([runScannerPreset(active, 100), buildMarketPulse()]);

  return (
    <div className="-mx-4 -my-8 sm:-mx-6">
      <StatusBar lastUpdate={run?.ranAt} />
      {pulse && <MarketPulsePanel pulse={pulse} />}

      <div className="flex flex-col lg:flex-row">
        {/* Scanner list */}
        <aside className="w-full shrink-0 border-b border-border lg:w-56 lg:border-b-0 lg:border-r">
          <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
            Scanners
          </div>
          <nav className="flex flex-wrap gap-1 px-2 pb-2 lg:flex-col lg:gap-0">
            {ready.map((p) => (
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

          {gated.length > 0 && (
            <details className="border-t border-border">
              <summary className="flex cursor-pointer items-center gap-1.5 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-ink-faint hover:text-ink-muted">
                <Lock size={10} />
                Needs intraday data ({gated.length})
              </summary>
              <div className="px-3 pb-2 text-[10px] leading-snug text-ink-faint">
                These scanners depend on minute bars, premarket volume, or halt data. They activate
                automatically on the Starter data plan; the rules and columns are already built.
              </div>
              <ul className="px-2 pb-2">
                {gated.map((p) => (
                  <li key={p.slug}>
                    <Link
                      href={`/scanners?s=${p.slug}`}
                      className={`block rounded px-2 py-1 text-[11px] ${
                        p.slug === active ? "bg-bg-hover text-ink" : "text-ink-faint hover:text-ink-muted"
                      }`}
                    >
                      {p.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          )}

          <details className="border-t border-border">
            <summary className="cursor-pointer px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-ink-faint hover:text-ink-muted">
              Universes
            </summary>
            <ul className="space-y-0.5 px-3 pb-2 text-[11px] text-ink-muted">
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
          </details>
        </aside>

        {/* Results */}
        <main className="min-w-0 flex-1">
          {!run ? (
            <div className="p-6 text-sm text-ink-muted">Scanner not found.</div>
          ) : (
            <>
              <div className="border-b border-border px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Filter size={13} className="text-ink-faint" />
                  <span className="text-[13px] font-semibold">{run.preset.name}</span>
                  <span className="ml-auto text-[11px] text-ink-faint">
                    <span className="font-mono text-ink">{run.rows.length}</span> of{" "}
                    <span className="font-mono">{run.evaluated}</span> in universe
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-ink-muted">{run.preset.description}</p>
              </div>

              {run.blockedFields.length > 0 && (
                <div className="flex items-start gap-2 border-b border-warn/25 bg-warn/5 px-3 py-2 text-[11px]">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warn" />
                  <div>
                    <span className="font-semibold text-warn">
                      This scanner cannot run on the current data feed.
                    </span>
                    <ul className="mt-1 space-y-0.5 text-ink-muted">
                      {run.blockedFields.map((b) => (
                        <li key={b.field}>
                          <span className="text-ink">{b.label}</span> — {b.reason}
                        </li>
                      ))}
                    </ul>
                    <div className="mt-1 text-ink-faint">
                      Required rules on missing data fail closed, so nothing is shown rather than a
                      misleading partial list.
                    </div>
                  </div>
                </div>
              )}

              {run.blockedFields.length === 0 && run.unknownSoftFields.length > 0 && (
                <div className="border-b border-border bg-bg-card px-3 py-1.5 text-[10px] text-ink-faint">
                  Preferred criteria not measurable on this feed (counted as unknown, never as met):{" "}
                  {run.unknownSoftFields.map((f) => f.label).join(", ")}.
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
