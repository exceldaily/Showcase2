"use client";

// Morning watch strip: the top one to three names to watch into the
// open. Live premarket ranking (refreshes every 5 minutes before
// 9:30 ET), frozen for the day once locked (sweep at ~9:10 ET, or the
// owner). Cards show only what matters: bias, setup, state, trigger,
// target, score, distance.

import { useCallback, useEffect, useState } from "react";
import { Lock, RefreshCw } from "lucide-react";
import type { MorningWatch as Watch, WatchPick } from "@/lib/morningWatch";
import { dayLabel, etTime, fmt$, pct } from "@/lib/ui/format";
import { machineTone, scoreTone, TONE_TEXT, type Tone } from "@/lib/ui/tone";
import { Chip } from "@/components/ui/primitives";

const BIAS: Record<WatchPick["bias"], { label: string; tone: Tone }> = {
  calls: { label: "BULLISH", tone: "bull" },
  puts: { label: "BEARISH", tone: "bear" },
  either: { label: "NEUTRAL", tone: "muted" },
};

export interface LivePlan {
  symbol: string;
  direction: "long" | "short";
  trigger: number;
  invalidation: number;
  target: number;
  state: string;
  price: number | null;
}

export default function MorningWatch({ onLoad, isOwner, livePlan = null, onPicks, active }: { onLoad: (sym: string) => void; isOwner: boolean; livePlan?: LivePlan | null; onPicks?: (syms: string[]) => void; active?: string }) {
  const [data, setData] = useState<Watch | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [topN, setTopN] = useState(2);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    try {
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
      else {
        setData(d);
        onPicks?.(d.picks.map((p) => p.symbol));
      }
    } catch {
      setErr("network error");
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topN]);

  useEffect(() => {
    void load();
    const id = setInterval(() => { if (!data?.locked) void load(); }, 5 * 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

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

  function changeN(n: number) {
    setTopN(n);
    try { localStorage.setItem("af_morning_n", String(n)); } catch { /* ignore */ }
  }

  const status = data
    ? data.locked
      ? `locked ${data.lockedAt ? etTime(data.lockedAt) : ""}`
      : data.session === "premarket" ? `premarket, ${etTime(data.computedAt)}`
      : data.session === "rth" ? `live, ${etTime(data.computedAt)}`
      : `as of ${etTime(data.computedAt)}`
    : busy ? "loading" : "";

  return (
    <div className="bg-bg-panel px-3 py-1.5">
      <div className="flex items-center gap-2">
        <span className="panel-title">Today&apos;s watch</span>
        {data && <span className="text-xs text-ink-faint">{dayLabel(data.day)} · {status}</span>}
        {data?.locked && <Lock size={10} className="text-ink-faint" />}
        <span className="flex-1" />
        <select value={topN} onChange={(e) => changeN(Number(e.target.value))} className="select py-0 text-xs" title="How many names">
          {[1, 2, 3].map((n) => <option key={n} value={n}>top {n}</option>)}
        </select>
        <button onClick={() => load(true)} disabled={busy || Boolean(data?.locked)} className="btn-quiet h-6 px-1" data-tip={data?.locked ? "Locked for the day" : "Recompute now"}>
          <RefreshCw size={11} className={busy ? "animate-spin" : ""} />
        </button>
        {isOwner && data && !data.locked && (
          <button onClick={lock} disabled={busy} className="btn-ghost btn-sm" title="Freeze today's list and email it now"><Lock size={10} /> lock + email</button>
        )}
      </div>
      {err && <div className="mt-1 text-xs text-bear">{err}</div>}
      {!data && !err && <div className="mt-1 text-xs text-ink-faint">Ranking the universe…</div>}
      {data && data.picks.length === 0 && !err && <div className="mt-1 text-xs text-ink-faint">No clear pick yet.</div>}
      {data && data.picks.length > 0 && (
        <div className={`mt-1.5 grid gap-2 ${data.picks.length === 1 ? "lg:grid-cols-2" : data.picks.length === 2 ? "lg:grid-cols-2" : "lg:grid-cols-3"}`}>
          {data.picks.map((p) => {
            const open = expanded === p.symbol;
            const lp = livePlan && livePlan.symbol === p.symbol ? livePlan : null;
            const dirLong = lp ? lp.direction === "long" : p.bias !== "puts";
            const trigger = lp ? lp.trigger : p.trigger;
            const inval = lp ? lp.invalidation : p.invalidation;
            const target = lp ? lp.target : p.target;
            const state = lp ? lp.state : p.state;
            const price = lp?.price ?? p.price;
            const dist = trigger !== null && price ? Math.abs((trigger - price) / price) * 100 : null;
            const bias = lp ? (dirLong ? BIAS.calls : BIAS.puts) : BIAS[p.bias];
            const on = active === p.symbol;
            return (
              <div key={p.symbol} className={`rounded-md p-2 ${on ? "bg-brand/10" : "bg-bg-card"}`}>
                <div className="flex items-center gap-2">
                  <span className="text-2xs font-semibold text-ink-faint">#{p.rank}</span>
                  <button onClick={() => onLoad(p.symbol)} className="num text-md font-semibold text-ink hover:text-brand-glow" title="Load in the workspace">{p.symbol}</button>
                  <span className="num text-sm text-ink-muted">{fmt$(price)}</span>
                  <span className={`num text-sm ${p.gapPct >= 0 ? "text-bull" : "text-bear"}`}>{pct(p.gapPct)}</span>
                  <Chip tone={bias.tone}>{bias.label}</Chip>
                  <span className="ml-auto flex items-center gap-2">
                    <span className={`num text-sm font-semibold ${TONE_TEXT[scoreTone(p.score)]}`} title="Watch score: gap, premarket volume, level proximity, setup quality, history">{p.score}</span>
                    <button onClick={() => onLoad(p.symbol)} className="btn-primary btn-sm">Load</button>
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                  <span className={`font-semibold ${TONE_TEXT[machineTone(state)]}`}>{trigger !== null ? `5M ${dirLong ? "BREAKOUT" : "BREAKDOWN"} · ${state ?? "WATCHING"}` : "NO SETUP"}</span>
                  {trigger !== null && <span className="num text-ink-muted">Trigger <span className="text-ink">{fmt$(trigger)}</span></span>}
                  {target !== null && <span className="num text-ink-muted">Target <span className="text-ink">{fmt$(target)}</span></span>}
                  {inval !== null && <span className="num text-ink-muted">Invalid <span className="text-bear">{fmt$(inval)}</span></span>}
                  {dist !== null && <span className="num text-ink-muted">Dist <span className={dist <= 0.3 ? "text-warn" : "text-ink"}>{dist.toFixed(2)}%</span></span>}
                  {lp && <span className="text-2xs text-ink-faint" title="Live chart levels; the frozen morning numbers can differ">live</span>}
                </div>
                {p.play.buyLabel && (
                  <div className="mt-0.5 num text-xs text-ink-muted">
                    then 1 <span className="text-ink">{p.play.buyLabel}</span> ({p.play.dte !== null && p.play.dte <= 0 ? "expires today" : `exp ${p.play.expiry?.slice(5)}`}) ~${p.play.perContract}
                    {p.play.atTarget && <span className="text-bull"> · at target {p.play.atTarget.pct >= 0 ? "+" : ""}{p.play.atTarget.pct}%</span>}
                    {p.play.atWrong && <span className="text-bear"> · if wrong {p.play.atWrong.pct}%</span>}
                  </div>
                )}
                <button onClick={() => setExpanded(open ? null : p.symbol)} className="mt-0.5 text-2xs text-ink-faint hover:text-ink">{open ? "less" : "why this one"}</button>
                {open && (
                  <ul className="mt-1 space-y-0.5 text-xs text-ink-muted">
                    {p.why.map((w, i) => <li key={i}>• {w}</li>)}
                    {p.bestCall && <li>• Best call: {p.bestCall.strike}C exp {p.bestCall.expiry} at about ${p.bestCall.mid.toFixed(2)} (score {p.bestCall.score}).</li>}
                    {p.bestPut && <li>• Best put: {p.bestPut.strike}P exp {p.bestPut.expiry} at about ${p.bestPut.mid.toFixed(2)} (score {p.bestPut.score}).</li>}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
      {data && data.notes.length > 0 && <div className="mt-1 text-2xs text-ink-faint">{data.notes.join(" ")}</div>}
    </div>
  );
}
