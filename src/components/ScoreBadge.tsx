import type { Decision } from "@/lib/types";

export function scoreColor(score: number): string {
  if (score >= 85) return "text-bull";
  if (score >= 80) return "text-brand-glow";
  if (score >= 65) return "text-warn";
  return "text-bear";
}

export function ScoreRing({ score, size = 64 }: { score: number; size?: number }) {
  const stroke = 6;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const color =
    score >= 85 ? "#16c784" : score >= 80 ? "#60a5fa" : score >= 65 ? "#f0b90b" : "#ea3943";
  return (
    <div className="relative inline-flex" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#1f2937" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <span
        className="absolute inset-0 flex items-center justify-center text-base font-bold"
        style={{ color }}
      >
        {score}
      </span>
    </div>
  );
}

const DECISION_STYLES: Record<Decision, string> = {
  "Buy Now": "bg-bull/15 text-bull border border-bull/30",
  "Wait For Pullback": "bg-warn/15 text-warn border border-warn/30",
  "Short Now": "bg-bear/15 text-bear border border-bear/30",
  "Wait For Bounce": "bg-warn/15 text-warn border border-warn/30",
  "Watchlist Only": "bg-brand/15 text-brand-glow border border-brand/30",
  Avoid: "bg-bg-hover text-ink-faint border border-border",
};

export function DirectionBadge({ direction }: { direction: "Long" | "Short" }) {
  return (
    <span
      className={`pill ${
        direction === "Short"
          ? "bg-bear/15 text-bear border border-bear/30"
          : "bg-bull/15 text-bull border border-bull/30"
      }`}
    >
      {direction === "Short" ? "SHORT" : "LONG"}
    </span>
  );
}

export function DecisionBadge({ decision }: { decision: Decision }) {
  return (
    <span className={`pill ${DECISION_STYLES[decision]}`}>{decision}</span>
  );
}

export function CatalystLevelBadge({ level }: { level: number }) {
  const map: Record<number, { label: string; cls: string }> = {
    4: { label: "L4 · Transformational", cls: "bg-bull/15 text-bull" },
    3: { label: "L3 · Major Catalyst", cls: "bg-brand/15 text-brand-glow" },
    2: { label: "L2 · Relevant", cls: "bg-warn/15 text-warn" },
    1: { label: "L1 · Noise", cls: "bg-bg-hover text-ink-faint" },
  };
  const m = map[level] ?? map[1];
  return <span className={`pill ${m.cls}`}>{m.label}</span>;
}
