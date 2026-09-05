// ─────────────────────────────────────────────────────────
// Options math (pure, unit-tested).
// OCC symbols, quote arithmetic, Black-Scholes pricing + greeks, and
// the scenario engine that estimates what a contract could be worth
// if the underlying reaches a level.
//
// Honesty: BS assumes European exercise; for American equity calls
// without dividends it is a good approximation, for deep-ITM puts it
// understates slightly. Every scenario output is a RANGE (IV band +
// spread) and is labeled an estimate by the callers. Alpaca-supplied
// greeks are preferred; locally calculated ones are tagged as such.
// ─────────────────────────────────────────────────────────

export type OptionSide = "call" | "put";

export interface OccParts {
  underlying: string;
  expiry: string; // YYYY-MM-DD
  side: OptionSide;
  strike: number;
}

const OCC_RE = /^([A-Z]{1,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;

export function parseOcc(symbol: string): OccParts | null {
  const m = OCC_RE.exec(symbol.trim().toUpperCase());
  if (!m) return null;
  return {
    underlying: m[1],
    expiry: `20${m[2]}-${m[3]}-${m[4]}`,
    side: m[5] === "C" ? "call" : "put",
    strike: parseInt(m[6], 10) / 1000,
  };
}

export function buildOcc(p: OccParts): string {
  const [y, mo, d] = p.expiry.split("-");
  const strike = String(Math.round(p.strike * 1000)).padStart(8, "0");
  return `${p.underlying}${y.slice(2)}${mo}${d}${p.side === "call" ? "C" : "P"}${strike}`;
}

/** Expiration moment: 16:00 ET on expiry date (~20:00/21:00 UTC; use 20:30 as a DST-neutral compromise for T calcs). */
export function expiryMs(expiry: string): number {
  return Date.parse(`${expiry}T20:30:00Z`);
}

export function dte(expiry: string, now = Date.now()): number {
  return Math.max(0, (expiryMs(expiry) - now) / 86400e3);
}

export function yearsToExpiry(expiry: string, now = Date.now()): number {
  return Math.max(1e-6, (expiryMs(expiry) - now) / (365 * 86400e3));
}

// ── Quote arithmetic ──

export const mid = (bid: number, ask: number): number => (bid + ask) / 2;
export const spreadDollars = (bid: number, ask: number): number => Math.max(0, ask - bid);
export function spreadPct(bid: number, ask: number): number | null {
  const m = mid(bid, ask);
  return m > 0 ? (spreadDollars(bid, ask) / m) * 100 : null;
}

export function intrinsicValue(side: OptionSide, strike: number, underlying: number): number {
  return side === "call" ? Math.max(0, underlying - strike) : Math.max(0, strike - underlying);
}

export function extrinsicValue(side: OptionSide, strike: number, underlying: number, optionPrice: number): number {
  return Math.max(0, optionPrice - intrinsicValue(side, strike, underlying));
}

export function breakEvenAtExpiry(side: OptionSide, strike: number, premium: number): number {
  return side === "call" ? strike + premium : strike - premium;
}

export type Moneyness = "ITM" | "ATM" | "OTM";

/** ATM = strike within `atmBandPct` of spot (default 0.5%). */
export function moneyness(side: OptionSide, strike: number, underlying: number, atmBandPct = 0.5): Moneyness {
  if (underlying <= 0) return "OTM";
  if (Math.abs(strike - underlying) / underlying <= atmBandPct / 100) return "ATM";
  const itm = side === "call" ? underlying > strike : underlying < strike;
  return itm ? "ITM" : "OTM";
}

// ── Black-Scholes ──

function erf(x: number): number {
  // Abramowitz & Stegun 7.1.26, |error| < 1.5e-7
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return sign * y;
}

export const normCdf = (x: number): number => 0.5 * (1 + erf(x / Math.SQRT2));
const normPdf = (x: number): number => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

export interface BsResult {
  price: number;
  delta: number;
  gamma: number;
  /** Per calendar day. */
  theta: number;
  /** Per 1 point (100 bps) of IV. */
  vega: number;
}

/**
 * Black-Scholes with continuous rate r, zero dividend yield.
 * S spot, K strike, T years, sigma IV as decimal (0.42 = 42%).
 */
export function blackScholes(side: OptionSide, S: number, K: number, T: number, sigma: number, r = 0.045): BsResult {
  if (S <= 0 || K <= 0) return { price: 0, delta: 0, gamma: 0, theta: 0, vega: 0 };
  if (T <= 1e-6 || sigma <= 1e-6) {
    const iv0 = intrinsicValue(side, K, S);
    return { price: iv0, delta: side === "call" ? (S > K ? 1 : 0) : S < K ? -1 : 0, gamma: 0, theta: 0, vega: 0 };
  }
  const sq = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / sq;
  const d2 = d1 - sq;
  const df = Math.exp(-r * T);
  const price =
    side === "call" ? S * normCdf(d1) - K * df * normCdf(d2) : K * df * normCdf(-d2) - S * normCdf(-d1);
  const delta = side === "call" ? normCdf(d1) : normCdf(d1) - 1;
  const gamma = normPdf(d1) / (S * sq);
  const thetaYear =
    side === "call"
      ? (-S * normPdf(d1) * sigma) / (2 * Math.sqrt(T)) - r * K * df * normCdf(d2)
      : (-S * normPdf(d1) * sigma) / (2 * Math.sqrt(T)) + r * K * df * normCdf(-d2);
  const vega = (S * normPdf(d1) * Math.sqrt(T)) / 100;
  return { price: Math.max(price, intrinsicValue(side, K, S) * df), delta, gamma, theta: thetaYear / 365, vega };
}

/** Solve IV from a market price (bisection; null when the price is off-model). */
export function impliedVol(side: OptionSide, S: number, K: number, T: number, price: number, r = 0.045): number | null {
  if (price <= intrinsicValue(side, K, S) * Math.exp(-r * T) - 1e-9) return null;
  let lo = 0.005;
  let hi = 5;
  for (let i = 0; i < 60; i++) {
    const midV = (lo + hi) / 2;
    const p = blackScholes(side, S, K, T, midV, r).price;
    if (Math.abs(p - price) < 1e-4) return midV;
    if (p > price) hi = midV;
    else lo = midV;
  }
  const v = (lo + hi) / 2;
  return v > 0.006 && v < 4.99 ? v : null;
}

// ── Scenario engine ──

export interface ScenarioInput {
  side: OptionSide;
  strike: number;
  expiry: string; // YYYY-MM-DD
  /** Current implied vol as decimal. Required for a model estimate. */
  iv: number | null;
  /** Current mid, used to calibrate when IV is missing. */
  currentMid: number | null;
  underlyingNow: number;
  now?: number;
  r?: number;
}

export interface ScenarioPoint {
  label: string;
  underlying: number;
  /** Minutes from now the scenario assumes. */
  minutesAhead: number;
  low: number;
  high: number;
  midEstimate: number;
  perContractLow: number;
  perContractHigh: number;
  method: "bs-iv" | "bs-implied-from-mid" | "intrinsic-only";
}

/**
 * Estimate option value if the underlying reaches `target` after
 * `minutesAhead`. Returns a RANGE built from an IV band (±10% of the
 * level) — never penny precision. Falls back to IV implied from the
 * current mid, then to intrinsic-only (clearly tagged).
 */
export function scenarioPrice(
  input: ScenarioInput,
  target: number,
  minutesAhead: number,
  label = ""
): ScenarioPoint {
  const now = input.now ?? Date.now();
  const later = now + minutesAhead * 60e3;
  const T = yearsToExpiry(input.expiry, later);
  const r = input.r ?? 0.045;

  let iv = input.iv;
  let method: ScenarioPoint["method"] = "bs-iv";
  if (iv === null || iv <= 0) {
    const Tnow = yearsToExpiry(input.expiry, now);
    iv = input.currentMid !== null
      ? impliedVol(input.side, input.underlyingNow, input.strike, Tnow, input.currentMid, r)
      : null;
    method = iv !== null ? "bs-implied-from-mid" : "intrinsic-only";
  }

  if (iv === null) {
    const intr = intrinsicValue(input.side, input.strike, target);
    return {
      label, underlying: target, minutesAhead,
      low: intr, high: intr, midEstimate: intr,
      perContractLow: intr * 100, perContractHigh: intr * 100,
      method: "intrinsic-only",
    };
  }

  const lo = blackScholes(input.side, target, input.strike, T, iv * 0.9, r).price;
  const hi = blackScholes(input.side, target, input.strike, T, iv * 1.1, r).price;
  const midV = blackScholes(input.side, target, input.strike, T, iv, r).price;
  const [low, high] = lo <= hi ? [lo, hi] : [hi, lo];
  return {
    label, underlying: target, minutesAhead,
    low: round2(low), high: round2(high), midEstimate: round2(midV),
    perContractLow: round2(low * 100), perContractHigh: round2(high * 100),
    method,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ── Staleness ──

/** An option quote older than this during market hours is stale. */
export const OPTION_QUOTE_STALE_MS = 60_000;

export function isQuoteStale(quoteTs: number | null, now = Date.now(), marketOpen = true): boolean {
  if (quoteTs === null) return true;
  if (!marketOpen) return false; // closed markets are old by definition, not "stale"
  return now - quoteTs > OPTION_QUOTE_STALE_MS;
}
