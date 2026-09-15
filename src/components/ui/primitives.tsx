"use client";

// Shared UI primitives for the command center. Small, consistent,
// tone-driven. Business logic never lives here.

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { TONE_CHIP, TONE_DOT, TONE_TEXT, type Tone } from "@/lib/ui/tone";

export function Chip({ tone = "muted", children, className = "", title, dot = false }: { tone?: Tone; children: ReactNode; className?: string; title?: string; dot?: boolean }) {
  return (
    <span className={`pill ${TONE_CHIP[tone]} ${className}`} title={title}>
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[tone]}`} />}
      {children}
    </span>
  );
}

/** Big state word next to the ticker: solid tint, wide tracking. */
export function StateBadge({ tone, children, detail, size = "md", live = false }: { tone: Tone; children: ReactNode; detail?: string | null; size?: "md" | "lg"; live?: boolean }) {
  return (
    <span className="inline-flex flex-col items-start">
      <span className={`inline-flex items-center gap-1.5 rounded-md font-semibold uppercase tracking-[0.08em] ${TONE_CHIP[tone]} ${size === "lg" ? "px-2.5 py-1 text-md" : "px-2 py-0.5 text-sm"}`}>
        {live && <span className={`h-1.5 w-1.5 animate-pulse rounded-full ${TONE_DOT[tone]}`} />}
        {children}
      </span>
      {detail && <span className="mt-0.5 pl-0.5 text-2xs text-ink-faint">{detail}</span>}
    </span>
  );
}

/** Tabular number with an optional tone. */
export function Num({ children, tone = "ink", className = "", title }: { children: ReactNode; tone?: Tone; className?: string; title?: string }) {
  return <span className={`num ${TONE_TEXT[tone]} ${className}`} title={title}>{children}</span>;
}

/** Label above a value: the atom of every stat grid. */
export function Stat({ label, children, tone = "ink", hint, className = "", size = "md" }: { label: string; children: ReactNode; tone?: Tone; hint?: string; className?: string; size?: "sm" | "md" | "lg" }) {
  const sz = size === "lg" ? "text-lg" : size === "sm" ? "text-sm" : "text-md";
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="stat-label" data-tip={hint}>{label}</div>
      <div className={`num truncate font-medium ${sz} ${TONE_TEXT[tone]}`}>{children}</div>
    </div>
  );
}

/** Key / value row for dense lists. */
export function KV({ k, v, tone = "ink", hint }: { k: ReactNode; v: ReactNode; tone?: Tone; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[var(--row-py)] text-sm">
      <span className="text-ink-muted" data-tip={hint}>{k}</span>
      <span className={`num text-right ${TONE_TEXT[tone]}`}>{v}</span>
    </div>
  );
}

/** Panel with a quiet header. Collapsible when `collapsible`. */
export function Panel({
  title, right, children, collapsible = false, defaultOpen = true, className = "", bodyClassName = "", flush = false, id,
}: {
  title: ReactNode; right?: ReactNode; children: ReactNode; collapsible?: boolean; defaultOpen?: boolean; className?: string; bodyClassName?: string; flush?: boolean; id?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`${className}`} id={id}>
      <header className="flex h-8 items-center justify-between gap-2 px-3">
        {collapsible ? (
          <button onClick={() => setOpen((v) => !v)} className="panel-title -ml-1 rounded px-1 hover:text-ink">
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {title}
          </button>
        ) : (
          <span className="panel-title">{title}</span>
        )}
        {right && <span className="flex items-center gap-1.5 text-xs text-ink-faint">{right}</span>}
      </header>
      {open && <div className={`${flush ? "" : "px-3 pb-3"} ${bodyClassName}`}>{children}</div>}
    </section>
  );
}

/** Expandable detail block, used for "why" and "what still needs to happen". */
export function Disclosure({ title, children, defaultOpen = false, count, tone }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean; count?: number; tone?: Tone }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-md bg-bg-panel/60">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-[0.06em] text-ink-muted hover:text-ink">
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className={tone ? TONE_TEXT[tone] : ""}>{title}</span>
        {count !== undefined && <span className="ml-auto rounded bg-bg-elevated px-1.5 text-2xs text-ink-faint">{count}</span>}
      </button>
      {open && <div className="px-2 pb-2 text-sm">{children}</div>}
    </div>
  );
}

/** Segmented control. */
export function Seg<T extends string>({ value, options, onChange, size = "sm", className = "" }: { value: T; options: { key: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; size?: "sm" | "md"; className?: string }) {
  return (
    <div className={`seg ${className}`} role="tablist">
      {options.map((o) => (
        <button key={o.key} role="tab" data-on={o.key === value} onClick={() => onChange(o.key)} title={o.title} className={size === "md" ? "!px-2.5 !py-1 !text-sm" : ""}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

/** Skeleton block. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

export function SkeletonRows({ rows = 4, className = "" }: { rows?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className={`h-3 ${i % 3 === 0 ? "w-3/4" : i % 3 === 1 ? "w-full" : "w-1/2"}`} />
      ))}
    </div>
  );
}

/** Uniform state box for LOADING / NO DATA / ERROR / MARKET CLOSED. */
export function StateBox({ kind, headline, detail, action, className = "" }: { kind: "loading" | "empty" | "error" | "closed" | "delayed"; headline: string; detail?: string | null; action?: ReactNode; className?: string }) {
  const tone: Tone = kind === "error" ? "bear" : kind === "delayed" ? "warn" : kind === "closed" ? "muted" : "faint";
  return (
    <div className={`flex flex-col items-center justify-center gap-1.5 p-6 text-center ${className}`}>
      <div className={`text-sm font-semibold uppercase tracking-[0.08em] ${TONE_TEXT[tone]}`}>{headline}</div>
      {detail && (
        kind === "error" ? (
          <details className="max-w-md text-xs text-ink-faint">
            <summary className="cursor-pointer hover:text-ink">technical detail</summary>
            <div className="mt-1 break-words rounded bg-bg-panel p-2 text-left font-mono text-2xs">{detail}</div>
          </details>
        ) : (
          <div className="max-w-md text-xs text-ink-faint">{detail}</div>
        )
      )}
      {action}
    </div>
  );
}

/** Icon-only button with a tooltip. */
export function IconButton({ onClick, title, children, on = false, className = "", disabled }: { onClick?: () => void; title: string; children: ReactNode; on?: boolean; className?: string; disabled?: boolean }) {
  return (
    <button onClick={onClick} data-tip={title} aria-label={title} disabled={disabled} className={`btn-quiet h-6 min-w-6 px-1 ${on ? "bg-bg-hover text-ink" : ""} ${className}`}>
      {children}
    </button>
  );
}
