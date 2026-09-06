import { describe, expect, it } from "vitest";
import { concurrentElsewhere, deviceLabel, factsFromHeaders, isNewCountry, placeLabel, sessionsToKick, type ActiveSession } from "../devices";

const s = (id: string, lastSeenMin: number, city: string | null, ip = "1.1.1.1"): ActiveSession => ({
  id, lastSeenAt: lastSeenMin * 60_000, createdAt: 0, city, region: null, country: city ? "US" : null, ip,
});

describe("device parsing", () => {
  it("labels common browsers and OSes", () => {
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36")).toBe("Chrome on Windows");
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")).toBe("Safari on iPhone");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/128.0 Safari/537.36 Edg/128.0")).toBe("Edge on Windows");
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36")).toBe("Chrome on Android");
    expect(deviceLabel(null)).toBe("Unknown device");
  });
  it("reads Vercel geo headers and decodes the city", () => {
    const h = new Map([["x-forwarded-for", "8.8.8.8, 10.0.0.1"], ["x-vercel-ip-city", "Winter%20Park"], ["x-vercel-ip-country", "US"], ["x-vercel-ip-country-region", "FL"]]);
    const f = factsFromHeaders({ get: (k) => h.get(k) ?? null });
    expect(f.ip).toBe("8.8.8.8");
    expect(f.city).toBe("Winter Park");
    expect(placeLabel(f)).toBe("Winter Park, FL, US");
    expect(placeLabel({ city: null, region: null, country: null })).toBe("unknown location");
  });
});

describe("device cap", () => {
  it("kicks the least recently seen sessions to make room for one more", () => {
    const active = [s("a", 10, "Orlando"), s("b", 50, "Orlando"), s("c", 30, "Orlando")];
    expect(sessionsToKick(active, 2)).toEqual(["a", "c"]);
    expect(sessionsToKick(active, 4)).toEqual([]);
    expect(sessionsToKick(active, 1)).toEqual(["a", "c", "b"]);
    expect(sessionsToKick([], 1)).toEqual([]);
  });
});

describe("sharing detection", () => {
  it("flags a recent session from a different city, ignores stale or same-city ones", () => {
    const now = 100 * 60_000;
    const cur = { city: "Orlando", country: "US", ip: "1.1.1.1" };
    expect(concurrentElsewhere(cur, [s("x", 90, "Orlando")], now)).toBeNull();
    expect(concurrentElsewhere(cur, [s("x", 90, "Dallas")], now)?.id).toBe("x");
    expect(concurrentElsewhere(cur, [s("x", 20, "Dallas")], now)).toBeNull(); // 80 minutes old
  });
  it("falls back to IP when the city is unknown (local dev)", () => {
    const now = 100 * 60_000;
    const cur = { city: null, country: null, ip: "1.1.1.1" };
    expect(concurrentElsewhere(cur, [s("x", 95, null, "1.1.1.1")], now)).toBeNull();
    expect(concurrentElsewhere(cur, [s("x", 95, null, "2.2.2.2")], now)?.id).toBe("x");
  });
  it("new-country needs history", () => {
    expect(isNewCountry("MX", [])).toBe(false);
    expect(isNewCountry("MX", ["US", "US"])).toBe(true);
    expect(isNewCountry("US", ["US"])).toBe(false);
    expect(isNewCountry(null, ["US"])).toBe(false);
  });
});
