"use client";

// Beginner-clear panels for the options command center:
//   PlanCard    — plain-English "read this first" narration
//   SidesPanel  — best CALL and best PUT side by side, each with what
//                 the contract is estimated to be worth at each level
//   ScannerTab  — options-setup scanner over bluechip universes
// Shared formatting helpers live here so nothing is duplicated.

import { useCallback, useEffect, useState } from "react";
import { Activity, RefreshCw } from "lucide-react";
import type { OptionsAnalysis, RankedContract } from "@/lib/optionsTerminal";

export const STATE_TONE: Record<string, string> = {
  WATCHING: "text-ink-muted", APPROACHING: "text-warn", FORMING: "text-warn",
  TRIGGERED: "text-brand-glow", CONFIRMING: "text-brand-glow", CONFIRMED: "text-bull",
  RETESTING: "text-warn", CONTINUATION: "text-bull", FAILED: "text-bear", INVALIDATED: "text-bear",
};

export const fmt$ = (n: number | null | undefined, d = 2) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : `$${n.toFixed(d)}`);
export const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`);

// ── Plain-English plan card ──

export function PlanCard({ analysis }: { analysis: OptionsAnalysis }) {
  const m = analysis.machine;
  return (
    <div className="border-b border-border bg-bg-card px-2 py-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Read this first</span>
        {m && <span className={`text-[11px] font-bold ${STATE_TONE[m.state]}`}>{m.state}</span>}
      </div>
      <ul className="mt-1 space-y-1 text-[11px] leading-snug text-ink">
        {analysis.summary.map((line, i) => (
          <li key={i} className="flex gap-1.5">
            <span className="text-ink-faint">•</span>
            <span>{line}</span>
          </li>
        ))}
      </ul>
      {analysis.opportunity && (
        <div className="mt-1.5 flex items-center gap-2 text-[10px] text-ink-muted">
          <Activity size={10} className="text-brand-glow" />
          Overall setup score <span className="font-mono font-bold text-ink">{analysis.opportunity.total}/100</span>
          <span className="text-ink-faint">(breakdown under Details)</span>
        </div>
      )}
    </div>
  );
}

// ── Best call | best put with per-level value ladders ──

export function SidesPanel({
  analysis, onTicket, onCompare,
}: {
  analysis: OptionsAnalysis;
  onTicket: (c: RankedContract) => void;
  onCompare: (symbol: string) => void;
}) {
  const favored = analysis.direction === "long" ? "call" : "put";
  return (
    <div className="border-b border-border">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
        {(["call", "put"] as const).map((side) => {
          const v = analysis.sides[side];
          const c = v.best;
          const isFav = side === favored;
          return (
            <div key={side} className={`border-border px-2 py-2 ${side === "call" ? "sm:border-r xl:border-r-0 xl:border-b 2xl:border-b-0 2xl:border-r" : ""}`}>
              <div className="flex items-center justify-between">
                <span className={`text-[10px] font-bold uppercase tracking-wide ${side === "call" ? "text-bull" : "text-bear"}`}>Best {side}</span>
                {isFav ? (
                  <span className="rounded bg-brand/15 px-1.5 py-0.5 text-[9px] font-semibold text-brand-glow">matches trend</span>
                ) : (
                  <span className="text-[9px] text-ink-faint">against trend</span>
                )}
              </div>
              {!c ? (
                <div className="mt-1 text-[10px] text-ink-muted">No liquid {side}s in range.</div>
              ) : (
                <>
                  <div className="mt-1 font-mono text-[12px] font-bold">
                    {analysis.symbol} {c.strike} {side === "call" ? "C" : "P"} · exp {c.expiry.slice(5)}
                    <span className="ml-2 rounded bg-bg-elevated px-1.5 py-0.5 text-[10px] text-ink-muted">{c.score}/100</span>
                  </div>
                  <div className="mt-0.5 text-[10px] text-ink-muted">
                    Costs about <span className="font-mono text-ink">{fmt$(c.mid * 100, 0)}</span> per contract (mid {fmt$(c.mid)}), spread{" "}
                    <span className={c.spreadPct !== null && c.spreadPct > 8 ? "text-warn" : ""}>{c.spreadPct ?? "—"}%</span>, delta {c.delta ?? "—"}, {c.dte} days left.
                    {c.stale && <span className="ml-1 font-semibold text-bear">STALE QUOTE</span>}
                  </div>
                  <div className="mt-1 text-[9px] font-semibold uppercase text-ink-faint">If {analysis.symbol} reaches…</div>
                  <table className="mt-0.5 w-full text-[10px]">
                    <tbody>
                      {v.ladder.map((r, i) => {
                        const ret = r.est && c.mid > 0 ? ((r.est.midEstimate - c.mid) / c.mid) * 100 : null;
                        return (
                          <tr key={i} className={r.kind === "wrong" ? "text-bear" : "text-ink-muted"}>
                            <td className="py-[1px] pr-1">{r.label}</td>
                            <td className="py-[1px] pr-1 font-mono">{fmt$(r.price)}</td>
                            <td className="py-[1px] font-mono">
                              {r.est ? (
                                <>
                                  {fmt$(r.est.low)}–{fmt$(r.est.high)}
                                  {ret !== null && <span className={ret >= 0 ? " text-bull" : " text-bear"}>{` ${ret >= 0 ? "+" : ""}${ret.toFixed(0)}%`}</span>}
                                </>
                              ) : "—"}
                            </td>
                          </tr>
                        );
                      })}
                      {v.ladder.length === 0 && (
                        <tr><td colSpan={3} className="text-ink-faint">No strong levels in that direction within today’s structure.</td></tr>
                      )}
                    </tbody>
                  </table>
                  <div className="mt-1.5 flex gap-1">
                    <button onClick={() => onTicket(c)} className="rounded bg-brand/20 px-2 py-0.5 text-[10px] font-semibold text-brand-glow hover:bg-brand/30">Trade ticket</button>
                    <button onClick={() => onCompare(c.symbol)} className="rounded border border-border px-2 py-0.5 text-[10px] text-ink-muted hover:text-ink">+ Compare</button>
                  </div>
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[10px] text-ink-faint hover:text-ink">Why this one? Alternatives?</summary>
                    <ul className="mt-0.5 space-y-0.5 text-[10px] text-ink-muted">
                      {c.why.map((w, i) => <li key={i}>• {w}</li>)}
                    </ul>
                    {v.alternatives.map((a) => (
                      <div key={a.symbol} className="flex items-center justify-between font-mono text-[10px] text-ink-muted">
                        <span>{a.strike}{side === "call" ? "C" : "P"} {a.expiry.slice(5)} · Δ{a.delta ?? "—"} · {a.spreadPct ?? "—"}% · {fmt$(a.mid)}</span>
                        <span className="flex items-center gap-1">
                          <span className="text-ink">{a.score}</span>
                          <button onClick={() => onCompare(a.symbol)} className="text-ink-faint hover:text-ink" title="Add to compare">＋</button>
                        </span>
                      </div>
                    ))}
                  </details>
                </>
              )}
            </div>
          );
        })}
      </div>
      <p className="px-2 pb-1.5 text-[9px] leading-snug text-ink-faint">
        Values are model estimates (ranges span IV ±10%). Options can lose their entire premium. Nothing here is a prediction.
      </p>
    </div>
  );
}

// ── Scanner tab ──

interface ScanRowT {
  symbol: string; price: number | null; changePct: number | null; volumeRatio: number | null; analyzed: boolean;
  trend: string | null; trendConfidence: number | null; direction: string | null; state: string | null;
  quality: number | null; opportunity: number | null; trigger: number | null; distanceToTriggerPct: number | null;
  roomGrade: string | null; rvol: number | null;
  bestCall: { strike: number; expiry: string; score: number; spreadPct: number | null; mid: number } | null;
  bestPut: { strike: number; expiry: string; score: number; spreadPct: number | null; mid: number } | null;
}

export function ScannerTab({ onPick }: { onPick: (sym: string) => void }) {
  const [universe, setUniverse] = useState<"megacaps" | "sp100" | "custom">("megacaps");
  const [custom, setCustom] = useState<string[]>([]);
  const [addText, setAddText] = useState("");
  const [rows, setRows] = useState<ScanRowT[]>([]);
  const [meta, setMeta] = useState<{ analyzedCount: number; asOf: string; notes: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    try {
      setCustom(JSON.parse(localStorage.getItem("af_options_watch") ?? "[]") as string[]);
    } catch {
      /* no saved list */
    }
  }, []);

  const run = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const q = universe === "custom" ? `&symbols=${encodeURIComponent(custom.join(","))}` : "";
      const r = await fetch(`/api/options/scan?universe=${universe}${q}&top=10`, { cache: "no-store" });
      const j = (await r.json()) as { rows?: ScanRowT[]; analyzedCount?: number; asOf?: string; notes?: string[]; error?: string };
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setRows(j.rows ?? []);
      setMeta({ analyzedCount: j.analyzedCount ?? 0, asOf: j.asOf ?? new Date().toISOString(), notes: j.notes ?? [] });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "scan failed");
    } finally {
      setBusy(false);
    }
  }, [universe, custom]);

  useEffect(() => {
    void run();
  }, [run]);

  const saveCustom = (list: string[]) => {
    setCustom(list);
    try {
      localStorage.setItem("af_options_watch", JSON.stringify(list));
    } catch {
      /* ignore */
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-2 py-1 text-[10px]">
        {(["megacaps", "sp100", "custom"] as const).map((u) => (
          <button key={u} onClick={() => setUniverse(u)} className={`rounded border px-1.5 py-0.5 ${universe === u ? "border-brand/40 text-brand-glow" : "border-border text-ink-muted"}`}>
            {u === "megacaps" ? "Megacaps + ETFs" : u === "sp100" ? "S&P 100" : `My list (${custom.length})`}
          </button>
        ))}
        {universe === "custom" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const syms = addText.toUpperCase().split(/[\s,]+/).filter((x) => /^[A-Z.]{1,6}$/.test(x));
              if (syms.length) saveCustom(Array.from(new Set([...custom, ...syms])).slice(0, 120));
              setAddText("");
            }}
            className="flex items-center gap-1"
          >
            <input value={addText} onChange={(e) => setAddText(e.target.value)} placeholder="Add: MU, AMD, …" className="w-36 rounded border border-border bg-bg-elevated px-1.5 py-0.5 font-mono uppercase" />
            <button type="submit" className="rounded border border-border px-1.5 py-0.5 text-ink-muted hover:text-ink">Add</button>
          </form>
        )}
        <button onClick={run} disabled={busy} className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-ink-muted hover:text-ink disabled:opacity-40">
          <RefreshCw size={10} className={busy ? "animate-spin" : ""} /> {busy ? "Scanning…" : "Rescan"}
        </button>
        {meta && (
          <span className="ml-auto text-ink-faint">
            Full pipeline on the {meta.analyzedCount} most active, quick pass on the rest · {new Date(meta.asOf).toLocaleTimeString()}
          </span>
        )}
      </div>
      {err && <div className="px-2 py-1 text-[11px] text-bear">{err}</div>}
      {universe === "custom" && custom.length > 0 && (
        <div className="flex flex-wrap gap-1 border-b border-border px-2 py-1">
          {custom.map((c) => (
            <span key={c} className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
              {c}
              <button onClick={() => saveCustom(custom.filter((x) => x !== c))} className="text-ink-faint hover:text-bear" title="Remove">×</button>
            </span>
          ))}
        </div>
      )}
      <div className="max-h-96 overflow-auto">
        <table className="w-full border-collapse text-[11px]">
          <thead className="sticky top-0 bg-bg-card">
            <tr className="border-b border-border text-left text-[9px] uppercase tracking-wide text-ink-faint">
              {["Ticker", "Price", "Chg %", "Vol vs prev", "RVOL", "Trend", "Setup", "Trigger", "Dist %", "Room", "Best call", "Best put", "Score"].map((h) => (
                <th key={h} className="whitespace-nowrap px-1.5 py-1 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.symbol} onClick={() => onPick(r.symbol)} className={`cursor-pointer border-b border-border/40 hover:bg-bg-hover ${r.analyzed ? "" : "opacity-60"}`}>
                <td className="px-1.5 py-0.5 font-mono font-bold">{r.symbol}</td>
                <td className="px-1.5 py-0.5 font-mono">{fmt$(r.price)}</td>
                <td className={`px-1.5 py-0.5 font-mono ${(r.changePct ?? 0) >= 0 ? "text-bull" : "text-bear"}`}>{pct(r.changePct)}</td>
                <td className="px-1.5 py-0.5 font-mono text-ink-muted">{r.volumeRatio !== null ? `${r.volumeRatio}x` : "—"}</td>
                <td className="px-1.5 py-0.5 font-mono text-ink-muted">{r.rvol !== null ? `${r.rvol.toFixed(2)}x` : "—"}</td>
                <td className={`px-1.5 py-0.5 ${r.trend && /Bullish/.test(r.trend) ? "text-bull" : r.trend && /Bearish/.test(r.trend) ? "text-bear" : "text-ink-muted"}`}>{r.trend ?? (r.analyzed ? "—" : "quick pass")}</td>
                <td className={`px-1.5 py-0.5 font-semibold ${STATE_TONE[r.state ?? ""] ?? "text-ink-faint"}`}>{r.state ? `${r.direction === "short" ? "↓" : "↑"} ${r.state}` : "—"}</td>
                <td className="px-1.5 py-0.5 font-mono text-ink-muted">{fmt$(r.trigger)}</td>
                <td className="px-1.5 py-0.5 font-mono text-ink-muted">{r.distanceToTriggerPct !== null ? `${r.distanceToTriggerPct}%` : "—"}</td>
                <td className={`px-1.5 py-0.5 ${r.roomGrade === "POOR" ? "text-bear" : r.roomGrade === "GOOD" || r.roomGrade === "OPEN" ? "text-bull" : "text-ink-muted"}`}>{r.roomGrade ?? "—"}</td>
                <td className="px-1.5 py-0.5 font-mono text-ink-muted">{r.bestCall ? `${r.bestCall.strike}C ${r.bestCall.expiry.slice(5)} · ${r.bestCall.score}` : "—"}</td>
                <td className="px-1.5 py-0.5 font-mono text-ink-muted">{r.bestPut ? `${r.bestPut.strike}P ${r.bestPut.expiry.slice(5)} · ${r.bestPut.score}` : "—"}</td>
                <td className="px-1.5 py-0.5 font-mono font-bold">{r.opportunity ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && !busy && <div className="p-4 text-center text-[11px] text-ink-muted">No results.</div>}
        {busy && rows.length === 0 && <div className="p-4 text-center text-[11px] text-ink-muted">Scanning the universe (10-20s for the full pipeline)…</div>}
      </div>
      {meta && meta.notes.length > 0 && <div className="px-2 py-1 text-[9px] text-ink-faint">{meta.notes.slice(0, 3).join(" · ")}</div>}
    </div>
  );
}
