import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { daysBetween, expiryLabel, morningWatchEmail, plainHtml, sirenEmail } from "../emailTemplates";
import type { MorningWatch } from "../morningWatch";
import type { SirenAlert } from "../sirenRules";

import { SAMPLE_ALERT as alert, SAMPLE_WATCH as watch } from "../emailSamples";

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
