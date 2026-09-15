// ─────────────────────────────────────────────────────────
// Decision layer (pure, unit-tested). Turns the engine's raw outputs
// into the vocabulary the trader sees:
//
//   BIAS      which way the evidence leans (never an instruction)
//   LIFECYCLE where the setup is in its life (NO SETUP ... EXPIRED)
//   ENTRY     what the entry needs right now (frequently WAIT)
//   VERDICT   TRADE / WAIT / NO TRADE / MANAGE
//
// A bearish chart does NOT mean "buy puts": bias and entry are
// separate outputs and only the entry line can say a trade is on.
// ─────────────────────────────────────────────────────────

import type { SetupState, SetupDirection, TradePlan, RoomResult, ConfirmationCheck } from "../setupMachine";

export type LifecycleState =
  | "NO SETUP" | "WATCHING" | "APPROACHING" | "TRIGGERED" | "CONFIRMING"
  | "CONFIRMED" | "IN TRADE" | "TARGET HIT" | "INVALIDATED" | "EXPIRED";

export const LIFECYCLE_STATES: LifecycleState[] = [
  "NO SETUP", "WATCHING", "APPROACHING", "TRIGGERED", "CONFIRMING",
  "CONFIRMED", "IN TRADE", "TARGET HIT", "INVALIDATED", "EXPIRED",
];

export type Bias = "BULLISH" | "BEARISH" | "NEUTRAL";
export type BiasStrength = "STRONG" | "MODERATE" | "WEAK" | "NONE";
export type Verdict = "TRADE" | "WAIT" | "NO TRADE" | "MANAGE";

export interface DecisionInput {
  machineState: SetupState | null;
  /** Confirmation checklist from the machine (empty before a trigger). */
  checks: ConfirmationCheck[];
  /** Highest (long) / lowest (short) price seen after the trigger. */
  extreme: number | null;
  plan: TradePlan | null;
  direction: SetupDirection;
  price: number | null;
  trendLabel: string | null;
  trendConfidence: number | null;
  choppy: boolean;
  dailyTrend: string | null;
  room: RoomResult | null;
  rvol: number | null;
  vwap: number | null;
  session: string;
  slot: string;
  marketOpen: boolean;
  /** The trader recorded a position in this symbol. */
  inTrade: boolean;
  /** Timeframe the plan was built on, for the setup name. */
  timeframe?: string;
}

export interface DecisionRead {
  lifecycle: LifecycleState;
  /** Short qualifier under the state, e.g. "retesting the level". */
  lifecycleDetail: string | null;
  bias: Bias;
  biasStrength: BiasStrength;
  /** Where the lean came from when the 5-minute read is choppy. */
  biasNote: string | null;
  /** Setup name: "5M BREAKOUT", "5M BREAKDOWN", "NO SETUP". */
  setup: string;
  /** Entry line: "NO ENTRY YET", "WAITING FOR 5M CLOSE ABOVE $211.61", "BREAKDOWN CONFIRMED". */
  entry: string;
  verdict: Verdict;
  /** One short reason for the verdict. */
  verdictReason: string;
  /** What still has to happen before an entry (empty once confirmed). */
  needs: string[];
  /** Confirmation criteria in plain terms (always listed, ticked when met). */
  confirmation: { text: string; met: boolean | null }[];
}

const POST_TRIGGER: SetupState[] = ["TRIGGERED", "CONFIRMING", "CONFIRMED", "RETESTING", "CONTINUATION"];
const CONFIRMED_FAMILY: SetupState[] = ["CONFIRMED", "RETESTING", "CONTINUATION"];
export const OPENING_SLOTS = ["premarket", "open-5", "open-15"];

const $ = (n: number) => `$${n.toFixed(2)}`;

export function readBias(trendLabel: string | null, choppy: boolean, dailyTrend: string | null): Pick<DecisionRead, "bias" | "biasStrength" | "biasNote"> {
  const of = (label: string | null): { bias: Bias; strength: BiasStrength } => {
    if (!label) return { bias: "NEUTRAL", strength: "NONE" };
    const bias: Bias = /Bull/i.test(label) ? "BULLISH" : /Bear/i.test(label) ? "BEARISH" : "NEUTRAL";
    if (bias === "NEUTRAL") return { bias, strength: "NONE" };
    const strength: BiasStrength = /Strong/i.test(label) ? "STRONG" : /Slight/i.test(label) ? "WEAK" : "MODERATE";
    return { bias, strength };
  };
  if (choppy) {
    const d = of(dailyTrend);
    return { bias: "NEUTRAL", biasStrength: "NONE", biasNote: d.bias === "NEUTRAL" ? "5m choppy, daily neutral" : `5m choppy, daily leans ${d.bias.toLowerCase()}` };
  }
  const t = of(trendLabel);
  return { bias: t.bias, biasStrength: t.strength, biasNote: null };
}

export function lifecycleOf(i: Pick<DecisionInput, "machineState" | "plan" | "extreme" | "direction" | "session" | "marketOpen" | "inTrade">): { lifecycle: LifecycleState; detail: string | null } {
  if (!i.plan) return { lifecycle: "NO SETUP", detail: null };
  const st = i.machineState ?? "WATCHING";
  const sessionOver = !i.marketOpen && (i.session === "afterhours" || i.session === "closed");
  if (st === "FAILED" || st === "INVALIDATED") return { lifecycle: "INVALIDATED", detail: st === "FAILED" ? "closed back through the level" : "closed past the wrong line" };
  if (POST_TRIGGER.includes(st) && sessionOver) return { lifecycle: "EXPIRED", detail: "session ended" };
  const t1 = i.plan.targets[0];
  const hitT1 = CONFIRMED_FAMILY.includes(st) && i.extreme !== null && t1 !== undefined && (i.direction === "long" ? i.extreme >= t1 : i.extreme <= t1);
  if (hitT1) return { lifecycle: "TARGET HIT", detail: i.inTrade ? "manage the exit" : "target 1 reached" };
  if (i.inTrade && CONFIRMED_FAMILY.includes(st)) return { lifecycle: "IN TRADE", detail: st === "RETESTING" ? "retesting the level" : st === "CONTINUATION" ? "retest held" : null };
  switch (st) {
    case "WATCHING": return { lifecycle: "WATCHING", detail: null };
    case "APPROACHING": return { lifecycle: "APPROACHING", detail: null };
    case "FORMING": return { lifecycle: "APPROACHING", detail: "pressing the level" };
    case "TRIGGERED": return { lifecycle: "TRIGGERED", detail: "not confirmed" };
    case "CONFIRMING": return { lifecycle: "CONFIRMING", detail: null };
    case "CONFIRMED": return { lifecycle: "CONFIRMED", detail: null };
    case "RETESTING": return { lifecycle: "CONFIRMED", detail: "retesting the level" };
    case "CONTINUATION": return { lifecycle: "CONFIRMED", detail: "retest held" };
    default: return { lifecycle: "WATCHING", detail: null };
  }
}

/** Standard confirmation criteria for a level break, ticked from the machine's checks when it has run. */
export function confirmationList(i: Pick<DecisionInput, "plan" | "direction" | "checks" | "rvol" | "vwap" | "price">): DecisionRead["confirmation"] {
  if (!i.plan) return [];
  const up = i.direction === "long";
  const find = (re: RegExp) => i.checks.find((c) => re.test(c.name));
  const close = find(/close/i);
  const vol = find(/volume|rvol/i);
  const vwap = find(/vwap/i);
  const body = find(/body/i);
  const out: DecisionRead["confirmation"] = [
    { text: `5-minute close ${up ? "above" : "below"} ${$(i.plan.trigger)}`, met: close ? close.pass : null },
    { text: `Relative volume 1.5x or more${i.rvol !== null ? ` (now ${i.rvol.toFixed(2)}x)` : ""}`, met: vol ? vol.pass : i.rvol === null ? null : i.rvol >= 1.5 },
  ];
  if (i.vwap !== null || vwap) {
    const side = i.price !== null && i.vwap !== null ? (up ? i.price > i.vwap : i.price < i.vwap) : null;
    out.push({ text: `Price ${up ? "above" : "below"} VWAP`, met: vwap ? vwap.pass : side });
  }
  out.push({ text: "Full-bodied candle, not a wick", met: body ? body.pass : null });
  return out;
}

export function readDecision(i: DecisionInput): DecisionRead {
  const b = readBias(i.trendLabel, i.choppy, i.dailyTrend);
  const { lifecycle, detail } = lifecycleOf(i);
  const up = i.direction === "long";
  const tf = (i.timeframe ?? "5m").toUpperCase();
  const setup = i.plan ? `${tf} ${up ? "BREAKOUT" : "BREAKDOWN"}` : "NO SETUP";
  const confirmation = confirmationList(i);
  const opening = OPENING_SLOTS.includes(i.slot);
  const needs: string[] = [];
  let entry = "NO ENTRY YET";
  let verdict: Verdict = "WAIT";
  let verdictReason = "";

  if (!i.plan) {
    entry = "NO TRADE";
    verdict = "NO TRADE";
    verdictReason = "no meaningful level in the trend direction";
    return { lifecycle, lifecycleDetail: detail, ...b, setup, entry, verdict, verdictReason, needs, confirmation };
  }
  const trig = $(i.plan.trigger);
  switch (lifecycle) {
    case "WATCHING":
      entry = "NO ENTRY YET";
      needs.push(`Price near ${trig}`, `5m close ${up ? "above" : "below"} ${trig}`, "Volume confirmation");
      verdictReason = "price is not at the level";
      break;
    case "APPROACHING":
      entry = `WAITING FOR 5M CLOSE ${up ? "ABOVE" : "BELOW"} ${trig}`;
      needs.push(`5m close ${up ? "above" : "below"} ${trig}`, "Volume confirmation");
      verdictReason = "do not buy the approach";
      break;
    case "TRIGGERED":
    case "CONFIRMING":
      entry = "WAITING FOR CONFIRMATION";
      for (const c of confirmation) if (c.met === false) needs.push(c.text);
      if (needs.length === 0) needs.push("Next 5m close to hold");
      verdictReason = "through the level, not confirmed";
      break;
    case "CONFIRMED":
      entry = `${up ? "BREAKOUT" : "BREAKDOWN"} CONFIRMED`;
      verdict = "TRADE";
      verdictReason = detail === "retesting the level" ? "retest in progress, better entry if it holds" : "confirmation criteria met";
      break;
    case "IN TRADE":
      entry = "POSITION OPEN";
      verdict = "MANAGE";
      verdictReason = `out on a 5m close ${up ? "below" : "above"} ${$(i.plan.invalidation)}`;
      break;
    case "TARGET HIT":
      entry = "TARGET 1 REACHED";
      verdict = i.inTrade ? "MANAGE" : "WAIT";
      verdictReason = i.inTrade ? "take profit or trail the stop" : "the move already happened, no chase";
      break;
    case "INVALIDATED":
      entry = "STAND DOWN";
      verdict = "NO TRADE";
      verdictReason = detail ?? "setup failed";
      break;
    case "EXPIRED":
      entry = "SESSION OVER";
      verdict = "NO TRADE";
      verdictReason = "same-day setup expired with the session";
      break;
    default:
      break;
  }
  // Rules that override a TRADE verdict. Not trading is a valid output.
  if (verdict === "TRADE") {
    if (opening) { verdict = "WAIT"; verdictReason = "before 9:45 ET, opening range only"; }
    else if (i.choppy) { verdict = "WAIT"; verdictReason = "5m read is choppy"; }
    else if (i.room && i.room.grade === "POOR") { verdict = "WAIT"; verdictReason = "no room, major level in the way"; }
    else if (!i.marketOpen) { verdict = "NO TRADE"; verdictReason = "market closed"; }
  }
  if (opening && (verdict === "WAIT") && !needs.includes("After 9:45 ET")) needs.unshift("After 9:45 ET");
  return { lifecycle, lifecycleDetail: detail, ...b, setup, entry, verdict, verdictReason, needs, confirmation };
}

/** RVOL as a word. */
export function volumeState(rvol: number | null): { label: "HEAVY" | "STRONG" | "NORMAL" | "LIGHT" | "UNKNOWN"; tone: "bull" | "warn" | "muted" | "bear" | "faint" } {
  if (rvol === null) return { label: "UNKNOWN", tone: "faint" };
  if (rvol >= 2) return { label: "HEAVY", tone: "bull" };
  if (rvol >= 1.3) return { label: "STRONG", tone: "bull" };
  if (rvol >= 0.8) return { label: "NORMAL", tone: "muted" };
  return { label: "LIGHT", tone: "bear" };
}

/** Price vs VWAP as a word. */
export function vwapState(price: number | null, vwap: number | null): { label: "ABOVE" | "BELOW" | "AT" | "N/A"; pct: number | null } {
  if (price === null || vwap === null || vwap <= 0) return { label: "N/A", pct: null };
  const d = ((price - vwap) / vwap) * 100;
  return { label: Math.abs(d) < 0.05 ? "AT" : d > 0 ? "ABOVE" : "BELOW", pct: Math.round(d * 100) / 100 };
}
