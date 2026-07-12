// ─────────────────────────────────────────────────────────
// Provider HTTP core.
// Every external API call in the app goes through fetchJson:
//   - hard timeout (AbortController)
//   - retries with exponential backoff + jitter
//   - 429 rate-limit awareness (respects Retry-After when present)
//   - typed result envelope with source + timestamp attribution
//   - never logs URLs with query strings (keys stay out of logs)
// ─────────────────────────────────────────────────────────

export interface ProviderResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  source: string;
  fetchedAt: string; // ISO timestamp of the fetch
  error?: string;
}

interface FetchOpts {
  timeoutMs?: number;
  retries?: number;
  revalidateSeconds?: number;
  source: string; // attribution label, e.g. "Polygon.io"
}

export async function fetchJson<T>(url: string, opts: FetchOpts): Promise<ProviderResult<T>> {
  const { timeoutMs = 9_000, retries = 2, revalidateSeconds, source } = opts;
  const fetchedAt = new Date().toISOString();
  // Log a redacted form only (host + path, no query string / keys).
  const redacted = (() => {
    try {
      const u = new URL(url);
      return `${u.hostname}${u.pathname}`;
    } catch {
      return "invalid-url";
    }
  })();

  let lastError = "";
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        ...(revalidateSeconds !== undefined
          ? { next: { revalidate: revalidateSeconds } }
          : { cache: "no-store" as const }),
      });
      clearTimeout(timer);

      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after")) || 2 ** attempt * 2;
        lastError = `429 rate limited (${redacted})`;
        if (attempt < retries) {
          await sleep(Math.min(retryAfter, 15) * 1000 + Math.random() * 500);
          continue;
        }
        return { ok: false, status: 429, data: null, source, fetchedAt, error: lastError };
      }

      if (!res.ok) {
        lastError = `HTTP ${res.status} (${redacted})`;
        // 5xx: retry. 4xx (other than 429): no point retrying.
        if (res.status >= 500 && attempt < retries) {
          await sleep(2 ** attempt * 1000 + Math.random() * 400);
          continue;
        }
        return { ok: false, status: res.status, data: null, source, fetchedAt, error: lastError };
      }

      const data = (await res.json()) as T;
      return { ok: true, status: res.status, data, source, fetchedAt };
    } catch (err) {
      clearTimeout(timer);
      lastError = err instanceof Error ? `${err.name}: ${err.message.slice(0, 80)}` : "fetch failed";
      if (attempt < retries) {
        await sleep(2 ** attempt * 1000 + Math.random() * 400);
        continue;
      }
    }
  }
  return { ok: false, status: 0, data: null, source, fetchedAt, error: lastError };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
