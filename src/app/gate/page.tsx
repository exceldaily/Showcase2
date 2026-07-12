"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Activity, Lock } from "lucide-react";

function GateForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(false);
    const res = await fetch("/api/gate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passcode }),
    });
    if (res.ok) {
      router.replace(params.get("from") || "/dashboard");
      router.refresh();
    } else {
      setError(true);
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <div className="card w-full max-w-sm p-8 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-brand">
          <Activity size={22} className="text-white" />
        </span>
        <h1 className="mt-4 text-xl font-bold">
          Alpha<span className="text-brand-glow">Forge</span>
        </h1>
        <p className="mt-1 text-sm text-ink-muted">Private beta. Enter the passcode.</p>

        <form onSubmit={submit} className="mt-6 space-y-3">
          <div className="relative">
            <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              type="password"
              inputMode="numeric"
              autoFocus
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              placeholder="Passcode"
              className="w-full rounded-lg border border-border bg-bg-elevated py-3 pl-9 pr-3 text-center font-mono tracking-widest outline-none transition-colors focus:border-brand"
            />
          </div>
          {error && <p className="text-sm text-bear">Wrong passcode. Try again.</p>}
          <button
            type="submit"
            disabled={busy || passcode.length === 0}
            className="w-full rounded-lg bg-brand py-3 font-semibold text-white transition-colors hover:bg-brand-glow disabled:opacity-50"
          >
            {busy ? "Checking..." : "Enter"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function GatePage() {
  return (
    <Suspense>
      <GateForm />
    </Suspense>
  );
}
