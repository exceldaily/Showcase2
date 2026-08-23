// ─────────────────────────────────────────────────────────
// Scanner rule engine (spec §19, §20).
// Rules are data (JSON), not code: AND/OR groups of {field, op, value}
// evaluated server-side against a computed metric snapshot. Pure and
// unit-tested; the Scanner Builder emits exactly this shape.
//
// Missing data is NEVER treated as a pass. A rule on a field the
// provider cannot supply fails closed and is reported, so a scanner
// can't silently "match everything" (spec §51).
// ─────────────────────────────────────────────────────────

import { FIELD_BY_KEY, type Operator } from "./fields";

export interface Condition {
  field: string;
  op: Operator;
  value?: number | string | boolean;
  /** Second bound for `between`. */
  value2?: number;
  /** Value list for `in`. */
  values?: (string | number)[];
  /**
   * Preferred-but-not-required (spec §20 "Catalyst: Preferred but not
   * required"). Soft conditions never gate the match; they are counted
   * so the row can show "3/5 criteria met, 2 unknown". Unknown (missing
   * data) is reported as unknown — never silently counted as met or
   * failed.
   */
  soft?: boolean;
}

export interface RuleGroup {
  logic: "AND" | "OR";
  conditions: Condition[];
  /** Optional nested groups for mixed logic. */
  groups?: RuleGroup[];
}

/** Any metric snapshot; unknown keys resolve to undefined (fail closed). */
export type MetricRow = Record<string, number | string | boolean | null | undefined>;

export interface EvalResult {
  pass: boolean;
  /** Conditions that failed because the data was missing, not because the value lost. */
  missingFields: string[];
  /** Human-readable per-condition outcome for the "WHY?" panel (spec §44). */
  explain: { field: string; label: string; op: Operator; expected: string; actual: string; pass: boolean; soft: boolean; unknown: boolean }[];
  /** Criteria tally across ALL conditions (hard + soft): met / total / unknown. */
  criteriaMet: number;
  criteriaTotal: number;
  criteriaUnknown: number;
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "n/a";
  if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString() : v.toFixed(2);
  return String(v);
}

function expectedText(c: Condition): string {
  switch (c.op) {
    case "gt": return `> ${fmt(c.value)}`;
    case "gte": return `>= ${fmt(c.value)}`;
    case "lt": return `< ${fmt(c.value)}`;
    case "lte": return `<= ${fmt(c.value)}`;
    case "eq": return `= ${fmt(c.value)}`;
    case "neq": return `!= ${fmt(c.value)}`;
    case "between": return `${fmt(c.value)} to ${fmt(c.value2)}`;
    case "in": return `in [${(c.values ?? []).map(fmt).join(", ")}]`;
    case "isTrue": return "is true";
    case "isFalse": return "is false";
  }
}

export function evaluateCondition(c: Condition, row: MetricRow): { pass: boolean; missing: boolean; actual: unknown } {
  const actual = row[c.field];
  if (actual === undefined || actual === null) {
    return { pass: false, missing: true, actual }; // fail closed
  }

  const num = typeof actual === "number" ? actual : Number(actual);
  const cmpNum = typeof c.value === "number" ? c.value : Number(c.value);

  switch (c.op) {
    case "gt": return { pass: num > cmpNum, missing: false, actual };
    case "gte": return { pass: num >= cmpNum, missing: false, actual };
    case "lt": return { pass: num < cmpNum, missing: false, actual };
    case "lte": return { pass: num <= cmpNum, missing: false, actual };
    case "between": {
      const hi = Number(c.value2);
      return { pass: num >= cmpNum && num <= hi, missing: false, actual };
    }
    case "eq": return { pass: String(actual) === String(c.value), missing: false, actual };
    case "neq": return { pass: String(actual) !== String(c.value), missing: false, actual };
    case "in": return { pass: (c.values ?? []).map(String).includes(String(actual)), missing: false, actual };
    case "isTrue": return { pass: actual === true, missing: false, actual };
    case "isFalse": return { pass: actual === false, missing: false, actual };
    default: return { pass: false, missing: false, actual };
  }
}

export function evaluateGroup(group: RuleGroup, row: MetricRow): EvalResult {
  const explain: EvalResult["explain"] = [];
  const missingFields: string[] = [];
  const hardResults: boolean[] = [];
  let criteriaMet = 0;
  let criteriaTotal = 0;
  let criteriaUnknown = 0;

  for (const c of group.conditions) {
    const { pass, missing, actual } = evaluateCondition(c, row);
    if (missing) missingFields.push(c.field);
    // Soft conditions are tallied but never gate the match.
    if (!c.soft) hardResults.push(pass);
    criteriaTotal++;
    if (missing) criteriaUnknown++;
    else if (pass) criteriaMet++;
    explain.push({
      field: c.field,
      label: FIELD_BY_KEY.get(c.field)?.label ?? c.field,
      op: c.op,
      expected: expectedText(c),
      actual: fmt(actual),
      pass,
      soft: Boolean(c.soft),
      unknown: missing,
    });
  }

  for (const g of group.groups ?? []) {
    const sub = evaluateGroup(g, row);
    hardResults.push(sub.pass);
    missingFields.push(...sub.missingFields);
    explain.push(...sub.explain);
    criteriaMet += sub.criteriaMet;
    criteriaTotal += sub.criteriaTotal;
    criteriaUnknown += sub.criteriaUnknown;
  }

  const pass =
    hardResults.length === 0
      ? true
      : group.logic === "AND"
        ? hardResults.every(Boolean)
        : hardResults.some(Boolean);

  return {
    pass,
    missingFields: Array.from(new Set(missingFields)),
    explain,
    criteriaMet,
    criteriaTotal,
    criteriaUnknown,
  };
}

/** Fields used only as SOFT (preferred) conditions — these should not block a scanner. */
export function hardFieldsUsed(group: RuleGroup): string[] {
  const keys = group.conditions.filter((c) => !c.soft).map((c) => c.field);
  for (const g of group.groups ?? []) keys.push(...hardFieldsUsed(g));
  return Array.from(new Set(keys));
}

/** Run a scanner over rows, returning matches with their explanations. */
export function runScanner<T extends MetricRow>(
  rows: T[],
  group: RuleGroup
): { row: T; result: EvalResult }[] {
  const out: { row: T; result: EvalResult }[] = [];
  for (const row of rows) {
    const result = evaluateGroup(group, row);
    if (result.pass) out.push({ row, result });
  }
  return out;
}

/** Fields a scanner touches — used to warn about unmet entitlements. */
export function fieldsUsed(group: RuleGroup): string[] {
  const keys = group.conditions.map((c) => c.field);
  for (const g of group.groups ?? []) keys.push(...fieldsUsed(g));
  return Array.from(new Set(keys));
}
