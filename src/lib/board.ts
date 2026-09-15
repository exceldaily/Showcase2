// ─────────────────────────────────────────────────────────
// Board layout (pure, unit-tested). A 12-column grid of widgets the
// trader drags and resizes. Positions are grid units; the component
// turns them into pixels. Overlap is allowed on purpose: it is the
// user's board, and auto-packing surprises people mid-drag.
// ─────────────────────────────────────────────────────────

export type WidgetKind = "chart" | "plan" | "watch" | "scanner";
export type WidgetTf = "1m" | "5m" | "15m" | "1h";

export interface Widget {
  id: string;
  kind: WidgetKind;
  symbol?: string;
  tf?: WidgetTf;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const COLS = 12;
export const ROW_PX = 44;

export const MIN_SIZE: Record<WidgetKind, { w: number; h: number }> = {
  chart: { w: 3, h: 6 },
  plan: { w: 3, h: 5 },
  watch: { w: 4, h: 4 },
  scanner: { w: 3, h: 6 },
};

export const DEFAULT_SIZE: Record<WidgetKind, { w: number; h: number }> = {
  chart: { w: 6, h: 9 },
  plan: { w: 4, h: 7 },
  watch: { w: 12, h: 5 },
  scanner: { w: 4, h: 10 },
};

export const KIND_LABEL: Record<WidgetKind, string> = {
  chart: "Chart",
  plan: "Plan",
  watch: "Today's watch",
  scanner: "Scanner",
};

let seq = 0;
export function newId(): string {
  seq += 1;
  return `w${Date.now().toString(36)}${seq}`;
}

export function clampWidget(w: Widget, cols = COLS): Widget {
  const min = MIN_SIZE[w.kind];
  const width = Math.max(min.w, Math.min(cols, Math.round(w.w)));
  const height = Math.max(min.h, Math.round(w.h));
  const x = Math.max(0, Math.min(cols - width, Math.round(w.x)));
  const y = Math.max(0, Math.round(w.y));
  return { ...w, x, y, w: width, h: height };
}

export function moveWidget(list: Widget[], id: string, dx: number, dy: number): Widget[] {
  return list.map((w) => (w.id === id ? clampWidget({ ...w, x: w.x + dx, y: w.y + dy }) : w));
}

export function resizeWidget(list: Widget[], id: string, dw: number, dh: number): Widget[] {
  return list.map((w) => (w.id === id ? clampWidget({ ...w, w: w.w + dw, h: w.h + dh }) : w));
}

/** Rows needed to show everything (plus breathing room to drop into). */
export function boardRows(list: Widget[]): number {
  return list.reduce((m, w) => Math.max(m, w.y + w.h), 0) + 4;
}

/** New widget goes below everything, full default size, left-aligned. */
export function addWidget(list: Widget[], kind: WidgetKind, symbol?: string): Widget[] {
  const size = DEFAULT_SIZE[kind];
  const y = list.reduce((m, w) => Math.max(m, w.y + w.h), 0);
  const added: Widget = { id: newId(), kind, symbol: kind === "chart" || kind === "plan" ? symbol ?? "NVDA" : undefined, tf: kind === "chart" ? "5m" : undefined, x: 0, y, ...size };
  return [...list, clampWidget(added)];
}

export function removeWidget(list: Widget[], id: string): Widget[] {
  return list.filter((w) => w.id !== id);
}

export function updateWidget(list: Widget[], id: string, patch: Partial<Pick<Widget, "symbol" | "tf">>): Widget[] {
  return list.map((w) => (w.id === id ? { ...w, ...patch } : w));
}

/** Four charts in a 2x2 grid; `rows` is the height of each chart in grid rows. */
export function presetFourCharts(symbols: string[], rows = 9): Widget[] {
  const syms = [...symbols, "NVDA", "TSLA", "SPY", "AAPL"].slice(0, 4);
  const h = Math.max(MIN_SIZE.chart.h, Math.round(rows));
  return syms.map((s, i) => clampWidget({ id: newId(), kind: "chart", symbol: s, tf: "5m", x: (i % 2) * 6, y: Math.floor(i / 2) * h, w: 6, h }));
}

/** Two charts on top, the plan for the first, the scanner, and the morning watch. */
export function presetTrader(symbols: string[]): Widget[] {
  const [a, b] = [...symbols, "NVDA", "TSLA"];
  return [
    { id: newId(), kind: "watch", x: 0, y: 0, w: 12, h: 5 },
    { id: newId(), kind: "chart", symbol: a, tf: "5m", x: 0, y: 5, w: 5, h: 9 },
    { id: newId(), kind: "chart", symbol: b, tf: "5m", x: 5, y: 5, w: 4, h: 9 },
    { id: newId(), kind: "plan", symbol: a, x: 9, y: 5, w: 3, h: 9 },
    { id: newId(), kind: "scanner", x: 0, y: 14, w: 4, h: 10 },
  ].map((w) => clampWidget(w as Widget));
}

const KINDS: WidgetKind[] = ["chart", "plan", "watch", "scanner"];
const TFS: WidgetTf[] = ["1m", "5m", "15m", "1h"];

/** Parses a stored board, dropping anything malformed. */
export function parseBoard(raw: string | null): Widget[] | null {
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return null;
    const out: Widget[] = [];
    for (const it of arr as Partial<Widget>[]) {
      if (!it || typeof it.id !== "string" || !KINDS.includes(it.kind as WidgetKind)) continue;
      if (![it.x, it.y, it.w, it.h].every((n) => typeof n === "number" && Number.isFinite(n))) continue;
      const symbol = typeof it.symbol === "string" && /^[A-Z.]{1,6}$/.test(it.symbol) ? it.symbol : undefined;
      const tf = TFS.includes(it.tf as WidgetTf) ? (it.tf as WidgetTf) : undefined;
      out.push(clampWidget({ id: it.id, kind: it.kind as WidgetKind, symbol, tf, x: it.x!, y: it.y!, w: it.w!, h: it.h! }));
    }
    return out;
  } catch {
    return null;
  }
}
