import { query } from "@/lib/db";
import { DirectionBadge } from "@/components/ScoreBadge";

export const dynamic = "force-dynamic";

interface PositionRow {
  id: string;
  symbol: string;
  direction: "Long" | "Short";
  setup_type: string;
  score: number | null;
  status: string;
  entry_zone_low: string;
  entry_zone_high: string;
  entry_price: string | null;
  stop_loss: string;
  target_2: string;
  t1_hit: boolean;
  pnl_dollars: string | null;
  r_multiple: string | null;
  hold_days: number | null;
  exit_reason: string | null;
  watch_started: string | null;
  activated_at: string | null;
  closed_at: string | null;
}

async function cohortStats(cohort: string) {
  const rows = await query<{ n: string; wins: string; total_r: string; total_pnl: string; gross_pos: string; gross_neg: string; avg_hold: string }>(
    `select count(*)::int as n,
            count(*) filter (where r_multiple > 0)::int as wins,
            coalesce(sum(r_multiple), 0) as total_r,
            coalesce(sum(pnl_dollars), 0) as total_pnl,
            coalesce(sum(r_multiple) filter (where r_multiple > 0), 0) as gross_pos,
            coalesce(abs(sum(r_multiple) filter (where r_multiple < 0)), 0) as gross_neg,
            coalesce(avg(hold_days), 0) as avg_hold
     from paper_trades where status like 'Closed%' and cohort = $1`,
    [cohort]
  );
  return rows[0];
}

export default async function PaperTradingPage() {
  const [open, closedRecent, accountS, researchS] = await Promise.all([
    query<PositionRow>(
      `select id, symbol, direction, setup_type, score, status,
              entry_zone_low, entry_zone_high, entry_price, stop_loss, target_2, t1_hit,
              pnl_dollars, r_multiple, hold_days, exit_reason,
              watch_started::text, activated_at::text, closed_at::text
       from paper_trades where status in ('Watching','Active') and cohort = 'account'
       order by status desc, symbol`
    ),
    query<PositionRow>(
      `select id, symbol, direction, setup_type, score, status,
              entry_zone_low, entry_zone_high, entry_price, stop_loss, target_2, t1_hit,
              pnl_dollars, r_multiple, hold_days, exit_reason,
              watch_started::text, activated_at::text, closed_at::text
       from paper_trades where status like 'Closed%' and cohort = 'account'
       order by closed_at desc limit 25`
    ),
    cohortStats("account"),
    cohortStats("research"),
  ]);

  const n = Number(accountS?.n ?? 0);
  const winRate = n > 0 ? (Number(accountS.wins) / n) * 100 : null;
  const profitFactor = Number(accountS?.gross_neg ?? 0) > 0 ? Number(accountS.gross_pos) / Number(accountS.gross_neg) : null;
  const rn = Number(researchS?.n ?? 0);

  const cards = [
    { label: "Closed Trades", value: String(n), hint: "bot-recommended only" },
    { label: "Win Rate", value: winRate !== null ? `${winRate.toFixed(0)}%` : "—", hint: "R > 0" },
    { label: "Total R", value: n > 0 ? `${Number(accountS.total_r) > 0 ? "+" : ""}${Number(accountS.total_r).toFixed(1)}R` : "—", hint: "$20 risked per R" },
    { label: "Profit Factor", value: profitFactor !== null ? profitFactor.toFixed(2) : "—", hint: "gross win / gross loss" },
    { label: "Total P&L", value: n > 0 ? `$${Number(accountS.total_pnl).toFixed(2)}` : "—", hint: "risk-normalized sizing" },
    { label: "Avg Hold", value: n > 0 ? `${Number(accountS.avg_hold).toFixed(1)}d` : "—", hint: "sessions in trade" },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Paper Trading</h1>
        <p className="text-sm text-ink-muted">
          The ACCOUNT simulates only what the bot actually recommends: decisions above Avoid with
          scores of {""}60 or better, max 10 concurrent positions, fixed $20 risk per trade, no new
          longs in bear regimes. Every other signal (including Avoid tier) is tracked separately as
          research evidence and never touches the account ledger.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map((c) => (
          <div key={c.label} className="card p-4">
            <div className="text-xs text-ink-muted">{c.label}</div>
            <div className="mt-1 font-mono text-2xl font-bold">{c.value}</div>
            <div className="text-[11px] text-ink-faint">{c.hint}</div>
          </div>
        ))}
      </div>

      <div className="card border-warn/20 p-4 text-sm text-ink-muted">
        <span className="font-semibold text-ink">Research firehose (separate ledger):</span>{" "}
        {rn} closed signals tracked including Avoid tier, {Number(researchS?.total_r ?? 0).toFixed(1)}R total.
        This cohort exists to validate the scoring system with evidence; forward data so far confirms
        higher scores outperform lower ones. It is not the account.
      </div>

      <section>
        <h2 className="mb-3 font-semibold">Open Positions ({open.length})</h2>
        {open.length === 0 ? (
          <div className="card p-6 text-sm text-ink-muted">
            No open paper positions. New ones open automatically after each scan.
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-ink-faint">
                  <th className="p-3">Symbol</th>
                  <th className="p-3">Dir</th>
                  <th className="p-3">Setup</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Entry zone / fill</th>
                  <th className="p-3 text-right">Stop</th>
                  <th className="p-3 text-right">Target 2</th>
                  <th className="p-3 text-right">Score</th>
                </tr>
              </thead>
              <tbody>
                {open.map((p) => (
                  <tr key={p.id} className="border-b border-border/50">
                    <td className="p-3 font-semibold">{p.symbol.replace(/^X:/, "")}</td>
                    <td className="p-3"><DirectionBadge direction={p.direction} /></td>
                    <td className="p-3 text-ink-muted">{p.setup_type}</td>
                    <td className="p-3">
                      <span className={`pill ${p.status === "Active" ? "bg-brand/15 text-brand-glow" : "bg-bg-hover text-ink-muted"}`}>
                        {p.status}{p.t1_hit ? " · T1 hit" : ""}
                      </span>
                    </td>
                    <td className="p-3 text-right font-mono">
                      {p.status === "Active" && p.entry_price
                        ? `$${Number(p.entry_price)}`
                        : `$${Number(p.entry_zone_low)}–${Number(p.entry_zone_high)}`}
                    </td>
                    <td className="p-3 text-right font-mono text-bear">${Number(p.stop_loss)}</td>
                    <td className="p-3 text-right font-mono text-bull">${Number(p.target_2)}</td>
                    <td className="p-3 text-right font-mono">{p.score ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-semibold">Recently Closed</h2>
        {closedRecent.length === 0 ? (
          <div className="card p-6 text-sm text-ink-muted">
            Nothing closed yet. Outcomes appear here as stops, targets, or time exits hit.
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-ink-faint">
                  <th className="p-3">Symbol</th>
                  <th className="p-3">Dir</th>
                  <th className="p-3">Setup</th>
                  <th className="p-3">Outcome</th>
                  <th className="p-3 text-right">R</th>
                  <th className="p-3 text-right">P&L</th>
                  <th className="p-3 text-right">Held</th>
                </tr>
              </thead>
              <tbody>
                {closedRecent.map((p) => {
                  const r = Number(p.r_multiple ?? 0);
                  return (
                    <tr key={p.id} className="border-b border-border/50">
                      <td className="p-3 font-semibold">{p.symbol.replace(/^X:/, "")}</td>
                      <td className="p-3"><DirectionBadge direction={p.direction} /></td>
                      <td className="p-3 text-ink-muted">{p.setup_type}</td>
                      <td className="p-3 text-ink-muted">{p.exit_reason}</td>
                      <td className={`p-3 text-right font-mono font-semibold ${r > 0 ? "text-bull" : "text-bear"}`}>
                        {r > 0 ? "+" : ""}{r.toFixed(2)}R
                      </td>
                      <td className={`p-3 text-right font-mono ${Number(p.pnl_dollars) >= 0 ? "text-bull" : "text-bear"}`}>
                        ${Number(p.pnl_dollars ?? 0).toFixed(2)}
                      </td>
                      <td className="p-3 text-right font-mono">{p.hold_days ?? 0}d</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-xs text-ink-faint">
        Simulation notes: EOD fills against daily bars, no slippage or commissions modeled, one
        open position per symbol and direction, Watching entries expire after 5 sessions if the
        zone is never reached. Shorts are tracked as analysis only; borrow costs are not simulated.
      </p>
    </div>
  );
}
