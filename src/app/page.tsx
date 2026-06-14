import Link from "next/link";
import { ArrowRight, Brain, Gauge, LineChart, ShieldCheck, Target, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export default function Home() {
  return (
    <div className="space-y-20 py-8">
      {/* Hero */}
      <section className="text-center">
        <span className="pill bg-brand/15 text-brand-glow">AI-Powered Catalyst Scanner</span>
        <h1 className="mx-auto mt-5 max-w-3xl text-4xl font-bold leading-tight sm:text-5xl">
          Find high-conviction swing trades{" "}
          <span className="text-brand-glow">before the crowd</span>
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-ink-muted">
          AlphaForge scans AI, semiconductors, energy, crypto, biotech and fresh IPOs for
          catalyst-driven setups — with defined entries, structural stops, profit targets, and a
          quality-gated conviction score. Quality over quantity. No filler trades.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-lg bg-brand px-6 py-3 font-semibold text-white transition-colors hover:bg-brand-glow"
          >
            Open Dashboard <ArrowRight size={18} />
          </Link>
          <Link
            href="/scanner"
            className="inline-flex items-center gap-2 rounded-lg border border-border px-6 py-3 font-semibold transition-colors hover:bg-bg-hover"
          >
            View Scanner
          </Link>
        </div>
        <p className="mt-4 text-xs text-ink-faint">
          Research &amp; education tool. Not financial advice. Paper trading only.
        </p>
      </section>

      {/* Feature grid */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Feature icon={Brain} title="AI Catalyst Engine">
          Headlines, SEC filings, FDA decisions and contracts classified Level 1–4. Only Major and
          Transformational catalysts surface.
        </Feature>
        <Feature icon={Target} title="Structural Trade Plans">
          Every setup carries an entry zone, a stop at a real invalidation level, three targets, and
          a minimum 3:1 reward/risk — or it's rejected.
        </Feature>
        <Feature icon={ShieldCheck} title="Smart Money Score">
          Institutional accumulation, insider buying, revenue and earnings acceleration distilled
          into a 0–100 conviction signal.
        </Feature>
        <Feature icon={Gauge} title="Market Regime Aware">
          SPY/QQQ trend, VIX and breadth classify the market and gate trade aggressiveness before a
          single setup is generated.
        </Feature>
        <Feature icon={Zap} title="Quality Gate">
          A weighted AlphaForge Score filters to 80+ only. Some days the honest answer is "No trade
          today."
        </Feature>
        <Feature icon={LineChart} title="Paper Trading & Learning">
          Track simulated fills, win rate, profit factor and expectancy by sector, setup and regime —
          then learn what actually works.
        </Feature>
      </section>
    </div>
  );
}

function Feature({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-6">
      <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand/15">
        <Icon size={20} className="text-brand-glow" />
      </span>
      <h3 className="mt-4 font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">{children}</p>
    </div>
  );
}
