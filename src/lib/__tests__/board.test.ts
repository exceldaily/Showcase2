import { describe, expect, it } from "vitest";
import { addWidget, boardRows, clampWidget, moveWidget, parseBoard, presetFourCharts, presetTrader, resizeWidget, COLS } from "../board";

describe("board layout", () => {
  it("clamps widgets inside the grid and above minimum sizes", () => {
    const w = clampWidget({ id: "a", kind: "chart", x: 11, y: -3, w: 1, h: 1 });
    expect(w).toMatchObject({ x: COLS - 3, y: 0, w: 3, h: 6 });
    const wide = clampWidget({ id: "b", kind: "watch", x: 2, y: 0, w: 40, h: 4 });
    expect(wide).toMatchObject({ x: 0, w: 12 });
  });
  it("moves and resizes with clamping", () => {
    const list = presetFourCharts(["NVDA", "TSLA", "SPY", "AAPL"]);
    const moved = moveWidget(list, list[0].id, 20, 2);
    expect(moved[0]).toMatchObject({ x: 6, y: 2 }); // clamped to the right edge, moved two rows down
    const shrunk = resizeWidget(list, list[1].id, -10, -10);
    expect(shrunk[1]).toMatchObject({ w: 3, h: 6 });
  });
  it("adds below everything and reports rows with room to drop", () => {
    const list = presetFourCharts([]);
    expect(boardRows(list)).toBe(18 + 4);
    const more = addWidget(list, "plan", "MSFT");
    expect(more.at(-1)).toMatchObject({ kind: "plan", symbol: "MSFT", x: 0, y: 18 });
  });
  it("presets fill the grid sensibly", () => {
    const four = presetFourCharts(["ORCL"]);
    expect(four.map((w) => w.symbol)).toEqual(["ORCL", "NVDA", "TSLA", "SPY"]);
    expect(new Set(four.map((w) => `${w.x},${w.y}`)).size).toBe(4);
    const trader = presetTrader([]);
    expect(trader.map((w) => w.kind)).toEqual(["watch", "chart", "chart", "plan", "scanner"]);
  });
  it("parses stored boards defensively", () => {
    expect(parseBoard(null)).toBeNull();
    expect(parseBoard("nope")).toBeNull();
    const ok = parseBoard(JSON.stringify([{ id: "x", kind: "chart", symbol: "nvda", tf: "9m", x: 0, y: 0, w: 6, h: 9 }, { id: 1 }, { id: "y", kind: "bogus", x: 0, y: 0, w: 1, h: 1 }]));
    expect(ok).toHaveLength(1);
    expect(ok![0].symbol).toBeUndefined(); // lowercase is rejected
    expect(ok![0].tf).toBeUndefined();
  });
});
