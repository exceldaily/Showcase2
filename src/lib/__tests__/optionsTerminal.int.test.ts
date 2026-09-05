// Live integration smoke test against real Alpaca data.
// Runs only when Alpaca keys exist in the environment (.env.local is
// loaded manually here because vitest does not read Next env files).
// Verifies the full pipeline produces a coherent analysis with REAL
// SIP + OPRA data and no fabricated values.

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const envFile = resolve(__dirname, "../../../.env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const hasKeys = Boolean(process.env.ALPACA_API_KEY_ID && process.env.ALPACA_API_SECRET_KEY);

describe.skipIf(!hasKeys)("options terminal live integration", () => {
  it("analyzes NVDA end to end on real data", { timeout: 60_000 }, async () => {
    const { buildOptionsAnalysis } = await import("../optionsTerminal");
    const a = await buildOptionsAnalysis("NVDA");

    expect(a.connected).toBe(true);
    expect(a.price).toBeGreaterThan(1);
    expect(a.bars.m1.length).toBeGreaterThan(100);
    expect(a.bars.m5.length).toBeGreaterThan(20);
    expect(a.zones.length).toBeGreaterThan(3);
    // Every zone must carry an explanation.
    for (const z of a.zones) {
      expect(z.strength).toBeGreaterThanOrEqual(0);
      expect(z.strength).toBeLessThanOrEqual(100);
      expect(z.reasons.length).toBeGreaterThan(0);
    }
    expect(a.trend).not.toBeNull();
    expect(a.plan).not.toBeNull();
    expect(a.machine).not.toBeNull();
    // Real OPRA contracts with two-sided quotes and scores.
    expect(a.contracts.length).toBeGreaterThan(10);
    const best = a.best!;
    expect(best.bid).toBeGreaterThan(0);
    expect(best.ask).toBeGreaterThanOrEqual(best.bid);
    expect(best.score).toBeGreaterThan(0);
    expect(best.why.length).toBeGreaterThan(0);
    // Scenario estimates exist and are ranges, not fake precision.
    expect(a.scenarios).not.toBeNull();
    for (const p of a.scenarios!.points) {
      expect(p.high).toBeGreaterThanOrEqual(p.low);
    }
    expect(a.opportunity).not.toBeNull();
    expect(a.opportunity!.parts.length).toBeGreaterThan(4);
  });

  it("replay cutoff never sees the future", { timeout: 60_000 }, async () => {
    const { buildOptionsAnalysis } = await import("../optionsTerminal");
    // Thursday Sept 4 2026, 10:30 ET (14:30 UTC) — a real past moment.
    const cutoff = Date.parse("2026-09-04T14:30:00Z");
    const a = await buildOptionsAnalysis("NVDA", { replayCutoffMs: cutoff });
    expect(a.replayCutoff).not.toBeNull();
    for (const b of a.bars.m1) expect(b.t).toBeLessThanOrEqual(cutoff);
    for (const b of a.bars.m5) expect(b.t).toBeLessThanOrEqual(cutoff);
  });
});
