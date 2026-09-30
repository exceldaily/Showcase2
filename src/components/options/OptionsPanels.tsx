"use client";

// Panels shared by the workspace:
//   BestContractCard  one side's best contract with what it is
//                     estimated to be worth at each level
//   ScannerTab        options-setup scanner over bluechip universes

import { hourlyDecay } from "@/lib/optionsMath";
import { scanGroup } from "@/lib/quality/watchlist";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { OptionsAnalysis, RankedContract } from "@/lib/optionsTerminal";
import { fmt$, pct, expiryLabel } from "@/lib/ui/format";
import { lifecycleTone, roomTone, scoreTone, signTone, TONE_TEXT } from "@/lib/ui/tone";
import { Chip, Seg, SkeletonRows, StateBox } from "@/components/ui/primitives";

export { fmt$, pct } from "@/lib/ui/format";

// ── Best contract ──

export function BestContractCard({
  analysis, side, onTicket, onCompare, canTicket, onPlan,
}: {
  analysis: OptionsAnalysis;
  side: "call" | "put";
  onTicket: (c: RankedContract) => void;
  onCompare: (symbol: string) => void;
  canTicket: boolean;
  onPlan?: (c: RankedContract) => void;
}) {
  const v = analysis.sides[side];
  const c = v.best;
  if (!c) return <div className="rounded-md bg-bg-elevated/60 p-2.5 text-sm text-ink-muted">No liquid {side}s in range.</div>;
  const t1 = v.ladder.find((r) => r.kind === "target" || r.kind === "level");
  const wrong = v.ladder.find((r) => r.kind === "wrong");
  const ret = (r: typeof t1) => (r && r.est && c.mid > 0 ? ((r.est.midEstimate - c.mid) / c.mid) * 100 : null);
  const thetaHr = c.dte <= 2 ? hourlyDecay(c, analysis.price, Date.parse(analysis.asOf)) : null;
  const spreadTone = c.spreadPct === null ? "muted" : c.spreadPct > 8 ? "warn" : "muted";
  return (
    <div className="rounded-md bg-bg-elevated/60 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="num text-md font-semibold">
          {c.strike}{side === "call" ? "C" : "P"} <span className="text-sm font-normal text-ink-muted">{expiryLabel(c.expiry, c.dte)}</span>
        </span>
        <span className="flex items-center gap-1.5">
          {c.stale && <Chip tone="bear">STALE</Chip>}
          <Chip tone={scoreTone(c.score)} title="Contract score, 0 to 100">{c.score}</Chip>
        </span>
      </div>
      <div className="mt-1.5 grid grid-cols-4 gap-x-2 text-sm">
        <div><div className="stat-label">Cost</div><div className="num">{fmt$(c.mid * 100, 0)}</div></div>
        <div><div className="stat-label">Delta</div><div className="num">{c.delta ?? "—"}</div></div>
        <div><div className="stat-label">Spread</div><div className={`num ${TONE_TEXT[spreadTone]}`}>{c.spreadPct ?? "—"}%</div></div>
        <div><div className="stat-label">Theta/hr</div><div className={`num ${thetaHr !== null ? "text-warn" : "text-ink-faint"}`}>{thetaHr !== null ? `-${fmt$(thetaHr, 0)}` : "—"}</div></div>
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-x-2 text-sm">
        <div>
          <div className="stat-label">At {t1 ? t1.label.toLowerCase() : "target"}</div>
          <div className="num">{t1?.est ? `${fmt$(t1.est.low)}–${fmt$(t1.est.high)}` : "—"} {ret(t1) !== null && <span className={TONE_TEXT[signTone(ret(t1))]}>{pct(ret(t1), 0)}</span>}</div>
        </div>
        <div>
          <div className="stat-label">If wrong</div>
          <div className="num">{wrong?.est ? `${fmt$(wrong.est.low)}–${fmt$(wrong.est.high)}` : "—"} {ret(wrong) !== null && <span className={TONE_TEXT[signTone(ret(wrong))]}>{pct(ret(wrong), 0)}</span>}</div>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-1">
        {onPlan && <button onClick={() => onPlan(c)} className="btn-ghost btn-sm">Plan trade</button>}
        {canTicket && <button onClick={() => onTicket(c)} className="btn-quiet btn-sm">Paper ticket</button>}
        <button onClick={() => onCompare(c.symbol)} className="btn-quiet btn-sm">Compare</button>
      </div>
      <details className="mt-1">
        <summary className="cursor-pointer text-xs text-ink-faint hover:text-ink">Why this contract · strike choices · alternatives</summary>
        <ul className="mt-1 space-y-0.5 text-xs text-ink-muted">
          {c.why.map((w, i) => <li key={i}>• {w}</li>)}
        </ul>
        {v.choices.length > 1 && (
          <table className="tbl mt-1 text-xs">
            <thead>
              <tr><th>Strike</th><th>Cost</th><th title="Stock reaches the first target soon">Hits target</th><th title="Stock is at the target when the option expires">At close</th><th title="Stock reaches the wrong line">Wrong</th><th title="Stock sits still for an hour">Sits 1h</th></tr>
            </thead>
            <tbody className="num">
              {v.choices.map((ch) => {
                const p = (o: { pct: number } | null) => (o === null ? "—" : `${o.pct >= 0 ? "+" : ""}${o.pct}%`);
                const tone = (o: { pct: number } | null) => (o === null ? "" : o.pct >= 0 ? "text-bull" : "text-bear");
                return (
                  <tr key={ch.symbol} className={ch.label === "Recommended" ? "text-ink" : "text-ink-muted"} title={ch.plain}>
                    <td>{ch.strike}{side === "call" ? "C" : "P"} <span className="text-2xs text-ink-faint">{ch.label.toLowerCase()}</span></td>
                    <td>${ch.perContract}</td>
                    <td className={tone(ch.atTarget)}>{p(ch.atTarget)}</td>
                    <td className={tone(ch.atTargetClose)}>{p(ch.atTargetClose)}</td>
                    <td className={tone(ch.atWrong)}>{p(ch.atWrong)}</td>
                    <td className={tone(ch.flatHour)}>{p(ch.flatHour)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {v.verdict && <div className="mt-1 text-xs leading-snug text-ink-muted">{v.verdict}</div>}
        {v.alternatives.map((a) => (
          <div key={a.symbol} className="mt-0.5 flex items-center justify-between font-mono text-xs text-ink-muted">
            <span>{a.strike}{side === "call" ? "C" : "P"} {a.expiry.slice(5)} · Δ{a.delta ?? "—"} · {a.spreadPct ?? "—"}% · {fmt$(a.mid)}</span>
            <span className="flex items-center gap-1">
              <span className="text-ink">{a.score}</span>
              <button onClick={() => onCompare(a.symbol)} className="btn-quiet btn-sm">+</button>
            </span>
          </div>
        ))}
      </details>
    </div>
  );
}

// ── Scanner ──

export interface ScanRowT {
  symbol: string; price: number | null; changePct: number | null; volumeRatio: number | null; analyzed: boolean;
  trend: string | null; trendConfidence: number | null; direction: string | null; state: string | null; lifecycle?: string | null;
  quality: number | null; opportunity: number | null; trigger: number | null; distanceToTriggerPct: number | null;
  roomGrade: string | null; rvol: number | null;
  bestCall: { strike: number; expiry: string; score: number; spreadPct: number | null; mid: number } | null;
  bestPut: { strike: number; expiry: string; score: number; spreadPct: number | null; mid: number } | null;
  t1HitRate: number | null;
  histConfirmed: number | null;
  call?: string | null;
  setupScore?: number | null;
  qualityLabel?: string | null;
  readState?: string | null;
  reason?: string | null;
}

type Universe = "megacaps" | "sp100" | "custom";
type SortKey = "opportunity" | "rvol" | "distance" | "changePct" | "symbol";

export function ScannerTab({ onPick, profile, active, compact = false }: { onPick: (sym: string) => void; profile: string; active?: string; compact?: boolean }) {
  const [universe, setUniverse] = useState<Universe>("megacaps");
  const [custom, setCustom] = useState<string[]>([]);
  const [addText, setAddText] = useState("");
  const [rows, setRows] = useState<ScanRowT[]>([]);
  const [meta, setMeta] = useState<{ analyzedCount: number; asOf: string; notes: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("opportunity");

  useEffect(() => {
    try {
      setCustom(JSON.parse(localStorage.getItem("af_options_watch") ?? "[]") as string[]);
    } catch { /* no saved list */ }
  }, []);

  const run = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const q = universe === "custom" ? `&symbols=${encodeURIComponent(custom.join(","))}` : "";
      const r = await fetch(`/api/options/scan?universe=${universe}${q}&top=10&profile=${profile}`, { cache: "no-store" });
      const j = (await r.json()) as { rows?: ScanRowT[]; analyzedCount?: number; asOf?: string; notes?: string[]; error?: string };
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setRows(j.rows ?? []);
      setMeta({ analyzedCount: j.analyzedCount ?? 0, asOf: j.asOf ?? new Date().toISOString(), notes: j.notes ?? [] });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "scan failed");
    } finally {
      setBusy(false);
    }
  }, [universe, custom, profile]);

  useEffect(() => { void run(); }, [run]);

  const saveCustom = (list: string[]) => {
    setCustom(list);
    try { localStorage.setItem("af_options_watch", JSON.stringify(list)); } catch { /* ignore */ }
  };

  const grouped = useMemo(() => {
    const cmp = (a: ScanRowT, b: ScanRowT) => {
      switch (sort) {
        case "rvol": return (b.rvol ?? -1) - (a.rvol ?? -1);
        case "distance": return Math.abs(a.distanceToTriggerPct ?? 99) - Math.abs(b.distanceToTriggerPct ?? 99);
        case "changePct": return Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0);
        case "symbol": return a.symbol.localeCompare(b.symbol);
        default: return (b.setupScore ?? b.opportunity ?? -1) - (a.setupScore ?? a.opportunity ?? -1);
      }
    };
    const groups: Record<string, ScanRowT[]> = { READY: [], "NEAR TRIGGER": [], WATCH: [], "NO SETUP": [] };
    for (const r of rows) groups[scanGroup(r)].push(r);
    for (const k of Object.keys(groups)) groups[k].sort(cmp);
    return groups;
  }, [rows, sort]);

  const groupTone = { READY: "bull", "NEAR TRIGGER": "warn", WATCH: "muted", "NO SETUP": "faint" } as const;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5">
        <Seg value={universe} onChange={setUniverse} options={[{ key: "megacaps", label: "Megacaps" }, { key: "sp100", label: "S&P 100" }, { key: "custom", label: `Mine (${custom.length})` }]} />
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="select py-0.5 text-xs" title="Sort within each group">
          <option value="opportunity">Setup score</option>
          <option value="rvol">Rel. volume</option>
          <option value="distance">Distance to trigger</option>
          <option value="changePct">% change</option>
          <option value="symbol">Ticker</option>
        </select>
        <button onClick={run} disabled={busy} className="btn-quiet btn-sm ml-auto" data-tip="Rescan">
          <RefreshCw size={11} className={busy ? "animate-spin" : ""} />
        </button>
      </div>
      {universe === "custom" && (
        <div className="px-2 pb-1.5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const syms = addText.toUpperCase().split(/[\s,]+/).filter((x) => /^[A-Z.]{1,6}$/.test(x));
              if (syms.length) saveCustom(Array.from(new Set([...custom, ...syms])).slice(0, 120));
              setAddText("");
            }}
            className="flex items-center gap-1"
          >
            <input value={addText} onChange={(e) => setAddText(e.target.value)} placeholder="Add: MU, AMD" className="input w-full py-0.5 font-mono text-xs uppercase" />
            <button type="submit" className="btn-ghost btn-sm">Add</button>
          </form>
          {custom.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {custom.map((c) => (
                <span key={c} className="pill bg-bg-elevated font-mono text-ink-muted">
                  {c}
                  <button onClick={() => saveCustom(custom.filter((x) => x !== c))} className="text-ink-faint hover:text-bear" title="Remove">×</button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {err && <div className="px-2 py-1 text-xs text-bear">{err}</div>}
      <div className="min-h-0 flex-1 overflow-auto">
        {busy && rows.length === 0 ? (
          <SkeletonRows rows={8} className="p-3" />
        ) : rows.length === 0 ? (
          <StateBox kind="empty" headline="No candidates" detail={meta?.notes[0] ?? null} />
        ) : (
          (["READY", "NEAR TRIGGER", "WATCH", "NO SETUP"] as const).map((g) => {
            const list = grouped[g];
            if (list.length === 0) return null;
            return (
              <div key={g}>
                <div className={`sticky top-0 z-[1] flex items-center gap-2 bg-bg-panel px-2 py-1 text-2xs font-semibold uppercase tracking-[0.1em] ${TONE_TEXT[groupTone[g]]}`}>
                  {g} <span className="text-ink-faint">{list.length}</span>
                </div>
                {list.map((r) => (
                  <ScanRow key={r.symbol} r={r} on={r.symbol === active} compact={compact} onPick={onPick} />
                ))}
              </div>
            );
          })
        )}
      </div>
      {meta && (
        <div className="px-2 py-1 text-2xs text-ink-faint" title={meta.notes.join(" · ")}>
          {meta.analyzedCount} analyzed · {new Date(meta.asOf).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
        </div>
      )}
    </div>
  );
}

const CALL_CHIP: Record<string, string> = {
  CALL: "bg-bull/15 text-bull", PUT: "bg-bear/15 text-bear", WAIT: "bg-bg-elevated text-ink-muted", "NO TRADE": "bg-bg-elevated text-ink-faint", "DO NOT CHASE": "bg-warn/12 text-warn",
};
const STATE_WORDS: Record<string, string> = {
  "NO SETUP": "No setup", WATCHING: "Watching", APPROACHING: "Approaching", TESTING: "Testing the level", "BREAK ATTEMPT": "Break attempt",
  "BREAKOUT CONFIRMED": "Confirmed", "FAILED BREAKOUT": "Failed breakout", "TARGET REACHED": "Target reached", "SESSION OVER": "Session over",
};

/** One watchlist row: ticker, price, what to do, how good the setup is, where it stands. Everything else lives in the panel. */
function ScanRow({ r, on, onPick }: { r: ScanRowT; on: boolean; compact: boolean; onPick: (s: string) => void }) {
  const call = r.call ?? (r.analyzed ? "WAIT" : null);
  const actionable = call === "CALL" || call === "PUT";
  const stateWord = r.readState ? STATE_WORDS[r.readState] ?? r.readState : r.lifecycle ?? (r.analyzed ? "No setup" : "Quick pass");
  const word = r.readState === "BREAKOUT CONFIRMED" || r.readState === "BREAK ATTEMPT" ? stateWord.replace("Break", r.direction === "short" ? "Breakdown" : "Break") : stateWord;
  return (
    <button
      onClick={() => onPick(r.symbol)}
      className={`flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors hover:bg-bg-hover/60 ${on ? "bg-brand/10" : ""} ${actionable ? "border-l-2 border-l-current " + (call === "CALL" ? "text-bull" : "text-bear") : "border-l-2 border-l-transparent"} ${r.analyzed ? "" : "opacity-60"}`}
      title={r.analyzed ? r.reason ?? undefined : "quick pass only (not in the most active ten)"}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={`num text-md font-semibold ${on ? "text-brand-glow" : "text-ink"}`}>{r.symbol}</span>
          <span className="num text-sm text-ink-muted">{fmt$(r.price)}</span>
          <span className={`num text-xs ${TONE_TEXT[signTone(r.changePct)]}`}>{pct(r.changePct)}</span>
        </div>
        <div className="truncate text-xs text-ink-faint">{word}{r.trigger !== null && r.readState && !["NO SETUP", "SESSION OVER"].includes(r.readState) ? <span className="num"> · {fmt$(r.trigger)}</span> : null}</div>
      </div>
      {call && <span className={`shrink-0 rounded px-1.5 py-0.5 text-2xs font-bold tracking-wide ${CALL_CHIP[call] ?? CALL_CHIP.WAIT}`}>{call === "DO NOT CHASE" ? "NO CHASE" : call}</span>}
      <span className={`num w-7 shrink-0 text-right text-md font-semibold ${r.setupScore == null ? "text-ink-faint" : r.setupScore >= 70 ? "text-bull" : r.setupScore >= 50 ? "text-warn" : "text-ink-faint"}`} title={r.setupScore == null ? "No setup score" : `Setup score ${r.setupScore} (${r.qualityLabel}). A score, not a probability.`}>{r.setupScore ?? "—"}</span>
    </button>
  );
}
