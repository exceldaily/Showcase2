"use client";

// Today's events: scheduled releases with countdowns, the no-entry
// buffer, and owner-entered events for what the free calendar cannot
// cover (earnings, Fed speakers).

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { EventView, Impact } from "@/lib/catalysts";
import { etClock } from "@/lib/ui/format";
import { TONE_CHIP, TONE_TEXT, type Tone } from "@/lib/ui/tone";
import { Panel } from "@/components/ui/primitives";

const IMPACT_TONE: Record<Impact, Tone> = { HIGH: "bear", MEDIUM: "warn", LOW: "muted" };

export default function EventsPanel({
  events, notes, fredOk, isOwner, buffer, setBuffer, onAdd, onDelete,
}: {
  events: EventView[];
  notes: string[];
  fredOk: boolean;
  isOwner: boolean;
  buffer: number;
  setBuffer: (n: number) => void;
  onAdd: (e: { at: string; title: string; impact: Impact; affects: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(() => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }));
  const [time, setTime] = useState("08:30");
  const [impact, setImpact] = useState<Impact>("HIGH");
  const [affects, setAffects] = useState("market");
  const upcoming = events.filter((e) => e.minutesUntil >= 0).slice(0, 8);
  const past = events.filter((e) => e.minutesUntil < 0).slice(-2);

  return (
    <Panel title="Events" collapsible defaultOpen right={<span className="flex items-center gap-1">no entries <input type="number" min={0} max={120} value={buffer} onChange={(e) => setBuffer(Math.max(0, Math.min(120, Number(e.target.value) || 0)))} className="input w-12 py-0 text-2xs" title="No new entries this many minutes before a high-impact event" />m before</span>} bodyClassName="text-xs">
      {!fredOk && <div className="mb-1 text-2xs text-warn">ECONOMIC CALENDAR UNAVAILABLE</div>}
      {upcoming.length === 0 && past.length === 0 && <div className="text-ink-faint">No scheduled events in the next week.</div>}
      <ul className="space-y-0.5">
        {[...past, ...upcoming].map((e) => (
          <li key={e.id} className={`flex items-center gap-2 ${e.minutesUntil < 0 ? "opacity-50" : ""}`}>
            <span className="num w-14 shrink-0 text-ink-muted" title={e.typicalTime ? "Usual release time, not a published clock time" : "Exact time"}>{etClock(e.at)}{e.typicalTime ? "*" : ""}</span>
            <span className="min-w-0 flex-1 truncate text-ink" title={e.title}>{e.title}{e.affects !== "market" && <span className="ml-1 text-ink-faint">{e.affects}</span>}</span>
            <span className={`pill !px-1 !py-0 text-2xs ${TONE_CHIP[IMPACT_TONE[e.impact]]}`}>{e.impact}</span>
            <span className={`num w-12 shrink-0 text-right ${e.minutesUntil >= 0 && e.minutesUntil <= buffer && e.impact === "HIGH" ? "font-semibold text-bear" : TONE_TEXT["faint"]}`}>{e.countdown}</span>
            {isOwner && e.source === "manual" && <button onClick={() => void onDelete(e.id.replace(/^manual:/, ""))} className="btn-quiet h-5 px-0.5 text-ink-faint hover:text-bear" title="Delete"><Trash2 size={11} /></button>}
          </li>
        ))}
      </ul>
      {isOwner && (
        adding ? (
          <form
            className="mt-2 space-y-1"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!title.trim()) return;
              // Interpret the entered wall-clock as Eastern time.
              const [y, m, d] = date.split("-").map(Number);
              const [h, mi] = time.split(":").map(Number);
              const guess = Date.UTC(y, m - 1, d, h, mi);
              const et = new Date(guess).toLocaleString("en-US", { timeZone: "America/New_York", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
              const mm = /(\d+)\/(\d+)\/(\d+), (\d+):(\d+)/.exec(et);
              const asEt = mm ? Date.UTC(Number(mm[3]), Number(mm[1]) - 1, Number(mm[2]), Number(mm[4]) % 24, Number(mm[5])) : guess;
              await onAdd({ at: new Date(guess + (guess - asEt)).toISOString(), title: title.trim(), impact, affects: affects.trim() || "market" });
              setTitle(""); setAdding(false);
            }}
          >
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Event, e.g. NVDA earnings after close" className="input w-full py-1 text-xs" maxLength={120} />
            <div className="flex flex-wrap gap-1">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input py-0.5 text-xs" />
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="input py-0.5 text-xs" />
              <select value={impact} onChange={(e) => setImpact(e.target.value as Impact)} className="select py-0.5 text-xs"><option>HIGH</option><option>MEDIUM</option><option>LOW</option></select>
              <input value={affects} onChange={(e) => setAffects(e.target.value)} placeholder="market or ticker" className="input w-24 py-0.5 text-xs uppercase" />
            </div>
            <div className="flex gap-1">
              <button type="submit" className="btn-primary btn-sm">Add</button>
              <button type="button" onClick={() => setAdding(false)} className="btn-ghost btn-sm">Cancel</button>
              <span className="self-center text-2xs text-ink-faint">Times are Eastern.</span>
            </div>
          </form>
        ) : (
          <button onClick={() => setAdding(true)} className="btn-quiet btn-sm mt-1"><Plus size={11} /> Add event</button>
        )
      )}
      <div className="mt-1.5 text-2xs text-ink-faint">{notes.join(" ")}</div>
    </Panel>
  );
}
