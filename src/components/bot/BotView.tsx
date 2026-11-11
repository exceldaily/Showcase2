"use client";

// Options bot control page: the budget, the switch, the rules, and
// everything the bot did and why. While this page is open it also runs a
// bot pass once a minute, so the bot works without an outside scheduler.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Chip, SkeletonRows, StateBox } from "@/components/ui/primitives";
import { TONE_TEXT, signTone } from "@/lib/ui/tone";
import { etClock, fmt$ } from "@/lib/ui/format";
import type { BotSettings, BudgetState } from "@/lib/bot/rules";
import type { BotTrade } from "@/lib/bot/engine";

interface Snapshot {
  settings: BotSettings; budget: BudgetState; trades: BotTrade[];
  events: { at: string; level: string; symbol: string | null; message: string }[];
  lastTick: string | null; lastSummary: { skipped?: string[]; looked?: number; marketOpen?: boolean; tookMs?: number } | null;
  account: { paper: boolean; ok: boolean; reason: string | null }; dataTier: "paid" | "free";
}

const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const toMin = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + (m || 0); };
const pnl$ = (n: number) => `${n >= 0 ? "+" : "-"}$${Math.abs(n).toFixed(0)}`;

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block" data-tip={hint}>
      <span className="stat-label">{label}</span>
      <div className="mt-0.5">{children}</div>
    </label>
  );
}

export default function BotView() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [form, setForm] = useState<BotSettings | null>(null);
  const [symbolsText, setSymbolsText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = useRef(false);

  const apply = useCallback((j: Snapshot) => {
    setSnap(j);
    if (!dirty.current) { setForm(j.settings); setSymbolsText(j.settings.symbols.join(", ")); }
  }, []);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/bot", { cache: "no-store" });
      const j = (await r.json()) as Snapshot & { error?: string };
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setError(null);
      apply(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not load");
    }
  }, [apply]);

  useEffect(() => { void load(); }, [load]);
  // Heartbeat: one pass a minute while the page is open, then refresh what is shown.
  useEffect(() => {
    const id = setInterval(async () => {
      if (document.hidden) return;
      await fetch("/api/bot/tick", { method: "POST" }).catch(() => undefined);
      void load();
    }, 60_000);
    return () => clearInterval(id);
  }, [load]);

  const save = async (patch: Partial<BotSettings> & { resetBudget?: boolean }) => {
    if (!form) return;
    setBusy(true);
    try {
      const symbols = symbolsText.toUpperCase().split(/[\s,]+/).filter(Boolean);
      const r = await fetch("/api/bot", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...form, symbols, ...patch }) });
      const j = (await r.json()) as Snapshot & { error?: string };
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      dirty.current = false;
      apply(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    } finally {
      setBusy(false);
    }
  };
  const act = async (action: "pause" | "stop") => {
    if (action === "stop" && !window.confirm("Turn the bot off and sell every open bot position at market?")) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/bot?action=${action}`, { method: "POST" });
      if (r.ok) { dirty.current = false; apply((await r.json()) as Snapshot); }
    } finally {
      setBusy(false);
    }
  };
  const set = <K extends keyof BotSettings>(k: K, v: BotSettings[K]) => { dirty.current = true; setForm((f) => (f ? { ...f, [k]: v } : f)); };
  const numIn = (k: keyof BotSettings, step = 1) => (
    <input type="number" step={step} value={form ? Number(form[k]) : 0} onChange={(e) => set(k, Number(e.target.value) as never)} className="input w-full py-1 font-mono" />
  );

  if (error && !snap) return <div className="full-bleed px-4 py-6"><StateBox kind="error" headline="BOT UNAVAILABLE" detail={error === "owner only" ? "Only the owner account can see or run the bot." : error} /></div>;
  if (!snap || !form) return <div className="full-bleed px-4 py-6"><SkeletonRows rows={8} className="max-w-lg" /></div>;

  const b = snap.budget;
  const s = snap.settings;
  const used = b.reserved + b.inPositions;
  const lost = Math.max(0, -b.realized);
  const pct = (x: number) => `${Math.min(100, (x / Math.max(1, b.budget)) * 100)}%`;
  const active = snap.trades.filter((t) => ["PENDING_ENTRY", "OPEN", "PENDING_EXIT"].includes(t.status));
  const closed = snap.trades.filter((t) => t.status === "CLOSED");
  const wins = closed.filter((t) => t.pnl > 0).length;
  const modeTone = s.mode === "trade" ? "bull" : s.mode === "dry-run" ? "warn" : "faint";

  return (
    <div className="full-bleed min-h-[calc(100vh-44px)] bg-bg px-4 py-4 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="max-w-3xl">
          <div className="text-lg font-semibold">Options bot</div>
          <div className="text-xs text-ink-muted">Buys calls or puts when the setup engine says CALL or PUT, only with money from the budget below, and sells them by its exit rules. It never sells options short, so a trade cannot lose more than it paid.</div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip tone={modeTone} dot>{s.mode === "trade" ? "TRADING" : s.mode === "dry-run" ? "DRY RUN" : "OFF"}</Chip>
          <Chip tone={snap.account.paper ? "muted" : "bear"} title={snap.account.paper ? "Alpaca paper account: simulated money" : "LIVE account: real money"}>{snap.account.paper ? "PAPER ACCOUNT" : "LIVE ACCOUNT"}</Chip>
          <Chip tone={snap.dataTier === "paid" ? "bull" : "warn"} title={snap.dataTier === "paid" ? "Live consolidated data" : "Free Alpaca data: stock prices live from IEX only, option quotes about 15 minutes delayed"}>{snap.dataTier === "paid" ? "LIVE DATA" : "FREE DATA (OPTIONS DELAYED)"}</Chip>
          <Link href="/options" className="btn-ghost btn-sm">Workspace</Link>
        </div>
      </div>

      {!snap.account.ok && <div className="mt-3 rounded-md bg-bear/10 px-3 py-2 text-sm text-ink">{snap.account.reason}</div>}
      {snap.dataTier === "free" && (
        <div className="mt-3 rounded-md bg-warn/10 px-3 py-2 text-sm text-ink">
          The paid Alpaca data plan is not active, so option quotes are about 15 minutes old. Buy orders are limit orders capped by the budget either way, but the limit is set from an old quote, so some orders will not fill and exits by option price are less precise. Exits by the stock&apos;s target and wrong line use live stock prices.
        </div>
      )}

      {/* Budget */}
      <div className="mt-4 rounded-lg bg-bg-card p-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="panel-title">Budget</div>
            <div className="num mt-1 text-[30px] font-semibold leading-none">{fmt$(b.available, 0)} <span className="text-sm font-normal text-ink-faint">free of {fmt$(b.budget, 0)}</span></div>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
            <div><div className="stat-label">In positions</div><div className="num">{fmt$(b.inPositions, 0)}</div></div>
            <div><div className="stat-label">Reserved by orders</div><div className="num">{fmt$(b.reserved, 0)}</div></div>
            <div><div className="stat-label">Result since set</div><div className={`num ${TONE_TEXT[signTone(b.realized)]}`}>{pnl$(b.realized)}</div></div>
            <div><div className="stat-label">Today</div><div className={`num ${TONE_TEXT[signTone(b.todayRealized)]}`}>{pnl$(b.todayRealized)} · {b.todayTrades} trade{b.todayTrades === 1 ? "" : "s"}</div></div>
          </div>
        </div>
        <div className="mt-2 flex h-2 overflow-hidden rounded bg-bg-elevated">
          <div className="bg-bear/70" style={{ width: pct(lost) }} title={`Lost: ${fmt$(lost, 0)}`} />
          <div className="bg-brand/80" style={{ width: pct(used) }} title={`At risk now: ${fmt$(used, 0)}`} />
        </div>
        <div className="mt-1 text-2xs text-ink-faint">Red is money already lost, blue is money at risk right now, the rest is free. Losses use up the budget until you reset it. {s.reinvestGains ? "Gains are added back to the budget." : "Gains are not added back."}</div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        {/* Settings */}
        <div className="rounded-lg bg-bg-card p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="panel-title">Switch and rules</div>
            <div className="flex gap-1.5">
              <button onClick={() => void act("pause")} disabled={busy || s.mode === "off"} className="btn-ghost btn-sm" title="Turn the bot off and cancel unfilled buy orders. Open positions stay under the exit rules.">Pause</button>
              <button onClick={() => void act("stop")} disabled={busy} className="btn btn-sm bg-bear/20 text-bear hover:bg-bear/30" title="Turn the bot off and sell every open bot position at market">Stop and sell all</button>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {([["off", "Off", "Does nothing"], ["dry-run", "Dry run", "Logs what it would buy, sends no orders"], ["trade", "Trade", snap.account.paper ? "Sends orders to the paper account" : "Sends orders to the LIVE account"]] as const).map(([k, label, tip]) => (
              <button key={k} onClick={() => set("mode", k)} title={tip} className={`rounded-md px-2 py-2 text-sm font-semibold ${form.mode === k ? (k === "trade" ? "bg-bull/20 text-bull" : k === "dry-run" ? "bg-warn/20 text-warn" : "bg-bg-elevated text-ink") : "bg-bg-elevated/50 text-ink-faint hover:text-ink"}`}>{label}</button>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
            <Field label="Budget ($)" hint="The most the bot may ever have at risk">{numIn("budget", 50)}</Field>
            <Field label="Per trade ($)" hint="Most premium for one trade">{numIn("perTrade", 25)}</Field>
            <Field label="Daily loss stop ($)" hint="No new trades today once today's losses reach this">{numIn("dailyLossLimit", 25)}</Field>
            <Field label="Max open">{numIn("maxOpen")}</Field>
            <Field label="Max trades / day">{numIn("maxTradesPerDay")}</Field>
            <Field label="Max contracts">{numIn("maxContracts")}</Field>
            <Field label="Min setup score" hint="The engine's setup score, 50 to 100. Higher is pickier.">{numIn("minScore", 5)}</Field>
            <Field label="Max days to expiry" hint="0 = same-day contracts only">{numIn("maxDte")}</Field>
            <Field label="Max spread %">{numIn("maxSpreadPct", 0.5)}</Field>
            <Field label="Take profit %" hint="Sell when the option is up this much">{numIn("takeProfitPct", 5)}</Field>
            <Field label="Stop loss %" hint="Sell when the option is down this much">{numIn("stopLossPct", 5)}</Field>
            <Field label="Slippage %" hint="How far past the quote a limit order may reach so it fills">{numIn("slippagePct", 0.5)}</Field>
            <Field label="Max hold (min)">{numIn("maxHoldMinutes", 5)}</Field>
            <Field label="No entries after (ET)"><input type="time" value={hm(form.noEntryAfter)} onChange={(e) => set("noEntryAfter", toMin(e.target.value))} className="input w-full py-1 font-mono" /></Field>
            <Field label="Sell everything at (ET)"><input type="time" value={hm(form.flattenAt)} onChange={(e) => set("flattenAt", toMin(e.target.value))} className="input w-full py-1 font-mono" /></Field>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={form.calls} onChange={(e) => set("calls", e.target.checked)} /> Calls</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={form.puts} onChange={(e) => set("puts", e.target.checked)} /> Puts</label>
            <label className="flex items-center gap-1.5" title="Add realized gains back to the budget"><input type="checkbox" checked={form.reinvestGains} onChange={(e) => set("reinvestGains", e.target.checked)} /> Reinvest gains</label>
          </div>
          <Field label="Symbols (up to 12)" hint="The bot only looks at these. SPX is not tradeable on Alpaca.">
            <input value={symbolsText} onChange={(e) => { dirty.current = true; setSymbolsText(e.target.value); }} className="input mt-1 w-full py-1 font-mono text-xs uppercase" />
          </Field>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button onClick={() => void save({})} disabled={busy} className="btn-primary btn-sm">Save</button>
            <button onClick={() => { if (window.confirm("Start the budget count again from now? Earlier losses stop counting against it.")) void save({ resetBudget: true }); }} disabled={busy} className="btn-ghost btn-sm">Reset budget</button>
            {error && <span className="text-xs text-bear">{error}</span>}
            <span className="ml-auto text-2xs text-ink-faint">{snap.lastTick ? `last pass ${etClock(snap.lastTick, true)} ET` : "no pass yet"}{snap.lastSummary?.tookMs ? ` · ${(snap.lastSummary.tookMs / 1000).toFixed(1)}s` : ""}</span>
          </div>
          {snap.lastSummary && (
            <div className="mt-2 text-xs text-ink-faint">Last pass: {snap.lastSummary.skipped && snap.lastSummary.skipped.length > 0 ? snap.lastSummary.skipped.slice(0, 4).join(" · ") : snap.lastSummary.marketOpen === false ? "market closed" : `looked at ${snap.lastSummary.looked ?? 0} symbols, no CALL or PUT signal`}</div>
          )}
          <div className="mt-2 text-2xs text-ink-faint">Runs once a minute while this page is open, or from a scheduler calling /api/bot/tick with the cron secret. Setup score is a score, not a win rate: measured results are on the <Link href="/signals" className="underline decoration-dotted hover:text-ink">Signals</Link> page.</div>
        </div>

        {/* Positions and log */}
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-lg bg-bg-card p-3">
            <div className="panel-title">Open now <span className="text-ink-faint">{active.length}</span></div>
            {active.length === 0 ? <div className="mt-1 text-sm text-ink-faint">Nothing open.</div> : (
              <table className="tbl mt-1">
                <thead><tr>{["Contract", "Qty", "Status", "Paid", "At risk", "Target", "Wrong line", "Why"].map((h) => <th key={h} className="!bg-transparent">{h}</th>)}</tr></thead>
                <tbody>{active.map((t) => (
                  <tr key={t.id}>
                    <td className="num font-semibold"><Link href={`/options?s=${t.symbol}`} className="hover:text-brand-glow">{t.occ}</Link></td>
                    <td className="num">{t.qty}</td>
                    <td><Chip tone={t.status === "OPEN" ? "mine" : "warn"}>{t.status === "PENDING_ENTRY" ? "BUYING" : t.status === "PENDING_EXIT" ? "SELLING" : "OPEN"}</Chip></td>
                    <td className="num">{t.entryFill !== null ? fmt$(t.entryFill) : `limit ${fmt$(t.limitPrice)}`}</td>
                    <td className="num">{fmt$(t.status === "PENDING_ENTRY" ? t.reserved : t.cost, 0)}</td>
                    <td className="num text-ink-muted">{fmt$(t.target)}</td>
                    <td className="num text-ink-muted">{fmt$(t.invalidation)}</td>
                    <td className="max-w-[280px] truncate text-xs text-ink-faint" title={t.reasonIn ?? ""}>{t.reasonIn}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
          <div className="overflow-x-auto rounded-lg bg-bg-card p-3">
            <div className="flex items-center justify-between"><span className="panel-title">Closed trades <span className="text-ink-faint">{closed.length}</span></span>{closed.length > 0 && <span className="text-xs text-ink-faint">{wins} won · {closed.length - wins} lost · {pnl$(closed.reduce((a, t) => a + t.pnl, 0))}</span>}</div>
            {closed.length === 0 ? <div className="mt-1 text-sm text-ink-faint">No closed trades yet.</div> : (
              <table className="tbl mt-1">
                <thead><tr>{["Day", "Contract", "Qty", "In", "Out", "Result", "Why it sold"].map((h) => <th key={h} className="!bg-transparent">{h}</th>)}</tr></thead>
                <tbody>{closed.slice(0, 40).map((t) => (
                  <tr key={t.id}>
                    <td className="num text-ink-muted">{t.day.slice(5)}</td>
                    <td className="num font-semibold">{t.occ}</td>
                    <td className="num">{t.qty}</td>
                    <td className="num">{fmt$(t.entryFill)}</td>
                    <td className="num">{fmt$(t.exitFill)}</td>
                    <td className={`num font-semibold ${TONE_TEXT[signTone(t.pnl)]}`}>{pnl$(t.pnl)}</td>
                    <td className="max-w-[300px] truncate text-xs text-ink-faint" title={t.reasonOut ?? ""}>{t.reasonOut}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
          <div className="rounded-lg bg-bg-card p-3">
            <div className="panel-title">Log</div>
            <ul className="mt-1 max-h-[320px] space-y-0.5 overflow-y-auto text-xs">
              {snap.events.length === 0 && <li className="text-ink-faint">Nothing yet.</li>}
              {snap.events.map((e, i) => (
                <li key={i} className="flex gap-2">
                  <span className="num shrink-0 text-ink-faint">{e.at.slice(5, 10)} {etClock(e.at)}</span>
                  <span className={e.level === "trade" ? "text-ink" : e.level === "warn" ? "text-warn" : "text-ink-muted"}>{e.symbol ? <span className="num font-semibold">{e.symbol} </span> : null}{e.message}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
