// Chart indicator preferences shared by the terminal and every board
// chart. Stored on the device; a custom event lets open charts react
// without a reload.

export interface ChartToggles {
  /** Plain-English labels, trend badge, legend and markers. */
  labels: boolean;
  /** EMA 20 / 50 / 200 on top of the always-on EMA9. */
  emas: boolean;
  /** MACD (12, 26, 9) in a pane under the price. */
  macd: boolean;
}

export const DEFAULT_TOGGLES: ChartToggles = { labels: true, emas: false, macd: false };
const KEY = "af_chart_ind";
const EVENT = "af-chart-prefs";

export function loadChartPrefs(): ChartToggles {
  if (typeof window === "undefined") return DEFAULT_TOGGLES;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<ChartToggles>;
    return { ...DEFAULT_TOGGLES, ...raw };
  } catch {
    return DEFAULT_TOGGLES;
  }
}

export function saveChartPrefs(t: ChartToggles): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(t));
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch { /* ignore */ }
}

/** Subscribe to changes made anywhere on the page (or another tab). */
export function onChartPrefs(cb: (t: ChartToggles) => void): () => void {
  const fire = () => cb(loadChartPrefs());
  window.addEventListener(EVENT, fire);
  window.addEventListener("storage", fire);
  return () => {
    window.removeEventListener(EVENT, fire);
    window.removeEventListener("storage", fire);
  };
}
