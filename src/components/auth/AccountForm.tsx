"use client";

// One form for the three account flows: sign in, join with an invite,
// and the one-time owner claim. Posts JSON, follows the redirect target.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, KeyRound, Lock, User } from "lucide-react";

type Mode = "login" | "join" | "claim";

interface Props {
  mode: Mode;
  token?: string;          // join
  invitedBy?: string;      // join
  next?: string;           // where to go after success
  notice?: string | null;  // e.g. "You were signed out."
  showClaimLink?: boolean; // login page, only while no owner exists
}

const COPY: Record<Mode, { title: string; subtitle: string; button: string; busy: string }> = {
  login: { title: "Sign in", subtitle: "Invite-only. Use the username and password you picked.", button: "Sign in", busy: "Checking..." },
  join: { title: "Create your account", subtitle: "Pick any username and password. No email confirmation needed.", button: "Create account", busy: "Creating..." },
  claim: { title: "Claim the owner account", subtitle: "One-time setup. Enter the site passcode, then pick your username and password.", button: "Claim owner", busy: "Setting up..." },
};

const ENDPOINT: Record<Mode, string> = { login: "/api/auth/login", join: "/api/auth/register", claim: "/api/auth/claim" };

export default function AccountForm({ mode, token, invitedBy, next, notice, showClaimLink }: Props) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const copy = COPY[mode];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(ENDPOINT[mode], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, token, passcode }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Try again.");
        setBusy(false);
        return;
      }
      const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/options";
      router.replace(target);
      router.refresh();
    } catch {
      setError("Network error. Try again.");
      setBusy(false);
    }
  }

  const input = "w-full rounded-lg border border-border bg-bg-elevated py-3 pl-9 pr-3 outline-none transition-colors focus:border-brand";

  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <div className="card w-full max-w-sm p-8 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-brand">
          <Activity size={22} className="text-white" />
        </span>
        <h1 className="mt-4 text-xl font-bold">
          Alpha<span className="text-brand-glow">Forge</span>
        </h1>
        <h2 className="mt-3 text-base font-semibold">{copy.title}</h2>
        <p className="mt-1 text-sm text-ink-muted">
          {mode === "join" && invitedBy ? `${invitedBy} invited you. ` : ""}
          {copy.subtitle}
        </p>
        {notice && <p className="mt-3 rounded-md bg-warn/10 px-3 py-2 text-xs text-warn">{notice}</p>}

        <form onSubmit={submit} className="mt-6 space-y-3 text-left">
          {mode === "claim" && (
            <div className="relative">
              <KeyRound size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
              <input
                type="password"
                inputMode="numeric"
                autoFocus
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                placeholder="Site passcode"
                className={`${input} font-mono tracking-widest`}
              />
            </div>
          )}
          <div className="relative">
            <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              type="text"
              autoFocus={mode !== "claim"}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              className={input}
            />
          </div>
          <div className="relative">
            <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className={input}
            />
          </div>
          {error && <p className="text-sm text-bear">{error}</p>}
          <button
            type="submit"
            disabled={busy || username.length === 0 || password.length === 0 || (mode === "claim" && passcode.length === 0)}
            className="w-full rounded-lg bg-brand py-3 font-semibold text-white transition-colors hover:bg-brand-glow disabled:opacity-50"
          >
            {busy ? copy.busy : copy.button}
          </button>
        </form>

        {mode === "login" && (
          <p className="mt-4 text-xs text-ink-faint">
            No account? You need an invite link from the owner.
            {showClaimLink && (
              <>
                {" "}
                <a href="/claim" className="text-brand-glow hover:underline">First time here? Set up the owner account.</a>
              </>
            )}
          </p>
        )}
        {mode !== "login" && (
          <p className="mt-4 text-xs text-ink-faint">
            Already have an account? <a href="/login" className="text-brand-glow hover:underline">Sign in</a>
          </p>
        )}
      </div>
    </div>
  );
}
