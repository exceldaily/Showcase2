import SetupCard from "@/components/SetupCard";
import { getSetups } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function ScannerPage() {
  const setups = await getSetups();
  const sorted = [...setups].sort((a, b) => b.scores.alphaforge - a.scores.alphaforge);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Scanner</h1>
          <p className="text-sm text-ink-muted">
            Setups scoring 80+ on the AlphaForge scale, sorted by conviction
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          <span className="pill bg-bg-hover text-ink-muted">{sorted.length} active setups</span>
          <span className="pill bg-bg-hover text-ink-muted">Min R/R 3:1</span>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {sorted.map((s) => (
          <SetupCard key={s.id} setup={s} />
        ))}
      </div>

      <p className="text-xs text-ink-faint">
        The scanner runs on a schedule once the Polygon and Neon database keys are connected. Until
        then it shows representative demo setups so you can see the full workflow.
      </p>
    </div>
  );
}
