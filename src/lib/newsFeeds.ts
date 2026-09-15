// ─────────────────────────────────────────────────────────
// News feeds (pure, unit-tested). Publishers' own RSS / Atom feeds are
// parsed into headlines, tiered by source, tagged by deterministic
// keywords, and de-duplicated. No page scraping, no generated text,
// no invented sentiment.
// ─────────────────────────────────────────────────────────

export interface FeedItem {
  title: string;
  url: string;
  publishedAt: string | null;
  /** Feed-provided publisher when present (Google News puts it in <source>). */
  publisher: string | null;
}

export interface NewsItem {
  symbol: string;
  title: string;
  url: string;
  source: "yahoo" | "google" | "sec";
  publisher: string | null;
  tier: 1 | 2 | 3 | 4;
  tags: string[];
  publishedAt: string | null;
  /** True when the headline names the symbol or the company; false for loosely related pieces. */
  direct: boolean;
}

export const NEWS_TAGS: [string, RegExp][] = [
  ["EARNINGS", /\b(earnings|quarterly results|Q[1-4]\b|revenue|EPS|guidance|outlook)\b/i],
  ["ANALYST", /\b(upgrade|downgrade|price target|initiat(es|ed) coverage|overweight|underweight|outperform|underperform)\b/i],
  ["FILING", /\b(8-K|10-Q|10-K|S-1|13D|13G|form 4|prospectus|registration statement)\b/i],
  ["M&A", /\b(acquire|acquisition|merger|takeover|buyout|to buy\b|deal to)\b/i],
  ["OFFERING", /\b(offering|secondary|convertible notes|share sale|dilut)/i],
  ["LEGAL", /\b(lawsuit|antitrust|probe|investigation|subpoena|settlement|DOJ|FTC)\b/i],
  ["FDA", /\b(FDA|approval|phase (1|2|3|i|ii|iii)|clinical)\b/i],
  ["MACRO", /\b(Fed|FOMC|tariff|inflation|CPI|rates?|Treasury yields?)\b/i],
  ["INSIDER", /\b(insider|CEO sells|CEO buys|executive (sold|bought)|stake)\b/i],
];

const TIER1 = /sec\.gov|federal reserve|prnewswire|globenewswire|business ?wire|accesswire|investor relations/i;
const TIER2 = /reuters|bloomberg|wall street journal|wsj|cnbc|barron|marketwatch|financial times|ft\.com|dow jones|associated press|ap news|the information|nikkei|investor'?s business daily|forbes|axios/i;
const TIER3 = /motley fool|fool\.com|seeking alpha|zacks|investorplace|simply wall st|tipranks|benzinga|stocktwits|invezz|24\/7 wall st|gurufocus|yahoo finance|thestreet|nasdaq\.com|insider monkey/i;

export function classifySource(publisher: string | null, url: string): 1 | 2 | 3 | 4 {
  const hay = `${publisher ?? ""} ${url}`;
  if (TIER1.test(hay)) return 1;
  if (TIER2.test(hay)) return 2;
  if (TIER3.test(hay)) return 3;
  return 4;
}

export function tagHeadline(title: string): string[] {
  return NEWS_TAGS.filter(([, re]) => re.test(title)).map(([t]) => t);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " " };
export function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e.startsWith("#x")) return String.fromCodePoint(parseInt(e.slice(2), 16));
      if (e.startsWith("#")) return String.fromCodePoint(Number(e.slice(1)));
      return ENTITIES[e] ?? m;
    })
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const tag = (block: string, name: string): string | null => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(block);
  return m ? decodeEntities(m[1]) : null;
};
const attr = (block: string, name: string, a: string): string | null => {
  const m = new RegExp(`<${name}\\b[^>]*\\b${a}="([^"]*)"`, "i").exec(block);
  return m ? decodeEntities(m[1]) : null;
};
const isoOrNull = (s: string | null) => {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

/** Parses RSS 2.0 <item> and Atom <entry> blocks. Unknown shapes yield no items, never junk. */
export function parseFeed(xml: string): FeedItem[] {
  const out: FeedItem[] = [];
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  for (const it of items) {
    const title = tag(it, "title");
    const url = tag(it, "link") ?? attr(it, "link", "href");
    if (!title || !url) continue;
    out.push({ title, url, publishedAt: isoOrNull(tag(it, "pubDate") ?? tag(it, "dc:date")), publisher: tag(it, "source") });
  }
  const entries = xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? [];
  for (const en of entries) {
    const title = tag(en, "title");
    const url = attr(en, "link", "href") ?? tag(en, "link");
    if (!title || !url) continue;
    out.push({ title, url, publishedAt: isoOrNull(tag(en, "updated") ?? tag(en, "filing-date") ?? tag(en, "published")), publisher: null });
  }
  return out;
}

/** Google News wraps the publisher into the title as " - Publisher"; split it off. */
export function splitGoogleTitle(title: string, publisher: string | null): { title: string; publisher: string | null } {
  const m = /^(.*)\s-\s([^-]{2,60})$/.exec(title);
  if (m && !publisher) return { title: m[1].trim(), publisher: m[2].trim() };
  if (m && publisher && m[2].trim().toLowerCase() === publisher.toLowerCase()) return { title: m[1].trim(), publisher };
  return { title, publisher };
}

const normalizeTitle = (t: string) => t.replace(/\s-\s[^-]{2,60}$/, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80);

/** Builds tiered, tagged, de-duplicated news for one symbol from raw feed items. */
export function isDirect(title: string, symbol: string, companyName: string | null): boolean {
  if (new RegExp(`\\b${symbol.replace(/[.]/g, "\\.")}\\b`).test(title)) return true;
  if (!companyName) return false;
  const core = companyName.replace(/\b(inc|corp|corporation|co|ltd|plc|holdings|class [abc]|the)\b\.?/gi, "").replace(/[^\w ]/g, " ").trim().split(/\s+/)[0];
  return core.length >= 3 && new RegExp(`\\b${core}\\b`, "i").test(title);
}

export function buildNews(symbol: string, feeds: { source: NewsItem["source"]; items: FeedItem[] }[], maxAgeDays = 7, nowMs = Date.now(), companyName: string | null = null): NewsItem[] {
  const seenUrl = new Set<string>();
  const seenTitle = new Set<string>();
  const out: NewsItem[] = [];
  for (const f of feeds) {
    for (const raw of f.items) {
      const { title, publisher } = f.source === "google" ? splitGoogleTitle(raw.title, raw.publisher) : { title: raw.title, publisher: raw.publisher };
      const url = raw.url.trim();
      const key = normalizeTitle(title);
      if (!title || !/^https?:\/\//i.test(url) || seenUrl.has(url) || seenTitle.has(key)) continue;
      if (raw.publishedAt && nowMs - Date.parse(raw.publishedAt) > maxAgeDays * 86400e3) continue;
      seenUrl.add(url);
      seenTitle.add(key);
      const pub = f.source === "sec" ? "SEC EDGAR" : f.source === "yahoo" && !publisher ? hostOf(url) : publisher;
      out.push({
        symbol, title: f.source === "sec" ? `SEC filing: ${title}` : title, url, source: f.source, publisher: pub,
        tier: f.source === "sec" ? 1 : classifySource(pub, url), tags: tagHeadline(f.source === "sec" ? `FILING ${title}` : title), publishedAt: raw.publishedAt,
        direct: f.source === "sec" || isDirect(title, symbol, companyName),
      });
    }
  }
  // Direct mentions first, then newest.
  return out.sort((a, b) => Number(b.direct) - Number(a.direct) || (b.publishedAt ? Date.parse(b.publishedAt) : 0) - (a.publishedAt ? Date.parse(a.publishedAt) : 0));
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Feed URLs for a symbol. Google News needs the company name to stay on topic. */
export function feedUrls(symbol: string, companyName: string | null): { source: NewsItem["source"]; url: string }[] {
  const q = companyName ? `"${symbol}" OR "${companyName.replace(/[^\w .&-]/g, "").replace(/\b(inc|corp|corporation|co|ltd|plc|holdings|class [abc])\b\.?/gi, "").trim()}"` : `${symbol} stock`;
  return [
    { source: "yahoo", url: `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US` },
    { source: "google", url: `https://news.google.com/rss/search?q=${encodeURIComponent(q + " stock")}&hl=en-US&gl=US&ceid=US:en` },
    { source: "sec", url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(symbol)}&type=&dateb=&owner=include&count=20&output=atom` },
  ];
}
