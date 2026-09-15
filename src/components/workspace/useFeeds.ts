"use client";

// Polling feeds for the workspace, kept out of the components so the
// high-frequency quote state does not re-render the whole shell.
//   analysis  every 5s open / 30s closed
//   quote     every 2s (30s closed), one tiny snapshot
//   broker    every 10s
// All pause while the tab is hidden.

import { useCallback, useEffect, useRef, useState } from "react";
import type { OptionsAnalysis } from "@/lib/optionsTerminal";
import { sessionOf } from "@/lib/intraday";
import type { Broker, Quote } from "@/components/options/types";

export function useAnalysis(symbol: string, profile: string, replayAt: string) {
  const [analysis, setAnalysis] = useState<OptionsAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const marketOpenRef = useRef(false);

  const fetchAnalysis = useCallback(async () => {
    try {
      const at = replayAt ? `&at=${encodeURIComponent(new Date(replayAt).toISOString())}` : "";
      const r = await fetch(`/api/options/analyze?symbol=${symbol}&profile=${profile}${at}`, { cache: "no-store" });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `HTTP ${r.status}`);
      const a = (await r.json()) as OptionsAnalysis;
      marketOpenRef.current = a.marketOpen;
      setAnalysis(a);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "analysis failed");
    } finally {
      setLoading(false);
    }
  }, [symbol, profile, replayAt]);

  // History stats are computed in the background once per symbol per
  // day; when they land the next refresh picks them up.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/options/history?symbol=${symbol}`, { cache: "no-store" });
        const j = (await r.json().catch(() => null)) as { cached?: boolean } | null;
        if (!cancelled && r.ok && j && j.cached === false) void fetchAnalysis();
      } catch { /* optional */ }
    })();
    return () => { cancelled = true; };
  }, [symbol, fetchAnalysis]);

  useEffect(() => {
    setLoading(true);
    void fetchAnalysis();
    let id: ReturnType<typeof setInterval> | null = null;
    let last = 0;
    const arm = () => {
      if (id) clearInterval(id);
      const every = marketOpenRef.current ? 5_000 : 30_000;
      last = every;
      id = setInterval(() => {
        if (document.visibilityState !== "visible") return;
        void fetchAnalysis();
        const want = marketOpenRef.current ? 5_000 : 30_000;
        if (want !== last) arm();
      }, every);
    };
    arm();
    return () => { if (id) clearInterval(id); };
  }, [fetchAnalysis]);

  return { analysis, loading, error, refetch: fetchAnalysis };
}

export function useQuote(symbol: string): Quote | null {
  const [quote, setQuote] = useState<Quote | null>(null);
  useEffect(() => {
    let cancelled = false;
    const pull = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await fetch(`/api/options/quote?symbol=${symbol}`, { cache: "no-store" });
        if (!r.ok) return;
        const q = (await r.json()) as Quote;
        if (!cancelled && q.symbol === symbol) setQuote(q);
      } catch { /* transient */ }
    };
    setQuote(null);
    void pull();
    const id = setInterval(pull, sessionOf(Date.now()) === "closed" ? 30_000 : 2_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [symbol]);
  return quote;
}

export function useBroker() {
  const [broker, setBroker] = useState<Broker | null>(null);
  const fetchBroker = useCallback(async () => {
    try {
      const r = await fetch("/api/broker/summary", { cache: "no-store" });
      setBroker((await r.json()) as Broker);
    } catch { /* transient */ }
  }, []);
  useEffect(() => {
    void fetchBroker();
    const id = setInterval(() => { if (document.visibilityState === "visible") void fetchBroker(); }, 10_000);
    return () => clearInterval(id);
  }, [fetchBroker]);
  return { broker, refetch: fetchBroker };
}

export function useIsOwner(): boolean {
  const [isOwner, setIsOwner] = useState(false);
  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((d: { user?: { role?: string } }) => setIsOwner(d.user?.role === "owner")).catch(() => undefined);
  }, []);
  return isOwner;
}
