import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { daysBetween, expiryLabel, morningWatchEmail, plainHtml, sirenEmail } from "../emailTemplates";
import type { MorningWatch } from "../morningWatch";
import type { SirenAlert } from "../sirenRules";

const watch: MorningWatch = {
  day: "2026-09-08", computedAt: "2026-09-08T13:10:00Z", locked: true, lockedAt: "2026-09-08T13:10:00Z",
  session: "premarket", sessionToday: true, ranked: [],
  notes: ["Premarket prices are thin. Gaps can fill or reverse in the first minutes after 9:30."],
  picks: [
    {
      rank: 1, symbol: "NVDA", price: 234.5, gapPct: 1.8, volRatio: 0.066, todayVolume: 9e6, bias: "calls", score: 78, preScore: 74,
      opportunity: 71, trend: "Bullish", dailyTrend: "Bullish", state: "APPROACHING", trigger: 234.76, invalidation: 232.9, target: 237.4,
      history: { confirmed: 17, t1Hit: 4 },
      bestCall: { symbol: "NVDA260908C00235000", strike: 235, expiry: "2026-09-08", mid: 2.15, score: 76 },
      bestPut: { symbol: "NVDA260908P00232500", strike: 232.5, expiry: "2026-09-08", mid: 1.9, score: 61 },
      why: ["Up 1.80% premarket (last close $230.36).", "Heavy interest: 9.0M shares already, 7% of a full normal day before the open.", "Sitting 0.11% under yesterday's high $234.76. A push through that is the breakout to watch."],
    },
    {
      rank: 2, symbol: "TSLA", price: 340, gapPct: -2.86, volRatio: 0.044, todayVolume: 4e6, bias: "puts", score: 70, preScore: 81,
      opportunity: 52, trend: "Bearish", dailyTrend: "Neutral", state: "WATCHING", trigger: 339.5, invalidation: 342.2, target: 334.1,
      history: null,
      bestCall: { symbol: "TSLA260911C00345000", strike: 345, expiry: "2026-09-11", mid: 6.1, score: 58 },
      bestPut: { symbol: "TSLA260911P00335000", strike: 335, expiry: "2026-09-11", mid: 5.4, score: 72 },
      why: ["Down 2.86% premarket (last close $350.00).", "Already below yesterday's low $341.00. Watch whether it stays under it after the open."],
    },
  ],
};

const alert: SirenAlert = {
  kind: "BREAK_CONFIRMED", direction: "long", urgency: "high", symbol: "NVDA",
  title: "NVDA BREAKOUT confirmed (82/100)",
  body: "NVDA at $235.10: 5-minute close through the level with volume. RVOL 2.10x, trend Strongly Bullish, setup score 74.",
  contract: "NVDA260908C00235000", opportunity: 74,
  orderCard: { contract: "NVDA260908C00235000", label: "NVDA 235C exp 09-08", qty: 1, limit: 2.2, stopTrigger: 1.1, stopLimit: 1.0, target: 3.6, underlyingInvalidation: 232.9, underlyingTarget: 237.4, note: "Stop = est. option value if NVDA reaches $232.90; target = est. value at $237.40. Model estimates, IV can shift them." },
  dedupeKey: "NVDA:BREAK_CONFIRMED:2026-09-08",
  summary: "NVDA just closed a 5-minute candle above the key level on 2.1x normal volume. Calls are on the table.",
  facts: { price: 235.1, rvol: 2.1, trend: "Strongly Bullish", state: "CONFIRMED", opportunity: 74, plan: { trigger: 234.76, t1: 237.4, invalidation: 232.9 }, best: { label: "NVDA 235C", expiry: "2026-09-08", dte: 0, mid: 2.15, score: 76 } },
};

describe("expiry labels", () => {
  it("counts days and says TODAY for 0DTE", () => {
    expect(daysBetween("2026-09-08", "2026-09-08")).toBe(0);
    expect(daysBetween("2026-09-08", "2026-09-11")).toBe(3);
    expect(expiryLabel("2026-09-08", 0)).toBe("expires TODAY (0DTE)");
    expect(expiryLabel("2026-09-09", 1)).toMatch(/tomorrow/);
    expect(expiryLabel("2026-09-11", 3)).toBe("expires 09-11 (3 days)");
  });
});

describe("morning watch email", () => {
  it("renders both picks, leads with the call, flags 0DTE, and escapes HTML", () => {
    const m = morningWatchEmail(watch, "locked premarket at 09:10 ET");
    expect(m.subject).toBe("Morning watch 2026-09-08: NVDA (calls), TSLA (puts)");
    expect(m.html).toMatch(/^[\x00-\x7f]*$/); // pure ASCII, so no client can garble it
    expect(m.html).toContain("NVDA");
    expect(m.html).toContain("LEAN CALLS");
    expect(m.html).toContain("LEAN PUTS");
    expect(m.html).toContain("expires TODAY (0DTE)");
    expect(m.html).toContain("no same-day expiry for this name today"); // TSLA best call is Friday
    expect(m.html.indexOf("Best call")).toBeLessThan(m.html.indexOf("Best put"));
    expect(m.html).toContain("/options?s=NVDA");
    expect(m.html).not.toContain("<script");
    expect(m.text).toContain("#1 NVDA");
    expect(m.text).toContain("Best call: NVDA 235C expires TODAY (0DTE)");
  });
});

describe("siren email", () => {
  it("renders the order card, the plan, the contract, and the prefilled ticket link", () => {
    const m = sirenEmail(alert);
    expect(m.subject).toBe("SIREN: NVDA BREAKOUT confirmed (82/100)");
    expect(m.html).toMatch(/^[\x00-\x7f]*$/);
    expect(m.html).toContain("ORDER CARD");
    expect(m.html).toContain("trigger $1.10");
    expect(m.html).toContain("Broke above");
    expect(m.html).toContain("$234.76");
    expect(m.html).toContain("expires TODAY (0DTE)");
    expect(m.html).toContain("ticket=NVDA260908C00235000");
    expect(m.text).toContain("Robinhood chain");
  });
  it("plain shell wraps text notices", () => {
    const h = plainHtml("Test", "line one\n\nline <two>");
    expect(h).toContain("line one");
    expect(h).toContain("&lt;two&gt;");
  });
});

// Visual preview for a human: EMAIL_PREVIEW_DIR=... npx vitest run emailTemplates
if (process.env.EMAIL_PREVIEW_DIR) {
  it("writes preview files", () => {
    mkdirSync(process.env.EMAIL_PREVIEW_DIR!, { recursive: true });
    writeFileSync(`${process.env.EMAIL_PREVIEW_DIR}/morning.html`, morningWatchEmail(watch, "locked premarket at 09:10 ET").html);
    writeFileSync(`${process.env.EMAIL_PREVIEW_DIR}/siren.html`, sirenEmail(alert).html);
    writeFileSync(`${process.env.EMAIL_PREVIEW_DIR}/plain.html`, plainHtml("testfriend used from two places", "testfriend just signed in from Miami, FL, US (Chrome on Windows, 3.3.3.3).\n\nThat account was ALSO active from Dallas, FL, US within the last 30 minutes."));
  });
}
