// ─────────────────────────────────────────────────────────
// Catalyst events (pure). Scheduled releases come from the FRED
// release calendar, which publishes DATES but not clock times, so the
// time on each event is the release's usual slot and is labelled
// "typical". Manual events (owner-entered) carry an exact time.
// Fed speakers and earnings have no legitimate feed here and are
// reported as NOT SUPPORTED rather than guessed.
// ─────────────────────────────────────────────────────────

export type Impact = "HIGH" | "MEDIUM" | "LOW";
export type EventSource = "fred" | "manual";

export interface CatalystEvent {
  id: string;
  /** ISO instant. */
  at: string;
  title: string;
  impact: Impact;
  source: EventSource;
  /** "market" or a ticker. */
  affects: string;
  /** True when the clock time is the release's usual slot, not a published time. */
  typicalTime: boolean;
}

interface ReleaseRule { match: RegExp; impact: Impact; time: string; title?: string }

/** Known FRED release names, their usual Eastern release time, and market impact. */
export const RELEASE_RULES: ReleaseRule[] = [
  { match: /Employment Situation/i, impact: "HIGH", time: "08:30", title: "Jobs report (Employment Situation)" },
  { match: /Consumer Price Index/i, impact: "HIGH", time: "08:30", title: "CPI (Consumer Price Index)" },
  { match: /Personal Income and Outlays/i, impact: "HIGH", time: "08:30", title: "PCE (Personal Income and Outlays)" },
  { match: /Gross Domestic Product/i, impact: "HIGH", time: "08:30", title: "GDP" },
  { match: /FOMC|Federal Open Market Committee/i, impact: "HIGH", time: "14:00", title: "FOMC statement" },
  { match: /Producer Price Index/i, impact: "MEDIUM", time: "08:30", title: "PPI (Producer Price Index)" },
  { match: /Retail and Food Services|Retail Sales/i, impact: "MEDIUM", time: "08:30", title: "Retail sales" },
  { match: /Job Openings|JOLTS/i, impact: "MEDIUM", time: "10:00", title: "JOLTS job openings" },
  { match: /Surveys? of Consumers|Consumer Sentiment/i, impact: "MEDIUM", time: "10:00", title: "Consumer sentiment (U. Michigan)" },
  { match: /Unemployment Insurance Weekly Claims/i, impact: "MEDIUM", time: "08:30", title: "Weekly jobless claims" },
  { match: /Industrial Production|G\.17/i, impact: "LOW", time: "09:15", title: "Industrial production" },
  { match: /Durable Goods|Manufacturers' Shipments/i, impact: "LOW", time: "08:30", title: "Durable goods" },
  { match: /Housing Starts|New Residential Construction/i, impact: "LOW", time: "08:30", title: "Housing starts" },
  { match: /Existing Home Sales|New Residential Sales/i, impact: "LOW", time: "10:00", title: "Home sales" },
  { match: /Import|Export Price/i, impact: "LOW", time: "08:30", title: "Import/export prices" },
  { match: /Trade in Goods|International Trade/i, impact: "LOW", time: "08:30", title: "Trade balance" },
  { match: /Consumer Credit|G\.19/i, impact: "LOW", time: "15:00", title: "Consumer credit" },
  { match: /Beige Book/i, impact: "MEDIUM", time: "14:00", title: "Beige Book" },
  { match: /Treasury/i, impact: "LOW", time: "13:00", title: "Treasury auction results" },
];

/** Releases FRED lists that never move intraday prices; skipped outright. */
const IGNORE = /Daily Treasury|H\.4\.1|H\.8|H\.15|Z\.1|Commercial Paper|Foreign Exchange Rates|Selected Interest Rates|Money Stock|Factors Affecting Reserve|State Employment|Regional|County|Metropolitan|Agricultural|Federal Reserve Bank of (?!.*Beige)|Weekly U\.S\.|Coincident|Leading Index for|Chicago Fed|Philadelphia Fed|Kansas City|Dallas Fed|Richmond|Atlanta Fed|Cleveland|St\. Louis|Minneapolis|San Francisco/i;

/** Eastern wall clock (YYYY-MM-DD + HH:MM) to an ISO instant, with DST from Intl. */
export function etToIso(date: string, hm: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = hm.split(":").map(Number);
  // First guess in UTC, then correct by the ET offset at that instant.
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const et = new Date(guess).toLocaleString("en-US", { timeZone: "America/New_York", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const mm = /(\d+)\/(\d+)\/(\d+), (\d+):(\d+)/.exec(et);
  if (!mm) return new Date(guess).toISOString();
  const asEt = Date.UTC(Number(mm[3]), Number(mm[1]) - 1, Number(mm[2]), Number(mm[4]) % 24, Number(mm[5]));
  return new Date(guess + (guess - asEt)).toISOString();
}

/** Turns a FRED release-date row into an event, or null when it is noise. */
export function fromFredRelease(releaseId: number, name: string, date: string): CatalystEvent | null {
  if (IGNORE.test(name)) return null;
  const rule = RELEASE_RULES.find((r) => r.match.test(name));
  if (!rule) return null;
  return { id: `fred:${releaseId}:${date}`, at: etToIso(date, rule.time), title: rule.title ?? name, impact: rule.impact, source: "fred", affects: "market", typicalTime: true };
}

export interface EventView extends CatalystEvent {
  minutesUntil: number;
  /** "12m", "2h 05m", "past". */
  countdown: string;
}

export function countdownLabel(minutes: number): string {
  if (minutes < 0) return minutes > -240 ? "past" : "";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

/** Sorted, de-duplicated, with countdowns; keeps the last 4 hours of past events for context. */
export function viewEvents(events: CatalystEvent[], nowMs: number, symbol?: string | null): EventView[] {
  const seen = new Set<string>();
  const out: EventView[] = [];
  for (const e of [...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    if (seen.has(e.id)) continue;
    if (e.affects !== "market" && symbol && e.affects !== symbol) continue;
    seen.add(e.id);
    const minutesUntil = (Date.parse(e.at) - nowMs) / 60e3;
    if (minutesUntil < -240) continue;
    out.push({ ...e, minutesUntil: Math.round(minutesUntil), countdown: countdownLabel(minutesUntil) });
  }
  return out;
}

/** Minutes until the next upcoming event at or above the given impact, null when none today. */
export function minutesToNextEvent(events: CatalystEvent[], nowMs: number, minImpact: Impact = "HIGH", symbol?: string | null): { minutes: number; event: CatalystEvent } | null {
  const rank: Record<Impact, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  const upcoming = viewEvents(events, nowMs, symbol).filter((e) => e.minutesUntil >= 0 && rank[e.impact] >= rank[minImpact]);
  if (!upcoming.length) return null;
  return { minutes: upcoming[0].minutesUntil, event: upcoming[0] };
}
