import Link from "next/link";
import { Activity, LogOut, UserPlus } from "lucide-react";
import { dataSourceStatus } from "@/lib/data";
import type { CurrentUser } from "@/lib/auth/users";
import { authEnabled } from "@/lib/auth/session";

const LINKS = [
  { href: "/options", label: "Options" },
  { href: "/board", label: "Board" },
  { href: "/scanners", label: "Scanners" },
  { href: "/market-regime", label: "Market" },
  { href: "/journal", label: "Journal" },
  { href: "/dashboard", label: "Swing" },
];

export default function Nav({ user, install }: { user: CurrentUser | null; install?: React.ReactNode }) {
  const status = dataSourceStatus();
  const signedIn = user !== null || !authEnabled();
  return (
    <header className="sticky top-0 z-50 bg-bg-panel/95 backdrop-blur">
      <div className="flex h-11 w-full items-center justify-between gap-3 px-3">
        <div className="flex min-w-0 items-center gap-5">
          <Link href="/" className="flex shrink-0 items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand">
              <Activity size={14} className="text-white" />
            </span>
            <span className="text-md font-semibold tracking-tight">
              Alpha<span className="text-brand-glow">Forge</span>
            </span>
          </Link>
          {signedIn && (
            <nav className="hidden items-center gap-0.5 md:flex">
              {LINKS.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="rounded-md px-2.5 py-1 text-sm font-medium text-ink-muted transition-colors hover:bg-bg-hover hover:text-ink"
                >
                  {l.label}
                </Link>
              ))}
              {user?.role === "owner" && (
                <Link
                  href="/invites"
                  className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium text-ink-muted transition-colors hover:bg-bg-hover hover:text-ink"
                >
                  <UserPlus size={13} /> Invites
                </Link>
              )}
            </nav>
          )}
        </div>
        <div className="flex items-center gap-2">
          {signedIn && install}
          <span className={`pill whitespace-nowrap ${status.live ? "bg-bull/10 text-bull" : "bg-warn/10 text-warn"}`} title={status.label}>
            <span className={`h-1.5 w-1.5 rounded-full ${status.live ? "bg-bull" : "bg-warn"}`} />
            {status.live ? "Live" : status.label}
          </span>
          {user && (
            <div className="flex items-center gap-2 text-xs">
              <span className="hidden font-mono text-ink-muted lg:inline" title={user.role === "owner" ? "Owner" : "Member"}>
                {user.username}
                {user.role === "owner" && <span className="ml-1 rounded bg-brand/15 px-1 py-px text-2xs font-semibold text-brand-glow">OWNER</span>}
              </span>
              <a href="/api/auth/logout" className="btn-quiet btn-sm" title="Sign out">
                <LogOut size={13} /> <span className="hidden sm:inline">Sign out</span>
              </a>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
