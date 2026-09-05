// Siren sweep: evaluates the alert rules across the megacap universe
// plus the user's alert watchlist, dedupes per symbol/kind/session,
// emails (when configured) and records events for the on-page siren.
//
// Meant to be hit once a minute by an external scheduler during
// market hours. Bearer CRON_SECRET bypasses throttles; unauthenticated
// calls are allowed but throttled (50s cooldown, 500 runs/day) and
// only run while the market is open, so the URL cannot be abused into
// burning market-data quota.

import { NextResponse } from "next/server";
import { hasDatabase, query } from "@/lib/db";
import { etStamp } from "@/lib/intraday";
import { scanOptionsUniverse, MEGACAPS } from "@/lib/optionsScan";
import { buildOptionsAnalysis } from "@/lib/optionsTerminal";
import { evaluateSiren } from "@/lib/sirenRules";
import { emailConfigured, sendAlertEmail } from "@/lib/alertsEmail";
import { getClock, hasAlpacaKeys } from "@/providers/alpaca";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!hasDatabase() || !hasAlpacaKeys()) {
    return NextResponse.json({ error: "database or Alpaca not configured" }, { status: 503 });
  }
  const secret = process.env.CRON_SECRET;
  const authed = !!secret && request.headers.get("authorization") === `Bearer ${secret}`;
  const force = authed && new URL(request.url).searchParams.get("force") === "1";

  if (!authed) {
    const [gate] = await query<{ recent: number; today: number }>(
      `select
         count(*) filter (where ran_at > now() - interval '50 seconds')::int as recent,
         count(*) filter (where ran_at > date_trunc('day', now()))::int as today
       from alert_runs`
    );
    if (gate && gate.recent > 0) return NextResponse.json({ throttled: true, reason: "cooldown" }, { status: 429 });
    if (gate && gate.today >= 500) return NextResponse.json({ throttled: true, reason: "daily cap" }, { status: 429 });
  }

  const clock = await getClock().catch(() => null);
  if (!clock?.is_open && !force) {
    await query(`insert into alert_runs (symbols, fired, note) values (0, 0, 'market closed')`);
    return NextResponse.json({ ok: true, skipped: "market closed", fired: 0 });
  }

  const watch = await query<{ symbol: string }>(`select symbol from alert_watch`);
  const symbols = Array.from(new Set([...MEGACAPS, ...watch.map((w) => w.symbol)]));
  const sessionDate = etStamp(Date.now()).date;
  const profile = process.env.ALERT_PROFILE ?? "DAY";

  // Cheap pass over everything, full pipeline on the most active 12;
  // watchlist symbols always get the full pipeline.
  const scan = await scanOptionsUniverse("custom", symbols, 12, profile);
  const analyzed = new Set(scan.rows.filter((r) => r.analyzed).map((r) => r.symbol));
  const extra = watch.map((w) => w.symbol).filter((s) => !analyzed.has(s)).slice(0, 8);

  const fired: { symbol: string; title: string; emailed: boolean }[] = [];
  const candidates = [...Array.from(analyzed), ...extra];
  for (let i = 0; i < candidates.length; i += 4) {
    await Promise.all(
      candidates.slice(i, i + 4).map(async (sym) => {
        try {
          const a = await buildOptionsAnalysis(sym, { profile });
          const alert = evaluateSiren(a, sessionDate);
          if (!alert) return;
          const inserted = await query<{ id: string }>(
            `insert into siren_events (dedupe_key, symbol, kind, direction, urgency, title, body, contract, opportunity)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             on conflict (dedupe_key) do nothing
             returning id`,
            [alert.dedupeKey, alert.symbol, alert.kind, alert.direction, alert.urgency, alert.title, alert.body, alert.contract, alert.opportunity]
          );
          if (!inserted.length) return; // already alerted this session
          let emailed = false;
          if (emailConfigured()) {
            const r = await sendAlertEmail(`🚨 ${alert.title}`, `${alert.body}\n\nOpen: https://www.thisistemporary.us/options?s=${alert.symbol}\n\nDecision support only. Not financial advice.`);
            emailed = r.sent;
            await query(`update siren_events set emailed = $2, email_error = $3 where id = $1`, [inserted[0].id, r.sent, r.sent ? null : (r.reason ?? null)]);
          }
          fired.push({ symbol: alert.symbol, title: alert.title, emailed });
        } catch {
          /* one symbol failing must not stop the sweep */
        }
      })
    );
  }

  await query(`insert into alert_runs (symbols, fired, note) values ($1, $2, $3)`, [candidates.length, fired.length, emailConfigured() ? "email on" : "email not configured"]);
  return NextResponse.json({ ok: true, evaluated: candidates.length, fired, emailConfigured: emailConfigured() });
}
