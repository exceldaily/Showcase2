"use client";

// Siren: compact chip that lives in the command bar, a fixed overlay
// card when an alert fires (sound + flashing + browser notification),
// and a small popover to manage the extra symbols the sweep watches.
// - Server events (the every-minute sweep) are polled every 15s.
// - The OPEN symbol is also evaluated locally on every refresh.
// Browsers require a click before audio/notifications: "Enable siren".

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
          break;
        }
      } catch { /* transient */ }
    };
    void poll();
    const id = setInterval(() => { if (document.visibilityState === "visible") void poll(); }, 15_000);
    return () => { stop = true; clearInterval(id); };
  }, [enabled, fire]);

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
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audio.current = audio.current ?? new Ctx();
      await audio.current.resume();
      if (typeof Notification !== "undefined" && Notification.permission === "default") await Notification.requestPermission();
      setEnabled(true);
      localStorage.setItem("af_siren", "1");
      playSiren(audio.current, "medium");
    } catch { setEnabled(true); }
  };
  const disable = () => { setEnabled(false); try { localStorage.setItem("af_siren", "0"); } catch { /* ignore */ } };

  const statusTitle = `${emailOn ? "Email on" : "Email off"} · sweep ${lastRun ? "last " + new Date(lastRun).toLocaleTimeString() : "not run yet"} · watching megacaps + ${watch.length} of yours${events[0] ? ` · latest: ${events[0].title}` : ""}`;

  return (
    <>
      {/* Command-bar chip */}
      <span className="relative flex items-center gap-1">
        {enabled ? (
          <button onClick={disable} className="flex items-center gap-1 rounded border border-bull/40 bg-bull/10 px-1.5 py-0.5 text-[10px] font-semibold text-bull" title={`Siren armed. ${statusTitle}`}>
            <BellRing size={10} /> Siren
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-bull opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-bull" />
            </span>
          </button>
        ) : (
          <button onClick={enable} className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] font-semibold text-ink-muted hover:text-ink" title={`Enable sound + browser notifications. ${statusTitle}`}>
            <BellOff size={10} /> Enable siren
          </button>
        )}
        <Mail size={10} className={emailOn ? "text-bull" : "text-ink-faint"} aria-label={emailOn ? "email alerts on" : "email alerts off"} />
        <button onClick={() => setShowList((v) => !v)} className="text-[10px] text-ink-faint hover:text-ink" title="Siren watchlist">list</button>
        {showList && (
          <div className="absolute right-0 top-6 z-40 w-72 rounded border border-border bg-bg-card p-2 shadow-lg">
            <div className="mb-1 text-[9px] font-semibold uppercase text-ink-faint">Siren watchlist (megacaps always included)</div>
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
              <input value={addText} onChange={(e) => setAddText(e.target.value)} placeholder="Add: MU, AMD" className="w-full rounded border border-border bg-bg-elevated px-1.5 py-0.5 font-mono text-[10px] uppercase" />
              <button type="submit" className="rounded border border-border px-1.5 py-0.5 text-[10px] text-ink-muted hover:text-ink">Add</button>
            </form>
            <div className="mt-1 flex flex-wrap gap-1">
              {watch.map((s) => (
                <span key={s} className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
                  {s}
                  <button onClick={async () => { await fetch(`/api/alerts/watch?symbol=${s}`, { method: "DELETE" }); void loadWatch(); }} className="text-ink-faint hover:text-bear" title="Remove">×</button>
                </span>
              ))}
              {watch.length === 0 && <span className="text-[10px] text-ink-faint">none yet</span>}
            </div>
            <div className="mt-1 text-[9px] text-ink-faint">{statusTitle}</div>
          </div>
        )}
      </span>

      {/* Fixed overlay when an alert fires */}
      {banner && (
        <div className={`fixed right-3 top-16 z-50 w-[420px] max-w-[calc(100vw-1.5rem)] rounded border p-3 text-[11px] shadow-2xl ${banner.urgency === "high" ? "animate-pulse border-bull/60 bg-bg-card text-ink" : "border-warn/60 bg-bg-card text-ink"}`}>
          <div className="flex items-start gap-2">
            <Volume2 size={16} className={banner.urgency === "high" ? "mt-0.5 shrink-0 text-bull" : "mt-0.5 shrink-0 text-warn"} />
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-bold">{banner.title}</div>
              <div className="mt-0.5 leading-snug text-ink-muted">{banner.body}</div>
            </div>
            <button onClick={() => setBanner(null)} className="text-ink-faint hover:text-ink" title="Dismiss"><X size={12} /></button>
          </div>
          <div className="mt-2 flex gap-1">
            <button onClick={() => { onLoad(banner.symbol); setBanner(null); }} className="rounded bg-brand/20 px-2 py-1 text-[10px] font-semibold text-brand-glow">Load {banner.symbol}</button>
            <a href={`https://robinhood.com/options/chains/${banner.symbol}`} target="_blank" rel="noreferrer" className="rounded border border-border px-2 py-1 text-[10px] font-semibold text-ink-muted hover:text-ink" title="Open this chain in Robinhood (you place the order there)">
              Robinhood ↗
            </a>
          </div>
        </div>
      )}
    </>
  );
}
