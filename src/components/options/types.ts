// Client-side shapes shared by the workspace panels.

export interface Quote {
  symbol: string;
  price: number | null;
  tradeTs: number | null;
  bid: number | null;
  ask: number | null;
  prevClose: number | null;
  session: string;
  asOf: number;
}

export interface Broker {
  connected: boolean;
  paper: boolean;
  liveEnabled: boolean;
  error?: string;
  account: { equity: number; buyingPower: number; optionsBuyingPower: number | null; optionsLevel: number | null } | null;
  clock: { isOpen: boolean; nextOpen: string; nextClose: string } | null;
  positions: {
    symbol: string; underlying: string; side: string | null; strike: number | null; expiry: string | null;
    qty: number; avgEntry: number; currentPrice: number | null; unrealizedPl: number | null;
    unrealizedPlPct: number | null; liveBid: number | null; liveAsk: number | null; quoteTs: string | null;
  }[];
  orders: {
    id: string; symbol: string; qty: number; filledQty: number; side: string; type: string;
    status: string; limitPrice: number | null; filledAvgPrice: number | null; submittedAt: string;
  }[];
}

export type ChartTf = "1m" | "2m" | "5m" | "15m" | "30m" | "1h" | "D" | "W";
export const TF_CHOICES: { key: ChartTf; label: string; hotkey: string }[] = [
  { key: "1m", label: "1m", hotkey: "1" }, { key: "2m", label: "2m", hotkey: "2" }, { key: "5m", label: "5m", hotkey: "5" },
  { key: "15m", label: "15m", hotkey: "I" }, { key: "30m", label: "30m", hotkey: "3" }, { key: "1h", label: "1h", hotkey: "H" },
  { key: "D", label: "D", hotkey: "D" }, { key: "W", label: "W", hotkey: "W" },
];
export const BUCKET_MS: Record<ChartTf, number | null> = { "1m": 60e3, "2m": 120e3, "5m": 300e3, "15m": 900e3, "30m": 1800e3, "1h": 3600e3, D: null, W: null };
