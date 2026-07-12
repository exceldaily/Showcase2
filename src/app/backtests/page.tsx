import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

interface StatRow {
  run_at: string;
  lookback_days: number;
  setup_type: string;
  direction: string;
  signals: number;
  wins: number;
  losses: number;
  win_rate: string;
  avg_r: string;
  profit_factor: string;
  avg_hold_days: string;
  notes: string;
}

export default async function BacktestsPage() {
  const rows = await query<StatRow>(
    `select run_at::text, lookback_days, setup_type, direction, signals, wins, losses,
            win_rate, avg_r, profit_factor, avg_hold_days, notes
     from backtest_stats
     where run_at = (select max(run_at) from backtest_stats)
     order by signals desc`
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Backtests</h1>
        <p className="text-sm text-ink-muted">
          The exact detection rules the live scanner uses, replayed over the cached bar history.
          Entries fill at the next session open. When a bar touches both the stop and the target,
          the stop counts first (conservative). Slippage and commissions are not modeled yet, so
          treat these as structure-quality validation, not net returns.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="card p-8 text-center text-sm text-ink-muted">
          No backtest run stored yet. The daily scan cron also refreshes this after each run.
        </div>
      ) : (
        <>
          <div className="text-xs text-ink-faint">
            Last run {rows[0].run_at} · ~{rows[0].lookback_days} sessions of history per symbol
          </div>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-ink-faint">
                  <th className="p-3">Setup</th>
                  <th className="p-3">Direction</th>
                  <th className="p-3 text-right">Signals</th>
                  <th className="p-3 text-right">Win rate</th>
                  <th className="p-3 text-right">Avg R</th>
                  <th className="p-3 text-right">Profit factor</th>
                  <th className="p-3 text-right">Avg hold</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const avgR = Number(r.avg_r);
                  const pf = Number(r.profit_factor);
                  return (
                    <tr key={`${r.setup_type}-${r.direction}`} className="border-b border-border/50">
                      <td className="p-3 font-semibold">{r.setup_type}</td>
                      <td className="p-3">
                        <span className={`pill ${r.direction === "Short" ? "bg-bear/15 text-bear" : "bg-bull/15 text-bull"}`}>
                          {r.direction}
                        </span>
                      </td>
                      <td className="p-3 text-right font-mono">{r.signals}</td>
                      <td className="p-3 text-right font-mono">{Number(r.win_rate).toFixed(0)}%</td>
                      <td className={`p-3 text-right font-mono font-semibold ${avgR > 0 ? "text-bull" : "text-bear"}`}>
                        {avgR > 0 ? "+" : ""}{avgR.toFixed(2)}R
                      </td>
                      <td className={`p-3 text-right font-mono ${pf >= 1.2 ? "text-bull" : pf >= 1 ? "text-warn" : "text-bear"}`}>
                        {pf.toFixed(2)}
                      </td>
                      <td className="p-3 text-right font-mono">{Number(r.avg_hold_days).toFixed(1)}d</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-ink-faint">
            Reading this honestly: a 3:1 target structure can be profitable well below a 50% win
            rate. Average R above zero and profit factor above 1.2 are the bars that matter. Small
            sample sizes (under ~30 signals) are noise, not validation.
          </p>
        </>
      )}
    </div>
  );
}
