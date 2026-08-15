import { Flame, Zap } from "lucide-react";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

interface AlertRow {
  symbol: string;
  alert_type: string;
  price: string;
  resistance: string | null;
  vwap: string | null;
  distance_pct: string | null;
  coil_pct: string | null;
  strength: number | null;
  sector: string | null;
  message: string;
  scan_date: string;
}

export default async function AlertsPage() {
  const [breakouts, primed] = await Promise.all([
    query<AlertRow>(
      `select symbol, alert_type, price, resistance, vwap, distance_pct, coil_pct,
              strength, sector, message, scan_date::text
       from alerts
       where alert_type = 'Breakout' and scan_date >= current_date - 3
       order by strength desc nulls last, created_at desc limit 30`
    ),
    query<AlertRow>(
      `select symbol, alert_type, price, resistance, vwap, distance_pct, coil_pct,
              strength, sector, message, scan_date::text
       from alerts
       where alert_type = 'Primed' and scan_date >= current_date - 2
       order by strength desc nulls last, distance_pct asc limit 40`
    ),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Breakout Radar</h1>
        <p className="text-sm text-ink-muted">
          Stocks with EMA 9 &gt; 20 &gt; 50 stacked, holding above a rising anchored VWAP, coiled
          tight under a resistance lid. <span className="text-ink">Primed</span> = about to break;{" "}
          <span className="text-ink">Breakout</span> = the lid just gave way on volume. End-of-day
          scan, so signals are actionable at the next open (swing timeframe, not intraday ticks).
        </p>
      </div>

      {/* Breakouts triggered */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <Zap size={16} className="text-bull" />
          <h2 className="font-semibold">Breakouts Triggered ({breakouts.length})</h2>
          <span className="text-xs text-ink-faint">closed above resistance on volume, last 3 sessions</span>
        </div>
        {breakouts.length === 0 ? (
          <div className="card p-6 text-sm text-ink-muted">
            No fresh breakouts. When a Primed coil closes above its lid on 1.5x+ volume, it lands here.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {breakouts.map((a) => (
              <AlertCard key={`${a.symbol}-${a.scan_date}`} a={a} tone="bull" />
            ))}
          </div>
        )}
      </section>

      {/* Primed radar */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <Flame size={16} className="text-warn" />
          <h2 className="font-semibold">Primed To Break ({primed.length})</h2>
          <span className="text-xs text-ink-faint">coiled under resistance, ranked by how ready</span>
        </div>
        {primed.length === 0 ? (
          <div className="card p-6 text-sm text-ink-muted">
            Nothing coiled right now. This fills as stocks tighten under resistance with the EMA
            stack and VWAP aligned.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {primed.map((a) => (
              <AlertCard key={`${a.symbol}-${a.scan_date}`} a={a} tone="warn" />
            ))}
          </div>
        )}
      </section>

      <p className="text-xs text-ink-faint">
        Anchored VWAP is measured from the recent swing low (the accumulation average since the base
        formed). Strength scores how textbook the setup is: tighter coil, closer to the lid, healthy
        RSI, above the 200-day. Not a guarantee of a breakout, a ranking of which coils are most
        ready. Wire email delivery by adding a Resend key (see .env.example).
      </p>
    </div>
  );
}

function AlertCard({ a, tone }: { a: AlertRow; tone: "bull" | "warn" }) {
  const strength = Number(a.strength ?? 0);
  const border = tone === "bull" ? "border-bull/25" : "border-warn/25";
  return (
    <div className={`card ${border} p-4`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold">{a.symbol}</span>
            <span className="text-xs text-ink-faint">{a.sector}</span>
          </div>
          <div className="font-mono text-sm text-ink-muted">${Number(a.price)}</div>
        </div>
        <div className="text-right">
          <div className={`font-mono text-lg font-bold ${tone === "bull" ? "text-bull" : "text-warn"}`}>
            {strength}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-ink-faint">strength</div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-3 text-center">
        <Metric label="Resistance" value={a.resistance ? `$${Number(a.resistance)}` : "—"} />
        <Metric
          label={a.alert_type === "Breakout" ? "Broke by" : "To break"}
          value={a.distance_pct !== null ? `${Number(a.distance_pct)}%` : "—"}
        />
        <Metric label="Coil" value={a.coil_pct !== null ? `${Number(a.coil_pct)}%` : "—"} />
      </div>

      <p className="mt-3 text-xs leading-relaxed text-ink-muted">{a.message}</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-ink-faint">{label}</div>
      <div className="font-mono text-sm font-semibold">{value}</div>
    </div>
  );
}
