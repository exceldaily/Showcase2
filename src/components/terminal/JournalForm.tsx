"use client";

// Journal entry form (spec §42). Market context (regime, sector, RVOL,
// setup score) is attached server-side at save time from real data.

import { useState } from "react";
import { useRouter } from "next/navigation";

const SETUPS = [
  "VWAP Reclaim", "HOD Break", "Opening Range Breakout", "First Pullback",
  "9 EMA Pullback", "20 EMA Pullback", "Breakout", "Trend Continuation",
  "Volume Surge", "Red To Green", "Failed Breakout", "Other",
];
const EMOTIONS = ["Calm", "Confident", "FOMO", "Hesitant", "Frustrated", "Revenge", "Bored"];

export default function JournalForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [f, setF] = useState({
    symbol: "", tradeDate: new Date().toISOString().slice(0, 10),
    entryPrice: "", exitPrice: "", shares: "", setup: "", scannerSource: "",
    notes: "", mistakes: "", emotion: "", catalyst: "",
  });

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((s) => ({ ...s, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.symbol.trim()) return;
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/journal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(f),
    });
    setBusy(false);
    if (res.ok) {
      setMsg("Entry saved with market context attached.");
      setF((s) => ({ ...s, symbol: "", entryPrice: "", exitPrice: "", shares: "", notes: "", mistakes: "", catalyst: "" }));
      router.refresh();
    } else {
      setMsg("Could not save the entry.");
    }
  }

  const input = "w-full rounded border border-border bg-bg-elevated px-1.5 py-1 text-[11px] outline-none focus:border-brand";
  const label = "text-[9px] uppercase tracking-wide text-ink-faint";

  return (
    <form onSubmit={submit} className="space-y-2 p-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Log a trade</div>

      <div className="grid grid-cols-2 gap-1.5">
        <label className="flex flex-col gap-0.5">
          <span className={label}>Symbol *</span>
          <input className={`${input} uppercase`} value={f.symbol} onChange={set("symbol")} placeholder="AMD" required />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className={label}>Date</span>
          <input type="date" className={input} value={f.tradeDate} onChange={set("tradeDate")} />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className={label}>Entry</span>
          <input type="number" step="0.01" className={input} value={f.entryPrice} onChange={set("entryPrice")} />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className={label}>Exit</span>
          <input type="number" step="0.01" className={input} value={f.exitPrice} onChange={set("exitPrice")} />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className={label}>Shares</span>
          <input type="number" className={input} value={f.shares} onChange={set("shares")} />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className={label}>Emotion</span>
          <select className={input} value={f.emotion} onChange={set("emotion")}>
            <option value="">—</option>
            {EMOTIONS.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-0.5">
        <span className={label}>Setup</span>
        <select className={input} value={f.setup} onChange={set("setup")}>
          <option value="">—</option>
          {SETUPS.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      </label>

      <label className="flex flex-col gap-0.5">
        <span className={label}>Catalyst</span>
        <input className={input} value={f.catalyst} onChange={set("catalyst")} placeholder="Earnings beat, FDA, none…" />
      </label>

      <label className="flex flex-col gap-0.5">
        <span className={label}>Notes</span>
        <textarea rows={2} className={input} value={f.notes} onChange={set("notes")} placeholder="What did you see? Why did you take it?" />
      </label>

      <label className="flex flex-col gap-0.5">
        <span className={label}>Mistakes</span>
        <textarea rows={2} className={input} value={f.mistakes} onChange={set("mistakes")} placeholder="Chased entry, moved stop, sized too big…" />
        <span className="text-[9px] text-ink-faint">
          Phrase mistakes consistently — repeated wording is what the pattern counter detects.
        </span>
      </label>

      <button
        type="submit"
        disabled={busy || !f.symbol.trim()}
        className="w-full rounded bg-brand py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-brand-glow disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save Entry"}
      </button>

      {msg && <div className="text-[10px] text-ink-muted">{msg}</div>}
    </form>
  );
}
