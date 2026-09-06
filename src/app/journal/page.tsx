import { BookOpen } from "lucide-react";
import StatusBar from "@/components/terminal/StatusBar";
import JournalForm from "@/components/terminal/JournalForm";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

interface EntryRow {
  id: string;
  symbol: string;
  trade_date: string | null;
  entry_price: string | null;
  exit_price: string | null;
  shares: string | null;
  pnl: string | null;
  setup: string | null;
  scanner_source: string | null;
  notes: string | null;
  mistakes: string | null;
  emotion: string | null;
  tags: string[] | null;
  market_context: Record<string, unknown> | null;
}

export default async function JournalPage() {
  const [entries, stats] = await Promise.all([
    query<EntryRow>(
      `select id, symbol, trade_date::text, entry_price, exit_price, shares, pnl,
              setup, scanner_source, notes, mistakes, emotion, tags, market_context
       from journal_entries order by trade_date desc nulls last, created_at desc limit 50`
    ),
    query<{ n: string; wins: string; total: string; avg_win: string; avg_loss: string }>(
      `select count(*)::int n,
              count(*) filter (where pnl > 0)::int wins,
              coalesce(sum(pnl),0)::numeric(12,2) total,
              coalesce(avg(pnl) filter (where pnl > 0),0)::numeric(12,2) avg_win,
              coalesce(avg(pnl) filter (where pnl < 0),0)::numeric(12,2) avg_loss
       from journal_entries where pnl is not null`
    ),
  ]);

  const s = stats[0];
  const n = Number(s?.n ?? 0);
  const wins = Number(s?.wins ?? 0);
  const winRate = n > 0 ? (wins / n) * 100 : null;

  // Repeated-mistake analysis (spec §43: find patterns, don't invent them).
  const mistakeCounts = new Map<string, number>();
  for (const e of entries) {
    if (!e.mistakes) continue;
    const key = e.mistakes.trim().toLowerCase();
    if (key) mistakeCounts.set(key, (mistakeCounts.get(key) ?? 0) + 1);
  }
  const topMistakes = Array.from(mistakeCounts.entries())
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return (
    <div className="-mx-4 -my-6 sm:-mx-6">
      <StatusBar />

      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <BookOpen size={14} className="text-ink-faint" />
        <h1 className="text-[13px] font-semibold">Trading Journal</h1>
        <span className="text-[11px] text-ink-muted">
          Log executed trades with context. Patterns are counted from what you record — never invented.
        </span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-5">
        {[
          { label: "Entries", value: String(n) },
          { label: "Win Rate", value: winRate !== null ? `${winRate.toFixed(0)}%` : "—" },
          { label: "Net P&L", value: n ? `$${Number(s.total).toFixed(2)}` : "—", tone: Number(s?.total ?? 0) >= 0 ? "bull" : "bear" },
          { label: "Avg Win", value: n ? `$${Number(s.avg_win).toFixed(2)}` : "—", tone: "bull" },
          { label: "Avg Loss", value: n ? `$${Number(s.avg_loss).toFixed(2)}` : "—", tone: "bear" },
        ].map((c) => (
          <div key={c.label} className="bg-bg px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-ink-faint">{c.label}</div>
            <div
              className={`font-mono text-lg font-bold ${
                c.tone === "bull" ? "text-bull" : c.tone === "bear" ? "text-bear" : "text-ink"
              }`}
            >
              {c.value}
            </div>
          </div>
        ))}
      </div>

      {topMistakes.length > 0 && (
        <div className="border-b border-warn/20 bg-warn/5 px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-warn">Repeated patterns</div>
          <ul className="mt-1 space-y-0.5">
            {topMistakes.map(([m, c]) => (
              <li key={m} className="text-[11px] text-ink-muted">
                <span className="font-mono text-warn">×{c}</span> {m}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col lg:flex-row">
        <div className="w-full shrink-0 border-b border-border lg:w-80 lg:border-b-0 lg:border-r">
          <JournalForm />
        </div>

        <div className="min-w-0 flex-1 overflow-x-auto">
          {entries.length === 0 ? (
            <div className="p-6 text-[12px] text-ink-muted">
              No journal entries yet. Log your first trade on the left.
            </div>
          ) : (
            <table className="w-full border-collapse text-[11px]">
              <thead className="bg-bg-card">
                <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-ink-faint">
                  {["Date", "Sym", "Setup", "Entry", "Exit", "Shares", "P&L", "Emotion", "Notes"].map((h) => (
                    <th key={h} className="whitespace-nowrap px-2 py-1.5 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => {
                  const pnl = e.pnl !== null ? Number(e.pnl) : null;
                  return (
                    <tr key={e.id} className="border-b border-border/40 hover:bg-bg-hover">
                      <td className="whitespace-nowrap px-2 py-1 font-mono text-ink-faint">{e.trade_date ?? "—"}</td>
                      <td className="px-2 py-1 font-semibold">{e.symbol}</td>
                      <td className="px-2 py-1 text-ink-muted">{e.setup ?? "—"}</td>
                      <td className="px-2 py-1 font-mono">{e.entry_price ? `$${Number(e.entry_price).toFixed(2)}` : "—"}</td>
                      <td className="px-2 py-1 font-mono">{e.exit_price ? `$${Number(e.exit_price).toFixed(2)}` : "—"}</td>
                      <td className="px-2 py-1 font-mono text-ink-muted">{e.shares ? Number(e.shares).toLocaleString() : "—"}</td>
                      <td className={`px-2 py-1 font-mono font-semibold ${pnl === null ? "text-ink-faint" : pnl >= 0 ? "text-bull" : "text-bear"}`}>
                        {pnl === null ? "—" : `${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`}
                      </td>
                      <td className="px-2 py-1 text-ink-muted">{e.emotion ?? "—"}</td>
                      <td className="max-w-[220px] truncate px-2 py-1 text-ink-faint" title={e.notes ?? ""}>
                        {e.notes ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
