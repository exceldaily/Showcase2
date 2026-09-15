"use client";

// Quick switch chips: today's picks, the personal list, and recent
// symbols. Keyboard: [ and ] cycle recents. A chip's x drops it from
// recents.

import { useEffect, useState } from "react";
import { X } from "lucide-react";

const RECENT_KEY = "af_recent";
const RECENT_MAX = 10;

export function loadRecents(): string[] {
  try {
    return (JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[]).filter((s) => /^[A-Z.]{1,6}$/.test(s));
  } catch {
    return [];
  }
}

export function pushRecent(symbol: string): string[] {
  const next = [symbol, ...loadRecents().filter((s) => s !== symbol)].slice(0, RECENT_MAX);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}

function loadWatch(): string[] {
  try {
    return (JSON.parse(localStorage.getItem("af_options_watch") ?? "[]") as string[]).slice(0, 12);
  } catch {
    return [];
  }
}

export default function SymbolSwitcher({
  symbol, picks, onPick, version,
}: {
  symbol: string;
  picks: string[];
  onPick: (sym: string) => void;
  /** Bump to re-read localStorage (after the parent pushes a recent). */
  version: number;
}) {
  const [recents, setRecents] = useState<string[]>([]);
  const [watch, setWatch] = useState<string[]>([]);

  useEffect(() => {
    setRecents(loadRecents());
    setWatch(loadWatch());
  }, [version]);

  function forget(sym: string) {
    const next = recents.filter((s) => s !== sym);
    setRecents(next);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }

  const chip = (sym: string, opts: { removable?: boolean } = {}) => {
    const active = sym === symbol;
    return (
      <span key={sym} className="group inline-flex shrink-0 items-stretch overflow-hidden rounded-md bg-bg-elevated">
        <button onClick={() => onPick(sym)} className={`px-2 py-0.5 font-mono text-xs font-semibold transition-colors ${active ? "bg-brand text-white" : "text-ink-muted hover:bg-bg-hover hover:text-ink"}`} title={active ? "Loaded" : `Load ${sym}`}>
          {sym}
        </button>
        {opts.removable && !active && (
          <button onClick={() => forget(sym)} className="hidden items-center px-1 text-ink-faint hover:text-bear group-hover:inline-flex" title="Remove from recents"><X size={10} /></button>
        )}
      </span>
    );
  };

  const group = (label: string, syms: string[], removable = false) =>
    syms.length === 0 ? null : (
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-0.5 text-2xs font-semibold uppercase tracking-[0.08em] text-ink-faint">{label}</span>
        {syms.map((s) => chip(s, { removable }))}
      </div>
    );

  const picksClean = picks.filter((s) => /^[A-Z.]{1,6}$/.test(s));
  const watchClean = watch.filter((s) => !picksClean.includes(s));
  const recentClean = recents.filter((s) => !picksClean.includes(s) && !watchClean.includes(s));
  if (picksClean.length + watchClean.length + recentClean.length === 0) return null;

  return (
    <div className="space-y-1 px-2 py-1.5">
      {group("Today", picksClean)}
      {group("Mine", watchClean)}
      {group("Recent", recentClean, true)}
    </div>
  );
}
