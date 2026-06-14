import { Sparkles } from "lucide-react";
import RegimeBanner from "@/components/RegimeBanner";
import SectorHeatmap from "@/components/SectorHeatmap";
import SetupCard from "@/components/SetupCard";
import { getDailyDigest, getRegime, getSectorStrength } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [regime, sectors, digest] = await Promise.all([
    getRegime(),
    getSectorStrength(),
    getDailyDigest(),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-ink-muted">
          {new Date().toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}{" "}
          · Daily catalyst digest
        </p>
      </div>

      <RegimeBanner regime={regime} />
      <SectorHeatmap sectors={sectors} />

      <DigestSection
        title="Top Conviction Trades"
        subtitle="Highest AlphaForge scores across all sectors"
        setups={digest.topTrades}
        emptyLabel="No trade today — nothing cleared the 80 score gate."
      />
      <DigestSection
        title="Emerging Growth"
        subtitle="$500M–$20B caps with 30%+ revenue growth and a sector tailwind"
        setups={digest.emergingGrowth}
        emptyLabel="No qualifying emerging-growth setups today."
      />
      <DigestSection
        title="Fresh IPOs"
        subtitle="Public within 36 months — base breakouts with institutional participation"
        setups={digest.freshIpos}
        emptyLabel="No qualifying fresh-IPO setups today."
      />
    </div>
  );
}

function DigestSection({
  title,
  subtitle,
  setups,
  emptyLabel,
}: {
  title: string;
  subtitle: string;
  setups: Awaited<ReturnType<typeof getDailyDigest>>["topTrades"];
  emptyLabel: string;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <Sparkles size={16} className="text-brand-glow" />
        <h2 className="font-semibold">{title}</h2>
        <span className="text-xs text-ink-faint">· {subtitle}</span>
      </div>
      {setups.length === 0 ? (
        <div className="card p-6 text-sm text-ink-muted">{emptyLabel}</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {setups.map((s) => (
            <SetupCard key={s.id} setup={s} />
          ))}
        </div>
      )}
    </section>
  );
}
