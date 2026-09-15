// Shared number and time formatting. One place, so every panel prints
// prices, percentages and Eastern-time clocks the same way.

export const fmt$ = (n: number | null | undefined, d = 2): string =>
  n === null || n === undefined || !Number.isFinite(n) ? "—" : `$${n.toFixed(d)}`;

export const fmtNum = (n: number | null | undefined, d = 2): string =>
  n === null || n === undefined || !Number.isFinite(n) ? "—" : n.toFixed(d);

export const pct = (n: number | null | undefined, d = 2): string =>
  n === null || n === undefined || !Number.isFinite(n) ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(d)}%`;

export const fmtInt = (n: number | null | undefined): string =>
  n === null || n === undefined || !Number.isFinite(n) ? "—" : Math.round(n).toLocaleString("en-US");

/** Signed dollars without cents: +$120 / -$45. */
export const fmtPnl = (n: number | null | undefined): string =>
  n === null || n === undefined || !Number.isFinite(n) ? "—" : `${n < 0 ? "-" : "+"}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;

/** Compact volume: 1.2M, 850K. */
export const fmtVol = (n: number | null | undefined): string => {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(Math.round(n));
};

/** "9:42 AM" in Eastern time. */
export const etClock = (ms: number | string, seconds = false): string =>
  new Date(ms).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}) });

export const etTime = (ms: number | string): string => `${etClock(ms)} ET`;

/** "Tue, Sep 15" from a YYYY-MM-DD day string. */
export const dayLabel = (day: string): string => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};

/** Contract label like "212.5C" or "NVDA 212.5P". */
export const contractLabel = (strike: number, side: "call" | "put", symbol?: string): string =>
  `${symbol ? `${symbol} ` : ""}${strike}${side === "call" ? "C" : "P"}`;

/** "exp 09-18" or "TODAY" for same-day expiries. */
export const expiryLabel = (expiry: string, dte: number): string => (dte <= 0 ? "TODAY" : `exp ${expiry.slice(5)}`);
