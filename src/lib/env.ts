// ─────────────────────────────────────────────────────────
// Environment validation.
// One place that knows every variable the app uses, what phase needs
// it, and whether it is currently set. Values are never returned or
// logged, only presence booleans.
// ─────────────────────────────────────────────────────────

export interface EnvCheck {
  name: string;
  required: boolean; // required for live data (vs optional/deferred)
  present: boolean;
  purpose: string;
}

export function checkEnv(): EnvCheck[] {
  const has = (k: string) => Boolean(process.env[k] && process.env[k]!.length > 0);
  return [
    { name: "DATABASE_URL", required: true, present: has("DATABASE_URL"), purpose: "Neon Postgres (bars, setups, scores)" },
    { name: "POLYGON_API_KEY", required: true, present: has("POLYGON_API_KEY"), purpose: "Market data (EOD stocks + crypto)" },
    { name: "CRON_SECRET", required: true, present: has("CRON_SECRET"), purpose: "Protects /api/scan" },
    { name: "SITE_PASSCODE", required: false, present: has("SITE_PASSCODE"), purpose: "Site gate (open when unset)" },
    { name: "FRED_API_KEY", required: false, present: has("FRED_API_KEY"), purpose: "Real VIX + macro series" },
    { name: "ANTHROPIC_API_KEY", required: false, present: has("ANTHROPIC_API_KEY"), purpose: "Phase 2: AI explanations of computed data" },
    { name: "RESEND_API_KEY", required: false, present: has("RESEND_API_KEY"), purpose: "Phase 5: email alerts" },
  ];
}

export function missingRequired(): string[] {
  return checkEnv()
    .filter((c) => c.required && !c.present)
    .map((c) => c.name);
}
