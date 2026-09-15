import { describe, expect, it } from "vitest";
import { buildNews, classifySource, decodeEntities, feedUrls, parseFeed, splitGoogleTitle, tagHeadline } from "../newsFeeds";

const rss = `<?xml version="1.0"?><rss><channel><item><title>Nvidia &amp; AMD Rally &#8211; Chips Lead</title><link>https://finance.yahoo.com/a?x=1</link><pubDate>Tue, 15 Sep 2026 20:13:27 +0000</pubDate></item>
<item><title><![CDATA[Nvidia stock drops after downgrade - Barron's]]></title><link>https://news.google.com/rss/articles/abc</link><pubDate>Tue, 15 Sep 2026 19:00:00 GMT</pubDate><source url="https://www.barrons.com">Barron's</source></item>
<item><title>no link</title></item></channel></rss>`;
const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>8-K - Current report</title><link rel="alternate" type="text/html" href="https://www.sec.gov/Archives/edgar/data/1/0001-index.htm"/><updated>2026-09-14T16:05:00-04:00</updated></entry></feed>`;

describe("news feeds", () => {
  it("parses RSS items and Atom entries, decoding entities", () => {
    const items = parseFeed(rss);
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe("Nvidia & AMD Rally – Chips Lead");
    expect(items[0].publishedAt).toBe("2026-09-15T20:13:27.000Z");
    expect(items[1].publisher).toBe("Barron's");
    const entries = parseFeed(atom);
    expect(entries[0].url).toMatch(/sec\.gov/);
    expect(entries[0].publishedAt).toBe("2026-09-14T20:05:00.000Z");
    expect(parseFeed("<html>not a feed</html>")).toEqual([]);
    expect(decodeEntities("A &amp; B &#x27;C&#x27; <b>bold</b>")).toBe("A & B 'C' bold");
  });
  it("tiers sources and tags headlines deterministically", () => {
    expect(classifySource("Reuters", "https://reuters.com/x")).toBe(2);
    expect(classifySource("Motley Fool", "https://fool.com/x")).toBe(3);
    expect(classifySource("PR Newswire", "https://prnewswire.com/x")).toBe(1);
    expect(classifySource("Random Blog", "https://example.com")).toBe(4);
    expect(tagHeadline("Nvidia beats on earnings, raises guidance; analyst upgrade follows")).toEqual(["EARNINGS", "ANALYST"]);
    expect(tagHeadline("Company files 8-K on CEO departure")).toEqual(["FILING"]);
    expect(tagHeadline("Weather is nice")).toEqual([]);
    expect(splitGoogleTitle("Nvidia drops - Barron's", null)).toEqual({ title: "Nvidia drops", publisher: "Barron's" });
  });
  it("builds de-duplicated, tiered, dated news and drops stale items", () => {
    const now = Date.parse("2026-09-16T00:00:00Z");
    const news = buildNews("NVDA", [
      { source: "yahoo", items: parseFeed(rss) },
      { source: "google", items: [{ title: "Nvidia stock drops after downgrade - Barron's", url: "https://news.google.com/other", publishedAt: "2026-09-15T19:00:00Z", publisher: null }, { title: "Old news", url: "https://x.com/old", publishedAt: "2026-08-01T00:00:00Z", publisher: "Reuters" }] },
      { source: "sec", items: parseFeed(atom) },
    ], 7, now, "NVIDIA Corp");
    expect(news.map((n) => n.source)).toEqual(["yahoo", "yahoo", "sec"]);
    expect(news.every((n) => n.direct)).toBe(true);
    const loose = buildNews("NVDA", [{ source: "yahoo", items: [{ title: "Tesla launches the Cybercab", url: "https://x.com/t", publishedAt: "2026-09-15T10:00:00Z", publisher: null }, { title: "Nvidia beats", url: "https://x.com/n", publishedAt: "2026-09-15T09:00:00Z", publisher: null }] }], 7, now, "NVIDIA Corp");
    expect(loose.map((n) => [n.title, n.direct])).toEqual([["Nvidia beats", true], ["Tesla launches the Cybercab", false]]);
    expect(news.find((n) => n.source === "sec")?.tier).toBe(1);
    expect(news.find((n) => n.source === "sec")?.tags).toContain("FILING");
    expect(news.find((n) => /Barron/.test(n.publisher ?? ""))?.tier).toBe(2);
    expect(news.find((n) => /Barron/.test(n.publisher ?? ""))?.tags).toContain("ANALYST");
    expect(news.some((n) => n.title === "Old news")).toBe(false);
  });
  it("builds feed urls with the company name for Google News", () => {
    const urls = feedUrls("NVDA", "NVIDIA Corp");
    expect(urls.map((u) => u.source)).toEqual(["yahoo", "google", "sec"]);
    expect(decodeURIComponent(urls[1].url)).toContain('"NVDA" OR "NVIDIA"');
    expect(urls[2].url).toContain("CIK=NVDA");
  });
});
