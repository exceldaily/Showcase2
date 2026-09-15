// Short definitions for tooltips. One line each, no lectures.

export const GLOSSARY: Record<string, string> = {
  VWAP: "Volume-weighted average price for the session. Price above it means buyers have paid up today; below, sellers have.",
  MACD: "Momentum: the gap between a fast and a slow EMA (12 and 26) and its 9-period signal. The histogram is their difference.",
  EMA: "Exponential moving average. Recent bars count more. Stacked 9 over 20 over 50 is an uptrend.",
  RSI: "Relative strength index, 0 to 100. Above 70 stretched up, below 30 stretched down.",
  DELTA: "Option price change per $1 move in the stock. 0.50 means about 50 cents per dollar.",
  GAMMA: "How fast delta changes as the stock moves. High gamma means the option accelerates.",
  THETA: "Value the option loses per calendar day from time alone, all else equal.",
  VEGA: "Value change per 1 point of implied volatility.",
  IV: "Implied volatility: the move the option market is pricing in, annualised.",
  OI: "Open interest: contracts outstanding. Higher means easier to get in and out.",
  RVOL: "Relative volume for this time of day against the 20-day average.",
  BREAKEVEN: "Stock price at expiry where the option neither makes nor loses money (strike plus or minus the premium).",
  RR: "Risk/reward: distance to target 1 divided by distance to invalidation, as a multiple.",
  MAE: "Maximum adverse excursion: the worst the trade went against you while open.",
  MFE: "Maximum favourable excursion: the best the trade went for you while open.",
  TRIGGER: "Level that has to break on a 5-minute close before an entry is considered.",
  INVALIDATION: "Level that proves the idea wrong. A 5-minute close through it means out.",
  CONFLUENCE: "Confidence from eight measured parts. It never replaces confirmation.",
  LIFECYCLE: "Where the setup is: NO SETUP, WATCHING, APPROACHING, TRIGGERED, CONFIRMING, CONFIRMED, IN TRADE, TARGET HIT, INVALIDATED, EXPIRED.",
  "0DTE": "Zero days to expiration: the contract expires today.",
  SPREAD: "Bid-ask spread as a percent of the mid. Wide spreads cost you on the way in and out.",
};

export const term = (key: keyof typeof GLOSSARY) => GLOSSARY[key];
