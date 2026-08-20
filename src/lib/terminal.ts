// ─────────────────────────────────────────────────────────
// Terminal data access: universes, scanner presets, running scanners.
// Server-side only (spec §38): scanner math never runs in the browser.
// ─────────────────────────────────────────────────────────

import { loadBars } from "./bars";
import { query } from "./db";
import { buildMetricRow, type TickerRef } from "./metrics";
import { evaluateGroup, fieldsUsed, type MetricRow, type RuleGroup } from "./scannerRules";
import { FIELD_BY_KEY, availableEntitlements, entitlementReason } from "./fields";
import { polygonCapabilities } from "@/providers/polygonProvider";

export interface UniverseRow {
  slug: string;
  name: string;
  min_price: string;
  max_price: string | null;
  min_dollar_volume: string;
  description: string | null;
}

export interface PresetRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  universe_slug: string | null;
  rules: RuleGroup;
  columns: string[];
  sort_field: string | null;
  sort_dir: string | null;
  is_enabled: boolean;
}

export async function getUniverses(): Promise<UniverseRow[]> {
  return query<UniverseRow>(
    `select slug, name, min_price, max_price, min_dollar_volume, description
     from universes order by min_price asc`
  );
}

export async function getPresets(): Promise<PresetRow[]> {
  return query<PresetRow>(
    `select id, slug, name, description, universe_slug, rules, columns,
            sort_field, sort_dir, is_enabled
     from scanner_presets where is_enabled = true order by name`
  );
}

export async function getPreset(slug: string): Promise<PresetRow | null> {
  const rows = await query<PresetRow>(
    `select id, slug, name, description, universe_slug, rules, columns,
            sort_field, sort_dir, is_enabled
     from scanner_presets where slug = $1 limit 1`,
    [slug]
  );
  return rows[0] ?? null;
}

export interface ScannerRunResult {
  preset: PresetRow;
  rows: MetricRow[];
  /** Fields the scanner uses that this provider cannot supply. */
  blockedFields: { field: string; label: string; reason: string }[];
  universeSize: number;
  evaluated: number;
  ranAt: string;
  dataQuality: string;
}

/**
 * Run one scanner preset over its universe using cached bars.
 * Honest by construction: if a rule references a field the provider
 * cannot supply, we report it as blocked rather than returning matches
 * that silently ignored the filter.
 */
export async function runScannerPreset(slug: string, limit = 100): Promise<ScannerRunResult | null> {
  const preset = await getPreset(slug);
  if (!preset) return null;

  const caps = polygonCapabilities();
  const ents = availableEntitlements(caps);

  // Entitlement check on the rules.
  const blockedFields = fieldsUsed(preset.rules)
    .map((f) => FIELD_BY_KEY.get(f))
    .filter((def): def is NonNullable<typeof def> => Boolean(def))
    .filter((def) => !ents.has(def.requires))
    .map((def) => ({ field: def.key, label: def.label, reason: entitlementReason(def.requires) }));

  // Universe bounds.
  const uni = preset.universe_slug
    ? (await query<UniverseRow>(
        `select slug, name, min_price, max_price, min_dollar_volume, description
         from universes where slug = $1 limit 1`,
        [preset.universe_slug]
      ))[0]
    : undefined;
  const minPrice = uni ? Number(uni.min_price) : 0.25;
  const maxPrice = uni?.max_price ? Number(uni.max_price) : null;
  const minDollarVol = uni ? Number(uni.min_dollar_volume) : 250_000;

  const refs = await query<TickerRef>(
    `select symbol, company_name, sector, industry, exchange, market_cap, shares_outstanding, float_shares
     from tickers where coalesce(is_active, true) = true`
  );
  const barsMap = await loadBars(refs.map((r) => r.symbol), 220);

  const rows: MetricRow[] = [];
  let evaluated = 0;

  for (const ref of refs) {
    const bars = barsMap.get(ref.symbol);
    if (!bars) continue;
    const row = buildMetricRow(ref, bars, {
      intraday: caps.intraday,
      quotes: caps.quotes,
      floatData: caps.floatData,
      halts: caps.halts,
    });
    if (!row) continue;

    // Universe gate.
    const price = Number(row.price ?? 0);
    const dv = Number(row.dollarVolume ?? 0);
    if (price < minPrice) continue;
    if (maxPrice !== null && price > maxPrice) continue;
    if (dv < minDollarVol) continue;

    evaluated++;
    const res = evaluateGroup(preset.rules, row);
    if (res.pass) rows.push({ ...row, _explain: JSON.stringify(res.explain) });
  }

  // Sort by the preset's field.
  const sortField = preset.sort_field ?? "rvol";
  const dir = (preset.sort_dir ?? "desc") === "asc" ? 1 : -1;
  rows.sort((a, b) => {
    const av = Number(a[sortField] ?? -Infinity);
    const bv = Number(b[sortField] ?? -Infinity);
    return (av - bv) * dir;
  });

  return {
    preset,
    rows: rows.slice(0, limit),
    blockedFields,
    universeSize: refs.length,
    evaluated,
    ranAt: new Date().toISOString(),
    dataQuality: caps.quality,
  };
}
