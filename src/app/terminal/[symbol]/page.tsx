import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ExternalLink } from "lucide-react";
import MarketPulsePanel from "@/components/terminal/MarketPulsePanel";
import StatusBar from "@/components/terminal/StatusBar";
import StatRow from "@/components/terminal/StatRow";
import PriceChart from "@/components/terminal/PriceChart";
import ScorePanel from "@/components/terminal/ScorePanel";
import RiskCalculator from "@/components/terminal/RiskCalculator";
import { buildMarketPulse } from "@/lib/marketPulseLive";
import { availableTimeframes, getStockDetail } from "@/lib/stockDetail";
import { getTickerNews } from "@/lib/news";
import { getSymbolScore } from "@/lib/scoreLookup";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

const EXT_TONE: Record<string, string> = {
  Normal: "bg-bg-hover text-ink-muted border-border",
  Extended: "bg-warn/15 text-warn border-warn/30",
  "Very Extended": "bg-warn/20 text-warn border-warn/40",
  Parabolic: "bg-bear/15 text-bear border-bear/30",
};

export default async function TerminalSymbolPage({ params }: { params: { symbol: string } }) {
  const sym = params.symbol.toUpperCase();
  const data = await getStockDetail(sym);
  if (!data) notFound();

  const { detail: d, chart } = data;
  const [news, alertRows] = await Promise.all([
    getTickerNews(sym, 5),
    query<{ alert_type: string; message: string; strength: number | null; scan_date: string }>(
      `select alert_type, message, strength, scan_date::text
       from alerts where symbol = $1 order by scan_date desc limit 3`,
      [sym]
    ),
  ]);
  const timeframes = availableTimeframes();
  const score = await getSymbolScore(sym, news.length > 0);
  // After getStockDetail so an untracked symbol's on-demand bars are
  // already cached and the pulse reads the same history.
  const pulse = await buildMarketPulse(sym);

  // Seed the risk calculator from real structure: nearest support below
  // as the stop, nearest resistance above as the target.
  const supportBelow = d.levels.filter((l) => l.kind === "support" && l.price < (d.price.value ?? 0))[0];
  const resistAbove = d.levels.filter((l) => l.kind === "resistance" && l.price > (d.price.value ?? 0))[0];

  return (
    <div className="-mx-4 -my-6 sm:-mx-6">
      <StatusBar lastUpdate={new Date().toISOString()} />

      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-3 py-2">
        <span className="text-xl font-bold">{d.symbol}</span>
        <span className="text-[12px] text-ink-muted">{d.company ?? "—"}</span>
        <span className="font-mono text-lg">${d.price.value?.toFixed(2)}</span>
        <span
          className={`font-mono text-[13px] ${
            (d.changePct.value ?? 0) > 0 ? "text-bull" : (d.changePct.value ?? 0) < 0 ? "text-bear" : "text-ink-muted"
          }`}
        >
          {(d.changePct.value ?? 0) > 0 ? "+" : ""}
          {d.changePct.value?.toFixed(2)}%
        </span>
        {d.extension && (
          <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${EXT_TONE[d.extension.state]}`}>
            {d.extension.state.toUpperCase()}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {timeframes.map((t) => (
            <button
              key={t.tf}
              disabled={!t.enabled}
              title={t.enabled ? `${t.label} bars` : "Requires intraday data plan"}
              className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                t.tf === "1d"
                  ? "bg-brand/15 text-brand-glow"
                  : t.enabled
                    ? "text-ink-muted hover:bg-bg-hover"
                    : "cursor-not-allowed text-ink-faint/50 line-through"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {pulse && <MarketPulsePanel pulse={pulse} />}

      <div className="flex flex-col xl:flex-row">
        {/* Chart */}
        <div className="min-w-0 flex-1 border-b border-border xl:border-b-0 xl:border-r">
          <PriceChart bars={chart.bars} overlays={chart.overlays} height={480} />
        </div>

        {/* Right rail */}
        <aside className="w-full shrink-0 xl:w-72">
          {score && (
            <div className="border-b border-border">
              <ScorePanel score={score} />
            </div>
          )}

          <Section title="Quote">
            <StatRow label="Prev Close" field={d.prevClose} kind="money" />
            <StatRow label="Gap %" field={d.gapPct} kind="pct" metricKey="gapPct" />
            <StatRow label="Day High" field={d.dayHigh} kind="money" />
            <StatRow label="Day Low" field={d.dayLow} kind="money" />
            <StatRow label="Bid" field={d.bid} kind="money" />
            <StatRow label="Ask" field={d.ask} kind="money" />
            <StatRow label="Spread %" field={d.spreadPct} kind="pct" />
            <StatRow label="Premarket High" field={d.premarketHigh} kind="money" />
            <StatRow label="Halted" field={d.halted} />
          </Section>

          <Section title="Volume">
            <StatRow label="Volume" field={d.volume} kind="shares" />
            <StatRow label="Avg Volume" field={d.avgVolume} kind="shares" />
            <StatRow label="RVOL" field={d.rvol} kind="x" metricKey="rvol" />
            <StatRow label="Dollar Volume" field={d.dollarVolume} kind="big" metricKey="dollarVolume" />
          </Section>

          <Section title="Technicals">
            <StatRow label="VWAP (anchored)" field={d.vwap} kind="money" />
            <StatRow label="VWAP Distance" field={d.vwapDistancePct} kind="pct" metricKey="vwapDistancePct" />
            <StatRow label="EMA 9" field={d.ema9} kind="money" />
            <StatRow label="EMA 20" field={d.ema20} kind="money" />
            <StatRow label="EMA 50" field={d.ema50} kind="money" />
            <StatRow label="EMA State" field={d.emaState} metricKey="emaState" />
            <StatRow label="MACD" field={d.macdState} metricKey="macdState" />
            <StatRow label="RSI 14" field={d.rsi} metricKey="rsi14" />
            <StatRow label="ATR" field={d.atr} kind="money" />
            <StatRow label="ATR %" field={d.atrPct} kind="pct" metricKey="atrPct" />
          </Section>

          <Section title="Company">
            <StatRow label="Sector" field={{ value: d.sector }} />
            <StatRow label="Industry" field={{ value: d.industry }} />
            <StatRow label="Market Cap" field={d.marketCap} kind="big" metricKey="marketCap" />
            <StatRow label="Shares Out" field={d.sharesOutstanding} kind="shares" />
            <StatRow label="Float" field={d.floatShares} kind="shares" metricKey="floatShares" />
            <StatRow label="52w High" field={d.week52High} kind="money" />
            <StatRow label="52w Low" field={d.week52Low} kind="money" />
          </Section>
        </aside>
      </div>

      {/* Bottom: extension, levels, alerts, news */}
      <div className="grid gap-0 border-t border-border md:grid-cols-2 xl:grid-cols-4">
        <Panel title="Extension Risk">
          {d.extension ? (
            <div className="space-y-1 px-2 py-1.5 text-[11px]">
              <div className="flex justify-between">
                <span className="text-ink-faint">ATRs above 9 EMA</span>
                <span className="font-mono">{d.extension.atrExtension.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-faint">% above 9 EMA</span>
                <span className="font-mono">{d.extension.pctAboveEma9.toFixed(2)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-faint">5-bar move</span>
                <span className="font-mono">{d.extension.pct5BarMove.toFixed(2)}%</span>
              </div>
              <p className="pt-1 leading-relaxed text-ink-muted">{d.extension.note}</p>
            </div>
          ) : (
            <Empty>Insufficient history.</Empty>
          )}
        </Panel>

        <Panel title="Risk Calculator">
          <RiskCalculator
            defaultEntry={d.price.value ?? undefined}
            defaultStop={supportBelow?.price ?? (d.price.value && d.atr.value ? Number((d.price.value - d.atr.value).toFixed(2)) : undefined)}
            defaultTarget={resistAbove?.price ?? undefined}
          />
        </Panel>

        <Panel title="Key Levels">
          {d.levels.length === 0 ? (
            <Empty>No repeated pivots identified.</Empty>
          ) : (
            <div className="px-2 py-1.5">
              {d.levels.slice(0, 6).map((l) => (
                <div key={`${l.kind}-${l.price}`} className="flex justify-between py-[2px] text-[11px]">
                  <span className={l.kind === "resistance" ? "text-bear" : "text-bull"}>
                    {l.kind === "resistance" ? "Resistance" : "Support"}
                  </span>
                  <span className="font-mono text-ink">
                    ${l.price.toFixed(2)}
                    <span className="ml-1 text-ink-faint">×{l.touches}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Radar History">
          {alertRows.length === 0 ? (
            <Empty>No radar alerts recorded.</Empty>
          ) : (
            <div className="space-y-1.5 px-2 py-1.5">
              {alertRows.map((a, i) => (
                <div key={i} className="text-[11px]">
                  <div className="flex items-center gap-1.5">
                    <span className={`font-semibold ${a.alert_type === "Breakout" ? "text-bull" : "text-warn"}`}>
                      {a.alert_type}
                    </span>
                    <span className="text-ink-faint">{a.scan_date}</span>
                    {a.strength !== null && <span className="font-mono text-ink-faint">{a.strength}</span>}
                  </div>
                  <p className="leading-snug text-ink-muted">{a.message}</p>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="News / Catalysts">
          {news.length === 0 ? (
            <Empty>
              <span className="flex items-start gap-1.5">
                <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                CATALYST UNKNOWN — no ticker-tagged news returned.
              </span>
            </Empty>
          ) : (
            <div className="space-y-1.5 px-2 py-1.5">
              {news.map((n) => (
                <a
                  key={n.url}
                  href={n.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group block text-[11px]"
                >
                  <div className="flex items-start gap-1">
                    <span className="leading-snug text-ink-muted group-hover:text-brand-glow">{n.headline}</span>
                    <ExternalLink size={10} className="mt-0.5 shrink-0 text-ink-faint" />
                  </div>
                  <div className="text-[10px] text-ink-faint">
                    T{n.tier} · {n.publisher} · {n.publishedAt.slice(0, 10)}
                  </div>
                </a>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="border-t border-border px-3 py-2 text-[10px] text-ink-faint">
        Bar date {d.barDate} · {d.dataQuality.toUpperCase()} data. Conditions and levels are computed
        from price and volume structure — decision support, not financial advice.{" "}
        <Link href="/scanners" className="text-brand-glow hover:underline">
          Back to scanners
        </Link>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-border">
      <div className="bg-bg-card px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
        {title}
      </div>
      <div className="py-0.5">{children}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-border md:border-r">
      <div className="bg-bg-card px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
        {title}
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-2 py-2 text-[11px] text-ink-faint">{children}</div>;
}
