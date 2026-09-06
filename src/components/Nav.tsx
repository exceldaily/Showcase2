import Link from "next/link";
import { Activity, LogOut, UserPlus } from "lucide-react";
import { dataSourceStatus } from "@/lib/data";
import type { CurrentUser } from "@/lib/auth/users";
import { authEnabled } from "@/lib/auth/session";

const LINKS = [
  { href: "/options", label: "Options" },
  { href: "/scanners", label: "Scanners" },
  { href: "/market-regime", label: "Market" },
  { href: "/journal", label: "Journal" },
  { href: "/dashboard", label: "Swing" },
];

export default function Nav({ user }: { user: CurrentUser | null }) {
  const status = dataSourceStatus();
  const signedIn = user !== null || !authEnabled();
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-bg/80 backdrop-blur-md">
      <div className="flex h-16 w-full items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand">
              <Activity size={18} className="text-white" />
            </span>
            <span className="text-lg font-bold tracking-tight">
              Alpha<span className="text-brand-glow">Forge</span>
            </span>
          </Link>
          {signedIn && (
            <nav className="hidden items-center gap-1 md:flex">
              {LINKS.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="rounded-md px-3 py-2 text-sm font-medium text-ink-muted transition-colors hover:bg-bg-hover hover:text-ink"
                >
                  {l.label}
                </Link>
              ))}
              {user?.role === "owner" && (
                <Link
                  href="/invites"
                  className="flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-ink-muted transition-colors hover:bg-bg-hover hover:text-ink"
                >
                  <UserPlus size={14} /> Invites
                </Link>
              )}
            </nav>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className={`pill ${status.live ? "bg-bull/15 text-bull" : "bg-warn/15 text-warn"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${status.live ? "bg-bull" : "bg-warn"} animate-pulse`} />
            {status.label}
          </div>
          {user && (
            <div className="flex items-center gap-2 text-xs">
              <span className="hidden font-mono text-ink-muted sm:inline" title={user.role === "owner" ? "Owner" : "Member"}>
                {user.username}
                {user.role === "owner" && <span className="ml-1 rounded bg-brand/20 px-1 py-0.5 text-[10px] font-semibold text-brand-glow">OWNER</span>}
              </span>
              <a
                href="/api/auth/logout"
                className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-ink-muted transition-colors hover:bg-bg-hover hover:text-ink"
                title="Sign out"
              >
                <LogOut size={13} /> <span className="hidden sm:inline">Sign out</span>
              </a>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
