import Link from "next/link";
import { Activity } from "lucide-react";
import { dataSourceStatus } from "@/lib/data";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/scanners", label: "Scanners" },
  { href: "/alerts", label: "Radar" },
  { href: "/scanner", label: "Setups" },
  { href: "/backtests", label: "Backtests" },
  { href: "/market-regime", label: "Market" },
  { href: "/paper-trading", label: "Paper" },
  { href: "/journal", label: "Journal" },
];

export default function Nav() {
  const status = dataSourceStatus();
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-bg/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand">
              <Activity size={18} className="text-white" />
            </span>
            <span className="text-lg font-bold tracking-tight">
              Alpha<span className="text-brand-glow">Forge</span>
            </span>
          </Link>
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
          </nav>
        </div>
        <div
          className={`pill ${
            status.live
              ? "bg-bull/15 text-bull"
              : "bg-warn/15 text-warn"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              status.live ? "bg-bull" : "bg-warn"
            } animate-pulse`}
          />
          {status.label}
        </div>
      </div>
    </header>
  );
}
