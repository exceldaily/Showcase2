"use client";

// Option chain: every contract the analysis scored, with the scorer's
// tags (BEST / ALTERNATIVE / AGGRESSIVE / CONSERVATIVE), warnings,
// break-even distance and estimated value at each plan level. Rows are
// windowed (only the visible slice renders) and expand to show the
// quality metrics, score parts and reasons behind the ranking.

import { useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import type { OptionsAnalysis, RankedContract } from "@/lib/optionsTerminal";
import { scenarioPrice } from "@/lib/optionsMath";
import { contractQuality, distanceToBreakEvenPct } from "@/lib/contractRank";
import { SCORE_PROFILES } from "@/lib/optionsScore";
import { fmt$, fmtInt, pct } from "@/lib/ui/format";
import { scoreTone, signTone, TONE_CHIP, TONE_TEXT, type Tone } from "@/lib/ui/tone";
import { Seg } from "@/components/ui/primitives";

type SortKey = "strike" | "score" | "mid" | "spreadPct" | "volume" | "openInterest" | "iv" | "delta" | "gamma" | "theta" | "beDist" | "estT1";
const ROW_H = 26;
const TAG_TONE: Record<string, Tone> = { BEST: "bull", ALTERNATIVE: "brand", AGGRESSIVE: "warn", CONSERVATIVE: "muted" };

interface Row extends RankedContract {
  beDist: number | null;
  estT1: number | null;
  estT2: number | null;
  estT3: number | null;
  estInv: number | null;
}

export default function ChainTab({
  analysis, compareSet, setCompareSet, onTicket, canTicket, onPlan, profile,
}: {
  analysis: OptionsAnalysis;
  compareSet: string[];
  setCompareSet: (fn: (v: string[]) => string[]) => void;
  onTicket: (c: RankedContract) => void;
  canTicket: boolean;
  onPlan: (c: RankedContract) => void;
  profile: string;
}) {
  const [side, setSide] = useState<"all" | "call" | "put">("all");
  const [expiry, setExpiry] = useState<string>("all");
  const [maxSpread, setMaxSpread] = useState(15);
  const [minOi, setMinOi] = useState(0);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "score", dir: -1 });
  const [open, setOpen] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(400);
  const hostRef = useRef<HTMLDivElement>(null);
  const maxSpreadPct = SCORE_PROFILES[profile]?.maxSpreadPct ?? 8;
  const price = analysis.price;
  const plan = analysis.plan;

  const expiries = useMemo(() => Array.from(new Set(analysis.contracts.map((c) => c.expiry))).sort(), [analysis]);
  const rows = useMemo<Row[]>(() => {
    const est = (c: RankedContract, target: number | undefined, minutes: number) =>
      target !== undefined && price ? scenarioPrice({ side: c.side, strike: c.strike, expiry: c.expiry, iv: c.iv, currentMid: c.mid, underlyingNow: price }, target, minutes).midEstimate : null;
    const list = analysis.contracts
      .filter((c) => (side === "all" ? true : c.side === side))
      .filter((c) => (expiry === "all" ? true : c.expiry === expiry))
      .filter((c) => c.spreadPct === null || c.spreadPct <= maxSpread)
      .filter((c) => c.openInterest >= minOi)
      .map((c) => ({
        ...c,
        beDist: distanceToBreakEvenPct(c, price),
        estT1: est(c, plan?.targets[0], 60), estT2: est(c, plan?.targets[1], 120), estT3: est(c, plan?.targets[2], 240), estInv: est(c, plan?.invalidation, 60),
      }));
    const val = (r: Row): number => {
      const v = r[sort.key];
      return v === null || v === undefined ? (sort.dir === 1 ? Infinity : -Infinity) : (v as number);
    };
    return list.sort((a, b) => (val(a) - val(b)) * sort.dir || a.strike - b.strike);
  }, [analysis, side, expiry, maxSpread, minOi, sort, price, plan]);

  const total = rows.length;
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - 5);
  const end = Math.min(total, Math.ceil((scrollTop + viewH) / ROW_H) + 5);
  const visible = rows.slice(start, end);
  const th = (label: string, key?: SortKey, tip?: string) => (
    <th key={label} onClick={key ? () => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === "strike" ? 1 : -1 })) : undefined} className={key ? "cursor-pointer select-none hover:text-ink" : ""} title={tip}>
      {label}{sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
    </th>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 px-2 py-1 text-xs">
        <Seg value={side} onChange={setSide} options={[{ key: "all", label: "All" }, { key: "call", label: "Calls" }, { key: "put", label: "Puts" }]} />
        <select value={expiry} onChange={(e) => setExpiry(e.target.value)} className="select py-0.5 text-xs">
          <option value="all">All expiries</option>
          {expiries.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <label className="flex items-center gap-1 text-ink-faint">
          Max spread <span className="num text-ink-muted">{maxSpread}%</span>
          <input type="range" min={2} max={30} value={maxSpread} onChange={(e) => setMaxSpread(Number(e.target.value))} className="w-20 align-middle accent-brand" />
        </label>
        <label className="flex items-center gap-1 text-ink-faint">
          Min OI <input type="number" value={minOi} onChange={(e) => setMinOi(Number(e.target.value) || 0)} className="input w-16 py-0.5 text-xs" />
        </label>
        <span className="ml-auto text-ink-faint">{total} contracts{analysis.indexMode ? " · CBOE delayed" : ""} · IV rank <span data-tip="Needs 20 sessions of stored implied volatility. Not supported by the current data provider yet." className="cursor-help underline decoration-dotted">n/a</span></span>
      </div>
      <div ref={hostRef} className="min-h-0 flex-1 overflow-auto" onScroll={(e) => { setScrollTop(e.currentTarget.scrollTop); setViewH(e.currentTarget.clientHeight); }}>
        <table className="tbl" style={{ tableLayout: "fixed", minWidth: 1500 }}>
          <thead>
            <tr>
              <th style={{ width: 24 }} />
              <th style={{ width: 24 }} />
              {th("Tag")}
              {th("Type")}
              {th("Strike", "strike")}
              {th("Exp")}
              {th("DTE")}
              {th("Bid")}
              {th("Ask")}
              {th("Mid", "mid")}
              {th("Spr%", "spreadPct", "Bid-ask spread as a percent of the mid")}
              {th("Vol", "volume")}
              {th("OI", "openInterest")}
              {th("IV", "iv")}
              {th("Δ", "delta", "Delta: option price change per $1 move in the stock")}
              {th("Γ", "gamma", "Gamma: how fast delta changes")}
              {th("Θ", "theta", "Theta: value lost per day, all else equal")}
              {th("V", undefined, "Vega: value change per 1 point of implied volatility")}
              {th("B/E")}
              {th("B/E %", "beDist", "Move needed in the stock to break even at expiry")}
              {th("Intr")}
              {th("Extr")}
              {th("Est T1", "estT1", "Estimated mid if the stock reaches target 1 within an hour (model)")}
              {th("Est T2")}
              {th("Est T3")}
              {th("Est Inv", undefined, "Estimated mid at the invalidation level (model)")}
              {th("Score", "score")}
              <th />
            </tr>
          </thead>
          <tbody>
            {start > 0 && <tr style={{ height: start * ROW_H }}><td colSpan={28} /></tr>}
            {visible.map((c) => {
              const isOpen = open === c.symbol;
              const ret = (v: number | null) => (v !== null && c.mid > 0 ? ((v - c.mid) / c.mid) * 100 : null);
              return [
                <tr key={c.symbol} data-on={c.tag === "BEST"} className={c.stale ? "opacity-50" : ""} style={{ height: ROW_H }}>
                  <td><button onClick={() => setOpen(isOpen ? null : c.symbol)} className="btn-quiet h-5 px-0.5" aria-label="Details">{isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</button></td>
                  <td><input type="checkbox" className="accent-brand" checked={compareSet.includes(c.symbol)} onChange={() => setCompareSet((v) => (v.includes(c.symbol) ? v.filter((x) => x !== c.symbol) : [...v, c.symbol].slice(-4)))} title="Compare" /></td>
                  <td>{c.tag && <span className={`pill !px-1 !py-0 text-2xs ${TONE_CHIP[TAG_TONE[c.tag]]}`}>{c.tag === "ALTERNATIVE" ? "ALT" : c.tag === "AGGRESSIVE" ? "AGGR" : c.tag === "CONSERVATIVE" ? "CONS" : "BEST"}</span>}</td>
                  <td className={`font-semibold ${c.side === "call" ? "text-bull" : "text-bear"}`}>{c.side === "call" ? "C" : "P"}</td>
                  <td className="num font-semibold">{c.strike}</td>
                  <td className="num text-ink-muted">{c.expiry.slice(5)}</td>
                  <td className="num text-ink-muted">{c.dte}</td>
                  <td className="num">{c.bid.toFixed(2)}</td>
                  <td className="num">{c.ask.toFixed(2)}</td>
                  <td className="num text-ink-muted">{c.mid.toFixed(2)}</td>
                  <td className={`num ${c.spreadPct !== null && c.spreadPct > maxSpreadPct ? "text-warn" : "text-ink-muted"}`}>{c.spreadPct ?? "—"}</td>
                  <td className={`num ${c.volume < 50 ? "text-warn" : "text-ink-muted"}`}>{fmtInt(c.volume)}</td>
                  <td className={`num ${c.openInterest < 100 ? "text-warn" : "text-ink-muted"}`}>{fmtInt(c.openInterest)}</td>
                  <td className={`num ${c.iv !== null && c.iv > 1.5 ? "text-warn" : "text-ink-muted"}`}>{c.iv !== null ? `${(c.iv * 100).toFixed(0)}%` : "—"}</td>
                  <td className="num">{c.delta ?? "—"}</td>
                  <td className="num text-ink-muted">{c.gamma ?? "—"}</td>
                  <td className="num text-ink-muted">{c.theta ?? "—"}</td>
                  <td className="num text-ink-muted">{c.vega ?? "—"}</td>
                  <td className="num text-ink-muted">{c.breakEven.toFixed(2)}</td>
                  <td className={`num ${c.beDist !== null && c.beDist > 2 ? "text-warn" : "text-ink-muted"}`}>{c.beDist !== null ? `${c.beDist.toFixed(2)}%` : "—"}</td>
                  <td className="num text-ink-muted">{c.intrinsic.toFixed(2)}</td>
                  <td className="num text-ink-muted">{c.extrinsic.toFixed(2)}</td>
                  <td className={`num ${TONE_TEXT[signTone(ret(c.estT1))]}`}>{c.estT1 !== null ? `${c.estT1.toFixed(2)} ${pct(ret(c.estT1), 0)}` : "—"}</td>
                  <td className={`num ${TONE_TEXT[signTone(ret(c.estT2))]}`}>{c.estT2 !== null ? c.estT2.toFixed(2) : "—"}</td>
                  <td className={`num ${TONE_TEXT[signTone(ret(c.estT3))]}`}>{c.estT3 !== null ? c.estT3.toFixed(2) : "—"}</td>
                  <td className={`num ${TONE_TEXT[signTone(ret(c.estInv))]}`}>{c.estInv !== null ? `${c.estInv.toFixed(2)} ${pct(ret(c.estInv), 0)}` : "—"}</td>
                  <td className={`num font-semibold ${TONE_TEXT[scoreTone(c.score)]}`}>{c.stale ? "STALE" : c.score}{c.warnings.length > 0 && <AlertTriangle size={11} className="ml-1 inline text-warn" aria-label={c.warnings.join("; ")} />}</td>
                  <td className="whitespace-nowrap">
                    <button onClick={() => onPlan(c)} className="btn-quiet btn-sm">Plan</button>
                    {canTicket && <button onClick={() => onTicket(c)} className="btn-quiet btn-sm">Ticket</button>}
                  </td>
                </tr>,
                isOpen ? <DetailRow key={`${c.symbol}-d`} c={c} maxSpreadPct={maxSpreadPct} /> : null,
              ];
            })}
            {end < total && <tr style={{ height: (total - end) * ROW_H }}><td colSpan={28} /></tr>}
          </tbody>
        </table>
        {total === 0 && <div className="p-4 text-center text-xs text-ink-muted">No contracts pass the filters.</div>}
      </div>
      <div className="px-2 py-1 text-2xs text-ink-faint">Estimates are model values (Black-Scholes at the contract&apos;s IV) if the stock reaches that level in the stated time. Direction being right does not guarantee the option gains; time and IV matter too.</div>
    </div>
  );
}

function DetailRow({ c, maxSpreadPct }: { c: RankedContract; maxSpreadPct: number }) {
  const q = contractQuality(c, maxSpreadPct);
  const cell = (label: string, value: string, tone: Tone = "ink") => (
    <div><div className="stat-label">{label}</div><div className={`num text-sm ${TONE_TEXT[tone]}`}>{value}</div></div>
  );
  return (
    <tr>
      <td colSpan={28} className="!whitespace-normal bg-bg-panel/60 px-4 py-2">
        <div className="flex flex-wrap gap-6">
          <div className="grid grid-cols-5 gap-x-4 gap-y-1">
            {cell("Liquidity", `${q.liquidity}/100`, scoreTone(q.liquidity))}
            {cell("Spread quality", `${q.spreadQuality}/100`, scoreTone(q.spreadQuality))}
            {cell("Theta impact", q.thetaImpactPct !== null ? `${q.thetaImpactPct}%/day` : "—", q.thetaImpactPct !== null && q.thetaImpactPct > 12 ? "warn" : "ink")}
            {cell("Directional sensitivity", q.directionalSensitivity !== null ? `${q.directionalSensitivity}` : "—")}
            {cell("Overall", `${q.overall}/100`, scoreTone(q.overall))}
          </div>
          {c.parts.length > 0 && (
            <div>
              <div className="stat-label mb-0.5">Score parts</div>
              <div className="grid grid-cols-3 gap-x-4 text-xs">
                {c.parts.map((p) => <span key={p.name} className="flex justify-between gap-2"><span className="text-ink-muted">{p.name}</span><span className={`num ${p.score / p.max >= 0.7 ? "text-bull" : p.score / p.max < 0.35 ? "text-bear" : "text-ink"}`}>{p.score}/{p.max}</span></span>)}
              </div>
            </div>
          )}
          <div className="min-w-[220px] text-xs">
            {c.why.length > 0 && <div className="stat-label mb-0.5">Why it ranks here</div>}
            {c.why.map((w, i) => <div key={i} className="text-ink-muted">• {w}</div>)}
            {c.penalties.map((p, i) => <div key={`p${i}`} className="text-warn">• {p}</div>)}
            {c.warnings.map((w, i) => <div key={`w${i}`} className="text-warn">• {w}</div>)}
            {c.greeksSource === "calculated" && <div className="text-ink-faint">Greeks are model-derived (provider sent none).</div>}
          </div>
        </div>
      </td>
    </tr>
  );
}
