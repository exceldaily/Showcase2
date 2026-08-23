// ─────────────────────────────────────────────────────────
// Terminal data access: universes, scanner presets, running scanners.
// Server-side only (spec §38): scanner math never runs in the browser.
// ─────────────────────────────────────────────────────────

import { loadBars } from "./bars";
import { query } from "./db";
import { buildMetricRow, type TickerRef } from "./metrics";
import { evaluateGroup, fieldsUsed, hardFieldsUsed, type MetricRow, type RuleGroup } from "./scannerRules";
import { FIELD_BY_KEY, availableEntitlements, entitlementReason } from "./fields";
import { computeMetricsFromBars } from "./polygon";
import { scoreSetup } from "./setupScore";
import { polygonCapabilities } from "@/providers/polygonProvider";
import type { ProviderCapabilities } from "@/providers/marketData";

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
  /** HARD rule fields this provider cannot supply — these block the scanner. */
  blockedFields: { field: string; label: string; reason: string }[];
  /** SOFT (preferred) rule fields this provider cannot supply — shown as "unknown", never blocking. */
  unknownSoftFields: { field: string; label: string; reason: string }[];
  universeSize: number;
  evaluated: number;
  ranAt: string;
  dataQuality: string;
}

export interface PresetReadiness {
  ready: boolean;
  blockedHard: { field: string; label: string; reason: string }[];
  unknownSoft: { field: string; label: string; reason: string }[];
}

/** Can this preset actually run on the given plan? Pure, no data needed. */
export function presetReadiness(rules: RuleGroup, caps: ProviderCapabilities): PresetReadiness {
  const ents = availableEntitlements(caps);
  const hard = new Set(hardFieldsUsed(rules));
  const describe = (f: string) => {
    const def = FIELD_BY_KEY.get(f);
    return def && !ents.has(def.requires)
      ? { field: def.key, label: def.label, reason: entitlementReason(def.requires) }
      : null;
  };
  const blockedHard = Array.from(hard).map(describe).filter((x): x is NonNullable<typeof x> => x !== null);
  const unknownSoft = fieldsUsed(rules)
    .filter((f) => !hard.has(f))
    .map(describe)
    .filter((x): x is NonNullable<typeof x> => x !== null);
  return { ready: blockedHard.length === 0, blockedHard, unknownSoft };
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

  // Entitlement check: hard rules block, soft rules become "unknown".
  const readiness = presetReadiness(preset.rules, caps);
  const blockedFields = readiness.blockedHard;
  const unknownSoftFields = readiness.unknownSoft;

  // Latest sector strength, for the setup score's sector component.
  const sectorRows = await query<{ sector: string; score: string }>(
    `select sector, score from sector_strength_daily
     where date = (select max(date) from sector_strength_daily)`
  );
  const sectorScoreByName = new Map(sectorRows.map((r) => [r.sector, Number(r.score)]));

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
    if (!res.pass) continue;

    // Transparent setup score for matched rows only (cheap enough: the
    // match set is small, the universe is not).
    const score = scoreSetup({
      metrics: computeMetricsFromBars(ref.symbol, bars),
      bars,
      sectorScore: ref.sector ? sectorScoreByName.get(ref.sector) : undefined,
      caps: { intraday: caps.intraday, floatData: caps.floatData, news: caps.news },
      floatShares: ref.float_shares ?? null,
      catalystFound: null, // per-row news lookups are Phase 4 work
    });

    rows.push({
      ...row,
      setupScore: score.total,
      setupGrade: score.grade,
      criteriaMet: res.criteriaMet,
      criteriaTotal: res.criteriaTotal,
      criteriaUnknown: res.criteriaUnknown,
      criteria:
        res.criteriaUnknown > 0
          ? `${res.criteriaMet}/${res.criteriaTotal} · ${res.criteriaUnknown} unknown`
          : `${res.criteriaMet}/${res.criteriaTotal}`,
      _explain: JSON.stringify(res.explain),
    });
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
    unknownSoftFields,
    universeSize: refs.length,
    evaluated,
    ranAt: new Date().toISOString(),
    dataQuality: caps.quality,
  };
}
