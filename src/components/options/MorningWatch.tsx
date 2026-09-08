"use client";

// Morning watch strip: the top one or two names to watch into the open.
// Live premarket ranking (refreshes every 5 minutes before 9:30 ET),
// frozen for the day once locked (sweep at ~9:10 ET, or the owner).

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Lock, RefreshCw, Sunrise } from "lucide-react";
import type { MorningWatch as Watch, WatchPick } from "@/lib/morningWatch";

const BIAS_TONE: Record<WatchPick["bias"], string> = {
  calls: "bg-bull/15 text-bull",
  puts: "bg-bear/15 text-bear",
  either: "bg-warn/15 text-warn",
};

function etTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }) + " ET";
}

function dayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export default function MorningWatch({ onLoad, isOwner }: { onLoad: (sym: string) => void; isOwner: boolean }) {
  const [data, setData] = useState<Watch | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const [topN, setTopN] = useState(2);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    try {
      setHidden(localStorage.getItem("af_morning_hidden") === "1");
      const n = Number(localStorage.getItem("af_morning_n") ?? 2);
      if (n >= 1 && n <= 3) setTopN(n);
    } catch { /* ignore */ }
  }, []);

  const load = useCallback(async (refresh = false) => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/options/morning?n=${topN}${refresh ? "&refresh=1" : ""}`);
      const d = (await res.json()) as Watch & { error?: string };
      if (!res.ok || d.error) setErr(d.error ?? "could not load");
      else setData(d);
    } catch {
      setErr("network error");
    } finally {
      setBusy(false);
    }
  }, [topN]);

  useEffect(() => {
    if (hidden) return;
    void load();
    // Premarket moves fast; poll every 5 minutes until the list is locked.
    const id = setInterval(() => {
      if (data?.locked) return;
      void load();
    }, 5 * 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden, load]);

  async function lock() {
    if (!window.confirm("Freeze today's picks now and email them? The sweep does this automatically at 9:10 ET.")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/options/morning", { method: "POST" });
      const d = (await res.json()) as Watch & { error?: string; emailed?: boolean; emailReason?: string };
      if (!res.ok || d.error) setErr(d.error ?? "lock failed");
      else {
        setData(d);
        if (!d.emailed && d.emailReason && d.emailReason !== "already locked") setErr(`Locked, but email failed: ${d.emailReason}`);
      }
    } finally {
      setBusy(false);
    }
  }

  function toggleHidden() {
    const next = !hidden;
    setHidden(next);
    try { localStorage.setItem("af_morning_hidden", next ? "1" : "0"); } catch { /* ignore */ }
  }

  function changeN(n: number) {
    setTopN(n);
    try { localStorage.setItem("af_morning_n", String(n)); } catch { /* ignore */ }
  }

  const status = data
    ? data.locked
      ? `locked ${data.lockedAt ? etTime(data.lockedAt) : ""}`
      : data.session === "premarket" ? `live premarket, as of ${etTime(data.computedAt)}`
      : data.session === "rth" ? `live, as of ${etTime(data.computedAt)}`
      : `as of ${etTime(data.computedAt)}`
    : busy ? "loading" : "";

  return (
    <div className="border-b border-border bg-bg-card">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <Sunrise size={13} className="text-warn" />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Today&apos;s watch</span>
        {data && <span className="text-[10px] text-ink-muted">{dayLabel(data.day)} · {status}</span>}
        {data?.locked && <Lock size={10} className="text-ink-faint" />}
        <span className="flex-1" />
        {!hidden && (
          <>
            <label className="flex items-center gap-1 text-[10px] text-ink-faint">
              top
              <select value={topN} onChange={(e) => changeN(Number(e.target.value))} className="rounded border border-border bg-bg-elevated px-1 py-0.5 text-[10px] outline-none">
                {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <button onClick={() => load(true)} disabled={busy || Boolean(data?.locked)} className="text-ink-faint hover:text-ink disabled:opacity-40" title={data?.locked ? "Locked for the day" : "Recompute now"}>
              <RefreshCw size={11} className={busy ? "animate-spin" : ""} />
            </button>
            {isOwner && data && !data.locked && (
              <button onClick={lock} disabled={busy} className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] text-ink-muted hover:text-ink disabled:opacity-40" title="Freeze today's list and email it now">
                <Lock size={10} /> lock + email
              </button>
            )}
          </>
        )}
        <button onClick={toggleHidden} className="text-ink-faint hover:text-ink" title={hidden ? "Show" : "Hide"}>
          {hidden ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
        </button>
      </div>

      {!hidden && (
        <div className="px-3 pb-2">
          {err && <div className="text-[11px] text-bear">{err}</div>}
          {!data && !err && <div className="text-[11px] text-ink-faint">Ranking the universe…</div>}
          {data && data.picks.length === 0 && !err && <div className="text-[11px] text-ink-faint">No clear pick yet.</div>}
          {data && data.picks.length > 0 && (
            <div className={`grid gap-2 ${data.picks.length === 1 ? "" : data.picks.length === 2 ? "lg:grid-cols-2" : "lg:grid-cols-3"}`}>
              {data.picks.map((p) => {
                const open = expanded === p.symbol;
                const long = p.bias !== "puts";
                return (
                  <div key={p.symbol} className="rounded border border-border bg-bg-elevated/60 p-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[10px] font-bold text-ink-faint">#{p.rank}</span>
                      <button onClick={() => onLoad(p.symbol)} className="font-mono text-sm font-bold text-ink hover:text-brand-glow" title="Load in the terminal">
                        {p.symbol}
                      </button>
                      <span className="font-mono text-xs text-ink-muted">${p.price.toFixed(2)}</span>
                      <span className={`font-mono text-xs font-semibold ${p.gapPct >= 0 ? "text-bull" : "text-bear"}`}>
                        {p.gapPct >= 0 ? "+" : ""}{p.gapPct.toFixed(2)}%
                      </span>
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${BIAS_TONE[p.bias]}`}>
                        {p.bias === "either" ? "EITHER WAY" : `LEAN ${p.bias.toUpperCase()}`}
                      </span>
                      {p.state && <span className="text-[10px] text-ink-faint">{p.state}</span>}
                      <span className="flex-1" />
                      <span className="text-[10px] text-ink-faint" title="Watch score: gap, premarket volume, level proximity, setup quality, history">score {p.score}</span>
                      <button onClick={() => onLoad(p.symbol)} className="rounded bg-brand px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-brand-glow">Load</button>
                    </div>
                    <div className="mt-1 text-[11px] text-ink-muted">{p.why[0]}{p.why[2] ? ` ${p.why[2]}` : ""}</div>
                    {p.trigger !== null && (
                      <div className="mt-1 font-mono text-[10px] text-ink-muted">
                        <span className={long ? "text-bull" : "text-bear"}>{long ? "calls above" : "puts below"} ${p.trigger.toFixed(2)}</span>
                        {p.invalidation !== null && <span> · wrong {long ? "below" : "above"} ${p.invalidation.toFixed(2)}</span>}
                        {p.target !== null && <span> · target ${p.target.toFixed(2)}</span>}
                      </div>
                    )}
                    <button onClick={() => setExpanded(open ? null : p.symbol)} className="mt-1 text-[10px] text-ink-faint hover:text-ink">
                      {open ? "less" : "why this one"}
                    </button>
                    {open && (
                      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-ink-muted">
                        {p.why.map((w, i) => <li key={i}>{w}</li>)}
                        {p.bestCall && <li>Best call right now: {p.bestCall.strike}C exp {p.bestCall.expiry} at about ${p.bestCall.mid.toFixed(2)} (score {p.bestCall.score}).</li>}
                        {p.bestPut && <li>Best put right now: {p.bestPut.strike}P exp {p.bestPut.expiry} at about ${p.bestPut.mid.toFixed(2)} (score {p.bestPut.score}).</li>}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {data && data.notes.length > 0 && (
            <div className="mt-1 text-[10px] text-ink-faint">{data.notes.join(" ")}</div>
          )}
        </div>
      )}
    </div>
  );
}
