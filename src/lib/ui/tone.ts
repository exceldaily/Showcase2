// The one tone map. Every panel colors meaning through these helpers so
// bull / bear / warn / brand / muted mean the same thing everywhere.

export type Tone = "bull" | "bear" | "warn" | "brand" | "muted" | "faint" | "ink" | "mine";

export const TONE_TEXT: Record<Tone, string> = {
  bull: "text-bull",
  bear: "text-bear",
  warn: "text-warn",
  brand: "text-brand-glow",
  muted: "text-ink-muted",
  faint: "text-ink-faint",
  ink: "text-ink",
  mine: "text-mine",
};

/** Tinted chip: soft background + colored text, no border. */
export const TONE_CHIP: Record<Tone, string> = {
  bull: "bg-bull/12 text-bull",
  bear: "bg-bear/12 text-bear",
  warn: "bg-warn/12 text-warn",
  brand: "bg-brand/15 text-brand-glow",
  muted: "bg-bg-elevated text-ink-muted",
  faint: "bg-bg-elevated text-ink-faint",
  ink: "bg-bg-elevated text-ink",
  mine: "bg-mine/15 text-mine",
};

export const TONE_DOT: Record<Tone, string> = {
  bull: "bg-bull",
  bear: "bg-bear",
  warn: "bg-warn",
  brand: "bg-brand",
  muted: "bg-ink-muted",
  faint: "bg-ink-faint",
  ink: "bg-ink",
  mine: "bg-mine",
};

/** Sign tone for a change / P&L number. */
export const signTone = (n: number | null | undefined): Tone => (n === null || n === undefined || !Number.isFinite(n) ? "muted" : n > 0 ? "bull" : n < 0 ? "bear" : "muted");

/** Tone for a trend label such as "Strongly Bullish", "Chop", "Neutral". */
export const trendTone = (label: string | null | undefined): Tone =>
  !label ? "faint" : /Bull/i.test(label) ? "bull" : /Bear/i.test(label) ? "bear" : /Chop/i.test(label) ? "warn" : "muted";

/** Tone for the setup machine's raw states. */
export const machineTone = (state: string | null | undefined): Tone => {
  switch (state) {
    case "APPROACHING":
    case "FORMING":
    case "RETESTING":
      return "warn";
    case "TRIGGERED":
    case "CONFIRMING":
      return "brand";
    case "CONFIRMED":
    case "CONTINUATION":
      return "bull";
    case "FAILED":
    case "INVALIDATED":
      return "bear";
    default:
      return "muted";
  }
};

/** Tone for a standard lifecycle state; falls back to the raw machine state. */
export const lifecycleTone = (lifecycle: string | null | undefined, machineState?: string | null): Tone => {
  switch (lifecycle) {
    case "NO SETUP": case "EXPIRED": return "faint";
    case "WATCHING": return "muted";
    case "APPROACHING": return "warn";
    case "TRIGGERED": case "CONFIRMING": return "brand";
    case "CONFIRMED": case "TARGET HIT": return "bull";
    case "IN TRADE": return "mine";
    case "INVALIDATED": return "bear";
    default: return machineTone(machineState);
  }
};

/** Tone for a room-to-move grade. */
export const roomTone = (grade: string | null | undefined): Tone => (grade === "POOR" ? "bear" : grade === "GOOD" || grade === "OPEN" ? "bull" : grade === "TIGHT" ? "warn" : "muted");

/** Tone for a 0-100 score: 70+ good, 45+ ok, else weak. */
export const scoreTone = (score: number | null | undefined): Tone => (score === null || score === undefined ? "faint" : score >= 70 ? "bull" : score >= 45 ? "warn" : "bear");
