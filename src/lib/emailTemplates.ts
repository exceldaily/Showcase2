// ─────────────────────────────────────────────────────────
// HTML email templates (table-based, inline styles, light theme so they
// render in Gmail/Apple Mail/Outlook). Every template also produces a
// plain-text twin. Pure functions, no IO.
// ─────────────────────────────────────────────────────────

import type { MorningWatch, WatchPick } from "./morningWatch";
import type { SirenAlert } from "./sirenRules";
import type { Outcome } from "./strikeCoach";

export const SITE = process.env.SITE_URL ?? "https://www.thisistemporary.us";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const $ = (n: number) => `$${n.toFixed(2)}`;
const pctStr = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

const C = {
  ink: "#0f172a", muted: "#64748b", faint: "#94a3b8", border: "#e2e8f0", bg: "#f1f5f9", card: "#ffffff",
  bull: "#16a34a", bullBg: "#dcfce7", bear: "#dc2626", bearBg: "#fee2e2", warn: "#d97706", warnBg: "#fef3c7",
  brand: "#2563eb", brandDark: "#1d4ed8",
};
const FONT = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";
const MONO = "font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;";

/** Days from an ET date (YYYY-MM-DD) to an expiry (YYYY-MM-DD). */
export function daysBetween(fromDay: string, toDay: string): number {
  const [y1, m1, d1] = fromDay.split("-").map(Number);
  const [y2, m2, d2] = toDay.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400e3);
}

export function expiryLabel(expiry: string, dte: number): string {
  if (dte <= 0) return "expires TODAY (0DTE)";
  if (dte === 1) return `expires tomorrow (${expiry.slice(5)})`;
  return `expires ${expiry.slice(5)} (${dte} days)`;
}

function pill(text: string, fg: string, bg: string): string {
  return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.3px;color:${fg};background:${bg};${FONT}">${esc(text)}</span>`;
}

function button(text: string, href: string, primary = true): string {
  const style = primary
    ? `background:${C.brand};color:#ffffff;border:1px solid ${C.brandDark};`
    : `background:#ffffff;color:${C.ink};border:1px solid ${C.border};`;
  return `<a href="${esc(href)}" style="display:inline-block;padding:9px 14px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;${style}${FONT}">${esc(text)}</a>`;
}

function statCell(label: string, value: string, color = C.ink): string {
  return `<td style="padding:8px 10px;border:1px solid ${C.border};border-radius:8px;background:#f8fafc;vertical-align:top;">
    <div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:${C.faint};${FONT}">${esc(label)}</div>
    <div style="font-size:14px;font-weight:700;color:${color};${MONO}">${esc(value)}</div>
  </td>`;
}

/** Some mail clients ignore the declared charset; numeric entities survive everything. */
export function asciiSafe(html: string): string {
  return html.replace(/[^\x00-\x7f]/g, (ch) => `&#${ch.codePointAt(0)};`);
}

/** Page shell: header bar, content, disclaimer. Output is pure ASCII (entities for anything else). */
export function shell(opts: { title: string; subtitle?: string; accent?: string; body: string; preheader?: string }): string {
  const accent = opts.accent ?? C.ink;
  return asciiSafe(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(opts.title)}</title></head><body style="margin:0;padding:0;background:${C.bg};">
${opts.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(opts.preheader)}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};padding:20px 0;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
  <tr><td style="background:${accent};border-radius:12px 12px 0 0;padding:16px 20px;">
    <div style="font-size:13px;font-weight:700;color:#ffffff;opacity:.85;letter-spacing:.5px;${FONT}">ALPHAFORGE</div>
    <div style="font-size:20px;font-weight:800;color:#ffffff;margin-top:2px;${FONT}">${esc(opts.title)}</div>
    ${opts.subtitle ? `<div style="font-size:13px;color:#ffffff;opacity:.8;margin-top:2px;${FONT}">${esc(opts.subtitle)}</div>` : ""}
  </td></tr>
  <tr><td style="background:${C.card};padding:18px 20px;border:1px solid ${C.border};border-top:0;border-radius:0 0 12px 12px;">
    ${opts.body}
    <div style="margin-top:18px;padding-top:12px;border-top:1px solid ${C.border};font-size:11px;line-height:1.5;color:${C.faint};${FONT}">
      Decision support, not financial advice. Nothing is placed automatically. Same-day options lose value fast; size small and respect the wrong line.
    </div>
  </td></tr>
</table>
</td></tr></table></body></html>`);
}

/** Fallback for plain-text notices (account alerts etc.): paragraphs inside the shell. */
export function plainHtml(title: string, text: string): string {
  const paras = text.split(/\n{2,}/).map((p) => `<p style="margin:0 0 10px;font-size:14px;line-height:1.55;color:${C.ink};${FONT}">${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  return shell({ title, body: paras });
}

// ── Morning watch ──

function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function outcomeRow(label: string, o: Outcome | null, cost: number | null): string {
  if (!o || cost === null) return "";
  const tone = o.pct >= 0 ? C.bull : C.bear;
  return `<tr>
    <td style="padding:6px 10px;border-top:1px solid ${C.border};font-size:13px;color:${C.ink};${FONT}">${esc(label)}</td>
    <td style="padding:6px 10px;border-top:1px solid ${C.border};text-align:right;font-size:13px;color:${C.ink};${MONO}">about ${money(o.value * 100)}</td>
    <td style="padding:6px 10px;border-top:1px solid ${C.border};text-align:right;font-size:13px;font-weight:700;color:${tone};${MONO}">${o.pct >= 0 ? "+" : ""}${o.pct}%</td>
  </tr>`;
}

function step(n: number, html: string): string {
  return `<tr>
    <td style="width:28px;padding:6px 8px 6px 0;vertical-align:top;">
      <span style="display:inline-block;width:22px;height:22px;line-height:22px;border-radius:999px;background:${C.ink};color:#ffffff;text-align:center;font-size:12px;font-weight:800;${FONT}">${n}</span>
    </td>
    <td style="padding:6px 0;font-size:14px;line-height:1.5;color:${C.ink};${FONT}">${html}</td>
  </tr>`;
}

function strikeTable(p: WatchPick): string {
  if (p.choices.length < 2) return "";
  const cell = (s: string, extra = "") => `<td style="padding:5px 8px;border-top:1px solid ${C.border};font-size:12px;${extra}${MONO}">${s}</td>`;
  const pctCell = (o: Outcome | null) => o === null ? cell("-", `color:${C.faint};`) : cell(`${o.pct >= 0 ? "+" : ""}${o.pct}%`, `text-align:right;color:${o.pct >= 0 ? C.bull : C.bear};`);
  const head = (s: string, right = false) => `<th style="padding:4px 8px;text-align:${right ? "right" : "left"};font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:${C.faint};${FONT}">${s}</th>`;
  const rows = p.choices.map((ch) => `<tr style="${ch.label === "Recommended" ? "background:#f8fafc;" : ""}">
      ${cell(`${ch.strike}${p.play.side === "call" ? "C" : "P"} <span style="font-size:10px;color:${C.faint};${FONT}">${ch.label.toLowerCase()}</span>`)}
      ${cell(money(ch.perContract), "text-align:right;")}
      ${pctCell(ch.atTarget)}
      ${pctCell(ch.atTargetClose)}
      ${pctCell(ch.atWrong)}
      ${pctCell(ch.flatHour)}
    </tr>`).join("");
  return `<div style="margin-top:14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:${C.muted};${FONT}">Which strike?</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:4px;border:1px solid ${C.border};border-radius:8px;overflow:hidden;">
    <tr>${head("Strike")}${head("Cost", true)}${head("Hits target", true)}${head("At close", true)}${head("Wrong", true)}${head("Sits 1h", true)}</tr>
    ${rows}
  </table>
  ${p.verdict ? `<div style="margin-top:6px;font-size:12px;line-height:1.5;color:${C.muted};${FONT}">${esc(p.verdict)}</div>` : ""}`;
}

function pickCard(p: WatchPick, day: string): string {
  const up = p.gapPct >= 0;
  const lean = p.bias === "calls" ? pill("LEAN CALLS", C.bull, C.bullBg) : p.bias === "puts" ? pill("LEAN PUTS", C.bear, C.bearBg) : pill("EITHER WAY", C.warn, C.warnBg);
  const pl = p.play;
  const call = pl.side === "call";
  const above = call ? "above" : "below";
  const back = call ? "back under" : "back over";
  const dte = pl.expiry ? daysBetween(day, pl.expiry) : null;
  const expiryNote = dte === null ? "" : dte <= 0 ? "expires today" : dte === 1 ? "expires tomorrow" : `expires ${pl.expiry!.slice(5)}, no same-day contract for this name today`;

  const s1 = pl.watch !== null
    ? `<b>Watch ${$(pl.watch)}.</b> Nothing to buy until a 5-minute candle closes ${above} it with volume.`
    : `<b>No clean trigger yet.</b> Let the first 15 minutes draw the levels, then look for a 5-minute close ${above} the nearest one with volume.`;
  const s2 = pl.buyLabel
    ? `<b>Then buy 1 ${esc(pl.buyLabel)}</b> (${expiryNote}). About <b>${money(pl.perContract ?? 0)}</b> per contract. That is the most you can lose.`
    : `<b>Then buy the ${call ? "call" : "put"} the terminal recommends</b> (open the link below).`;
  const s3 = pl.sellAt !== null
    ? `<b>Sell at ${$(pl.sellAt)}.</b>${pl.getOutAt !== null ? ` Get out if a 5-minute candle closes ${back} ${$(pl.getOutAt)}.` : ""}`
    : `<b>Sell at the first target the terminal shows.</b> Get out if price closes back through the level.`;

  const outcomes = pl.perContract !== null && (pl.atTarget || pl.atWrong || pl.flatHour)
    ? `<div style="margin-top:14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:${C.muted};${FONT}">What 1 contract (${money(pl.perContract)}) could do</div>
       <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:4px;border:1px solid ${C.border};border-radius:8px;overflow:hidden;">
         ${outcomeRow(pl.sellAt !== null ? `Reaches ${$(pl.sellAt)} soon` : "Reaches the target soon", pl.atTarget, pl.perContract)}
         ${outcomeRow(pl.getOutAt !== null ? `Breaks to ${$(pl.getOutAt)} (wrong)` : "Goes the wrong way", pl.atWrong, pl.perContract)}
         ${outcomeRow("Sits still for an hour", pl.flatHour, pl.perContract)}
       </table>
       <div style="margin-top:4px;font-size:11px;color:${C.faint};${FONT}">Model estimates using today's implied volatility. Real fills differ.</div>`
    : "";

  const why = p.why.slice(0, 3).map((w) => `<li style="margin:0 0 3px;">${esc(w)}</li>`).join("");
  return `<div style="margin-top:16px;padding:16px;border:1px solid ${C.border};border-radius:12px;background:${C.card};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align:middle;">
        <span style="font-size:11px;font-weight:700;color:${C.faint};${FONT}">#${p.rank}</span>
        <span style="font-size:26px;font-weight:800;color:${C.ink};margin-left:6px;${MONO}">${esc(p.symbol)}</span>
        <span style="font-size:15px;color:${C.muted};margin-left:8px;${MONO}">${$(p.price)}</span>
        <span style="font-size:15px;font-weight:700;color:${up ? C.bull : C.bear};margin-left:6px;${MONO}">${pctStr(p.gapPct)}</span>
      </td>
      <td align="right" style="vertical-align:middle;">${lean}</td>
    </tr></table>
    <div style="margin-top:12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:${C.muted};${FONT}">The play, 3 steps</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:2px;">${step(1, s1)}${step(2, s2)}${step(3, s3)}</table>
    ${outcomes}
    ${strikeTable(p)}
    <div style="margin-top:14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:${C.muted};${FONT}">Why it made the list</div>
    <ul style="margin:4px 0 0;padding-left:18px;font-size:13px;line-height:1.5;color:${C.ink};${FONT}">${why}</ul>
    <div style="margin-top:14px;">${button(`Open ${p.symbol} in AlphaForge`, `${SITE}/options?s=${p.symbol}`)} ${button("Robinhood chain", `https://robinhood.com/options/chains/${p.symbol}`, false)}</div>
  </div>`;
}

export function morningWatchEmail(w: MorningWatch, lockedLabel: string): { subject: string; text: string; html: string } {
  const names = w.picks.map((p) => `${p.symbol} (${p.bias})`).join(", ") || "no clear pick";
  const subject = `Morning watch ${w.day}: ${names}`;
  const intro = `<p style="margin:0;font-size:14px;line-height:1.55;color:${C.ink};${FONT}">Your top ${w.picks.length} into the open. Each one is the same 3-step play: watch a level, buy only after it breaks, sell at the target or get out at the wrong line. Calls come first because that is what you trade.</p>`;
  const cards = w.picks.map((p) => pickCard(p, w.day)).join("");
  const notes = w.notes.length ? `<div style="margin-top:12px;font-size:12px;line-height:1.5;color:${C.muted};${FONT}">${w.notes.map(esc).join("<br>")}</div>` : "";
  const html = shell({ title: "Morning watch", subtitle: `${w.day}, ${lockedLabel}`, body: intro + cards + notes, preheader: names });

  const lines: string[] = [`Morning watch for ${w.day} (${lockedLabel}).`, ""];
  for (const p of w.picks) {
    const pl = p.play;
    lines.push(`#${p.rank} ${p.symbol}  ${$(p.price)}  ${pctStr(p.gapPct)}  lean: ${p.bias.toUpperCase()}`);
    lines.push(`  1. ${pl.watch !== null ? `Watch ${$(pl.watch)}. Nothing to buy until a 5-minute candle closes ${pl.side === "call" ? "above" : "below"} it with volume.` : "No clean trigger yet; let the first 15 minutes draw the levels."}`);
    if (pl.buyLabel) lines.push(`  2. Then buy 1 ${pl.buyLabel} (${pl.expiry ? expiryLabel(pl.expiry, daysBetween(w.day, pl.expiry)) : ""}), about $${pl.perContract} per contract.`);
    if (pl.sellAt !== null) lines.push(`  3. Sell at ${$(pl.sellAt)}.${pl.getOutAt !== null ? ` Get out if it closes ${pl.side === "call" ? "back under" : "back over"} ${$(pl.getOutAt)}.` : ""}`);
    if (pl.atTarget) lines.push(`  If it reaches the target soon: about $${Math.round(pl.atTarget.value * 100)} (${pl.atTarget.pct >= 0 ? "+" : ""}${pl.atTarget.pct}%).`);
    if (pl.atWrong) lines.push(`  If it breaks the wrong way: about $${Math.round(pl.atWrong.value * 100)} (${pl.atWrong.pct}%).`);
    if (p.verdict) lines.push(`  Which strike? ${p.verdict}`);
    for (const l of p.why.slice(0, 3)) lines.push(`  - ${l}`);
    lines.push(`  Open: ${SITE}/options?s=${p.symbol}`, "");
  }
  for (const n of w.notes) lines.push(`Note: ${n}`);
  lines.push("", "Decision support, not financial advice. Wait for the close through the trigger with volume, and respect the wrong line.");
  return { subject, text: lines.join("\n"), html };
}

// ── Siren ──


export function sirenEmail(a: SirenAlert): { subject: string; text: string; html: string } {
  const f = a.facts;
  const long = a.direction === "long";
  const accent = a.urgency === "high" ? (long ? "#15803d" : "#b91c1c") : "#b45309";
  const kindLabel = a.kind === "BREAK_CONFIRMED" ? (long ? "Breakout confirmed" : "Breakdown confirmed") : a.kind === "RETEST_HELD" ? "Retest held" : "Trend surge";
  const ticket = a.contract ? `&ticket=${a.contract}` : "";
  const openUrl = `${SITE}/options?s=${a.symbol}${ticket}`;
  const rhUrl = `https://robinhood.com/options/chains/${a.symbol}`;

  const surge = a.kind === "TREND_SURGE";
  const banner = surge
    ? `<div style="margin:0 0 10px;padding:8px 12px;border-radius:8px;background:${C.warnBg};color:${C.warn};font-size:13px;font-weight:700;${FONT}">HEADS UP ONLY. Not a buy yet: the level has not broken. A separate BREAKOUT alert fires when a 5-minute candle closes through it with volume.</div>`
    : "";
  const head = banner + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td><span style="font-size:28px;font-weight:800;color:${C.ink};${MONO}">${esc(a.symbol)}</span>
        ${f ? `<span style="font-size:16px;color:${C.muted};margin-left:8px;${MONO}">${$(f.price)}</span>` : ""}</td>
    <td align="right">${pill(long ? "CALLS" : "PUTS", long ? C.bull : C.bear, long ? C.bullBg : C.bearBg)} ${pill(a.urgency === "high" ? "ACT NOW" : "HEADS UP", a.urgency === "high" ? "#ffffff" : C.warn, a.urgency === "high" ? accent : C.warnBg)}</td>
  </tr></table>
  <p style="margin:8px 0 0;font-size:14px;line-height:1.5;color:${C.ink};${FONT}">${esc(a.summary)}</p>`;

  const stats = f ? `<table role="presentation" cellpadding="0" cellspacing="6" style="margin:8px -6px 0;"><tr>
      ${statCell("Volume", `${f.rvol.toFixed(2)}x normal`, f.rvol >= 1.5 ? C.bull : C.ink)}
      ${statCell("Trend", f.trend ?? "?")}
      ${statCell("Setup score", f.opportunity !== null ? `${f.opportunity}/100` : "?")}
      ${statCell("Status", f.state ?? "WATCHING")}
    </tr></table>` : "";

  const plan = f?.plan ? `<table role="presentation" cellpadding="0" cellspacing="6" style="margin:2px -6px 0;"><tr>
      ${statCell(long ? "Broke above" : "Broke below", $(f.plan.trigger), long ? C.bull : C.bear)}
      ${statCell(long ? "Wrong below" : "Wrong above", $(f.plan.invalidation), C.bear)}
      ${statCell("First target", $(f.plan.t1), C.brand)}
    </tr></table>` : "";

  const contract = f?.best ? `<div style="margin-top:10px;padding:10px 12px;border:1px solid ${long ? C.bull : C.bear};border-left:4px solid ${long ? C.bull : C.bear};border-radius:8px;background:${long ? "#f0fdf4" : "#fef2f2"};${FONT}">
      <div style="font-size:14px;font-weight:700;color:${C.ink};">Best ${long ? "call" : "put"}: <span style="${MONO}">${esc(f.best.label)}</span> <span style="font-weight:600;color:${f.best.dte <= 0 ? C.bull : C.muted};">${esc(expiryLabel(f.best.expiry, f.best.dte))}</span></div>
      <div style="font-size:12px;color:${C.muted};margin-top:2px;">About ${$(f.best.mid)} per share (${$(f.best.mid * 100)} per contract), contract score ${f.best.score}/100${f.best.dte > 0 ? ", no same-day expiry for this name today" : ""}</div>
    </div>` : "";

  const card = a.orderCard ? `<div style="margin-top:12px;border:1px solid ${C.border};border-radius:10px;overflow:hidden;${FONT}">
      <div style="padding:8px 12px;background:#f8fafc;font-size:11px;font-weight:700;letter-spacing:.5px;color:${C.muted};">ORDER CARD (type these into the ticket)</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:${C.ink};">
        <tr><td style="padding:8px 12px;border-top:1px solid ${C.border};">Buy</td><td style="padding:8px 12px;border-top:1px solid ${C.border};text-align:right;${MONO}">${a.orderCard.qty} x ${esc(a.orderCard.label)}, limit ${$(a.orderCard.limit)}</td></tr>
        <tr><td style="padding:8px 12px;border-top:1px solid ${C.border};">Stop-limit sell</td><td style="padding:8px 12px;border-top:1px solid ${C.border};text-align:right;${MONO}">trigger ${$(a.orderCard.stopTrigger)}, limit ${$(a.orderCard.stopLimit)}</td></tr>
        <tr><td style="padding:8px 12px;border-top:1px solid ${C.border};">Target sell</td><td style="padding:8px 12px;border-top:1px solid ${C.border};text-align:right;${MONO}">${$(a.orderCard.target)}</td></tr>
      </table>
      <div style="padding:8px 12px;border-top:1px solid ${C.border};font-size:11px;line-height:1.4;color:${C.faint};">${esc(a.orderCard.note)}</div>
    </div>` : "";

  const buttons = `<div style="margin-top:14px;">${button(a.contract && !surge ? "Open prefilled paper ticket" : "Open in AlphaForge", openUrl)} ${surge ? "" : button("Robinhood chain", rhUrl, false)}</div>`;
  const html = shell({ title: `Siren: ${kindLabel}`, subtitle: a.title, accent, body: head + stats + plan + contract + card + buttons, preheader: a.summary });
  const text = `${a.body}\n\nReview + paper ticket (prefilled): ${openUrl}\nRobinhood chain: ${rhUrl}\n\nYou decide. Nothing is placed automatically. Decision support only, not financial advice.`;
  return { subject: `SIREN: ${a.title}`, text, html };
}
