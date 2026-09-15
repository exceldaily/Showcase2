"use client";

// Options trade journal: trades, skipped setups, post-trade review and
// the statistics the trader asked for. Everything is recorded by hand;
// nothing is fetched from a broker.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { journalStats, rMultiple, type Bucket } from "@/lib/journal/stats";
import { REVIEW_TAGS, type TradeRecord } from "@/lib/journal/types";
import { etClock, fmt$, fmtPnl } from "@/lib/ui/format";
import { lifecycleTone, signTone, scoreTone, TONE_CHIP, TONE_TEXT, type Tone } from "@/lib/ui/tone";
import { Chip, Disclosure, Seg, SkeletonRows, Stat, StateBox } from "@/components/ui/primitives";

type Filter = "all" | "open" | "closed" | "skipped";

export default function JournalView() {
  const [trades, setTrades] = useState<TradeRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [review, setReview] = useState<TradeRecord | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/journal/trades", { cache: "no-store" });
      const j = (await r.json()) as { trades?: TradeRecord[]; error?: string };
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setTrades(j.trades ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "journal unavailable");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const stats = useMemo(() => (trades ? journalStats(trades) : null), [trades]);
  const rows = useMemo(() => (trades ?? []).filter((t) => filter === "all" || t.status === filter), [trades, filter]);

  const patch = async (id: string, body: Record<string, unknown>) => {
    await fetch("/api/journal/trades", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, ...body }) });
    await load();
  };
  const remove = async (id: string) => {
    if (!window.confirm("Delete this journal entry?")) return;
    await fetch(`/api/journal/trades?id=${id}`, { method: "DELETE" });
    await load();
  };

  return (
    <div className="full-bleed min-h-[calc(100vh-44px)] bg-bg px-4 py-4 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-lg font-semibold">Journal</div>
          <div className="text-xs text-ink-muted">Trades you recorded, setups you skipped, and what the numbers say. Manual entries only.</div>
        </div>
        <div className="flex items-center gap-2">
          <Seg value={filter} onChange={setFilter} options={[{ key: "all", label: "All" }, { key: "open", label: "Open" }, { key: "closed", label: "Closed" }, { key: "skipped", label: "Skipped" }]} />
          <Link href="/options" className="btn-ghost btn-sm">Back to the workspace</Link>
        </div>
      </div>

      {error && <StateBox kind="error" headline="JOURNAL UNAVAILABLE" detail={error} className="mt-6" />}
      {!trades && !error && <SkeletonRows rows={6} className="mt-6 max-w-lg" />}
      {trades && stats && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
            <Card label="Closed trades">{stats.closed}</Card>
            <Card label="Win rate" tone={scoreTone(stats.winRate)}>{stats.winRate !== null ? `${stats.winRate}%` : "—"}</Card>
            <Card label="Average R" tone={signTone(stats.avgR)}>{stats.avgR !== null ? `${stats.avgR}R` : "—"}</Card>
            <Card label="Profit factor" tone={stats.profitFactor === null ? "faint" : stats.profitFactor >= 1.5 ? "bull" : stats.profitFactor >= 1 ? "warn" : "bear"}>{stats.profitFactor === null ? "—" : stats.profitFactor === Infinity ? "∞" : stats.profitFactor}</Card>
            <Card label="Total P&L" tone={signTone(stats.totalPnl)}>{fmtPnl(stats.totalPnl)}</Card>
            <Card label="Avg winner / loser" tone="muted">{stats.avgWinner !== null ? fmtPnl(stats.avgWinner) : "—"} / {stats.avgLoser !== null ? fmtPnl(stats.avgLoser) : "—"}</Card>
            <Card label="Open / skipped" tone="muted">{stats.open} / {stats.skipped}</Card>
            <Card label="Skipped would have worked" tone={stats.skippedOutcomes.wouldHaveWorkedRate === null ? "faint" : stats.skippedOutcomes.wouldHaveWorkedRate >= 50 ? "warn" : "bull"} hint="Of the skipped setups that resolved, how many reached target 1 before the invalidation">{stats.skippedOutcomes.wouldHaveWorkedRate !== null ? `${stats.skippedOutcomes.wouldHaveWorkedRate}%` : "—"}</Card>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            <BucketTable title="By setup" buckets={stats.bySetup} best={stats.bestSetup} worst={stats.worstSetup} />
            <BucketTable title="By ticker" buckets={stats.byTicker} best={stats.bestTicker} worst={stats.worstTicker} />
            <BucketTable title="By hour (ET)" buckets={[...stats.byHour].sort((a, b) => a.key.localeCompare(b.key))} best={stats.bestHour} worst={stats.worstHour} />
            <BucketTable title="By weekday" buckets={stats.byWeekday} />
            <BucketTable title="By market state" buckets={stats.byMarketState} />
            <BucketTable title="By confidence" buckets={stats.byConfidence} />
            <BucketTable title="By expiration" buckets={stats.byExpiry} />
            <BucketTable title="By strike choice" buckets={stats.byStrikeTag} />
            <BucketTable title="By timeframe alignment" buckets={stats.byAlignment} />
          </div>

          {stats.behaviour.length > 0 && (
            <div className="mt-4 rounded-lg bg-bg-card p-3">
              <div className="panel-title">Behaviour (review tags)</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {stats.behaviour.map((b) => <Chip key={b.tag} tone={/FOLLOWED|GOOD/.test(b.tag) ? "bull" : "warn"}>{b.tag} · {b.count} · {fmtPnl(b.pnl)}</Chip>)}
              </div>
              <div className="mt-1 text-2xs text-ink-faint">Behaviour tags are separate from strategy results: a plan that works can still be executed badly, and the reverse.</div>
            </div>
          )}

          <div className="mt-4 overflow-x-auto rounded-lg bg-bg-card">
            <table className="tbl">
              <thead>
                <tr>{["When (ET)", "Symbol", "Status", "Contract", "Qty", "Entry", "Exit", "P&L", "R", "Setup", "State", "Conf.", "Tag", "Review", ""].map((h) => <th key={h}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((t) => {
                  const r = rMultiple(t);
                  return (
                    <tr key={t.id}>
                      <td className="num text-ink-muted">{t.entryAt.slice(0, 10)} {etClock(t.entryAt)}</td>
                      <td className="num font-semibold"><Link href={`/options?s=${t.symbol}`} className="hover:text-brand-glow">{t.symbol}</Link></td>
                      <td><Chip tone={t.status === "open" ? "mine" : t.status === "skipped" ? "muted" : signTone(t.pnl)}>{t.status.toUpperCase()}{t.status === "skipped" && t.outcome ? ` · ${t.outcome}` : ""}</Chip></td>
                      <td className="num">{t.strike !== null ? `${t.strike}${t.side === "call" ? "C" : t.side === "put" ? "P" : ""} ${t.expiry?.slice(5) ?? ""}` : "—"}</td>
                      <td className="num">{t.qty}</td>
                      <td className="num">{fmt$(t.entryPremium)}</td>
                      <td className="num">{fmt$(t.exitPremium)}</td>
                      <td className={`num font-semibold ${TONE_TEXT[signTone(t.pnl)]}`}>{t.pnl !== null ? fmtPnl(t.pnl) : "—"}</td>
                      <td className={`num ${TONE_TEXT[signTone(r)]}`}>{r !== null ? `${r}R` : "—"}</td>
                      <td className="text-ink-muted">{t.setup ?? "—"}{t.lifecycle && <span className={`ml-1 text-2xs ${TONE_TEXT[lifecycleTone(t.lifecycle)]}`}>{t.lifecycle}</span>}</td>
                      <td className="text-ink-muted">{t.marketState ?? "—"}</td>
                      <td className={`num ${TONE_TEXT[scoreTone(t.confidence)]}`}>{t.confidence !== null ? `${t.confidence}%` : "—"}</td>
                      <td className="text-2xs text-ink-faint">{t.strikeTag ?? ""}{t.aligned === false ? " · conflict" : ""}</td>
                      <td className="max-w-[220px] truncate text-xs text-ink-muted" title={[...t.reviewTags, t.notes ?? "", t.skippedReason ?? ""].filter(Boolean).join(" · ")}>{t.reviewTags.join(", ") || t.skippedReason || t.notes || ""}</td>
                      <td className="whitespace-nowrap">
                        {t.status === "open" && <button onClick={() => { const v = window.prompt("Exit premium per share?"); const n = Number(v); if (v !== null && n >= 0) void patch(t.id, { exitPremium: n }); }} className="btn-quiet btn-sm">Close</button>}
                        {t.status !== "open" && <button onClick={() => setReview(t)} className="btn-quiet btn-sm">Review</button>}
                        <button onClick={() => void remove(t.id)} className="btn-quiet btn-sm text-ink-faint hover:text-bear">Delete</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length === 0 && <StateBox kind="empty" headline="No entries yet" detail="Record a trade from the planner or the My trade panel, or mark a setup as skipped from the Trade Command Panel." />}
          </div>
        </>
      )}

      {review && (
        <ReviewDialog trade={review} onClose={() => setReview(null)} onSave={async (tags, notes) => { await patch(review.id, { reviewTags: tags, notes }); setReview(null); }} />
      )}
    </div>
  );
}

function Card({ label, children, tone = "ink", hint }: { label: string; children: React.ReactNode; tone?: Tone; hint?: string }) {
  return <div className="rounded-lg bg-bg-card p-3"><Stat label={label} tone={tone} size="lg" hint={hint}>{children}</Stat></div>;
}

function BucketTable({ title, buckets, best, worst }: { title: string; buckets: Bucket[]; best?: Bucket | null; worst?: Bucket | null }) {
  return (
    <div className="rounded-lg bg-bg-card p-3">
      <div className="flex items-center justify-between">
        <span className="panel-title">{title}</span>
        {best && worst && best.key !== worst.key && <span className="text-2xs text-ink-faint">best <span className="text-bull">{best.key}</span> · worst <span className="text-bear">{worst.key}</span></span>}
      </div>
      {buckets.length === 0 ? <div className="mt-1 text-xs text-ink-faint">No closed trades yet.</div> : (
        <table className="tbl mt-1 text-xs">
          <thead><tr><th className="!bg-transparent">Group</th><th className="!bg-transparent">Trades</th><th className="!bg-transparent">Win</th><th className="!bg-transparent">Avg R</th><th className="!bg-transparent">P&L</th></tr></thead>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.key}>
                <td className="text-ink">{b.key}</td>
                <td className="num text-ink-muted">{b.trades}</td>
                <td className={`num ${TONE_TEXT[scoreTone(b.winRate)]}`}>{b.winRate !== null ? `${b.winRate}%` : "—"}</td>
                <td className={`num ${TONE_TEXT[signTone(b.avgR)]}`}>{b.avgR !== null ? `${b.avgR}R` : "—"}</td>
                <td className={`num ${TONE_TEXT[signTone(b.pnl)]}`}>{fmtPnl(b.pnl)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ReviewDialog({ trade, onClose, onSave }: { trade: TradeRecord; onClose: () => void; onSave: (tags: string[], notes: string) => Promise<void> }) {
  const [tags, setTags] = useState<string[]>(trade.reviewTags);
  const [notes, setNotes] = useState(trade.notes ?? "");
  const [busy, setBusy] = useState(false);
  const toggle = (t: string) => setTags((v) => (v.includes(t) ? v.filter((x) => x !== t) : [...v, t]));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-lg bg-bg-card p-4 shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-baseline justify-between">
          <span className="text-md font-semibold">Review {trade.symbol} {trade.strike !== null ? `${trade.strike}${trade.side === "call" ? "C" : "P"}` : ""}</span>
          <span className={`num text-sm ${TONE_TEXT[signTone(trade.pnl)]}`}>{trade.pnl !== null ? fmtPnl(trade.pnl) : trade.status.toUpperCase()}</span>
        </div>
        <div className="mt-3 stat-label">How did the execution go?</div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {REVIEW_TAGS.map((t) => (
            <button key={t} onClick={() => toggle(t)} className={`pill ${tags.includes(t) ? TONE_CHIP[/FOLLOWED|GOOD/.test(t) ? "bull" : "warn"] : "bg-bg-elevated text-ink-faint hover:text-ink"}`}>{t}</button>
          ))}
        </div>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes: what you saw, what you would do differently" className="input mt-3 h-24 w-full text-sm" maxLength={2000} />
        {trade.snapshot && (
          <Disclosure title="Setup snapshot at entry">
            <div className="grid grid-cols-2 gap-x-3 text-xs text-ink-muted">
              <div>Verdict {trade.snapshot.verdict} · {trade.snapshot.bias}</div>
              <div>Lifecycle {trade.snapshot.lifecycle}</div>
              <div>Confidence {trade.snapshot.confluence?.pct ?? "—"}%</div>
              <div>RVOL {trade.snapshot.rvol?.toFixed(2) ?? "—"}x · slot {trade.snapshot.slot}</div>
              <div>Market {trade.snapshot.marketState ?? "—"}</div>
              <div>Align {trade.snapshot.align ? `${trade.snapshot.align.score}/10${trade.snapshot.align.conflict ? " conflict" : ""}` : "—"}</div>
              <div className="col-span-2">Matrix {trade.snapshot.matrix.map((m) => `${m.tf} ${m.trend}`).join(" · ")}</div>
            </div>
          </Disclosure>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost btn-sm">Cancel</button>
          <button onClick={async () => { setBusy(true); await onSave(tags, notes); setBusy(false); }} disabled={busy} className="btn-primary btn-sm">Save review</button>
        </div>
      </div>
    </div>
  );
}
