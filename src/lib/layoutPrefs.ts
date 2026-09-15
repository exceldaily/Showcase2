// Workspace layout preferences (pure clamp + device storage). The
// scanner, the Trade Command Panel and the options-chain drawer can
// each collapse and resize; widths and heights are saved per device.

export type LayoutMode = "COMMAND" | "CHART" | "SCANNER" | "OPTIONS" | "JOURNAL";
export type Density = "compact" | "normal" | "comfortable";

export interface LayoutPrefs {
  mode: LayoutMode;
  left: boolean;
  leftW: number;
  right: boolean;
  rightW: number;
  bottom: boolean;
  bottomH: number;
  density: Density;
  /** Morning watch strip visible. */
  watch: boolean;
}

export const LAYOUT_LIMITS = {
  leftW: { min: 220, max: 460 },
  rightW: { min: 300, max: 600 },
  bottomH: { min: 140, max: 640 },
} as const;

export const DEFAULT_LAYOUT: LayoutPrefs = {
  mode: "COMMAND",
  left: true,
  leftW: 280,
  right: true,
  rightW: 380,
  bottom: true,
  bottomH: 240,
  density: "normal",
  watch: true,
};

const MODES: LayoutMode[] = ["COMMAND", "CHART", "SCANNER", "OPTIONS", "JOURNAL"];
const DENSITIES: Density[] = ["compact", "normal", "comfortable"];
const KEY = "af_layout";
const EVENT = "af-layout";

const clampN = (n: unknown, lo: number, hi: number, fallback: number) =>
  typeof n === "number" && Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : fallback;

/** Validates and clamps anything that claims to be a layout. */
export function clampLayout(raw: Partial<LayoutPrefs> | null | undefined): LayoutPrefs {
  const r = raw ?? {};
  return {
    mode: MODES.includes(r.mode as LayoutMode) ? (r.mode as LayoutMode) : DEFAULT_LAYOUT.mode,
    left: typeof r.left === "boolean" ? r.left : DEFAULT_LAYOUT.left,
    leftW: clampN(r.leftW, LAYOUT_LIMITS.leftW.min, LAYOUT_LIMITS.leftW.max, DEFAULT_LAYOUT.leftW),
    right: typeof r.right === "boolean" ? r.right : DEFAULT_LAYOUT.right,
    rightW: clampN(r.rightW, LAYOUT_LIMITS.rightW.min, LAYOUT_LIMITS.rightW.max, DEFAULT_LAYOUT.rightW),
    bottom: typeof r.bottom === "boolean" ? r.bottom : DEFAULT_LAYOUT.bottom,
    bottomH: clampN(r.bottomH, LAYOUT_LIMITS.bottomH.min, LAYOUT_LIMITS.bottomH.max, DEFAULT_LAYOUT.bottomH),
    density: DENSITIES.includes(r.density as Density) ? (r.density as Density) : DEFAULT_LAYOUT.density,
    watch: typeof r.watch === "boolean" ? r.watch : DEFAULT_LAYOUT.watch,
  };
}

/**
 * Panel visibility for a layout mode. Sizes are kept; only what is
 * open changes, so switching back restores the trader's widths.
 */
export function applyMode(p: LayoutPrefs, mode: LayoutMode): LayoutPrefs {
  switch (mode) {
    case "CHART": return { ...p, mode, left: false, right: true, bottom: false };
    case "SCANNER": return { ...p, mode, left: true, right: false, bottom: false };
    case "OPTIONS": return { ...p, mode, left: false, right: true, bottom: true };
    case "JOURNAL": return { ...p, mode, left: false, right: false, bottom: false };
    default: return { ...p, mode: "COMMAND", left: true, right: true, bottom: true };
  }
}

/**
 * Sizes that still leave the chart at least `minChart` px wide and,
 * on short screens, keep the chain drawer from eating the chart.
 */
export function fitToViewport(p: LayoutPrefs, viewportW: number, viewportH = 1080, minChart = 480): LayoutPrefs {
  let { left, right, leftW, rightW } = p;
  const bottomH = viewportH < 860 ? Math.min(p.bottomH, 180) : p.bottomH;
  const chart = () => viewportW - (left ? leftW : 0) - (right ? rightW : 0);
  if (chart() >= minChart) return bottomH === p.bottomH ? p : { ...p, bottomH };
  // Shrink rails first, then collapse the scanner, then the panel.
  leftW = LAYOUT_LIMITS.leftW.min;
  rightW = LAYOUT_LIMITS.rightW.min;
  if (chart() < minChart) left = false;
  if (chart() < minChart) right = false;
  return { ...p, left, right, leftW, rightW, bottomH };
}

export function loadLayout(): LayoutPrefs {
  if (typeof window === "undefined") return DEFAULT_LAYOUT;
  try {
    return clampLayout(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<LayoutPrefs>);
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function saveLayout(p: LayoutPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(clampLayout(p)));
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    /* ignore */
  }
}

export function onLayout(cb: (p: LayoutPrefs) => void): () => void {
  const fire = () => cb(loadLayout());
  window.addEventListener(EVENT, fire);
  window.addEventListener("storage", fire);
  return () => {
    window.removeEventListener(EVENT, fire);
    window.removeEventListener("storage", fire);
  };
}
