"use client";

// Siren bar: on-page alerts for "jump on it" setups.
// - Polls recent server-side alert events (the sweep runs every minute
//   during market hours across the megacap universe + your list).
// - Also evaluates the OPEN symbol locally on every refresh, so a
//   break on the chart you are watching sirens immediately.
// - Sound is a synthesized siren (WebAudio, no assets); browsers require
//   a click before audio/notifications, hence the Enable button.

import { useCallback, useEffect, useRef, useState } from "react";
import { BellRing, BellOff, Mail, Volume2, X } from "lucide-react";
import { evaluateSiren, type SirenAlert } from "@/lib/sirenRules";
import type { OptionsAnalysis } from "@/lib/optionsTerminal";

interface ServerEvent {
  id: string;
  createdAt: string;
  symbol: string;
  kind: string;
  direction: string;
  urgency: string;
  title: string;
  body: string;
  contract: string | null;
  opportunity: number | null;
  emailed: boolean;
}

function playSiren(ctx: AudioContext, urgency: "high" | "medium") {
  const now = ctx.currentTime;
  const cycles = urgency === "high" ? 3 : 1;
  for (let i = 0; i < cycles; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    const t0 = now + i * 0.9;
    osc.frequency.setValueAtTime(600, t0);
    osc.frequency.linearRampToValueAtTime(1300, t0 + 0.45);
    osc.frequency.linearRampToValueAtTime(600, t0 + 0.9);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.25, t0 + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.88);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.9);
  }
}

export default function SirenBar({ analysis, onLoad }: { analysis: OptionsAnalysis | null; onLoad: (sym: string) => void }) {
  const [enabled, setEnabled] = useState(false);
  const [events, setEvents] = useState<ServerEvent[]>([]);
  const [emailOn, setEmailOn] = useState(false);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ title: string; body: string; symbol: string; urgency: "high" | "medium" } | null>(null);
  const [watch, setWatch] = useState<string[]>([]);
  const [addText, setAddText] = useState("");
  const [showList, setShowList] = useState(false);
  const seen = useRef<Set<string>>(new Set());
  const audio = useRef<AudioContext | null>(null);
  const primed = useRef(false);

  useEffect(() => {
    try {
      setEnabled(localStorage.getItem("af_siren") === "1");
      seen.current = new Set(JSON.parse(localStorage.getItem("af_siren_seen") ?? "[]") as string[]);
    } catch { /* fresh browser */ }
  }, []);

  const remember = (key: string) => {
    seen.current.add(key);
    try { localStorage.setItem("af_siren_seen", JSON.stringify(Array.from(seen.current).slice(-200))); } catch { /* ignore */ }
  };

  const fire = useCallback((a: { title: string; body: string; symbol: string; urgency: "high" | "medium" }) => {
    setBanner(a);
    if (audio.current) playSiren(audio.current, a.urgency);
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      try { new Notification(a.title, { body: a.body.slice(0, 180) }); } catch { /* ignore */ }
    }
  }, []);

  // Server events (the sweep) every 15s.
  useEffect(() => {
    let stop = false;
    const poll = async () => {
      try {
        const r = await fetch("/api/alerts/recent", { cache: "no-store" });
        const j = (await r.json()) as { events: ServerEvent[]; emailConfigured: boolean; lastRun: { at: string } | null };
        if (stop) return;
        setEvents(j.events);
        setEmailOn(j.emailConfigured);
        setLastRun(j.lastRun?.at ?? null);
        if (!primed.current) {
          // First load: do not siren for history, just mark it seen.
          j.events.forEach((e) => seen.current.add(`srv:${e.id}`));
          primed.current = true;
          return;
        }
        if (!enabled) return;
        for (const e of j.events) {
          const key = `srv:${e.id}`;
          if (seen.current.has(key)) continue;
          remember(key);
          fire({ title: e.title, body: e.body, symbol: e.symbol, urgency: e.urgency === "high" ? "high" : "medium" });
          break; // one siren per poll is plenty
        }
      } catch { /* transient */ }
    };
    void poll();
    const id = setInterval(() => { if (document.visibilityState === "visible") void poll(); }, 15_000);
    return () => { stop = true; clearInterval(id); };
  }, [enabled, fire]);

  // Local evaluation of the open symbol.
  useEffect(() => {
    if (!enabled || !analysis || !analysis.marketOpen) return;
    const a: SirenAlert | null = evaluateSiren(analysis, analysis.asOf.slice(0, 10));
    if (!a) return;
    const key = `local:${a.dedupeKey}`;
    if (seen.current.has(key)) return;
    remember(key);
    fire({ title: a.title, body: a.body, symbol: a.symbol, urgency: a.urgency });
  }, [analysis, enabled, fire]);

  const loadWatch = useCallback(async () => {
    try {
      const r = await fetch("/api/alerts/watch", { cache: "no-store" });
      setWatch(((await r.json()) as { symbols: string[] }).symbols);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { void loadWatch(); }, [loadWatch]);

  const enable = async () => {
    try {
      const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
      audio.current = audio.current ?? new Ctx();
      await audio.current.resume();
      if (typeof Notification !== "undefined" && Notification.permission === "default") await Notification.requestPermission();
      setEnabled(true);
      localStorage.setItem("af_siren", "1");
      playSiren(audio.current, "medium"); // audible confirmation
    } catch { setEnabled(true); }
  };
  const disable = () => { setEnabled(false); try { localStorage.setItem("af_siren", "0"); } catch { /* ignore */ } };

  return (
    <div className="border-b border-border bg-bg-card">
      {banner && (
        <div className={`flex items-start gap-2 px-3 py-2 text-[11px] ${banner.urgency === "high" ? "animate-pulse bg-bull/15 text-ink" : "bg-warn/10 text-ink"}`}>
          <Volume2 size={14} className={banner.urgency === "high" ? "mt-0.5 text-bull" : "mt-0.5 text-warn"} />
          <div className="min-w-0 flex-1">
            <div className="font-bold">{banner.title}</div>
            <div className="text-ink-muted">{banner.body}</div>
          </div>
          <button onClick={() => { onLoad(banner.symbol); setBanner(null); }} className="rounded bg-brand/20 px-2 py-1 text-[10px] font-semibold text-brand-glow">Load {banner.symbol}</button>
          <button onClick={() => setBanner(null)} className="text-ink-faint hover:text-ink" title="Dismiss"><X size={12} /></button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 px-3 py-1 text-[10px]">
        {enabled ? (
          <button onClick={disable} className="flex items-center gap-1 rounded border border-bull/40 bg-bull/10 px-1.5 py-0.5 font-semibold text-bull" title="Siren is armed">
            <BellRing size={10} /> Siren armed
          </button>
        ) : (
          <button onClick={enable} className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 font-semibold text-ink-muted hover:text-ink" title="Enable sound + browser notifications">
            <BellOff size={10} /> Enable siren
          </button>
        )}
        <span className={`flex items-center gap-1 ${emailOn ? "text-bull" : "text-ink-faint"}`} title={emailOn ? "Email alerts on" : "Add BREVO_API_KEY and ALERT_EMAIL_TO to enable email"}>
          <Mail size={10} /> {emailOn ? "email on" : "email off"}
        </span>
        <span className="text-ink-faint">
          Sweep: {lastRun ? `last ${new Date(lastRun).toLocaleTimeString()}` : "not run yet"} · megacaps + your list ({watch.length})
        </span>
        <button onClick={() => setShowList((v) => !v)} className="text-ink-faint hover:text-ink">{showList ? "hide list" : "edit list"}</button>
        {events[0] && (
          <span className="ml-auto truncate text-ink-muted" title={events[0].body}>
            Latest: <span className="text-ink">{events[0].title}</span> · {new Date(events[0].createdAt).toLocaleTimeString()}
          </span>
        )}
      </div>
      {showList && (
        <div className="flex flex-wrap items-center gap-1 border-t border-border/60 px-3 py-1">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const syms = addText.toUpperCase().split(/[\s,]+/).filter((x) => /^[A-Z.]{1,6}$/.test(x));
              if (!syms.length) return;
              setAddText("");
              await fetch("/api/alerts/watch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbols: syms }) });
              void loadWatch();
            }}
            className="flex items-center gap-1"
          >
            <input value={addText} onChange={(e) => setAddText(e.target.value)} placeholder="Add symbols to siren list" className="w-44 rounded border border-border bg-bg-elevated px-1.5 py-0.5 font-mono text-[10px] uppercase" />
            <button type="submit" className="rounded border border-border px-1.5 py-0.5 text-[10px] text-ink-muted hover:text-ink">Add</button>
          </form>
          {watch.map((s) => (
            <span key={s} className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
              {s}
              <button onClick={async () => { await fetch(`/api/alerts/watch?symbol=${s}`, { method: "DELETE" }); void loadWatch(); }} className="text-ink-faint hover:text-bear" title="Remove">×</button>
            </span>
          ))}
          <span className="text-[9px] text-ink-faint">Megacaps + ETFs are always watched.</span>
        </div>
      )}
    </div>
  );
}
