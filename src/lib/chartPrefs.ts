// Chart presets and per-indicator toggles shared by the terminal and
// every board chart. Stored on the device; a custom event lets open
// charts react without a reload.
//
// A preset is a full set of toggles; the trader's individual switches
// are stored as overrides on top of it, so picking a new preset resets
// the overrides and every line can still be flipped on its own.

export type ChartPreset = "CLEAN" | "MOMENTUM" | "TREND" | "LEVELS" | "FULL";
export const CHART_PRESETS: ChartPreset[] = ["CLEAN", "MOMENTUM", "TREND", "LEVELS", "FULL"];

export interface ChartToggles {
  /** Short labels next to lines, setup markers, session tint. */
  labels: boolean;
  markers: boolean;
  volume: boolean;
  vwap: boolean;
  ema9: boolean;
  ema20: boolean;
  ema50: boolean;
  ema200: boolean;
  macd: boolean;
  rsi: boolean;
  /** Support / resistance zones (nearest each side in CLEAN, all in LEVELS/FULL). */
  levels: boolean;
  /** Every zone above the strength filter, not just the nearest each side. */
  allLevels: boolean;
  /** Trigger line. */
  trigger: boolean;
  targets: boolean;
  invalidation: boolean;
  prevDay: boolean;
  premarket: boolean;
  openingRange: boolean;
}

export const TOGGLE_LABELS: Record<keyof ChartToggles, string> = {
  labels: "Labels",
  markers: "Setup markers",
  volume: "Volume",
  vwap: "VWAP",
  ema9: "EMA 9",
  ema20: "EMA 20",
  ema50: "EMA 50",
  ema200: "EMA 200",
  macd: "MACD",
  rsi: "RSI",
  levels: "Support / resistance",
  allLevels: "All levels",
  trigger: "Entry trigger",
  targets: "Targets",
  invalidation: "Invalidation",
  prevDay: "Prev-day high / low",
  premarket: "Premarket high / low",
  openingRange: "Opening range",
};

const base: ChartToggles = {
  labels: true, markers: true, volume: true, vwap: true, ema9: true, ema20: true, ema50: false, ema200: false,
  macd: false, rsi: false, levels: true, allLevels: false, trigger: true, targets: true, invalidation: true,
  prevDay: false, premarket: false, openingRange: false,
};

export const PRESETS: Record<ChartPreset, ChartToggles> = {
  CLEAN: { ...base },
  MOMENTUM: { ...base, ema20: false, macd: true, rsi: true, levels: false },
  TREND: { ...base, ema50: true, ema200: true },
  LEVELS: { ...base, ema9: false, ema20: false, allLevels: true, prevDay: true, premarket: true, openingRange: true },
  FULL: { ...base, ema50: true, ema200: true, macd: true, rsi: true, allLevels: true, prevDay: true, premarket: true, openingRange: true },
};

export interface ChartPrefs {
  preset: ChartPreset;
  overrides: Partial<ChartToggles>;
}

export const DEFAULT_CHART_PREFS: ChartPrefs = { preset: "CLEAN", overrides: {} };
const KEY = "af_chart";
const LEGACY_KEY = "af_chart_ind";
const EVENT = "af-chart-prefs";

export function effectiveToggles(p: ChartPrefs): ChartToggles {
  return { ...PRESETS[p.preset], ...p.overrides };
}

/** Sanitises anything that claims to be chart prefs. */
export function parseChartPrefs(raw: unknown): ChartPrefs {
  if (!raw || typeof raw !== "object") return DEFAULT_CHART_PREFS;
  const r = raw as Partial<ChartPrefs>;
  const preset = CHART_PRESETS.includes(r.preset as ChartPreset) ? (r.preset as ChartPreset) : "CLEAN";
  const overrides: Partial<ChartToggles> = {};
  const o = (r.overrides ?? {}) as Record<string, unknown>;
  for (const k of Object.keys(base) as (keyof ChartToggles)[]) if (typeof o[k] === "boolean") overrides[k] = o[k] as boolean;
  return { preset, overrides };
}

export function loadChartPrefs(): ChartPrefs {
  if (typeof window === "undefined") return DEFAULT_CHART_PREFS;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return parseChartPrefs(JSON.parse(raw));
    // One-time migration from the old {labels, emas, macd} shape.
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const l = JSON.parse(legacy) as { labels?: boolean; emas?: boolean; macd?: boolean };
      const p: ChartPrefs = { preset: "CLEAN", overrides: {} };
      if (l.labels === false) p.overrides.labels = false;
      if (l.emas) { p.overrides.ema50 = true; p.overrides.ema200 = true; }
      if (l.macd) p.overrides.macd = true;
      return p;
    }
    return DEFAULT_CHART_PREFS;
  } catch {
    return DEFAULT_CHART_PREFS;
  }
}

export function saveChartPrefs(p: ChartPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(parseChartPrefs(p)));
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch { /* ignore */ }
}

/** Flip one indicator on top of the current preset. */
export function toggleIndicator(p: ChartPrefs, key: keyof ChartToggles): ChartPrefs {
  const now = effectiveToggles(p)[key];
  return { ...p, overrides: { ...p.overrides, [key]: !now } };
}

export function setPreset(p: ChartPrefs, preset: ChartPreset): ChartPrefs {
  return { preset, overrides: {} };
}

/** Subscribe to changes made anywhere on the page (or another tab). */
export function onChartPrefs(cb: (p: ChartPrefs) => void): () => void {
  const fire = () => cb(loadChartPrefs());
  window.addEventListener(EVENT, fire);
  window.addEventListener("storage", fire);
  return () => {
    window.removeEventListener(EVENT, fire);
    window.removeEventListener("storage", fire);
  };
}
