"use client";

// The options command center. Layout: scanner (left) | chart (center,
// dominant) with the option-chain drawer under it | Trade Command
// Panel (right). Every panel collapses and resizes; the layout is
// saved on the device. Market data arrives through polling hooks kept
// outside this component so the 2-second quote never re-renders the
// whole shell.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import OptionsChart from "@/components/options/OptionsChart";
import { ScannerTab } from "@/components/options/OptionsPanels";
import SirenBar from "@/components/options/SirenBar";
import MorningWatch from "@/components/options/MorningWatch";
import { loadTrade, tradeKey } from "@/components/options/MyTradePanel";
import SymbolSwitcher, { loadRecents, pushRecent } from "@/components/options/SymbolSwitcher";
import TicketModal from "@/components/options/tabs/TicketModal";
import { BUCKET_MS, TF_CHOICES, type ChartTf } from "@/components/options/types";
import { StateBox, Skeleton } from "@/components/ui/primitives";
import { effectiveToggles, loadChartPrefs, onChartPrefs, saveChartPrefs, type ChartPrefs, DEFAULT_CHART_PREFS } from "@/lib/chartPrefs";
import { readDecision } from "@/lib/decision/lifecycle";
import { noTradeRules } from "@/lib/decision/noTrade";
import { SCORE_PROFILES } from "@/lib/optionsScore";
import { etStamp, resample, sessionOf } from "@/lib/intraday";
import { applyMode, clampLayout, DEFAULT_LAYOUT, fitToViewport, LAYOUT_LIMITS, loadLayout, saveLayout, type LayoutPrefs } from "@/lib/layoutPrefs";
import type { LiveQuote } from "@/lib/liveCandle";
import { resampleWeekly, type SetupTf } from "@/lib/multiTimeframe";
import { breakEvenAtExpiry } from "@/lib/optionsMath";
import type { RankedContract } from "@/lib/optionsTerminal";
import type { MyTrade } from "@/lib/positionCoach";
import { sessionLevels } from "@/lib/sessionLevels";
import { DEFAULT_RISK, evaluateRisk, loadRiskSettings, onRiskSettings, type RiskSettings } from "@/lib/riskEngine";
import { scenarioPrice } from "@/lib/optionsMath";
import { plannedEntry } from "@/lib/planEntry";
import { friendlyError } from "@/lib/ui/errors";
import BottomDrawer, { type DrawerTab } from "./BottomDrawer";
import ChartToolbar from "./ChartToolbar";
import CommandBar from "./CommandBar";
import Resizer from "./Resizer";
import TradeCommandPanel from "./TradeCommandPanel";
import { useAnalysis, useBroker, useIsOwner, useQuote } from "./useFeeds";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export default function Workspace({ initialSymbol, initialTicket = null }: { initialSymbol: string; initialTicket?: string | null }) {
  const [symbol, setSymbol] = useState(initialSymbol);
  const [searchText, setSearchText] = useState(initialSymbol);
  const [profile, setProfileState] = useState("DAY");
  const [tf, setTf] = useState<ChartTf>("5m");
  const [prefs, setPrefsState] = useState<ChartPrefs>(DEFAULT_CHART_PREFS);
  const [minStrength, setMinStrength] = useState(65);
  const [picks, setPicks] = useState<string[]>([]);
  const [recentVersion, setRecentVersion] = useState(0);
  const [myTrade, setMyTrade] = useState<MyTrade | null>(null);
  const [tab, setTab] = useState<DrawerTab>("chain");
  const [compareSet, setCompareSet] = useState<string[]>([]);
  const [ticket, setTicket] = useState<RankedContract | null>(null);
  const [replayAt, setReplayAt] = useState("");
  const [setupTf, setSetupTf] = useState<SetupTf>("5m");
  const [layout, setLayoutState] = useState<LayoutPrefs>(DEFAULT_LAYOUT);
  const [risk, setRisk] = useState<RiskSettings>(DEFAULT_RISK);
  const [planSymbol, setPlanSymbol] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const symbolRef = useRef(symbol);
  const isOwner = useIsOwner();

  // ── Device prefs ──
  useEffect(() => {
    try {
      const saved = localStorage.getItem("af_profile");
      if (saved) setProfileState(saved);
    } catch { /* fresh browser */ }
    setPrefsState(loadChartPrefs());
    setLayoutState(fitToViewport(loadLayout(), window.innerWidth, window.innerHeight));
    setRisk(loadRiskSettings());
    const offPrefs = onChartPrefs(setPrefsState);
    const offRisk = onRiskSettings(setRisk);
    return () => { offPrefs(); offRisk(); };
  }, []);
  const setProfile = (p: string) => {
    setProfileState(p);
    try { localStorage.setItem("af_profile", p); } catch { /* ignore */ }
  };
  const setPrefs = useCallback((p: ChartPrefs) => { setPrefsState(p); saveChartPrefs(p); }, []);
  const setLayout = useCallback((fn: (p: LayoutPrefs) => LayoutPrefs) => {
    setLayoutState((p) => {
      const next0 = fn(p);
      const next = clampLayout(next0.mode !== p.mode ? applyMode(next0, next0.mode) : next0);
      saveLayout(next);
      return next;
    });
  }, []);
  useEffect(() => {
    const onResize = () => setLayoutState((p) => fitToViewport(p, window.innerWidth, window.innerHeight));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // ── Symbol bookkeeping ──
  const loadSymbol = useCallback((sym: string) => {
    setSearchText(sym);
    setSymbol(sym);
    setCompareSet([]);
    setTicket(null);
  }, []);
  useEffect(() => {
    symbolRef.current = symbol;
    pushRecent(symbol);
    setRecentVersion((v) => v + 1);
    setMyTrade(loadTrade(symbol));
    try {
      const u = new URL(window.location.href);
      if (u.searchParams.get("s") !== symbol) {
        u.searchParams.set("s", symbol);
        u.searchParams.delete("ticket");
        window.history.replaceState(null, "", u.toString());
      }
    } catch { /* ignore */ }
  }, [symbol]);
  const saveTrade = useCallback((t: MyTrade | null) => {
    setMyTrade(t);
    try {
      if (t) localStorage.setItem(tradeKey(symbol), JSON.stringify(t));
      else localStorage.removeItem(tradeKey(symbol));
    } catch { /* ignore */ }
  }, [symbol]);

  // ── Feeds ──
  const { analysis, loading, error, refetch } = useAnalysis(symbol, profile, replayAt);
  const quote = useQuote(symbol);
  const { broker, refetch: refetchBroker } = useBroker();

  // ── Keyboard ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
        if (e.key === "Escape") (t as HTMLInputElement).blur();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      const tfHit = TF_CHOICES.find((c) => c.hotkey.toLowerCase() === k.toLowerCase());
      if (k === "/") { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); }
      else if (tfHit) setTf(tfHit.key);
      else if (k === "s" || k === "S") setLayout((p) => ({ ...p, left: !p.left }));
      else if (k === "o" || k === "O") setLayout((p) => ({ ...p, bottom: !p.bottom }));
      else if (k === "p" || k === "P") setLayout((p) => ({ ...p, right: !p.right }));
      else if (k === "[" || k === "]") {
        const r = loadRecents();
        if (r.length > 1) {
          const i = r.indexOf(symbolRef.current);
          loadSymbol(r[k === "]" ? (i + 1) % r.length : (i - 1 + r.length) % r.length]);
        }
      } else if (k === "Escape") setTicket(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [loadSymbol, setLayout]);

  // ── Derived ──
  const liveQuote: LiveQuote | null = useMemo(
    () => (quote && quote.price !== null && quote.tradeTs !== null && quote.symbol === symbol ? { t: quote.tradeTs, price: quote.price } : null),
    [quote, symbol]
  );
  const chartBars = useMemo(() => {
    if (!analysis) return [];
    switch (tf) {
      case "1m": return analysis.bars.m1;
      case "2m": return resample(analysis.bars.m1, 2);
      case "5m": return analysis.bars.m5;
      case "15m": return resample(analysis.bars.m5, 15);
      case "30m": return resample(analysis.bars.m5, 30);
      case "1h": return resample(analysis.bars.m5, 60);
      case "D": return analysis.bars.daily;
      case "W": return resampleWeekly(analysis.bars.daily);
    }
  }, [analysis, tf]);
  const machineBars = useMemo(() => {
    if (!analysis || analysis.bars.m5.length === 0) return [];
    const day = etStamp(analysis.bars.m5[analysis.bars.m5.length - 1].t).date;
    return analysis.bars.m5.filter((b) => etStamp(b.t).date === day && sessionOf(b.t) !== "closed");
  }, [analysis]);
  const levels = useMemo(() => (analysis ? sessionLevels(analysis.bars.m1, analysis.bars.daily, Date.parse(analysis.asOf)) : null), [analysis]);
  const toggles = useMemo(() => effectiveToggles(prefs), [prefs]);
  // Risk check on the best contract, one contract at the mid: the risk
  // engine can veto the verdict but never loosen it.
  const riskBreach = useMemo(() => {
    if (!analysis || !analysis.best || !analysis.plan || analysis.price === null) return null;
    const b = analysis.best;
    const entry = plannedEntry(b, analysis.plan, analysis.price, analysis.lifecycle);
    if (!entry) return null;
    const inv = scenarioPrice({ side: b.side, strike: b.strike, expiry: b.expiry, iv: b.iv, currentMid: entry.premium, underlyingNow: entry.underlying }, analysis.plan.invalidation, 60).midEstimate;
    const r = evaluateRisk({ settings: risk, premium: entry.premium, contracts: 1, valueAtInvalidation: inv, valuesAtTargets: [], is0dte: b.dte <= 1, openPositions: myTrade && myTrade.contract !== b.symbol ? [{ premiumTotal: myTrade.entry * 100 * myTrade.qty, is0dte: true, correlated: true }] : [], realizedToday: 0, unrealizedToday: 0 });
    return r.breaches.find((x) => x.blocking)?.message ?? null;
  }, [analysis, risk, myTrade]);
  const planContract = useMemo(() => (analysis ? analysis.contracts.find((c) => c.symbol === planSymbol) ?? analysis.best ?? null : null), [analysis, planSymbol]);
  const decision = useMemo(() => {
    if (!analysis) return null;
    return readDecision({
      machineState: analysis.machine?.state ?? null,
      checks: analysis.machine?.checks ?? [],
      extreme: analysis.machine?.extreme ?? null,
      plan: analysis.plan,
      direction: analysis.direction,
      price: analysis.price,
      trendLabel: analysis.trend?.label ?? null,
      trendConfidence: analysis.trend?.confidence ?? null,
      choppy: analysis.choppy,
      dailyTrend: analysis.setups.find((s) => s.tf === "D")?.trend ?? null,
      room: analysis.room,
      rvol: analysis.rvol,
      vwap: analysis.vwap,
      session: analysis.session,
      slot: analysis.slot,
      marketOpen: analysis.marketOpen,
      inTrade: myTrade !== null,
      timeframe: setupTf,
      blockers: noTradeRules({
        plan: analysis.plan, price: analysis.price, rvol: analysis.rvol, choppy: analysis.choppy, align: analysis.align, room: analysis.room,
        contract: analysis.best ? { score: analysis.best.score, spreadPct: analysis.best.spreadPct, volume: analysis.best.volume, openInterest: analysis.best.openInterest, iv: analysis.best.iv } : null,
        maxSpreadPct: SCORE_PROFILES[profile]?.maxSpreadPct ?? 8, minutesToEvent: null, eventBufferMinutes: 15, riskLimitBreached: riskBreach, marketOpen: analysis.marketOpen,
      }),
    });
  }, [analysis, myTrade, setupTf, profile, riskBreach]);
  const chartPlan = analysis ? (setupTf === "5m" ? analysis.plan : analysis.setups.find((x) => x.tf === setupTf)?.plan ?? analysis.plan) : null;
  const chartZones = analysis ? (() => { const s = analysis.setups.find((x) => x.tf === setupTf); return s && (setupTf === "D" || setupTf === "W") ? s.zones : analysis.zones; })() : [];

  // Deep link from an alert: open the prefilled ticket once the contract is in the chain.
  const ticketOpened = useRef(false);
  useEffect(() => {
    if (!initialTicket || ticketOpened.current || !analysis || !isOwner) return;
    const c = analysis.contracts.find((x) => x.symbol === initialTicket);
    if (c) { ticketOpened.current = true; setTicket(c); }
  }, [analysis, initialTicket, isOwner]);

  const openTicket = useCallback((c: RankedContract) => {
    if (analysis?.indexMode) { window.alert("Index options cannot be paper-traded on Alpaca. Use this contract as the plan at your broker."); return; }
    setTicket(c);
  }, [analysis?.indexMode]);
  const repickLevel = useCallback(async () => {
    if (!window.confirm("Drop today's locked level for this symbol and pick a fresh one from the current chart?")) return;
    await fetch(`/api/options/lock?symbol=${symbol}`, { method: "DELETE" });
    void refetch();
  }, [symbol, refetch]);

  // ── Resizing ──
  const dragStart = useRef<number | null>(null);
  const dragLeft = (d: number) => { if (dragStart.current === null) dragStart.current = layout.leftW; const w = clamp(dragStart.current + d, LAYOUT_LIMITS.leftW.min, LAYOUT_LIMITS.leftW.max); setLayoutState((p) => ({ ...p, leftW: w })); };
  const dragRight = (d: number) => { if (dragStart.current === null) dragStart.current = layout.rightW; const w = clamp(dragStart.current - d, LAYOUT_LIMITS.rightW.min, LAYOUT_LIMITS.rightW.max); setLayoutState((p) => ({ ...p, rightW: w })); };
  const dragBottom = (d: number) => { if (dragStart.current === null) dragStart.current = layout.bottomH; const h = clamp(dragStart.current - d, LAYOUT_LIMITS.bottomH.min, LAYOUT_LIMITS.bottomH.max); setLayoutState((p) => ({ ...p, bottomH: h })); };
  const dragEnd = () => { dragStart.current = null; setLayoutState((p) => { saveLayout(p); return p; }); };

  const err = error ? friendlyError(error) : null;
  const livePlan = analysis && analysis.plan ? { symbol: analysis.symbol, direction: analysis.direction, trigger: analysis.plan.trigger, invalidation: analysis.plan.invalidation, target: analysis.plan.targets[0], state: analysis.machine?.state ?? "WATCHING", lifecycle: decision?.lifecycle, price: quote?.price ?? analysis.price } : null;

  return (
    <div className="options-app flex h-[calc(100vh-44px)] flex-col overflow-hidden bg-bg" data-density={layout.density}>
      <CommandBar
        searchRef={searchRef} searchText={searchText} setSearchText={setSearchText}
        onSearch={() => { const s = searchText.trim().toUpperCase(); if (/^[A-Z.]{1,6}$/.test(s)) loadSymbol(s); }}
        analysis={analysis} quote={quote} decision={decision} broker={broker}
        profile={profile} setProfile={setProfile} replayAt={replayAt} setReplayAt={setReplayAt}
        layout={layout} setLayout={setLayout} error={error}
        siren={<SirenBar analysis={analysis} onLoad={loadSymbol} />}
      />
      {layout.watch && <MorningWatch isOwner={isOwner} onPicks={setPicks} livePlan={livePlan} onLoad={loadSymbol} active={symbol} />}
      {err && analysis && (
        <div className="flex items-center gap-2 bg-bear/10 px-3 py-1 text-xs text-bear">
          <AlertTriangle size={12} /> {err.headline}{err.detail ? <span className="text-bear/70"> · {err.detail}</span> : null}
          <span className="ml-auto text-ink-faint">showing the last good analysis</span>
        </div>
      )}

      {!analysis ? (
        <div className="flex min-h-0 flex-1">
          {loading && !error ? (
            <div className="flex flex-1 gap-1 p-1">
              <Skeleton className="w-[280px]" />
              <Skeleton className="flex-1" />
              <Skeleton className="w-[380px]" />
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <StateBox kind="error" headline={err?.headline ?? "ANALYSIS UNAVAILABLE"} detail={err?.detail ?? null} action={<button onClick={() => void refetch()} className="btn-ghost btn-sm">Retry</button>} />
            </div>
          )}
        </div>
      ) : !analysis.connected ? (
        <div className="flex flex-1 items-center justify-center">
          <StateBox kind="error" headline="NOT CONNECTED TO DATA PROVIDER" detail="Add ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY to the environment." />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {layout.left && (
            <>
              <aside className="flex min-h-0 shrink-0 flex-col bg-bg-panel" style={{ width: layout.leftW }}>
                <SymbolSwitcher symbol={symbol} picks={picks} version={recentVersion} onPick={loadSymbol} />
                <div className="min-h-0 flex-1">
                  <ScannerTab profile={profile} compact active={symbol} onPick={loadSymbol} />
                </div>
              </aside>
              <Resizer axis="x" onDelta={dragLeft} onEnd={dragEnd} className="bg-bg" />
            </>
          )}

          <div className="flex min-w-0 flex-1 flex-col bg-bg-card">
            <ChartToolbar
              tf={tf} setTf={setTf} prefs={prefs} setPrefs={setPrefs} minStrength={minStrength} setMinStrength={setMinStrength}
              right={
                analysis.dataStale ? <span className="font-semibold text-bear">DATA STALE</span> : (
                  <>
                    <span key={analysis.asOf} className="relative flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-bull opacity-60" /><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-bull" /></span>
                    {new Date(analysis.asOf).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })}
                  </>
                )
              }
            />
            <div className="min-h-0 flex-1">
              <OptionsChart
                bars={chartBars}
                zones={chartZones}
                plan={chartPlan}
                minStrength={minStrength}
                toggles={toggles}
                resetKey={`${analysis.symbol}:${tf}`}
                live={liveQuote}
                bucketMs={BUCKET_MS[tf]}
                session={levels}
                myTrade={myTrade ? { side: myTrade.side, strike: myTrade.strike, breakEven: breakEvenAtExpiry(myTrade.side, myTrade.strike, myTrade.entry), label: `${myTrade.strike}${myTrade.side === "call" ? "C" : "P"}` } : null}
                context={{
                  symbol: analysis.symbol,
                  direction: analysis.direction,
                  state: analysis.machine?.state ?? null,
                  lockedAt: analysis.lock?.pickedAt ?? null,
                  machine: tf === "5m" || tf === "1m" || tf === "2m" ? analysis.machine : null,
                  machineBars,
                }}
              />
            </div>
            {layout.bottom && <Resizer axis="y" onDelta={dragBottom} onEnd={dragEnd} className="bg-bg" />}
            <div className="shrink-0" style={{ height: layout.bottom ? layout.bottomH : 32 }}>
              <BottomDrawer
                analysis={analysis} broker={broker} compareSet={compareSet} setCompareSet={setCompareSet}
                onTicket={openTicket} refreshBroker={refetchBroker} isOwner={isOwner}
                tab={tab} setTab={setTab} open={layout.bottom} setOpen={(v) => setLayout((p) => ({ ...p, bottom: v }))}
                profile={profile} decision={decision} planContract={planContract} setPlanContract={setPlanSymbol} risk={risk} setRisk={setRisk} myTrade={myTrade} onRecordTrade={saveTrade}
              />
            </div>
          </div>

          {layout.right && decision && (
            <>
              <Resizer axis="x" onDelta={dragRight} onEnd={dragEnd} className="bg-bg" />
              <aside className="min-h-0 shrink-0 bg-bg-panel" style={{ width: layout.rightW }}>
                <TradeCommandPanel
                  analysis={analysis} quote={quote} decision={decision} myTrade={myTrade} onTradeChange={saveTrade}
                  isOwner={isOwner} onRepick={repickLevel} onTicket={openTicket}
                  onCompare={(s) => { setCompareSet((v) => (v.includes(s) ? v : [...v, s].slice(-4))); setTab("compare"); setLayout((p) => ({ ...p, bottom: true })); }}
                  setupTf={setupTf} onSelectTf={(t) => { setSetupTf(t); setTf(t); }}
                  onPlan={(c) => { setPlanSymbol(c.symbol); setTab("plan"); setLayout((p) => ({ ...p, bottom: true })); }}
                  chartTf={tf} onSelectChartTf={(t) => { setTf(t); if (t === "1m" || t === "5m" || t === "15m" || t === "1h" || t === "D") setSetupTf(t); }}
                />
              </aside>
            </>
          )}
        </div>
      )}

      {ticket && analysis && (
        <TicketModal contract={ticket} analysis={analysis} broker={broker} onClose={() => setTicket(null)} onDone={() => { setTicket(null); void refetchBroker(); }} />
      )}
    </div>
  );
}
