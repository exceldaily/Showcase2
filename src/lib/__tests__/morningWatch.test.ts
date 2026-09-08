import { describe, expect, it } from "vitest";
import { rankPremarket, whyLines } from "../morningWatch";
import type { StockSnapshot } from "@/providers/alpaca";

// 2026-09-08 08:30 ET (12:30Z), a premarket moment.
const NOW = Date.parse("2026-09-08T12:30:00Z");
const bar = (t: string, o: number, h: number, l: number, c: number, v: number) => ({ t, o, h, l, c, v, vw: c });

function snap(price: number, prev: { h: number; l: number; c: number; v: number }, todayVol: number | null): StockSnapshot {
  return {
    latestTrade: { p: price, t: "2026-09-08T12:29:00Z" },
    prevDailyBar: todayVol !== null ? bar("2026-09-04T04:00:00Z", prev.c, prev.h, prev.l, prev.c, prev.v) : bar("2026-09-03T04:00:00Z", 1, 1, 1, 1, 1),
    dailyBar: todayVol !== null
      ? bar("2026-09-08T04:00:00Z", price, price, price, price, todayVol)
      : bar("2026-09-04T04:00:00Z", prev.c, prev.h, prev.l, prev.c, prev.v),
  };
}

describe("rankPremarket", () => {
  it("puts a gapping, heavily traded name testing yesterday's high on top", () => {
    const snaps: Record<string, StockSnapshot> = {
      NVDA: snap(234.5, { h: 234.76, l: 229.63, c: 230.36, v: 136e6 }, 9e6),   // +1.8%, 6.6% of a day, right at the high
      KO:   snap(70.1, { h: 70.4, l: 69.5, c: 70.0, v: 12e6 }, 50e3),           // flat, quiet
      TSLA: snap(340, { h: 352, l: 341, c: 350, v: 90e6 }, 4e6),                // -2.9% below yesterday's low
      PENNY: snap(3.2, { h: 3.4, l: 3.0, c: 3.1, v: 50e6 }, 5e6),               // filtered: price < 5
    };
    const r = rankPremarket(snaps, NOW);
    // TSLA: bigger gap, already through yesterday's low. NVDA: smaller gap, at the high. KO: nothing going on.
    expect(r.map((x) => x.symbol)).toEqual(["TSLA", "NVDA", "KO"]);
    expect(r[0].bias).toBe("puts");
    expect(r[0].parts.find((p) => p.name === "near yesterday's high/low")?.score).toBe(20);
    expect(r[1].bias).toBe("calls");
    expect(r[1].todayVolume).toBe(9e6);
    expect(r[1].parts.find((p) => p.name === "near yesterday's high/low")?.score).toBe(20);
    expect(r[2].bias).toBe("either");
    expect(r[2].score).toBeLessThan(25);
  });
  it("ignores overnight prints and uses the official close outside live sessions", () => {
    const s = snap(415, { h: 440, l: 435, c: 437.23, v: 3e6 }, null);
    const overnight = rankPremarket({ AMGN: s }, Date.parse("2026-09-08T06:30:00Z"), "closed")[0]; // 2:30 ET
    expect(overnight.price).toBe(437.23);
    expect(overnight.gapPct).toBe(0);
    const pre = rankPremarket({ AMGN: s }, NOW, "premarket")[0];
    expect(pre.price).toBe(415);
  });
  it("falls back to the last session when nothing has printed today", () => {
    const r = rankPremarket({ AAPL: snap(190, { h: 192, l: 188, c: 190, v: 60e6 }, null) }, NOW);
    expect(r).toHaveLength(1);
    expect(r[0].todayVolume).toBe(0);
    expect(r[0].gapPct).toBe(0);
    expect(r[0].prevClose).toBe(190);
  });
});

describe("whyLines", () => {
  it("explains gap, volume, and the level in plain words without promising anything", () => {
    const c = rankPremarket({ NVDA: snap(234.5, { h: 234.76, l: 229.63, c: 230.36, v: 136e6 }, 9e6) }, NOW)[0];
    const text = whyLines(c, "premarket", null).join(" ");
    expect(text).toMatch(/Up 1\.80% premarket/);
    expect(text).toMatch(/Heavy interest: 9\.0M shares/);
    expect(text).toMatch(/under yesterday's high \$234\.76/);
    expect(text).not.toMatch(/will go|guaranteed/);
  });
  it("says so when premarket is empty", () => {
    const c = rankPremarket({ AAPL: snap(190, { h: 192, l: 188, c: 190, v: 60e6 }, null) }, NOW)[0];
    expect(whyLines(c, "premarket", null).join(" ")).toMatch(/No premarket prints yet/);
  });
});
