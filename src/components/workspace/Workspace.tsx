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
import { useAnalysis, useBroker, useEvents, useIsOwner, useMarket, useQuote } from "./useFeeds";
import { minutesToNextEvent } from "@/lib/catalysts";
import { detectTransitions, type AlertSnapshot } from "@/lib/alertTransitions";
import { classify, tickerEvidence } from "@/lib/marketState";
import AlertToasts, { type Toast } from "./AlertToasts";
import { skippedOutcome } from "@/lib/journal/stats";
import type { TradeRecord, TradeSnapshot } from "@/lib/journal/types";
import EventsPanel from "./EventsPanel";
import MarketPanel from "./MarketPanel";

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
  const [eventBuffer, setEventBufferState] = useState(15);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const prevAlert = useRef<AlertSnapshot | null>(null);
  const setEventBuffer = (n: number) => { setEventBufferState(n); try { localStorage.setItem("af_event_buffer", String(n)); } catch { /* ignore */ } };
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
    try { const b = Number(localStorage.getItem("af_event_buffer")); if (Number.isFinite(b) && b >= 0) setEventBufferState(b); } catch { /* ignore */ }
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
      if (next0.mode === "JOURNAL") { window.location.href = "/journal"; return p; }
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
  const analysisRef = useRef<import("@/lib/optionsTerminal").OptionsAnalysis | null>(null);
  const decisionRef = useRef<import("@/lib/decision/lifecycle").DecisionRead | null>(null);
  const marketRef = useRef<string | null>(null);
  const journalKey = (sym: string) => `af_trade_journal:${sym}`;
  const snapshotNow = useCallback((c: { symbol: string; strike: number; side: "call" | "put"; expiry: string; dte: number; mid: number; delta: number | null; score: number; tag: string | null } | null): TradeSnapshot | null => {
    const a = analysisRef.current, d = decisionRef.current;
    if (!a || !d) return null;
    return {
      price: a.price, lifecycle: d.lifecycle, verdict: d.verdict, bias: d.bias, setup: d.setup,
      confluence: a.confluence ? { pct: a.confluence.pct, parts: a.confluence.parts.map((p) => ({ name: p.name, score: p.score, max: p.max, measured: p.measured })) } : null,
      matrix: a.matrix.map((m) => ({ tf: m.tf, trend: m.trend, momentum: m.momentum, vwap: m.vwap })),
      align: a.align ? { score: a.align.score, conflict: a.align.conflict } : null,
      rvol: a.rvol, vwap: a.vwap, marketState: marketRef.current, contract: c, slot: a.slot,
    };
  }, []);
  // Recording a trade also writes a journal row; closing it asks for the exit premium.
  const saveTrade = useCallback((t: MyTrade | null) => {
    const a = analysisRef.current, d = decisionRef.current;
    if (t) {
      const prev = loadTrade(symbol);
      setMyTrade(t);
      try { localStorage.setItem(tradeKey(symbol), JSON.stringify(t)); } catch { /* ignore */ }
      const changed = !prev || prev.contract !== t.contract || prev.entry !== t.entry || prev.qty !== t.qty;
      if (!changed || !a) return;
      const c = a.contracts.find((x) => x.symbol === t.contract) ?? null;
      const inv = a.plan && a.price !== null && c ? scenarioPrice({ side: c.side, strike: c.strike, expiry: c.expiry, iv: c.iv, currentMid: t.entry, underlyingNow: a.price }, a.plan.invalidation, 60).midEstimate : null;
      void fetch("/api/journal/trades", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        status: "open", symbol: a.symbol, direction: a.direction, side: t.side, contract: t.contract, strike: t.strike, expiry: t.expiry, entryPremium: t.entry, qty: t.qty,
        riskDollars: inv !== null ? Math.max(0, (t.entry - inv) * 100 * t.qty) : t.entry * 100 * t.qty,
        setup: d?.setup ?? null, lifecycle: d?.lifecycle ?? null, marketState: marketRef.current, confidence: a.confluence?.pct ?? null,
        trigger: a.plan?.trigger ?? null, invalidation: a.plan?.invalidation ?? null, targets: a.plan?.targets ?? null,
        snapshot: snapshotNow(c ? { symbol: c.symbol, strike: c.strike, side: c.side, expiry: c.expiry, dte: c.dte, mid: c.mid, delta: c.delta, score: c.score, tag: c.tag } : null),
        strikeTag: c?.tag ?? null, aligned: a.align ? !a.align.conflict : null,
      }) }).then((r) => r.json()).then((j: { trade?: TradeRecord }) => { if (j.trade) try { localStorage.setItem(journalKey(symbol), j.trade.id); } catch { /* ignore */ } }).catch(() => undefined);
    } else {
      const prev = loadTrade(symbol);
      let journalId: string | null = null;
      try { journalId = localStorage.getItem(journalKey(symbol)); } catch { /* ignore */ }
      if (prev && journalId) {
        const live = a?.contracts.find((x) => x.symbol === prev.contract)?.mid;
        const v = window.prompt("Exit premium per share for the journal?", live !== undefined ? live.toFixed(2) : "");
        const n = v === null ? NaN : Number(v);
        if (Number.isFinite(n) && n >= 0) void fetch("/api/journal/trades", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: journalId, exitPremium: n, mae: maeRef.current, mfe: mfeRef.current }) }).catch(() => undefined);
        try { localStorage.removeItem(journalKey(symbol)); } catch { /* ignore */ }
      }
      maeRef.current = null; mfeRef.current = null;
      setMyTrade(null);
      try { localStorage.removeItem(tradeKey(symbol)); } catch { /* ignore */ }
    }
  }, [symbol, snapshotNow]);
  const maeRef = useRef<number | null>(null);
  const mfeRef = useRef<number | null>(null);
  const skipSetup = useCallback((reason: string) => {
    const a = analysisRef.current, d = decisionRef.current;
    if (!a || !d || !a.plan) return;
    const c = a.best;
    void fetch("/api/journal/trades", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      status: "skipped", symbol: a.symbol, direction: a.direction, side: c?.side ?? null, contract: c?.symbol ?? null, strike: c?.strike ?? null, expiry: c?.expiry ?? null,
      entryPremium: c?.mid ?? null, qty: 1, setup: d.setup, lifecycle: d.lifecycle, marketState: marketRef.current, confidence: a.confluence?.pct ?? null,
      trigger: a.plan.trigger, invalidation: a.plan.invalidation, targets: a.plan.targets, skippedReason: reason,
      snapshot: snapshotNow(c ? { symbol: c.symbol, strike: c.strike, side: c.side, expiry: c.expiry, dte: c.dte, mid: c.mid, delta: c.delta, score: c.score, tag: c.tag } : null),
      strikeTag: c?.tag ?? null, aligned: a.align ? !a.align.conflict : null,
    }) }).then(() => setToasts((t) => [...t, { id: `${Date.now()}:skip`, at: Date.now(), kind: "SETUP_INVALIDATED", symbol: a.symbol, title: `${a.symbol} setup logged as skipped`, detail: `${reason}. The journal will check whether it would have worked.`, area: "status", urgency: "low" }])).catch(() => undefined);
  }, [snapshotNow]);

  // ── Feeds ──
  const { analysis, loading, error, refetch } = useAnalysis(symbol, profile, replayAt);
  const quote = useQuote(symbol);
  const { broker, refetch: refetchBroker } = useBroker();
  const events = useEvents(symbol);
  const market = useMarket();
  const nextEvent = useMemo(() => minutesToNextEvent(events.events, Date.now(), "HIGH", symbol), [events.events, symbol]);

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
        maxSpreadPct: SCORE_PROFILES[profile]?.maxSpreadPct ?? 8, minutesToEvent: nextEvent?.minutes ?? null, eventBufferMinutes: eventBuffer, riskLimitBreached: riskBreach, marketOpen: analysis.marketOpen,
      }),
    });
  }, [analysis, myTrade, setupTf, profile, riskBreach, nextEvent, eventBuffer]);
  // Ticker state from the same engine the market uses.
  const tickerState = useMemo(() => {
    if (!analysis || !analysis.matrix.length) return null;
    const ev = tickerEvidence({ rows: analysis.matrix, price: analysis.price, vwap: analysis.vwap, rvol: analysis.rvol, trendLabel: analysis.trend?.label ?? null, choppy: analysis.choppy, changePct: analysis.changePct, prevHigh: levels?.prevHigh ?? null, prevLow: levels?.prevLow ?? null });
    return classify(ev.evidence, ev.notMeasured, ev.chopSignals);
  }, [analysis, levels]);
  // Transition alerts: compare the previous snapshot of this symbol with the new one.
  useEffect(() => {
    if (!analysis || !decision) return;
    const price = quote && quote.symbol === analysis.symbol && quote.price !== null ? quote.price : analysis.price;
    const above = analysis.zones.filter((z) => z.strength >= 65 && price !== null && z.price > price).sort((a, b) => a.price - b.price)[0]?.price ?? null;
    const below = analysis.zones.filter((z) => z.strength >= 65 && price !== null && z.price < price).sort((a, b) => b.price - a.price)[0]?.price ?? null;
    const next: AlertSnapshot = { symbol: analysis.symbol, price, vwap: analysis.vwap, rvol: analysis.rvol, direction: analysis.direction, lifecycle: decision.lifecycle, machineState: analysis.machine?.state ?? null, trigger: analysis.plan?.trigger ?? null, invalidation: analysis.plan?.invalidation ?? null, target1: analysis.plan?.targets[0] ?? null, support: below, resistance: above, minutesToEvent: nextEvent?.minutes ?? null };
    const found = detectTransitions(prevAlert.current, next, eventBuffer);
    prevAlert.current = next;
    if (!found.length) return;
    const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    let seen: string[] = [];
    try { seen = JSON.parse(localStorage.getItem("af_alerts_seen") ?? "[]") as string[]; } catch { /* fresh */ }
    const fresh = found.filter((a) => !seen.includes(`${day}:${a.symbol}:${a.kind}`));
    if (!fresh.length) return;
    try { localStorage.setItem("af_alerts_seen", JSON.stringify([...seen, ...fresh.map((a) => `${day}:${a.symbol}:${a.kind}`)].slice(-300))); } catch { /* ignore */ }
    setToasts((t) => [...t, ...fresh.map((a) => ({ ...a, id: `${Date.now()}:${a.kind}`, at: Date.now() }))]);
    if (typeof Notification !== "undefined" && Notification.permission === "granted") for (const a of fresh) if (a.urgency === "high") new Notification(a.title, { body: a.detail, tag: `${a.symbol}:${a.kind}` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis, decision?.lifecycle, quote?.price, nextEvent?.minutes]);
  const dismissToast = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  useEffect(() => { analysisRef.current = analysis; decisionRef.current = decision; marketRef.current = market.snap?.state?.state ?? null; }, [analysis, decision, market.snap]);
  // MAE / MFE from the live mid while a recorded trade is open; written with the close.
  useEffect(() => {
    if (!analysis || !myTrade) return;
    const mid = analysis.contracts.find((x) => x.symbol === myTrade.contract)?.mid;
    if (mid === undefined) return;
    const pnl = (mid - myTrade.entry) * 100 * myTrade.qty;
    maeRef.current = maeRef.current === null ? Math.min(0, pnl) : Math.min(maeRef.current, pnl);
    mfeRef.current = mfeRef.current === null ? Math.max(0, pnl) : Math.max(mfeRef.current, pnl);
  }, [analysis, myTrade]);
  // Skipped setups for this symbol today: resolve their outcome from the bars.
  useEffect(() => {
    if (!analysis || analysis.bars.m1.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/journal/trades", { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as { trades: TradeRecord[] };
        const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
        for (const t of j.trades.filter((x) => x.status === "skipped" && x.symbol === analysis.symbol && x.entryAt.slice(0, 10) === today && x.outcome !== "WORKED" && x.outcome !== "FAILED")) {
          const o = skippedOutcome(t, analysis.bars.m1);
          if (o !== "UNRESOLVED" && !cancelled) await fetch("/api/journal/trades", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: t.id, outcome: o }) });
        }
      } catch { /* optional */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, analysis?.asOf.slice(0, 13)]);
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
        nextEvent={nextEvent ? { minutes: nextEvent.minutes, title: nextEvent.event.title } : null} eventBuffer={eventBuffer}
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
                <div className="max-h-[45%] shrink-0 overflow-y-auto border-t border-border/40">
                  <MarketPanel snap={market.snap} error={market.error} />
                  <EventsPanel events={events.events} notes={events.notes} fredOk={events.fredOk} isOwner={isOwner} buffer={eventBuffer} setBuffer={setEventBuffer}
                    onAdd={async (e) => { await fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(e) }); await events.refetch(); }}
                    onDelete={async (id) => { await fetch(`/api/events?id=${id}`, { method: "DELETE" }); await events.refetch(); }} />
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
                  market={market.snap} tickerState={tickerState} onSkip={skipSetup}
                  chartTf={tf} onSelectChartTf={(t) => { setTf(t); if (t === "1m" || t === "5m" || t === "15m" || t === "1h" || t === "D") setSetupTf(t); }}
                />
              </aside>
            </>
          )}
        </div>
      )}

      <AlertToasts toasts={toasts} onDismiss={dismissToast} />
      {ticket && analysis && (
        <TicketModal contract={ticket} analysis={analysis} broker={broker} onClose={() => setTicket(null)} onDone={() => { setTicket(null); void refetchBroker(); }} />
      )}
    </div>
  );
}
