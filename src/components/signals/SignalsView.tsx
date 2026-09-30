"use client";

// Signal analytics. Every number on this screen is counted from the
// signal log: levels the engine locked, what each model did with them,
// and how the entry turned out on that day's bars. Nothing is a forecast.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Chip, Seg, SkeletonRows, StateBox } from "@/components/ui/primitives";
import { TONE_TEXT, signTone, type Tone } from "@/lib/ui/tone";
import { fmt$ } from "@/lib/ui/format";
import { MEGACAPS } from "@/lib/universes";
import type { Bucket, ModelSummary } from "@/lib/signals/stats";

type Src = "all" | "replay" | "live";
type CondRow = Bucket & { key: string; group: string };
interface Recent { symbol: string; day: string; model: "old" | "new"; source: string; direction: "long" | "short"; trigger: number; status: string; blockedBy: string | null; firedAt: string | null; price: number | null; outcome: string | null; r: number | null; quality: number | null; rvol: number | null }
interface Payload {
  asOf: string; source: Src; days: number;
  sessions: { count: number; first: string | null; last: string | null };
  counts: { live: number; replay: number };
  models: { old: ModelSummary; new: ModelSummary };
  blocked: Bucket[];
  conditions: { old: CondRow[]; new: CondRow[] };
  symbols: { old: Bucket[]; new: Bucket[] };
  recent: Recent[];
  coverage: { symbol: string; first: string; last: string; sessions: number }[];
  isOwner: boolean;
}

const pctTone = (w: number | null): Tone => (w === null ? "faint" : w >= 50 ? "bull" : w >= 35 ? "warn" : "bear");
const rTone = (r: number | null): Tone => (r === null ? "faint" : r > 0.05 ? "bull" : r < -0.05 ? "bear" : "muted");
const fmtR = (r: number | null) => (r === null ? "—" : `${r > 0 ? "+" : ""}${r.toFixed(2)}R`);

function BucketRow({ b, label }: { b: Bucket; label?: React.ReactNode }) {
  return (
    <tr className={b.small ? "opacity-60" : ""}>
      <td className="text-ink">{label ?? b.name}{b.small && b.n > 0 && <span className="ml-1.5 text-2xs text-ink-faint">small sample</span>}</td>
      <td className="num text-ink-muted">{b.n}</td>
      <td className={`num font-semibold ${TONE_TEXT[pctTone(b.winRate)]}`}>{b.winRate !== null ? `${b.winRate}%` : "—"}</td>
      <td className={`num ${TONE_TEXT[rTone(b.avgR)]}`}>{fmtR(b.avgR)}</td>
      <td className={`num ${TONE_TEXT[rTone(b.totalR)]}`}>{b.totalR !== null ? `${b.totalR > 0 ? "+" : ""}${b.totalR.toFixed(1)}R` : "—"}</td>
      <td className="num text-ink-muted">{b.avgMae !== null ? `${b.avgMae.toFixed(2)}R` : "—"}</td>
      <td className="num text-ink-muted">{b.avgMfe !== null ? `${b.avgMfe.toFixed(2)}R` : "—"}</td>
      <td className="num text-ink-muted">{b.falseBreakRate !== null ? `${b.falseBreakRate}%` : "—"}</td>
    </tr>
  );
}
const HEAD = ["", "Signals", "Win rate", "Avg result", "Total", "Avg heat (MAE)", "Avg best (MFE)", "False break"];

export default function SignalsView() {
  const [source, setSource] = useState<Src>("all");
  const [model, setModel] = useState<"new" | "old">("new");
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch(`/api/signals?source=${source}&days=120`, { cache: "no-store" });
      const j = (await r.json()) as Payload & { error?: string };
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setData(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not load");
    }
  }, [source]);
  useEffect(() => { void load(); }, [load]);

  // Owner action: replay the newest sessions for the watch universe, one symbol per request.
  const update = useCallback(async () => {
    if (!data) return;
    let custom: string[] = [];
    try { custom = JSON.parse(localStorage.getItem("af_options_watch") ?? "[]") as string[]; } catch { /* none */ }
    const syms = Array.from(new Set([...MEGACAPS, ...data.coverage.map((c) => c.symbol), ...custom])).filter((s) => /^[A-Z.]{1,6}$/.test(s));
    let written = 0;
    for (let i = 0; i < syms.length; i++) {
      setBusy(`${syms[i]} (${i + 1} of ${syms.length})`);
      try {
        const r = await fetch(`/api/signals/replay?symbol=${syms[i]}&sessions=3`, { method: "POST" });
        const j = (await r.json()) as { written?: number };
        written += j.written ?? 0;
      } catch { /* next symbol */ }
    }
    setBusy(null);
    void load();
    return written;
  }, [data, load]);

  const groups = useMemo(() => {
    if (!data) return [] as { group: string; rows: CondRow[] }[];
    const out = new Map<string, CondRow[]>();
    for (const c of data.conditions[model]) { const a = out.get(c.group) ?? []; a.push(c); out.set(c.group, a); }
    return [...out.entries()].map(([group, rows]) => ({ group, rows }));
  }, [data, model]);

  return (
    <div className="full-bleed min-h-[calc(100vh-44px)] bg-bg px-4 py-4 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="max-w-3xl">
          <div className="text-lg font-semibold">Signals</div>
          <div className="text-xs text-ink-muted">What the engine&apos;s signals actually did. Counted from logged setups and that day&apos;s real bars. No forecasts, no invented probabilities.</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Seg value={source} onChange={setSource} options={[{ key: "all", label: "All" }, { key: "replay", label: "Replayed history", title: "The same engine stepped through past sessions, five minutes at a time, seeing only the bars that existed then" }, { key: "live", label: "Recorded live", title: "Logged while the app was analysing the symbol" }]} />
          {data?.isOwner && <button onClick={() => void update()} disabled={busy !== null} className="btn-ghost btn-sm" title="Replay the newest sessions for the megacap list and your own list">{busy ? `Replaying ${busy}` : "Update history"}</button>}
          <Link href="/options" className="btn-ghost btn-sm">Back to the workspace</Link>
        </div>
      </div>

      {error && <StateBox kind="error" headline="SIGNALS UNAVAILABLE" detail={error} className="mt-6" />}
      {!data && !error && <SkeletonRows rows={8} className="mt-6 max-w-lg" />}
      {data && data.models.new.setups + data.models.old.setups === 0 && <StateBox kind="empty" headline="NO SIGNALS LOGGED YET" detail={data.isOwner ? "Use Update history to replay recent sessions." : "Nothing has been recorded for this filter."} className="mt-6" />}

      {data && data.models.new.setups + data.models.old.setups > 0 && (
        <>
          <div className="mt-2 text-xs text-ink-faint">
            {data.sessions.count} sessions, {data.sessions.first} to {data.sessions.last}. {data.counts.replay.toLocaleString()} replayed setups, {data.counts.live.toLocaleString()} recorded live.
            Results are on the stock, in R (units of the risk from entry to the wrong line): out at target 1, stopped on a touch of the wrong line, otherwise the close. Option spread and time decay are not included, so real option results are lower.
          </div>

          {/* Old vs new */}
          <div className="mt-4 overflow-x-auto rounded-lg bg-bg-card p-3">
            <div className="panel-title">Old model vs new model</div>
            <div className="mt-0.5 text-xs text-ink-faint">Old: the original confirmation rules. New: the setup quality engine (closed candles only, volume on the break, a follow-through or a held retest, chop / chase / market / score gates). Both run on every logged setup.</div>
            <table className="tbl mt-2">
              <thead><tr>{["Model", "Setups", "Entries", "Per session", "Win rate", "Avg result", "Total", "Avg heat", "Avg best", "False break", "Held back", "Failed breaks", "Never triggered"].map((h) => <th key={h} className="!bg-transparent">{h}</th>)}</tr></thead>
              <tbody>
                {(["old", "new"] as const).map((m) => {
                  const s = data.models[m]; const e = s.entries;
                  return (
                    <tr key={m}>
                      <td className="font-semibold text-ink">{m === "old" ? "Old" : "New"}</td>
                      <td className="num text-ink-muted">{s.setups}</td>
                      <td className="num text-ink">{s.status.ENTRY}</td>
                      <td className="num text-ink-muted">{s.entriesPerSession ?? "—"}</td>
                      <td className={`num font-semibold ${TONE_TEXT[pctTone(e.winRate)]}`}>{e.winRate !== null ? `${e.winRate}%` : "—"}</td>
                      <td className={`num ${TONE_TEXT[rTone(e.avgR)]}`}>{fmtR(e.avgR)}</td>
                      <td className={`num ${TONE_TEXT[rTone(e.totalR)]}`}>{e.totalR !== null ? `${e.totalR > 0 ? "+" : ""}${e.totalR.toFixed(1)}R` : "—"}</td>
                      <td className="num text-ink-muted">{e.avgMae !== null ? `${e.avgMae.toFixed(2)}R` : "—"}</td>
                      <td className="num text-ink-muted">{e.avgMfe !== null ? `${e.avgMfe.toFixed(2)}R` : "—"}</td>
                      <td className="num text-ink-muted">{e.falseBreakRate !== null ? `${e.falseBreakRate}%` : "—"}</td>
                      <td className="num text-ink-muted">{s.status["NO ENTRY"]}</td>
                      <td className="num text-ink-muted">{s.status["FAILED BREAKOUT"]}</td>
                      <td className="num text-ink-muted">{s.status["NEVER TRIGGERED"]}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="mt-1 text-2xs text-ink-faint">An average result near zero on the stock is a losing trade on a same-day option once the spread and decay are paid. Neither model is assumed to be better: read the numbers.</div>
          </div>

          {/* What the gates held back */}
          {data.blocked.length > 0 && (
            <div className="mt-4 overflow-x-auto rounded-lg bg-bg-card p-3">
              <div className="panel-title">Confirmed breaks the new model held back</div>
              <div className="mt-0.5 text-xs text-ink-faint">Scored as if entered at the confirmation anyway. A negative average means the gate saved money; a positive one means it cost some.</div>
              <table className="tbl mt-2">
                <thead><tr>{HEAD.map((h, i) => <th key={i} className="!bg-transparent">{i === 0 ? "Held back because" : h}</th>)}</tr></thead>
                <tbody>{data.blocked.map((b) => <BucketRow key={b.name} b={b} />)}</tbody>
              </table>
            </div>
          )}

          {/* Conditions */}
          <div className="mt-4 rounded-lg bg-bg-card p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="panel-title">Which conditions went with results</div>
                <div className="mt-0.5 text-xs text-ink-faint">Entries from the {model} model, sliced by what was true at the moment of the signal. Rows with under 20 signals are dimmed: too few to read anything into.</div>
              </div>
              <Seg value={model} onChange={setModel} options={[{ key: "new", label: "New model" }, { key: "old", label: "Old model" }]} />
            </div>
            <div className="mt-2 overflow-x-auto">
              <table className="tbl">
                <thead><tr>{HEAD.map((h, i) => <th key={i} className="!bg-transparent">{i === 0 ? "Condition" : h}</th>)}</tr></thead>
                <tbody>
                  <BucketRow b={data.models[model].entries} label={<span className="font-semibold">All entries</span>} />
                  {groups.map((g) => [
                    <tr key={g.group}><td colSpan={8} className="!pt-2 text-2xs font-semibold uppercase tracking-[0.1em] text-ink-faint">{g.group}</td></tr>,
                    ...g.rows.filter((r) => r.n > 0).map((r) => <BucketRow key={r.key} b={r} />),
                  ])}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <div className="overflow-x-auto rounded-lg bg-bg-card p-3">
              <div className="panel-title">By ticker ({model} model)</div>
              <table className="tbl mt-2">
                <thead><tr>{HEAD.map((h, i) => <th key={i} className="!bg-transparent">{i === 0 ? "Ticker" : h}</th>)}</tr></thead>
                <tbody>{data.symbols[model].map((b) => <BucketRow key={b.name} b={b} label={<Link href={`/options?s=${b.name}`} className="num font-semibold hover:text-brand-glow">{b.name}</Link>} />)}</tbody>
              </table>
            </div>
            <div className="overflow-x-auto rounded-lg bg-bg-card p-3">
              <div className="panel-title">Most recent</div>
              <table className="tbl mt-2">
                <thead><tr>{["Day", "Ticker", "Model", "Side", "Level", "Entry", "What happened", "Result", "Score"].map((h) => <th key={h} className="!bg-transparent">{h}</th>)}</tr></thead>
                <tbody>
                  {data.recent.filter((r) => r.model === model).slice(0, 40).map((r, i) => (
                    <tr key={i}>
                      <td className="num text-ink-muted">{r.day.slice(5)}{r.source === "live" && <span className="ml-1 text-2xs text-brand-glow">live</span>}</td>
                      <td className="num font-semibold"><Link href={`/options?s=${r.symbol}`} className="hover:text-brand-glow">{r.symbol}</Link></td>
                      <td className="text-ink-faint">{r.model}</td>
                      <td className={r.direction === "long" ? "text-bull" : "text-bear"}>{r.direction === "long" ? "CALL" : "PUT"}</td>
                      <td className="num text-ink-muted">{fmt$(r.trigger)}</td>
                      <td className="num text-ink-muted">{fmt$(r.price)}</td>
                      <td>{r.status === "ENTRY" ? <Chip tone={r.outcome === "WIN" ? "bull" : r.outcome === "LOSS" ? "bear" : "muted"}>{r.outcome ?? "OPEN"}</Chip> : <span className="text-xs text-ink-faint" title={r.blockedBy ?? ""}>held back: {(r.blockedBy ?? "").split(":")[0].toLowerCase()}</span>}</td>
                      <td className={`num ${TONE_TEXT[signTone(r.r)]}`}>{fmtR(r.r)}</td>
                      <td className="num text-ink-muted">{r.quality ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
