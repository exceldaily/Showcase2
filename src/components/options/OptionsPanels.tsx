"use client";

// Panels shared by the workspace:
//   BestContractCard  one side's best contract with what it is
//                     estimated to be worth at each level
//   ScannerTab        options-setup scanner over bluechip universes

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { OptionsAnalysis, RankedContract } from "@/lib/optionsTerminal";
import { fmt$, pct, expiryLabel } from "@/lib/ui/format";
import { lifecycleTone, roomTone, scoreTone, signTone, TONE_TEXT } from "@/lib/ui/tone";
import { Chip, Seg, SkeletonRows, StateBox } from "@/components/ui/primitives";

export { fmt$, pct } from "@/lib/ui/format";

// ── Best contract ──

export function BestContractCard({
  analysis, side, onTicket, onCompare, canTicket,
}: {
  analysis: OptionsAnalysis;
  side: "call" | "put";
  onTicket: (c: RankedContract) => void;
  onCompare: (symbol: string) => void;
  canTicket: boolean;
}) {
  const v = analysis.sides[side];
  const c = v.best;
  if (!c) return <div className="rounded-md bg-bg-elevated/60 p-2.5 text-sm text-ink-muted">No liquid {side}s in range.</div>;
  const t1 = v.ladder.find((r) => r.kind === "target" || r.kind === "level");
  const wrong = v.ladder.find((r) => r.kind === "wrong");
  const ret = (r: typeof t1) => (r && r.est && c.mid > 0 ? ((r.est.midEstimate - c.mid) / c.mid) * 100 : null);
  const thetaHr = c.theta !== null && c.dte <= 2 ? (Math.abs(c.theta) * 100) / 6.5 : null;
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
        {canTicket && <button onClick={() => onTicket(c)} className="btn-ghost btn-sm">Paper ticket</button>}
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
}

type Universe = "megacaps" | "sp100" | "custom";
type SortKey = "opportunity" | "rvol" | "distance" | "changePct" | "symbol";

const READY_STATES = ["CONFIRMED", "RETESTING", "CONTINUATION"];
const NEAR_STATES = ["APPROACHING", "FORMING", "TRIGGERED", "CONFIRMING"];

/** READY / NEAR TRIGGER / WATCH / NO SETUP grouping (pure). */
export function scanGroup(r: ScanRowT): "READY" | "NEAR TRIGGER" | "WATCH" | "NO SETUP" {
  if (!r.state || !r.trigger) return "NO SETUP";
  if (READY_STATES.includes(r.state)) return "READY";
  if (NEAR_STATES.includes(r.state)) return "NEAR TRIGGER";
  if (r.distanceToTriggerPct !== null && Math.abs(r.distanceToTriggerPct) <= 0.5) return "NEAR TRIGGER";
  return "WATCH";
}

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
        default: return (b.opportunity ?? -1) - (a.opportunity ?? -1);
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
          <option value="opportunity">Confidence</option>
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

function ScanRow({ r, on, compact, onPick }: { r: ScanRowT; on: boolean; compact: boolean; onPick: (s: string) => void }) {
  const dist = r.distanceToTriggerPct;
  return (
    <button
      onClick={() => onPick(r.symbol)}
      className={`flex w-full flex-col gap-0.5 px-2 py-1.5 text-left transition-colors hover:bg-bg-hover/60 ${on ? "bg-brand/10" : ""} ${r.analyzed ? "" : "opacity-60"}`}
      title={r.analyzed ? undefined : "quick pass only (not in the most active ten)"}
    >
      <div className="flex items-center gap-2">
        <span className={`num text-md font-semibold ${on ? "text-brand-glow" : "text-ink"}`}>{r.symbol}</span>
        <span className="num text-sm text-ink-muted">{fmt$(r.price)}</span>
        <span className={`num text-sm ${TONE_TEXT[signTone(r.changePct)]}`}>{pct(r.changePct)}</span>
        <span className="ml-auto flex items-center gap-1.5">
          {r.rvol !== null && <span className={`num text-xs ${r.rvol >= 1.5 ? "text-bull" : "text-ink-faint"}`} title="Relative volume">{r.rvol.toFixed(1)}x</span>}
          <span className={`num text-sm font-semibold ${TONE_TEXT[scoreTone(r.opportunity)]}`} title="Confidence">{r.opportunity ?? "—"}</span>
        </span>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className={`font-semibold ${r.direction === "short" ? "text-bear" : r.direction === "long" ? "text-bull" : "text-ink-faint"}`}>{r.direction === "short" ? (compact ? "BEAR" : "BEARISH") : r.direction === "long" ? (compact ? "BULL" : "BULLISH") : "—"}</span>
        <span className={`font-semibold ${TONE_TEXT[lifecycleTone(r.lifecycle ?? null, r.state)]}`}>{r.lifecycle ?? (r.state ? (compact ? r.state : `${r.state}`) : "NO SETUP")}{!compact && r.state && r.trigger !== null ? <span className="ml-1 font-normal text-ink-faint">5M {r.direction === "short" ? "BREAKDOWN" : "BREAKOUT"}</span> : null}</span>
        {!compact && r.trigger !== null && <span className="num text-ink-faint">trig {fmt$(r.trigger)}</span>}
        <span className="ml-auto flex items-center gap-1.5">
          {dist !== null && <span className={`num ${Math.abs(dist) <= 0.3 ? "text-warn" : "text-ink-faint"}`} title="Distance to trigger">{Math.abs(dist).toFixed(2)}%</span>}
          {r.roomGrade && <span className={`text-2xs ${TONE_TEXT[roomTone(r.roomGrade)]}`} title="Room to the next level">{r.roomGrade}</span>}
          {r.t1HitRate !== null && <span className={`num text-2xs ${TONE_TEXT[scoreTone(r.t1HitRate)]}`} title={`${r.histConfirmed} confirmed breaks in the history sample`}>H{r.t1HitRate}%</span>}
        </span>
      </div>
    </button>
  );
}
