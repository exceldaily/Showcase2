import Link from "next/link";
import { Activity } from "lucide-react";
import { dataSourceStatus } from "@/lib/data";

const LINKS = [
  { href: "/options", label: "Options" },
  { href: "/scanners", label: "Scanners" },
  { href: "/market-regime", label: "Market" },
  { href: "/journal", label: "Journal" },
  { href: "/dashboard", label: "Swing" },
];

export default function Nav() {
  const status = dataSourceStatus();
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
