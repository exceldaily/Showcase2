// Static symbol universes. Pure data, safe to import on the client
// (the server-side scanner re-exports these).

/** S&P 100 constituents (static reference list; composition drifts slowly). */
export const SP100 = [
  "AAPL","ABBV","ABT","ACN","ADBE","AIG","AMD","AMGN","AMT","AMZN","AVGO","AXP","BA","BAC","BNY","BKNG","BLK","BMY","BRK.B","C",
  "CAT","CHTR","CL","CMCSA","COF","COP","COST","CRM","CSCO","CVS","CVX","DE","DHR","DIS","DUK","EMR","F","FDX","GD","GE",
  "GILD","GM","GOOG","GOOGL","GS","HD","HON","IBM","INTC","INTU","ISRG","JNJ","JPM","KO","LIN","LLY","LMT","LOW","MA","MCD",
  "MDLZ","MDT","MET","META","MMM","MO","MRK","MS","MSFT","NEE","NFLX","NKE","NOW","NVDA","ORCL","PEP","PFE","PG","PLTR","PM",
  "PYPL","QCOM","RTX","SBUX","SCHW","SO","SPG","T","TGT","TMO","TMUS","TSLA","TXN","UNH","UNP","UPS","USB","V","VZ","WFC","WMT","XOM",
];

/** Liquid, options-heavy names day traders actually trade. */
export const MEGACAPS = [
  "NVDA","TSLA","AAPL","MSFT","AMZN","META","GOOGL","AMD","AVGO","NFLX","MU","PLTR","COIN","CRM","ORCL","INTC","QCOM","BA","JPM","GS",
  "SPY","QQQ","IWM","SMH","XLF","XLE","XLK","ARKK","UBER","SHOP",
];

/** Index modes the terminal understands (see lib/indexMode.ts). */
export const INDEXES = ["SPX"];

/** Everything the search box should suggest, deduped, indexes first. */
export const ALL_SYMBOLS: string[] = Array.from(new Set([...INDEXES, ...MEGACAPS, ...SP100]));
