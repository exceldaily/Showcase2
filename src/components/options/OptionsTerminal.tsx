"use client";

// Options command center: underlying-first workflow.
// Chart + Trade Map + setup machine + ranked contracts + chain +
// comparison + calculator + paper trading, all fed by the server
// analysis endpoint (Alpaca keys never reach this file).

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  Activity, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, CircleDot,
  Gauge, HelpCircle, RefreshCw, Search, XCircle,
} from "lucide-react";
import OptionsChart, { type ChartToggles } from "./OptionsChart";
import { PlanCard, ScannerTab, SidesPanel, STATE_TONE, fmt$, pct } from "./OptionsPanels";
import SirenBar from "./SirenBar";
import SetupsPanel from "./SetupsPanel";
import { resampleWeekly, type SetupTf } from "@/lib/multiTimeframe";
import { resample } from "@/lib/intraday";
import { blackScholes, breakEvenAtExpiry, intrinsicValue, scenarioPrice, yearsToExpiry } from "@/lib/optionsMath";
import type { OptionsAnalysis, RankedContract } from "@/lib/optionsTerminal";

type Broker = {
  connected: boolean;
  paper: boolean;
  liveEnabled: boolean;
  error?: string;
  account: { equity: number; buyingPower: number; optionsBuyingPower: number | null; optionsLevel: number | null } | null;
  clock: { isOpen: boolean; nextOpen: string; nextClose: string } | null;
  positions: {
    symbol: string; underlying: string; side: string | null; strike: number | null; expiry: string | null;
    qty: number; avgEntry: number; currentPrice: number | null; unrealizedPl: number | null;
    unrealizedPlPct: number | null; liveBid: number | null; liveAsk: number | null; quoteTs: string | null;
  }[];
  orders: {
    id: string; symbol: string; qty: number; filledQty: number; side: string; type: string;
    status: string; limitPrice: number | null; filledAvgPrice: number | null; submittedAt: string;
  }[];
};

const TF_CHOICES = [
  { key: "1m", label: "1m" }, { key: "5m", label: "5m" }, { key: "15m", label: "15m" },
  { key: "30m", label: "30m" }, { key: "1h", label: "1h" }, { key: "D", label: "D" }, { key: "W", label: "W" },
] as const;

export default function OptionsTerminal({ initialSymbol, initialTicket = null }: { initialSymbol: string; initialTicket?: string | null }) {
  const [symbol, setSymbol] = useState(initialSymbol);
  const [searchText, setSearchText] = useState(initialSymbol);
  const [profile, setProfileState] = useState("DAY");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("af_profile");
      if (saved) setProfileState(saved);
    } catch {
      /* no saved profile */
    }
  }, []);
  const setProfile = (p: string) => {
    setProfileState(p);
    try {
      localStorage.setItem("af_profile", p);
    } catch {
      /* ignore */
    }
  };
  const [tf, setTf] = useState<(typeof TF_CHOICES)[number]["key"]>("5m");
  const [toggles, setToggles] = useState<ChartToggles>({ vwap: true, emas: true, zones: true, plan: true });
  const [minStrength, setMinStrength] = useState(65);
  const [analysis, setAnalysis] = useState<OptionsAnalysis | null>(null);
  const [broker, setBroker] = useState<Broker | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [tab, setTab] = useState<"scan" | "chain" | "compare" | "calc" | "broker">("chain");
  const [compareSet, setCompareSet] = useState<string[]>([]);
  const [ticket, setTicket] = useState<RankedContract | null>(null);
  const [replayAt, setReplayAt] = useState<string>("");
  const [railOpen, setRailOpen] = useState(true);
  // Which timeframe's setup drives the chart's plan lines (5m primary).
  const [setupTf, setSetupTf] = useState<SetupTf>("5m");
  const [notesOpen, setNotesOpen] = useState(false);
  const [chartH, setChartH] = useState(460);
  const searchRef = useRef<HTMLInputElement>(null);

  // Chart fills the viewport height (minus bars/tabs) instead of a fixed 460px.
  useEffect(() => {
    const fit = () => setChartH(Math.max(380, Math.min(760, window.innerHeight - 330)));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  // Keyboard: "/" search, 1-6 timeframes, "s" scanner rail, Esc closes the ticket.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) {
        if (e.key === "Escape") (t as HTMLInputElement).blur();
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (/^[1-6]$/.test(e.key)) {
        setTf(TF_CHOICES[Number(e.key) - 1].key);
      } else if (e.key.toLowerCase() === "s") {
        setRailOpen((v) => !v);
      } else if (e.key === "Escape") {
        setTicket(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const fetchAnalysis = useCallback(async () => {
    try {
      const at = replayAt ? `&at=${encodeURIComponent(new Date(replayAt).toISOString())}` : "";
      const r = await fetch(`/api/options/analyze?symbol=${symbol}&profile=${profile}${at}`, { cache: "no-store" });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `HTTP ${r.status}`);
      setAnalysis((await r.json()) as OptionsAnalysis);
      setFetchError(null);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "analysis failed");
    } finally {
      setLoading(false);
    }
  }, [symbol, profile, replayAt]);

  // History stats (volume profile + breakout backtest) are computed in
  // the background once per symbol per day; when they land, the next
  // analysis refresh picks them up from the cache.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/options/history?symbol=${symbol}`, { cache: "no-store" });
        const j = (await r.json().catch(() => null)) as { cached?: boolean } | null;
        if (!cancelled && r.ok && j && j.cached === false) void fetchAnalysis();
      } catch {
        /* history is optional */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  const fetchBroker = useCallback(async () => {
    try {
      const r = await fetch("/api/broker/summary", { cache: "no-store" });
      setBroker((await r.json()) as Broker);
    } catch {
      /* transient */
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void fetchAnalysis();
    void fetchBroker();
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      void fetchAnalysis();
    };
    const brokerTick = () => {
      if (document.visibilityState !== "visible") return;
      void fetchBroker();
    };
    const marketOpen = analysis?.marketOpen ?? false;
    const a = setInterval(tick, marketOpen ? 5_000 : 30_000);
    const b = setInterval(brokerTick, 10_000);
    return () => {
      clearInterval(a);
      clearInterval(b);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchAnalysis, fetchBroker, analysis?.marketOpen]);

  // Deep link from a siren alert: open the prefilled ticket once the
  // contract is in the loaded chain. Still review-and-confirm; nothing
  // is placed automatically.
  const ticketOpened = useRef(false);
  useEffect(() => {
    if (!initialTicket || ticketOpened.current || !analysis) return;
    const c = analysis.contracts.find((x) => x.symbol === initialTicket);
    if (c) {
      ticketOpened.current = true;
      setTicket(c);
    }
  }, [analysis, initialTicket]);

  const chartBars = useMemo(() => {
    if (!analysis) return [];
    switch (tf) {
      case "1m": return analysis.bars.m1;
      case "5m": return analysis.bars.m5;
      case "15m": return analysis.bars.m15;
      case "30m": return resample(analysis.bars.m1, 30);
      case "1h": return resample(analysis.bars.m1, 60);
      case "D": return analysis.bars.daily;
      case "W": return resampleWeekly(analysis.bars.daily);
    }
  }, [analysis, tf]);

  const compared = useMemo(
    () => (analysis ? analysis.contracts.filter((c) => compareSet.includes(c.symbol)) : []),
    [analysis, compareSet]
  );

  return (
    <div className="-mx-4 -my-8 flex min-h-[calc(100vh-64px)] flex-col sm:-mx-6">
      <CommandBar
        searchRef={searchRef}
        searchText={searchText} setSearchText={setSearchText}
        onSearch={() => {
          const s = searchText.trim().toUpperCase();
          if (/^[A-Z.]{1,6}$/.test(s)) {
            setSymbol(s);
            setCompareSet([]);
            setTicket(null);
          }
        }}
        analysis={analysis} broker={broker} profile={profile} setProfile={setProfile}
        replayAt={replayAt} setReplayAt={setReplayAt}
        railOpen={railOpen} setRailOpen={setRailOpen}
        notesOpen={notesOpen} setNotesOpen={setNotesOpen}
        siren={
          <SirenBar
            analysis={analysis}
            onLoad={(sym) => {
              setSearchText(sym);
              setSymbol(sym);
              setCompareSet([]);
              setTicket(null);
            }}
          />
        }
      />

      {fetchError && (
        <div className="flex items-center gap-2 border-b border-bear/30 bg-bear/10 px-3 py-1.5 text-[11px] text-bear">
          <XCircle size={12} /> {fetchError}
        </div>
      )}
      {notesOpen && analysis && analysis.notes.length > 0 && (
        <div className="border-b border-border bg-bg-card px-3 py-1">
          {analysis.notes.map((n, i) => (
            <div key={i} className="flex items-center gap-2 text-[10px] text-ink-faint">
              <AlertTriangle size={10} className="text-warn" /> {n}
            </div>
          ))}
        </div>
      )}

      {loading && !analysis ? (
        <div className="p-10 text-center text-xs text-ink-muted">Loading analysis…</div>
      ) : !analysis || !analysis.connected ? (
        <div className="p-10 text-center text-xs text-ink-muted">
          Not connected to Alpaca. Add ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY to the environment.
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
          {/* Left rail: scanner */}
          {railOpen && (
            <aside className="hidden w-[300px] shrink-0 border-r border-border xl:block">
              <div className="flex items-center justify-between border-b border-border px-2 py-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Scanner</span>
                <button onClick={() => setRailOpen(false)} className="text-[10px] text-ink-faint hover:text-ink" title="Hide scanner (S)">hide</button>
              </div>
              <div className="xl:sticky xl:top-[64px] xl:max-h-[calc(100vh-110px)] xl:overflow-y-auto">
                <ScannerTab
                  profile={profile}
                  compact
                  onPick={(sym) => {
                    setSearchText(sym);
                    setSymbol(sym);
                    setCompareSet([]);
                    setTicket(null);
                  }}
                />
              </div>
            </aside>
          )}

          {/* Center: chart + tabs */}
          <div className="flex min-w-0 flex-1 flex-col border-b border-border xl:border-b-0 xl:border-r">
            <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1">
              {!railOpen && (
                <button onClick={() => setRailOpen(true)} className="mr-1 hidden rounded border border-border px-1.5 py-0.5 text-[10px] text-ink-muted hover:text-ink xl:inline" title="Show scanner (S)">
                  ⟨ scanner
                </button>
              )}
              {TF_CHOICES.map((t, i) => (
                <button
                  key={t.key}
                  onClick={() => setTf(t.key)}
                  title={`Timeframe ${t.label} (${i + 1})`}
                  className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${tf === t.key ? "bg-brand/15 text-brand-glow" : "text-ink-muted hover:text-ink"}`}
                >
                  {t.label}
                </button>
              ))}
              <span className="mx-1 h-3 w-px bg-border" />
              {(
                [
                  ["vwap", "VWAP"], ["emas", "EMA"], ["zones", "Levels"], ["plan", "Plan"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setToggles((v) => ({ ...v, [k]: !v[k] }))}
                  className={`rounded border px-1.5 py-0.5 text-[10px] ${toggles[k] ? "border-brand/40 text-brand-glow" : "border-border text-ink-faint"}`}
                >
                  {label}
                </button>
              ))}
              <select
                value={minStrength}
                onChange={(e) => setMinStrength(Number(e.target.value))}
                className="ml-1 rounded border border-border bg-bg-elevated px-1 py-0.5 text-[10px] text-ink-muted"
                title="Minimum level strength shown"
              >
                <option value={50}>≥50 minor</option>
                <option value={65}>≥65 meaningful</option>
                <option value={80}>≥80 strong</option>
                <option value={90}>≥90 major</option>
              </select>
              <span className="ml-auto flex items-center gap-1.5 text-[10px] text-ink-faint">
                {analysis.dataStale ? (
                  <span className="font-semibold text-bear">DATA STALE</span>
                ) : (
                  <>
                    <span key={analysis.asOf} className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-bull opacity-75" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-bull" />
                    </span>
                    {new Date(analysis.asOf).toLocaleTimeString()}
                  </>
                )}
              </span>
            </div>
            <OptionsChart
              bars={chartBars}
              zones={(() => { const s = analysis.setups.find((x) => x.tf === setupTf); return s && (setupTf === "D" || setupTf === "W") ? s.zones : analysis.zones; })()}
              plan={setupTf === "5m" ? analysis.plan : (analysis.setups.find((x) => x.tf === setupTf)?.plan ?? analysis.plan)}
              minStrength={minStrength}
              toggles={toggles}
              resetKey={`${analysis.symbol}:${tf}`}
              height={chartH}
            />

            {/* Bottom tabs under the chart */}
            <div className="border-t border-border">
              <div className="flex items-center gap-1 border-b border-border px-2 py-1">
                {(
                  [
                    ["scan", "Scanner"],
                    ["chain", `Option Chain (${analysis.contracts.length})`],
                    ["compare", `Compare (${compareSet.length})`],
                    ["calc", "Calculator"],
                    ["broker", `Positions & Orders${broker?.positions.length ? ` (${broker.positions.length})` : ""}`],
                  ] as const
                )
                  .filter(([k]) => !(k === "scan" && railOpen))
                  .map(([k, label]) => (
                    <button
                      key={k}
                      onClick={() => setTab(k)}
                      className={`rounded px-2 py-1 text-[11px] font-medium ${tab === k ? "bg-brand/15 text-brand-glow" : "text-ink-muted hover:text-ink"}`}
                    >
                      {label}
                    </button>
                  ))}
              </div>
              {tab === "scan" && !railOpen && (
                <ScannerTab
                  profile={profile}
                  onPick={(sym) => {
                    setSearchText(sym);
                    setSymbol(sym);
                    setCompareSet([]);
                    setTicket(null);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                />
              )}
              {(tab === "chain" || (tab === "scan" && railOpen)) && (
                <ChainTab analysis={analysis} compareSet={compareSet} setCompareSet={setCompareSet} onTicket={setTicket} />
              )}
              {tab === "compare" && <CompareTab analysis={analysis} contracts={compared} />}
              {tab === "calc" && <CalculatorTab analysis={analysis} />}
              {tab === "broker" && <BrokerTab broker={broker} refresh={fetchBroker} />}
            </div>
          </div>

          {/* Right rail: workflow + plan (sticky, own scroll) */}
          <aside className="w-full shrink-0 xl:sticky xl:top-[64px] xl:max-h-[calc(100vh-64px)] xl:w-[400px] xl:overflow-y-auto">
            <Stepper analysis={analysis} ticketOpen={ticket !== null} />
            <SetupsPanel
              setups={analysis.setups}
              selected={setupTf}
              onSelect={(t) => {
                setSetupTf(t);
                setTf(t);
              }}
            />
            <PlanCard analysis={analysis} />
            <SidesPanel analysis={analysis} onTicket={setTicket} onCompare={(s) => setCompareSet((v) => (v.includes(s) ? v : [...v, s].slice(-4)))} />
            <TradeMap analysis={analysis} />
            <details className="border-b border-border">
              <summary className="cursor-pointer px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-faint hover:text-ink">
                Details: confirmation checklist, signals, score breakdown
              </summary>
              <SetupPanel analysis={analysis} />
            </details>
          </aside>
        </div>
      )}

      {ticket && analysis && (
        <TicketModal contract={ticket} analysis={analysis} broker={broker} onClose={() => setTicket(null)} onDone={() => { setTicket(null); void fetchBroker(); }} />
      )}
    </div>
  );
}

// ── Workflow stepper ──

function Stepper({ analysis, ticketOpen }: { analysis: OptionsAnalysis; ticketOpen: boolean }) {
  const st = analysis.machine?.state ?? "WATCHING";
  const active = ticketOpen || ["CONFIRMED", "RETESTING", "CONTINUATION"].includes(st) ? 3 : analysis.plan ? 2 : 1;
  const steps = [
    ["Scan", "find a mover"],
    ["Pick", "open a ticker"],
    ["Plan", "level, targets, stop"],
    ["Trade", "confirmed break only"],
  ] as const;
  return (
    <div className="flex items-stretch border-b border-border bg-bg-card">
      {steps.map(([name, hint], i) => {
        const done = i < active;
        const now = i === active;
        return (
          <div key={name} className={`flex flex-1 items-center gap-1.5 border-r border-border/60 px-2 py-1.5 last:border-r-0 ${now ? "bg-brand/10" : ""}`} title={hint}>
            <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold ${done ? "bg-bull/20 text-bull" : now ? "bg-brand/25 text-brand-glow" : "bg-bg-elevated text-ink-faint"}`}>
              {done ? "✓" : i + 1}
            </span>
            <span className={`text-[10px] font-semibold ${now ? "text-ink" : done ? "text-ink-muted" : "text-ink-faint"}`}>{name}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Command bar ──

function CommandBar({
  searchRef, searchText, setSearchText, onSearch, analysis, broker, profile, setProfile, replayAt, setReplayAt,
  railOpen, setRailOpen, notesOpen, setNotesOpen, siren,
}: {
  searchRef: RefObject<HTMLInputElement>;
  searchText: string; setSearchText: (s: string) => void; onSearch: () => void;
  analysis: OptionsAnalysis | null; broker: Broker | null;
  profile: string; setProfile: (p: string) => void;
  replayAt: string; setReplayAt: (s: string) => void;
  railOpen: boolean; setRailOpen: (v: boolean) => void;
  notesOpen: boolean; setNotesOpen: (v: boolean) => void;
  siren: ReactNode;
}) {
  const st = analysis?.machine?.state ?? null;
  const live = st && ["APPROACHING", "FORMING", "TRIGGERED", "CONFIRMING", "CONFIRMED", "RETESTING", "CONTINUATION"].includes(st);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-bg-card px-3 py-1.5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSearch();
        }}
        className="flex items-center gap-1"
      >
        <Search size={12} className="text-ink-faint" />
        <input
          ref={searchRef}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value.toUpperCase())}
          className="w-20 rounded border border-border bg-bg-elevated px-1.5 py-0.5 font-mono text-[12px] uppercase outline-none focus:border-brand"
          placeholder="NVDA"
          maxLength={6}
          title="Search ( / )"
        />
        <button type="submit" className="rounded border border-border px-1.5 py-0.5 text-[11px] text-ink-muted hover:text-ink">Go</button>
      </form>
      {analysis?.price != null && (
        <span className="font-mono text-[13px] font-bold">
          {analysis.symbol} {fmt$(analysis.price)}{" "}
          <span className={analysis.changePct !== null && analysis.changePct >= 0 ? "text-bull" : "text-bear"}>{pct(analysis.changePct)}</span>
        </span>
      )}
      {st && (
        <span className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${STATE_TONE[st]} ${live ? "border-current/30" : "border-border"}`}>
          {live && <span className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
          {analysis?.direction === "short" ? "↓" : "↑"} {st}
        </span>
      )}
      <span className={`flex items-center gap-1 text-[10px] ${analysis?.marketOpen ? "text-bull" : "text-ink-faint"}`}>
        <CircleDot size={9} /> {analysis?.marketOpen ? "Market open" : "Closed"} · <span className="uppercase">{analysis?.session ?? "—"}</span>
      </span>
      <span
        className={`rounded border px-2 py-0.5 text-[10px] font-bold ${broker?.paper === false ? "border-bear bg-bear/20 text-bear" : "border-warn/50 bg-warn/10 text-warn"}`}
        title="Trading mode"
      >
        {broker?.paper === false ? "LIVE" : "PAPER"}
      </span>
      {broker?.account && (
        <span className="text-[10px] text-ink-muted">
          Equity <span className="font-mono text-ink">{fmt$(broker.account.equity, 0)}</span> · BP{" "}
          <span className="font-mono text-ink">{fmt$(broker.account.optionsBuyingPower ?? broker.account.buyingPower, 0)}</span>
        </span>
      )}
      <span className="ml-auto flex flex-wrap items-center gap-2">
        {siren}
        {analysis && analysis.notes.length > 0 && (
          <button onClick={() => setNotesOpen(!notesOpen)} className={`rounded border px-1.5 py-0.5 text-[10px] ${notesOpen ? "border-warn/40 text-warn" : "border-border text-ink-faint hover:text-ink"}`} title="Data notes">
            ⓘ {analysis.notes.length}
          </button>
        )}
        <button onClick={() => setRailOpen(!railOpen)} className="hidden rounded border border-border px-1.5 py-0.5 text-[10px] text-ink-faint hover:text-ink xl:inline" title="Toggle scanner rail (S)">
          {railOpen ? "⟨ rail" : "rail ⟩"}
        </button>
        <select value={profile} onChange={(e) => setProfile(e.target.value)} className="rounded border border-border bg-bg-elevated px-1 py-0.5 text-[10px] text-ink-muted" title="Contract scoring profile">
          {[["DAY", "0-1 DTE (same day)"], ["SCALP", "SCALP"], ["AGGRESSIVE", "AGGRESSIVE"], ["BALANCED", "BALANCED (3-30 DTE)"], ["CONSERVATIVE", "CONSERVATIVE"]].map(([p, label]) => (
            <option key={p} value={p}>{label}</option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-[10px] text-ink-faint" title="Replay the full analysis at a past moment (no lookahead)">
          Replay
          <input
            type="datetime-local"
            value={replayAt}
            onChange={(e) => setReplayAt(e.target.value)}
            className="rounded border border-border bg-bg-elevated px-1 py-0.5 text-[10px] text-ink-muted"
          />
          {replayAt && (
            <button onClick={() => setReplayAt("")} className="text-bear" title="Back to live">✕</button>
          )}
        </label>
      </span>
    </div>
  );
}

// ── Trade map ladder ──

function TradeMap({ analysis }: { analysis: OptionsAnalysis }) {
  const [open, setOpen] = useState<number | null>(null);
  const rows = useMemo(() => {
    const items: { label: string; price: number; tone: string; zone?: OptionsAnalysis["zones"][number] }[] = [];
    for (const z of analysis.zones.filter((z) => z.strength >= 65)) {
      items.push({ label: `${z.kind === "resistance" ? "R" : "S"} ${z.strength}`, price: z.price, tone: z.kind === "resistance" ? "text-bear" : "text-bull", zone: z });
    }
    if (analysis.plan) {
      items.push({ label: "TRIG", price: analysis.plan.trigger, tone: "text-warn" });
      analysis.plan.targets.forEach((t, i) => items.push({ label: `T${i + 1}`, price: t, tone: "text-brand-glow" }));
      items.push({ label: "INV", price: analysis.plan.invalidation, tone: "text-bear" });
    }
    if (analysis.vwap !== null) items.push({ label: "VWAP", price: analysis.vwap, tone: "text-warn" });
    if (analysis.price !== null) items.push({ label: "NOW", price: analysis.price, tone: "text-ink font-bold" });
    return items.sort((a, b) => b.price - a.price);
  }, [analysis]);

  return (
    <div className="border-b border-border">
      <div className="flex items-center justify-between px-2 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Trade Map</span>
        {analysis.trend && (
          <span className="text-[10px]">
            <span className={/Bullish/.test(analysis.trend.label) ? "text-bull" : /Bearish/.test(analysis.trend.label) ? "text-bear" : "text-ink-muted"}>
              {analysis.trend.label}
            </span>{" "}
            <span className="text-ink-faint">{analysis.trend.confidence}/100</span>
          </span>
        )}
      </div>
      <div className="max-h-64 overflow-y-auto px-2 pb-1.5">
        {rows.map((r, i) => (
          <div key={i}>
            <button
              onClick={() => setOpen(open === i ? null : i)}
              disabled={!r.zone}
              className={`flex w-full items-center justify-between rounded px-1 py-[2px] text-[11px] ${r.label === "NOW" ? "bg-bg-hover" : "hover:bg-bg-hover"} ${r.zone ? "cursor-pointer" : "cursor-default"}`}
            >
              <span className={`font-mono ${r.tone}`}>{r.label}</span>
              <span className="flex items-center gap-1 font-mono text-ink-muted">
                {fmt$(r.price)}
                {r.zone && (open === i ? <ChevronDown size={10} /> : <ChevronRight size={10} />)}
              </span>
            </button>
            {r.zone && open === i && (
              <div className="mb-1 ml-2 rounded border border-border/60 bg-bg-elevated px-2 py-1 text-[10px] text-ink-muted">
                <div className="font-semibold text-ink">
                  {r.zone.kind.toUpperCase()} {fmt$(r.zone.price)} — strength {r.zone.strength}/100
                </div>
                <div className="text-ink-faint">Timeframes: {r.zone.timeframes.join(", ")}</div>
                {r.zone.reasons.map((reason, j) => (
                  <div key={j}>• {reason}</div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Setup panel ──

function SetupPanel({ analysis }: { analysis: OptionsAnalysis }) {
  const [showWhy, setShowWhy] = useState(false);
  const m = analysis.machine;
  return (
    <div className="border-b border-border px-2 py-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Setup</span>
        <span className="text-[10px] text-ink-faint">
          RVOL <span className="font-mono text-ink">{analysis.rvol !== null ? `${analysis.rvol.toFixed(2)}x` : "—"}</span>
          {" · "}SPY {pct(analysis.context.spy)} · QQQ {pct(analysis.context.qqq)}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <Gauge size={14} className="text-ink-faint" />
        <span className={`text-[13px] font-bold ${STATE_TONE[m?.state ?? "WATCHING"]}`}>
          {analysis.direction === "short" ? "BREAKDOWN " : "BREAKOUT "}
          {m?.state ?? "WATCHING"}
        </span>
        {m && m.quality > 0 && <span className="font-mono text-[11px] text-ink-muted">{m.quality}/100</span>}
        {analysis.opportunity && (
          <span className="ml-auto rounded border border-border px-1.5 py-0.5 text-[11px]" title="Master opportunity score">
            <Activity size={10} className="mr-1 inline text-brand-glow" />
            <span className="font-mono font-bold">{analysis.opportunity.total}</span>
            <span className="text-ink-faint">/100</span>
          </span>
        )}
      </div>
      {analysis.room && (
        <div className={`mt-1 text-[10px] ${analysis.room.grade === "POOR" ? "font-semibold text-bear" : "text-ink-muted"}`}>{analysis.room.note}</div>
      )}
      {m && m.checks.length > 0 && (
        <div className="mt-1">
          {m.checks.map((c, i) => (
            <div key={i} className="flex items-center gap-1 text-[10px]">
              {c.pass ? <CheckCircle2 size={10} className="text-bull" /> : <XCircle size={10} className="text-bear" />}
              <span className="text-ink-muted">{c.name}:</span>
              <span className="text-ink-faint">{c.detail}</span>
            </div>
          ))}
        </div>
      )}
      <button onClick={() => setShowWhy((v) => !v)} className="mt-1 flex items-center gap-1 text-[10px] text-ink-faint hover:text-ink">
        <HelpCircle size={10} /> {showWhy ? "hide" : "why?"}
      </button>
      {showWhy && (
        <div className="mt-1 space-y-0.5 text-[10px] text-ink-muted">
          {analysis.trend?.signals.map((s, i) => (
            <div key={i}>
              <span className={s.dir === "bull" ? "text-bull" : s.dir === "bear" ? "text-bear" : "text-ink-faint"}>
                {s.dir === "bull" ? "▲" : s.dir === "bear" ? "▼" : "■"}
              </span>{" "}
              <span className="font-semibold text-ink">{s.name}</span>: {s.detail}
            </div>
          ))}
          {analysis.opportunity?.parts.map((p, i) => (
            <div key={`o${i}`} className="flex justify-between">
              <span>{p.name}: {p.detail}</span>
              <span className="font-mono text-ink-faint">{p.score}/{p.max}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Chain tab ──

function ChainTab({
  analysis, compareSet, setCompareSet, onTicket,
}: {
  analysis: OptionsAnalysis;
  compareSet: string[];
  setCompareSet: (fn: (v: string[]) => string[]) => void;
  onTicket: (c: RankedContract) => void;
}) {
  const [side, setSide] = useState<"all" | "call" | "put">("all");
  const [expiry, setExpiry] = useState<string>("all");
  const [maxSpread, setMaxSpread] = useState(15);
  const [minOi, setMinOi] = useState(0);
  const [minDelta, setMinDelta] = useState(0);

  const expiries = useMemo(() => Array.from(new Set(analysis.contracts.map((c) => c.expiry))).sort(), [analysis]);
  const rows = useMemo(
    () =>
      analysis.contracts
        .filter((c) => (side === "all" ? true : c.side === side))
        .filter((c) => (expiry === "all" ? true : c.expiry === expiry))
        .filter((c) => c.spreadPct === null || c.spreadPct <= maxSpread)
        .filter((c) => c.openInterest >= minOi)
        .filter((c) => c.delta === null || Math.abs(c.delta) >= minDelta)
        .sort((a, b) => a.strike - b.strike || a.expiry.localeCompare(b.expiry)),
    [analysis, side, expiry, maxSpread, minOi, minDelta]
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-2 py-1 text-[10px]">
        {(["all", "call", "put"] as const).map((s) => (
          <button key={s} onClick={() => setSide(s)} className={`rounded border px-1.5 py-0.5 ${side === s ? "border-brand/40 text-brand-glow" : "border-border text-ink-muted"}`}>
            {s.toUpperCase()}
          </button>
        ))}
        <select value={expiry} onChange={(e) => setExpiry(e.target.value)} className="rounded border border-border bg-bg-elevated px-1 py-0.5 text-ink-muted">
          <option value="all">All expiries</option>
          {expiries.map((x) => (
            <option key={x} value={x}>{x}</option>
          ))}
        </select>
        <label className="text-ink-faint">
          Max spread {maxSpread}%
          <input type="range" min={2} max={30} value={maxSpread} onChange={(e) => setMaxSpread(Number(e.target.value))} className="ml-1 align-middle" />
        </label>
        <label className="text-ink-faint">
          Min OI
          <input type="number" value={minOi} onChange={(e) => setMinOi(Number(e.target.value) || 0)} className="ml-1 w-14 rounded border border-border bg-bg-elevated px-1 py-0.5" />
        </label>
        <label className="text-ink-faint">
          Min |Δ|
          <input type="number" step={0.05} min={0} max={1} value={minDelta} onChange={(e) => setMinDelta(Number(e.target.value) || 0)} className="ml-1 w-14 rounded border border-border bg-bg-elevated px-1 py-0.5" />
        </label>
        <span className="ml-auto text-ink-faint">{rows.length} contracts</span>
      </div>
      <div className="max-h-80 overflow-auto">
        <table className="w-full border-collapse text-[11px]">
          <thead className="sticky top-0 bg-bg-card">
            <tr className="border-b border-border text-left text-[9px] uppercase tracking-wide text-ink-faint">
              {["", "Type", "Strike", "Exp", "DTE", "Bid", "Ask", "Mid", "Spr%", "Vol", "OI", "IV", "Δ", "Γ", "Θ", "BE", "Intr", "Extr", "Money", "Score", ""].map((h, i) => (
                <th key={i} className="whitespace-nowrap px-1.5 py-1 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.symbol} className={`border-b border-border/40 hover:bg-bg-hover ${c.stale ? "opacity-50" : ""}`}>
                <td className="px-1.5 py-0.5">
                  <input
                    type="checkbox"
                    checked={compareSet.includes(c.symbol)}
                    onChange={() => setCompareSet((v) => (v.includes(c.symbol) ? v.filter((x) => x !== c.symbol) : [...v, c.symbol].slice(-4)))}
                    title="Compare"
                  />
                </td>
                <td className={`px-1.5 py-0.5 font-semibold ${c.side === "call" ? "text-bull" : "text-bear"}`}>{c.side === "call" ? "C" : "P"}</td>
                <td className="px-1.5 py-0.5 font-mono">{c.strike}</td>
                <td className="px-1.5 py-0.5 font-mono text-ink-muted">{c.expiry.slice(5)}</td>
                <td className="px-1.5 py-0.5 font-mono text-ink-muted">{c.dte}</td>
                <td className="px-1.5 py-0.5 font-mono">{c.bid.toFixed(2)}</td>
                <td className="px-1.5 py-0.5 font-mono">{c.ask.toFixed(2)}</td>
                <td className="px-1.5 py-0.5 font-mono text-ink-muted">{c.mid.toFixed(2)}</td>
                <td className={`px-1.5 py-0.5 font-mono ${c.spreadPct !== null && c.spreadPct > 8 ? "text-warn" : "text-ink-muted"}`}>{c.spreadPct ?? "—"}</td>
                <td className="px-1.5 py-0.5 font-mono text-ink-muted">{c.volume.toLocaleString()}</td>
                <td className="px-1.5 py-0.5 font-mono text-ink-muted">{c.openInterest.toLocaleString()}</td>
                <td className="px-1.5 py-0.5 font-mono text-ink-muted">{c.iv !== null ? `${(c.iv * 100).toFixed(0)}%` : "—"}</td>
                <td className="px-1.5 py-0.5 font-mono">{c.delta ?? "—"}</td>
                <td className="px-1.5 py-0.5 font-mono text-ink-muted">{c.gamma ?? "—"}</td>
                <td className="px-1.5 py-0.5 font-mono text-ink-muted">{c.theta ?? "—"}</td>
                <td className="px-1.5 py-0.5 font-mono text-ink-muted">{c.breakEven.toFixed(2)}</td>
                <td className="px-1.5 py-0.5 font-mono text-ink-muted">{c.intrinsic.toFixed(2)}</td>
                <td className="px-1.5 py-0.5 font-mono text-ink-muted">{c.extrinsic.toFixed(2)}</td>
                <td className={`px-1.5 py-0.5 text-[9px] font-semibold ${c.moneyness === "ITM" ? "text-bull" : c.moneyness === "ATM" ? "text-brand-glow" : "text-ink-faint"}`}>{c.moneyness}</td>
                <td className="px-1.5 py-0.5 font-mono font-bold">{c.stale ? <span className="text-bear">STALE</span> : c.score}</td>
                <td className="px-1.5 py-0.5">
                  <button onClick={() => onTicket(c)} className="rounded border border-border px-1 py-0.5 text-[9px] text-ink-muted hover:text-ink">Trade</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="p-4 text-center text-[11px] text-ink-muted">No contracts pass the filters.</div>}
      </div>
    </div>
  );
}

// ── Compare tab ──

function CompareTab({ analysis, contracts }: { analysis: OptionsAnalysis; contracts: RankedContract[] }) {
  if (contracts.length === 0) {
    return <div className="p-4 text-[11px] text-ink-muted">Tick contracts in the chain (or “+ Compare”) to compare up to 4 side by side.</div>;
  }
  const targets = analysis.plan?.targets ?? [];
  const scenarioFor = (c: RankedContract, target: number) =>
    scenarioPrice(
      { side: c.side, strike: c.strike, expiry: c.expiry, iv: c.iv, currentMid: c.mid, underlyingNow: analysis.price ?? 0 },
      target, 60
    );
  const rows: { label: string; get: (c: RankedContract) => string }[] = [
    { label: "Mid", get: (c) => fmt$(c.mid) },
    { label: "Spread", get: (c) => (c.spreadPct !== null ? `${c.spreadPct}%` : "—") },
    { label: "Delta", get: (c) => String(c.delta ?? "—") },
    { label: "Gamma", get: (c) => String(c.gamma ?? "—") },
    { label: "Theta", get: (c) => String(c.theta ?? "—") },
    { label: "IV", get: (c) => (c.iv !== null ? `${(c.iv * 100).toFixed(0)}%` : "—") },
    { label: "Volume", get: (c) => c.volume.toLocaleString() },
    { label: "OI", get: (c) => c.openInterest.toLocaleString() },
    { label: "Intr / Extr", get: (c) => `${c.intrinsic.toFixed(2)} / ${c.extrinsic.toFixed(2)}` },
    { label: "Break-even", get: (c) => fmt$(c.breakEven) },
    ...targets.map((t, i) => ({
      label: `Est @ T${i + 1} ${fmt$(t)}`,
      get: (c: RankedContract) => {
        const s = scenarioFor(c, t);
        const ret = c.mid > 0 ? ` (${s.midEstimate >= c.mid ? "+" : ""}${(((s.midEstimate - c.mid) / c.mid) * 100).toFixed(0)}%)` : "";
        return `${fmt$(s.low)}–${fmt$(s.high)}${ret}`;
      },
    })),
    { label: "Score", get: (c) => `${c.score}/100` },
  ];
  const bestScore = Math.max(...contracts.map((c) => c.score));
  return (
    <div className="overflow-x-auto p-2">
      <table className="border-collapse text-[11px]">
        <thead>
          <tr>
            <th className="px-2 py-1 text-left text-[9px] uppercase text-ink-faint">Contract</th>
            {contracts.map((c) => (
              <th key={c.symbol} className={`px-3 py-1 text-left font-mono ${c.score === bestScore ? "text-brand-glow" : "text-ink"}`}>
                {c.strike}{c.side === "call" ? "C" : "P"} {c.expiry.slice(5)}
                {c.score === bestScore && <span className="ml-1 text-[9px]">★ best</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-border/40">
              <td className="px-2 py-0.5 text-ink-faint">{r.label}</td>
              {contracts.map((c) => (
                <td key={c.symbol} className="px-3 py-0.5 font-mono text-ink-muted">{r.get(c)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[9px] text-ink-faint">Target estimates are model ranges (IV ±10%), not guarantees.</p>
    </div>
  );
}

// ── Calculator tab ──

function CalculatorTab({ analysis }: { analysis: OptionsAnalysis }) {
  const [side, setSide] = useState<"call" | "put">("call");
  const [strike, setStrike] = useState(analysis.price ? Math.round(analysis.price) : 100);
  const [expiry, setExpiry] = useState(() => new Date(Date.now() + 7 * 86400e3).toISOString().slice(0, 10));
  const [qty, setQty] = useState(1);
  const [entry, setEntry] = useState(2.5);
  const [target, setTarget] = useState(analysis.plan?.targets[0] ?? (analysis.price ?? 100) * 1.02);
  const [ivPct, setIvPct] = useState(35);

  const T = yearsToExpiry(expiry);
  const iv = ivPct / 100;
  const nowBs = analysis.price ? blackScholes(side, analysis.price, strike, T, iv) : null;
  const est = analysis.price
    ? scenarioPrice({ side, strike, expiry, iv, currentMid: entry, underlyingNow: analysis.price }, target, 60)
    : null;
  const cost = entry * qty * 100;
  const be = breakEvenAtExpiry(side, strike, entry);
  const intr = analysis.price ? intrinsicValue(side, strike, analysis.price) : 0;

  const input = "w-24 rounded border border-border bg-bg-elevated px-1.5 py-0.5 font-mono text-[11px]";
  return (
    <div className="flex flex-wrap gap-6 p-3 text-[11px]">
      <div className="space-y-1.5">
        <div className="text-[9px] font-semibold uppercase text-ink-faint">Position</div>
        <label className="flex items-center justify-between gap-2">Side
          <select value={side} onChange={(e) => setSide(e.target.value as "call" | "put")} className={input}>
            <option value="call">Call</option><option value="put">Put</option>
          </select>
        </label>
        <label className="flex items-center justify-between gap-2">Strike <input type="number" value={strike} onChange={(e) => setStrike(Number(e.target.value))} className={input} /></label>
        <label className="flex items-center justify-between gap-2">Expiry <input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className={input} /></label>
        <label className="flex items-center justify-between gap-2">Contracts <input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value)))} className={input} /></label>
        <label className="flex items-center justify-between gap-2">Option price <input type="number" step={0.05} value={entry} onChange={(e) => setEntry(Number(e.target.value))} className={input} /></label>
        <label className="flex items-center justify-between gap-2">Target stock <input type="number" step={0.1} value={target} onChange={(e) => setTarget(Number(e.target.value))} className={input} /></label>
        <label className="flex items-center justify-between gap-2">IV % <input type="number" min={5} max={300} value={ivPct} onChange={(e) => setIvPct(Number(e.target.value))} className={input} /></label>
      </div>
      <div className="min-w-[240px] space-y-1">
        <div className="text-[9px] font-semibold uppercase text-ink-faint">Result (model estimates)</div>
        <Row k="Cost basis" v={fmt$(cost, 0)} />
        <Row k={`Underlying now`} v={fmt$(analysis.price)} />
        <Row k="Intrinsic now" v={fmt$(intr)} />
        <Row k="Model value now" v={nowBs ? fmt$(nowBs.price) : "—"} />
        {nowBs && <Row k="Model greeks" v={`Δ${nowBs.delta.toFixed(2)} Γ${nowBs.gamma.toFixed(3)} Θ${nowBs.theta.toFixed(2)}/d`} />}
        <Row k="Break-even @exp" v={fmt$(be)} />
        {est && (
          <>
            <Row k={`Est option @ ${fmt$(target)}`} v={`${fmt$(est.low)}–${fmt$(est.high)}`} />
            <Row k="Est position value" v={`${fmt$(est.perContractLow * qty, 0)}–${fmt$(est.perContractHigh * qty, 0)}`} />
            <Row
              k="Est P/L"
              v={`${fmt$(est.perContractLow * qty - cost, 0)} to ${fmt$(est.perContractHigh * qty - cost, 0)} (${cost > 0 ? `${(((est.perContractLow * qty - cost) / cost) * 100).toFixed(0)}% to ${(((est.perContractHigh * qty - cost) / cost) * 100).toFixed(0)}%` : "—"})`}
            />
          </>
        )}
        <p className="pt-1 text-[9px] text-ink-faint">
          Black-Scholes estimate with your IV assumption. American-style early exercise and IV shifts are not predicted; ranges span IV ±10%.
        </p>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-ink-faint">{k}</span>
      <span className="font-mono text-ink">{v}</span>
    </div>
  );
}

// ── Broker tab (positions, orders, cancel) ──

function BrokerTab({ broker, refresh }: { broker: Broker | null; refresh: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  if (!broker) return <div className="p-4 text-[11px] text-ink-muted">Loading account…</div>;
  if (!broker.connected) return <div className="p-4 text-[11px] text-ink-muted">Broker not connected. {broker.error ?? ""}</div>;
  const cancel = async (id: string) => {
    setBusy(id);
    await fetch(`/api/broker/order?id=${id}`, { method: "DELETE" }).catch(() => undefined);
    setBusy(null);
    refresh();
  };
  return (
    <div className="grid gap-4 p-3 lg:grid-cols-2">
      <div>
        <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase text-ink-faint">
          Positions <button onClick={refresh} title="Refresh"><RefreshCw size={10} /></button>
        </div>
        {broker.positions.length === 0 ? (
          <div className="text-[11px] text-ink-muted">No open positions.</div>
        ) : (
          broker.positions.map((p) => (
            <div key={p.symbol} className="mb-1 rounded border border-border p-2 text-[11px]">
              <div className="flex justify-between font-mono font-semibold">
                <span>{p.underlying} {p.strike}{p.side === "call" ? "C" : p.side === "put" ? "P" : ""} {p.expiry?.slice(5) ?? ""} ×{p.qty}</span>
                <span className={p.unrealizedPl !== null && p.unrealizedPl >= 0 ? "text-bull" : "text-bear"}>
                  {p.unrealizedPl !== null ? `${p.unrealizedPl >= 0 ? "+" : ""}$${p.unrealizedPl.toFixed(0)} (${pct(p.unrealizedPlPct)})` : "—"}
                </span>
              </div>
              <div className="mt-0.5 grid grid-cols-3 gap-1 font-mono text-[10px] text-ink-muted">
                <span>Entry {fmt$(p.avgEntry)}</span>
                <span>Mark {fmt$(p.currentPrice)}</span>
                <span>Bid/Ask {p.liveBid ?? "—"}/{p.liveAsk ?? "—"}</span>
              </div>
            </div>
          ))
        )}
      </div>
      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase text-ink-faint">Orders</div>
        {broker.orders.length === 0 ? (
          <div className="text-[11px] text-ink-muted">No orders yet.</div>
        ) : (
          broker.orders.map((o) => (
            <div key={o.id} className="mb-0.5 flex items-center justify-between border-b border-border/40 py-0.5 font-mono text-[10px]">
              <span className="text-ink-muted">
                {o.side.toUpperCase()} {o.qty} {o.symbol} {o.type}{o.limitPrice ? ` @${o.limitPrice}` : ""} · {o.status}
                {o.filledAvgPrice ? ` · filled ${fmt$(o.filledAvgPrice)}` : ""}
              </span>
              {["new", "accepted", "pending_new", "partially_filled"].includes(o.status) && (
                <button onClick={() => cancel(o.id)} disabled={busy === o.id} className="rounded border border-border px-1 text-bear disabled:opacity-40">
                  {busy === o.id ? "…" : "Cancel"}
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Order ticket ──

function TicketModal({
  contract, analysis, broker, onClose, onDone,
}: {
  contract: RankedContract;
  analysis: OptionsAnalysis;
  broker: Broker | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [qty, setQty] = useState(1);
  const [type, setType] = useState<"limit" | "market">("limit");
  const [limit, setLimit] = useState(contract.mid > 0 ? contract.mid : contract.ask);
  const [review, setReview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const clientOrderIdRef = useRef(`af-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);

  const estDebit = (type === "limit" ? limit : contract.ask) * qty * 100;
  const bp = broker?.account?.optionsBuyingPower ?? broker?.account?.buyingPower ?? null;

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const r = await fetch("/api/broker/order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol: contract.symbol, qty, side, type,
          limitPrice: type === "limit" ? Math.round(limit * 100) / 100 : undefined,
          clientOrderId: clientOrderIdRef.current,
          setupSnapshot: {
            underlyingPrice: analysis.price, state: analysis.machine?.state, quality: analysis.machine?.quality,
            trigger: analysis.plan?.trigger, targets: analysis.plan?.targets, invalidation: analysis.plan?.invalidation,
            trend: analysis.trend?.label, rvol: analysis.rvol, contractScore: contract.score,
            delta: contract.delta, iv: contract.iv, opportunity: analysis.opportunity?.total,
          },
        }),
      });
      const j = (await r.json()) as { ok?: boolean; error?: string; order?: { status: string } };
      if (!r.ok || !j.ok) throw new Error(j.error ?? "order failed");
      setResult(`Order ${j.order?.status ?? "submitted"} ✔`);
      setTimeout(onDone, 1200);
    } catch (e) {
      setResult(e instanceof Error ? e.message : "order failed");
      setSubmitting(false);
    }
  };

  const input = "w-24 rounded border border-border bg-bg-elevated px-1.5 py-0.5 font-mono text-[11px]";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded border border-border bg-bg-card p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-[13px] font-bold">
            {analysis.symbol} {contract.strike}{contract.side === "call" ? "C" : "P"} {contract.expiry}
          </span>
          <span className={`rounded border px-2 py-0.5 text-[10px] font-bold ${broker?.paper === false ? "border-bear text-bear" : "border-warn/50 text-warn"}`}>
            {broker?.paper === false ? "LIVE ORDER" : "PAPER"}
          </span>
        </div>
        {!review ? (
          <>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <label className="flex items-center justify-between">Side
                <select value={side} onChange={(e) => setSide(e.target.value as "buy" | "sell")} className={input}>
                  <option value="buy">Buy to open</option>
                  <option value="sell">Sell to close</option>
                </select>
              </label>
              <label className="flex items-center justify-between">Qty
                <input type="number" min={1} max={100} value={qty} onChange={(e) => setQty(Math.max(1, Math.min(100, Number(e.target.value))))} className={input} />
              </label>
              <label className="flex items-center justify-between">Type
                <select value={type} onChange={(e) => setType(e.target.value as "limit" | "market")} className={input}>
                  <option value="limit">Limit</option>
                  <option value="market">Market</option>
                </select>
              </label>
              {type === "limit" && (
                <label className="flex items-center justify-between">Limit
                  <input type="number" step={0.01} value={limit} onChange={(e) => setLimit(Number(e.target.value))} className={input} />
                </label>
              )}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1 font-mono text-[10px] text-ink-muted">
              <span>Bid {fmt$(contract.bid)} / Ask {fmt$(contract.ask)}</span>
              <span>Spread {contract.spreadPct ?? "—"}%</span>
              <span>Est {side === "buy" ? "debit" : "credit"} {fmt$(estDebit, 0)}</span>
              <span>Options BP {bp !== null ? fmt$(bp, 0) : "—"}</span>
            </div>
            {analysis.plan && (
              <div className="mt-1 text-[10px] text-ink-faint">
                Setup: {analysis.machine?.state} · trigger {fmt$(analysis.plan.trigger)} · T1 {fmt$(analysis.plan.targets[0])} · inv {fmt$(analysis.plan.invalidation)}
              </div>
            )}
            {analysis.plan && analysis.price !== null && (() => {
              const inp = { side: contract.side, strike: contract.strike, expiry: contract.expiry, iv: contract.iv, currentMid: contract.mid, underlyingNow: analysis.price };
              const atInv = scenarioPrice(inp, analysis.plan.invalidation, 60);
              const atT1 = scenarioPrice(inp, analysis.plan.targets[0], 60);
              const tick = (p: number) => (p >= 3 ? Math.round(p / 0.05) * 0.05 : Math.round(p * 100) / 100);
              const stop = tick(atInv.midEstimate);
              return (
                <div className="mt-1.5 rounded border border-border/60 bg-bg-elevated px-2 py-1 text-[10px]">
                  <div className="text-[9px] font-semibold uppercase text-ink-faint">Exit plan (model estimates)</div>
                  <div className="grid grid-cols-2 gap-x-3 font-mono text-ink-muted">
                    <span>Stop-limit sell: trigger <span className="text-bear">{fmt$(stop)}</span> / limit {fmt$(tick(stop * 0.9))}</span>
                    <span>Target sell: <span className="text-bull">{fmt$(tick(atT1.midEstimate))}</span></span>
                    <span className="text-ink-faint">if {analysis.symbol} reaches {fmt$(analysis.plan.invalidation)}</span>
                    <span className="text-ink-faint">if {analysis.symbol} reaches {fmt$(analysis.plan.targets[0])}</span>
                  </div>
                  <div className="mt-0.5 text-[9px] text-ink-faint">
                    Alpaca has no stop orders on options, so the stop is your plan here (type it into Robinhood as a stop-limit). Ranges shift with IV.
                  </div>
                </div>
              );
            })()}
            {contract.stale && <div className="mt-1 text-[10px] font-semibold text-bear">Quote is STALE — refresh before trading.</div>}
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={onClose} className="rounded border border-border px-2 py-1 text-[11px] text-ink-muted">Cancel</button>
              <button
                onClick={() => setReview(true)}
                disabled={bp !== null && side === "buy" && estDebit > bp}
                className="rounded bg-brand/20 px-3 py-1 text-[11px] font-semibold text-brand-glow disabled:opacity-40"
              >
                Review order
              </button>
            </div>
            {bp !== null && side === "buy" && estDebit > bp && (
              <div className="mt-1 text-right text-[10px] text-bear">Insufficient options buying power.</div>
            )}
          </>
        ) : (
          <>
            <div className="rounded border border-warn/30 bg-warn/5 p-2 text-[11px] text-ink">
              <div className="font-semibold">{side === "buy" ? "BUY TO OPEN" : "SELL TO CLOSE"} {qty} × {contract.symbol}</div>
              <div className="mt-0.5 font-mono text-[10px] text-ink-muted">
                {type.toUpperCase()}{type === "limit" ? ` @ ${fmt$(limit)}` : ""} · est {side === "buy" ? "debit" : "credit"} {fmt$(estDebit, 0)} · day order
              </div>
            </div>
            {result && <div className={`mt-2 text-[11px] ${result.includes("✔") ? "text-bull" : "text-bear"}`}>{result}</div>}
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={() => setReview(false)} className="rounded border border-border px-2 py-1 text-[11px] text-ink-muted" disabled={submitting}>Back</button>
              <button onClick={submit} disabled={submitting || Boolean(result?.includes("✔"))} className="rounded bg-bull/20 px-3 py-1 text-[11px] font-bold text-bull disabled:opacity-40">
                {submitting ? "Submitting…" : "Confirm order"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
