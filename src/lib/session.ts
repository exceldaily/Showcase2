// ─────────────────────────────────────────────────────────
// US equity market session awareness (spec §31).
// Handles premarket / regular / after-hours / closed, NYSE holidays,
// half-days, and DST via America/New_York conversion. Never assumes
// 9:30-16:00 blindly.
// ─────────────────────────────────────────────────────────

export type MarketSession = "premarket" | "regular" | "afterhours" | "closed";

export interface SessionState {
  session: MarketSession;
  label: string;
  /** ET wall-clock, e.g. "09:42:18" */
  etTime: string;
  etDate: string;
  isHoliday: boolean;
  isHalfDay: boolean;
  /** Minutes until the next session boundary (open/close). */
  minutesToNextBoundary: number | null;
  nextBoundaryLabel: string;
}

// NYSE full-day holidays (observed). Extend annually.
const HOLIDAYS = new Set<string>([
  // 2026
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
  "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  // 2027
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31",
  "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);

// Early closes at 13:00 ET.
const HALF_DAYS = new Set<string>([
  "2026-11-27", "2026-12-24",
  "2027-11-26",
]);

/** Extract ET wall-clock parts for an instant. */
export function etParts(now: Date = new Date()): { date: string; h: number; m: number; s: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false, weekday: "short",
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    h: Number(parts.hour) % 24,
    m: Number(parts.minute),
    s: Number(parts.second),
    weekday: weekdayMap[parts.weekday as string] ?? 0,
  };
}

export function isTradingDay(dateStr: string, weekday: number): boolean {
  if (weekday === 0 || weekday === 6) return false;
  return !HOLIDAYS.has(dateStr);
}

export function getSessionState(now: Date = new Date()): SessionState {
  const { date, h, m, s, weekday } = etParts(now);
  const mins = h * 60 + m;
  const isHoliday = HOLIDAYS.has(date);
  const isHalfDay = HALF_DAYS.has(date);
  const tradingDay = isTradingDay(date, weekday);

  const PRE_OPEN = 4 * 60;        // 04:00 ET
  const REG_OPEN = 9 * 60 + 30;   // 09:30 ET
  const REG_CLOSE = isHalfDay ? 13 * 60 : 16 * 60;
  const AH_CLOSE = isHalfDay ? 17 * 60 : 20 * 60;

  const etTime = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  const base = { etTime, etDate: date, isHoliday, isHalfDay };

  if (!tradingDay) {
    return {
      ...base,
      session: "closed",
      label: isHoliday ? "Closed — market holiday" : "Closed — weekend",
      minutesToNextBoundary: null,
      nextBoundaryLabel: "Next session",
    };
  }

  if (mins < PRE_OPEN) {
    return { ...base, session: "closed", label: "Closed", minutesToNextBoundary: PRE_OPEN - mins, nextBoundaryLabel: "Premarket opens" };
  }
  if (mins < REG_OPEN) {
    return { ...base, session: "premarket", label: "Premarket", minutesToNextBoundary: REG_OPEN - mins, nextBoundaryLabel: "Opening bell" };
  }
  if (mins < REG_CLOSE) {
    return {
      ...base,
      session: "regular",
      label: isHalfDay ? "Open — half day" : "Open",
      minutesToNextBoundary: REG_CLOSE - mins,
      nextBoundaryLabel: "Closing bell",
    };
  }
  if (mins < AH_CLOSE) {
    return { ...base, session: "afterhours", label: "After hours", minutesToNextBoundary: AH_CLOSE - mins, nextBoundaryLabel: "After hours ends" };
  }
  return { ...base, session: "closed", label: "Closed", minutesToNextBoundary: null, nextBoundaryLabel: "Premarket opens" };
}

/** Trading-session progress 0-1, for time-of-day adjusted RVOL (spec §7). */
export function regularSessionProgress(now: Date = new Date()): number | null {
  const st = getSessionState(now);
  if (st.session !== "regular") return null;
  const { h, m } = etParts(now);
  const mins = h * 60 + m;
  const open = 9 * 60 + 30;
  const close = st.isHalfDay ? 13 * 60 : 16 * 60;
  return Math.max(0, Math.min(1, (mins - open) / (close - open)));
}
