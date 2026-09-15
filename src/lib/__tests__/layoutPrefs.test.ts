import { describe, expect, it } from "vitest";
import { applyMode, clampLayout, DEFAULT_LAYOUT, fitToViewport, LAYOUT_LIMITS } from "../layoutPrefs";

describe("layout prefs", () => {
  it("clamps sizes and rejects junk", () => {
    const p = clampLayout({ leftW: 9999, rightW: 10, bottomH: 300.6, mode: "nope" as never, density: "x" as never });
    expect(p.leftW).toBe(LAYOUT_LIMITS.leftW.max);
    expect(p.rightW).toBe(LAYOUT_LIMITS.rightW.min);
    expect(p.bottomH).toBe(301);
    expect(p.mode).toBe("COMMAND");
    expect(p.density).toBe("normal");
    expect(clampLayout(null)).toEqual(DEFAULT_LAYOUT);
  });
  it("modes only change what is open", () => {
    const p = { ...DEFAULT_LAYOUT, leftW: 300 };
    expect(applyMode(p, "CHART")).toMatchObject({ left: false, right: true, bottom: false, leftW: 300 });
    expect(applyMode(p, "OPTIONS")).toMatchObject({ left: false, bottom: true });
    expect(applyMode(applyMode(p, "CHART"), "COMMAND")).toMatchObject({ left: true, right: true, bottom: true });
  });
  it("fits narrow viewports by shrinking, then collapsing rails", () => {
    expect(fitToViewport(DEFAULT_LAYOUT, 1920)).toEqual(DEFAULT_LAYOUT);
    const laptop = fitToViewport(DEFAULT_LAYOUT, 1100);
    expect(laptop.left).toBe(true);
    expect(laptop.leftW).toBe(LAYOUT_LIMITS.leftW.min);
    const tablet = fitToViewport(DEFAULT_LAYOUT, 900);
    expect(tablet.left).toBe(false);
    expect(tablet.right).toBe(true);
  });
  it("shrinks the chain drawer on short screens", () => {
    expect(fitToViewport(DEFAULT_LAYOUT, 1920, 768).bottomH).toBe(180);
    expect(fitToViewport(DEFAULT_LAYOUT, 1920, 1080).bottomH).toBe(DEFAULT_LAYOUT.bottomH);
  });
});
