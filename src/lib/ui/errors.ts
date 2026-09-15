// Turns raw failures into the short headline a trader should see,
// keeping the technical text for an expandable detail.

export interface FriendlyError {
  headline: string;
  detail: string | null;
}

export function friendlyError(raw: string | null | undefined, area: "analysis" | "options" | "scan" | "quote" | "broker" = "analysis"): FriendlyError {
  const text = (raw ?? "").trim();
  const noun = area === "options" ? "OPTIONS DATA" : area === "scan" ? "SCANNER" : area === "quote" ? "QUOTE FEED" : area === "broker" ? "BROKER" : "ANALYSIS";
  if (!text) return { headline: `${noun} UNAVAILABLE`, detail: null };
  if (/ALPACA_API_KEY|not connected|keys not configured/i.test(text)) return { headline: "NOT CONNECTED TO DATA PROVIDER", detail: text };
  if (/network|fetch failed|Failed to fetch|ECONN|ETIMEDOUT|aborted/i.test(text)) return { headline: `${noun} UNREACHABLE`, detail: text };
  if (/HTTP 401|HTTP 403|unauthori[sz]ed|forbidden/i.test(text)) return { headline: "SIGNED OUT OR NOT ALLOWED", detail: text };
  if (/HTTP 429|rate limit|too many/i.test(text)) return { headline: "DATA PROVIDER RATE LIMITED", detail: text };
  if (/HTTP 5\d\d|internal/i.test(text)) return { headline: `${noun} UNAVAILABLE`, detail: text };
  if (/not enough|too few|no bars|insufficient/i.test(text)) return { headline: "NOT ENOUGH DATA FOR THIS SYMBOL", detail: text };
  if (/unknown symbol|not found|HTTP 404/i.test(text)) return { headline: "SYMBOL NOT FOUND", detail: text };
  return { headline: `${noun} UNAVAILABLE`, detail: text };
}
