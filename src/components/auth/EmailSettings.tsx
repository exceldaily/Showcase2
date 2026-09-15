"use client";

// Owner: which emails go out. The on-page siren is unaffected.

import { useEffect, useState } from "react";
import { Mail } from "lucide-react";

interface EmailPrefs {
  morning: boolean;
  buySignals: boolean;
  security: boolean;
}

const ROWS: { key: keyof EmailPrefs; title: string; detail: string }[] = [
  { key: "morning", title: "Morning look-ahead (9:10 ET)", detail: "The day's top picks with the 3-step play. One email per trading day." },
  { key: "buySignals", title: "Buy signals during the day", detail: "Only real breakouts and held retests. Off by default; the on-page siren still fires either way." },
  { key: "security", title: "Account security", detail: "Only when a login is used from two places at the same time." },
];

export default function EmailSettings() {
  const [prefs, setPrefs] = useState<EmailPrefs | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then((d: { email: EmailPrefs }) => setPrefs(d.email)).catch(() => undefined);
  }, []);

  async function toggle(key: keyof EmailPrefs) {
    if (!prefs) return;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    setSaving(key);
    try {
      const r = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: { [key]: next[key] } }) });
      if (r.ok) setPrefs(((await r.json()) as { email: EmailPrefs }).email);
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="card p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-ink-muted"><Mail size={14} /> Emails</h2>
      <p className="mt-1 text-xs text-ink-faint">Turn off anything that feels like noise. These go to the alert address on the server.</p>
      <div className="mt-3 divide-y divide-border">
        {ROWS.map((row) => (
          <label key={row.key} className="flex cursor-pointer items-center justify-between gap-4 py-3">
            <span>
              <span className="block text-sm font-medium text-ink">{row.title}</span>
              <span className="block text-xs text-ink-muted">{row.detail}</span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={prefs?.[row.key] ?? false}
              disabled={!prefs || saving === row.key}
              onClick={() => toggle(row.key)}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${prefs?.[row.key] ? "bg-bull" : "bg-border-light"} disabled:opacity-50`}
            >
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${prefs?.[row.key] ? "left-[22px]" : "left-0.5"}`} />
            </button>
          </label>
        ))}
      </div>
    </section>
  );
}
