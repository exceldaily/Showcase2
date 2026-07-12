import SetupCard from "@/components/SetupCard";
import { getSetups } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function ScannerPage() {
  const setups = await getSetups();
  const sorted = [...setups].sort((a, b) => b.scores.alphaforge - a.scores.alphaforge);
  const longs = sorted.filter((s) => s.direction !== "Short");
  const shorts = sorted.filter((s) => s.direction === "Short");

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Scanner</h1>
          <p className="text-sm text-ink-muted">
            Structural setups from the latest scan, both directions, sorted by conviction
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          <span className="pill bg-bull/10 text-bull">{longs.length} long</span>
          <span className="pill bg-bear/10 text-bear">{shorts.length} short</span>
          <span className="pill bg-bg-hover text-ink-muted">Min R/R 3:1</span>
        </div>
      </div>

      <section>
        <h2 className="mb-3 font-semibold text-bull">Long Setups</h2>
        {longs.length === 0 ? (
          <div className="card p-6 text-sm text-ink-muted">
            No long structures passed the filters in the latest scan.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {longs.map((s) => (
              <SetupCard key={s.id} setup={s} />
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center gap-3">
          <h2 className="font-semibold text-bear">Short Setups</h2>
          <span className="text-xs text-ink-faint">
            Thesis only: borrow availability and fees are not verified
          </span>
        </div>
        {shorts.length === 0 ? (
          <div className="card p-6 text-sm text-ink-muted">
            No short structures passed the filters in the latest scan.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {shorts.map((s) => (
              <SetupCard key={s.id} setup={s} />
            ))}
          </div>
        )}
      </section>

      <p className="text-xs text-ink-faint">
        End-of-day data. The scan runs each weekday morning; every setup shows the bar date its
        prices came from. Short candidates require a weak sector; longs require a strong one.
      </p>
    </div>
  );
}
