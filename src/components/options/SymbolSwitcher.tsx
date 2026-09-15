"use client";

// Quick switch strip: recent symbols, the day's picks, and the personal
// list as one-tap chips. Keyboard: [ and ] cycle recents. The active
// symbol is highlighted; a chip's × drops it from recents.

import { useEffect, useState } from "react";
import Link from "next/link";
import { Clock, LayoutGrid, Star, Sunrise, X } from "lucide-react";

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
  /** Today's morning-watch symbols (may be empty before the strip loads). */
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
      <span key={sym} className="group inline-flex shrink-0 items-stretch overflow-hidden rounded-md border border-border bg-bg-elevated/70">
        <button
          onClick={() => onPick(sym)}
          className={`px-2.5 py-1 font-mono text-xs font-semibold transition-colors ${active ? "bg-brand text-white" : "text-ink-muted hover:bg-bg-hover hover:text-ink"}`}
          title={active ? "Loaded" : `Load ${sym}`}
        >
          {sym}
        </button>
        {opts.removable && !active && (
          <button onClick={() => forget(sym)} className="hidden items-center border-l border-border px-1 text-ink-faint hover:text-bear group-hover:inline-flex" title="Remove from recents">
            <X size={10} />
          </button>
        )}
      </span>
    );
  };

  const group = (icon: React.ReactNode, label: string, syms: string[], removable = false) =>
    syms.length === 0 ? null : (
      <div className="flex shrink-0 items-center gap-1.5">
        <span className="flex items-center gap-1 pr-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{icon}{label}</span>
        {syms.map((s) => chip(s, { removable }))}
      </div>
    );

  const picksClean = picks.filter((s) => /^[A-Z.]{1,6}$/.test(s));
  const watchClean = watch.filter((s) => !picksClean.includes(s));
  const recentClean = recents.filter((s) => !picksClean.includes(s) && !watchClean.includes(s));

  return (
    <div className="flex items-center gap-4 overflow-x-auto border-b border-border bg-bg-panel px-3 py-1.5 [scrollbar-width:thin]">
      {group(<Sunrise size={11} className="text-warn" />, "Today", picksClean)}
      {group(<Star size={11} className="text-brand-glow" />, "My list", watchClean)}
      {group(<Clock size={11} />, "Recent", recentClean, true)}
      <span className="ml-auto flex shrink-0 items-center gap-3">
        <span className="hidden text-[11px] text-ink-faint lg:inline">/ search · [ ] cycle recents</span>
        <Link href="/board" className="inline-flex items-center gap-1 rounded-md border border-brand/40 bg-brand/10 px-2 py-1 text-xs font-semibold text-brand-glow hover:bg-brand/20" title="Up to four (or more) charts side by side, movable widgets">
          <LayoutGrid size={12} /> Multi-chart board
        </Link>
      </span>
    </div>
  );
}
