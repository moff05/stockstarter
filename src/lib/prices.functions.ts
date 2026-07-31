import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const YH_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

// Per-isolate cache of Yahoo's anti-bot crumb + cookies. Yahoo started returning
// 401 "Invalid Cookie" to data-center IPs (Cloudflare Workers included) unless
// you fetch a consent cookie and crumb first. We do that lazily and reuse it.
let _yhCookie: string | null = null;
let _yhCrumb: string | null = null;
let _yhPromise: Promise<void> | null = null;

// Persist session to disk so subsequent app launches skip the 2-step bootstrap.
// Dynamic imports keep node: built-ins out of the browser bundle (server-fn files
// are processed by both the client and server Vite builds).
const SESSION_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

function getSessionPath(): string | null {
  const userData = process.env.USER_DATA_PATH;
  if (!userData) return null;
  return `${userData}/yahoo-session.json`;
}

async function loadYahooSession(): Promise<boolean> {
  const sessionPath = getSessionPath();
  if (!sessionPath) return false;
  try {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(sessionPath, "utf8");
    const { cookie, crumb, expiresAt } = JSON.parse(raw);
    if (typeof cookie !== "string" || typeof crumb !== "string") return false;
    if (Date.now() > expiresAt) return false;
    _yhCookie = cookie;
    _yhCrumb = crumb;
    return true;
  } catch {
    return false;
  }
}

async function saveYahooSession(): Promise<void> {
  const sessionPath = getSessionPath();
  if (!sessionPath || !_yhCookie || !_yhCrumb) return;
  try {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      sessionPath,
      JSON.stringify({ cookie: _yhCookie, crumb: _yhCrumb, expiresAt: Date.now() + SESSION_TTL_MS }),
      "utf8",
    );
  } catch {
    // non-fatal
  }
}

function clearYahooSession(): void {
  _yhCookie = null;
  _yhCrumb = null;
  const sessionPath = getSessionPath();
  if (sessionPath) {
    import("node:fs/promises").then(({ writeFile }) => writeFile(sessionPath, "{}", "utf8")).catch(() => {});
  }
}

async function ensureYahooSession(): Promise<void> {
  if (_yhCookie && _yhCrumb) return;
  if (_yhPromise) return _yhPromise;
  _yhPromise = (async () => {
    try {
      // Try disk cache before hitting the network.
      if (await loadYahooSession()) {
        console.log("[yahoo] session restored from disk");
        return;
      }
      // Step 1: hit fc.yahoo.com to get a Set-Cookie (A1/A3) we can echo back.
      const seed = await fetch("https://fc.yahoo.com/", {
        headers: { "User-Agent": YH_UA, Accept: "*/*" },
        redirect: "manual",
      });
      const setCookie =
        // workerd exposes getSetCookie on Headers
        (seed.headers as any).getSetCookie?.() ?? [seed.headers.get("set-cookie") ?? ""];
      const cookie = (setCookie as string[])
        .map((c) => c.split(";")[0])
        .filter(Boolean)
        .join("; ");
      if (!cookie) throw new Error("no yahoo cookie");
      _yhCookie = cookie;
      // Step 2: ask for a crumb tied to those cookies.
      const crumbRes = await fetch(
        "https://query2.finance.yahoo.com/v1/test/getcrumb",
        { headers: { "User-Agent": YH_UA, Accept: "*/*", Cookie: cookie } },
      );
      const crumb = (await crumbRes.text()).trim();
      if (!crumb || crumb.length > 64) throw new Error(`bad crumb: ${crumb.slice(0, 40)}`);
      _yhCrumb = crumb;
      await saveYahooSession();
    } catch (e) {
      console.error("[yahoo] session bootstrap failed", (e as Error).message);
      clearYahooSession();
    } finally {
      _yhPromise = null;
    }
  })();
  return _yhPromise;
}

function yahooHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    "User-Agent": YH_UA,
    Accept: "application/json,text/plain,*/*",
  };
  if (_yhCookie) h["Cookie"] = _yhCookie;
  return h;
}

function toISO(d: Date) {
  return d.toISOString().slice(0, 10);
}

export async function yahooChart(symbol: string, period1: number, period2: number) {
  await ensureYahooSession();
  const base = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol,
  )}?period1=${period1}&period2=${period2}&interval=1d&events=history`;
  const url = _yhCrumb ? `${base}&crumb=${encodeURIComponent(_yhCrumb)}` : base;
  let res = await fetch(url, { headers: yahooHeaders() });
  if (res.status === 401 || res.status === 403) {
    // Cookie/crumb expired — clear cache and refresh once before retrying.
    clearYahooSession();
    await ensureYahooSession();
    const retry = _yhCrumb ? `${base}&crumb=${encodeURIComponent(_yhCrumb)}` : base;
    res = await fetch(retry, { headers: yahooHeaders() });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[yahoo] ${symbol} ${res.status} ${body.slice(0, 200)}`);
    throw new Error(`Yahoo ${symbol} ${res.status}`);
  }
  const json = (await res.json()) as any;
  const result = json?.chart?.result?.[0];
  if (!result) {
    console.error(`[yahoo] ${symbol} empty result: ${JSON.stringify(json).slice(0, 300)}`);
    throw new Error(`No data for ${symbol}`);
  }
  return result;
}

/**
 * Get current quote for one or more symbols.
 */
export const getQuotes = createServerFn({ method: "POST" })
  .inputValidator((d: { symbols: string[] }) =>
    z.object({ symbols: z.array(z.string()).max(100) }).parse(d),
  )
  .handler(async ({ data }) => {
    const out: Record<string, { price: number; previousClose: number; currency: string }> = {};
    if (data.symbols.length === 0) return out;

    await ensureYahooSession();

    const yhToOrig = new Map<string, string>();
    for (const sym of data.symbols) yhToOrig.set(sym.replace(".", "-").toUpperCase(), sym);
    const yhSyms = [...yhToOrig.keys()];

    const base = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${yhSyms.join(",")}&fields=regularMarketPrice,regularMarketPreviousClose,currency`;
    const url = _yhCrumb ? `${base}&crumb=${encodeURIComponent(_yhCrumb)}` : base;

    try {
      let res = await fetch(url, { headers: yahooHeaders() });
      if (res.status === 401 || res.status === 403) {
        clearYahooSession();
        await ensureYahooSession();
        const retry = _yhCrumb ? `${base}&crumb=${encodeURIComponent(_yhCrumb)}` : base;
        res = await fetch(retry, { headers: yahooHeaders() });
      }
      if (!res.ok) throw new Error(`Yahoo v7/quote ${res.status}`);

      const json = (await res.json()) as any;
      const results: any[] = json?.quoteResponse?.result ?? [];
      for (const r of results) {
        const origSym = yhToOrig.get(r.symbol?.toUpperCase()) ?? r.symbol;
        out[origSym.toUpperCase()] = {
          price: Number(r.regularMarketPrice ?? 0),
          previousClose: Number(r.regularMarketPreviousClose ?? 0),
          currency: r.currency ?? "USD",
        };
      }
    } catch (e) {
      console.error("[getQuotes]", (e as Error).message);
    }

    for (const sym of data.symbols) {
      if (!out[sym.toUpperCase()]) out[sym.toUpperCase()] = { price: 0, previousClose: 0, currency: "USD" };
    }
    return out;
  });

/**
 * Get beta and trailing dividend yield for a batch of symbols via Yahoo v7/quote.
 * Returns null for either field when Yahoo doesn't have data (bonds, funds, etc.).
 */
export const getQuoteMetrics = createServerFn({ method: "POST" })
  .inputValidator((d: { symbols: string[] }) =>
    z.object({ symbols: z.array(z.string()).max(100) }).parse(d),
  )
  .handler(async ({ data }) => {
    const out: Record<string, { beta: number | null; dividendYield: number | null }> = {};
    if (data.symbols.length === 0) return out;

    await ensureYahooSession();

    // Yahoo uses BRK-B style; keep a reverse map so we can key output by original symbol
    const yhToOrig = new Map<string, string>();
    for (const sym of data.symbols) yhToOrig.set(sym.replace(".", "-").toUpperCase(), sym);
    const yhSyms = [...yhToOrig.keys()];

    const base = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${yhSyms.join(",")}&fields=beta,trailingAnnualDividendYield,dividendYield`;
    const url = _yhCrumb ? `${base}&crumb=${encodeURIComponent(_yhCrumb)}` : base;

    try {
      let res = await fetch(url, { headers: yahooHeaders() });
      if (res.status === 401 || res.status === 403) {
        clearYahooSession();
        await ensureYahooSession();
        const retry = _yhCrumb ? `${base}&crumb=${encodeURIComponent(_yhCrumb)}` : base;
        res = await fetch(retry, { headers: yahooHeaders() });
      }
      if (!res.ok) throw new Error(`Yahoo v7/quote ${res.status}`);

      const json = (await res.json()) as any;
      const results: any[] = json?.quoteResponse?.result ?? [];
      for (const r of results) {
        const origSym = yhToOrig.get(r.symbol?.toUpperCase()) ?? r.symbol;
        out[origSym] = {
          beta: r.beta != null ? Number(r.beta) : null,
          dividendYield: (() => {
            // trailingAnnualDividendYield is always a decimal (0.07 = 7%).
            // dividendYield (fallback, used for mutual funds) is sometimes a
            // percentage (7.04 = 7.04%) — normalize any value > 1 to decimal.
            const raw =
              r.trailingAnnualDividendYield != null
                ? Number(r.trailingAnnualDividendYield)
                : r.dividendYield != null
                  ? Number(r.dividendYield)
                  : null;
            if (raw == null) return null;
            return raw > 1 ? raw / 100 : raw;
          })(),
        };
      }
    } catch (e) {
      console.error("[getQuoteMetrics]", (e as Error).message);
    }

    for (const sym of data.symbols) {
      if (!(sym in out)) out[sym] = { beta: null, dividendYield: null };
    }
    return out;
  });

/**
 * Get historical close price for each symbol on or before the given as-of date.
 * Caches results in price_cache.
 */
export const getHistoricalCloses = createServerFn({ method: "POST" })
  .inputValidator((d: { symbols: string[]; asOfDate: string }) =>
    z
      .object({
        symbols: z.array(z.string()).max(100),
        asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const asOf = new Date(data.asOfDate + "T16:00:00Z");
    const period2 = Math.floor(asOf.getTime() / 1000) + 86400;
    const period1 = period2 - 60 * 60 * 24 * 14; // 2 wk window

    const out: Record<string, number> = {};
    const upper = data.symbols.map((s) => s.toUpperCase());

    const { getDb } = await import("@/lib/db.server");
    const db = getDb();

    const placeholders = upper.map(() => "?").join(",");
    const cached = db
      .prepare(`SELECT symbol, close FROM price_cache WHERE symbol IN (${placeholders}) AND as_of_date = ?`)
      .all(...upper, data.asOfDate) as { symbol: string; close: number }[];
    const cachedMap = new Map(cached.map((r) => [r.symbol, Number(r.close)]));

    const toFetch = upper.filter((s) => !cachedMap.has(s));
    const upsertCache = db.prepare(
      "INSERT OR REPLACE INTO price_cache (symbol, as_of_date, close) VALUES (?, ?, ?)",
    );

    await Promise.all(
      toFetch.map(async (sym) => {
        const yhSym = sym.replace(".", "-"); // BRK.B → BRK-B for Yahoo Finance
        try {
          const r = await yahooChart(yhSym, period1, period2);
          const ts: number[] = r.timestamp ?? [];
          const closes: (number | null)[] = r.indicators?.quote?.[0]?.close ?? [];
          let pick: number | null = null;
          for (let i = ts.length - 1; i >= 0; i--) {
            const d = new Date(ts[i] * 1000);
            if (d <= asOf && closes[i] != null) {
              pick = Number(closes[i]);
              break;
            }
          }
          if (pick != null) {
            out[sym] = pick;
            try { upsertCache.run(yhSym, data.asOfDate, pick); } catch { /* non-fatal */ }
          } else {
            out[sym] = 0;
          }
        } catch {
          out[sym] = 0;
        }
      }),
    );

    for (const [sym, val] of cachedMap) out[sym] = val;
    return out;
  });

/**
 * Fetch current 13-week T-bill yield (^IRX) from Yahoo Finance as the risk-free rate.
 * Returns an annualized decimal (e.g. 0.0425 for 4.25%). Falls back to 4.5% on error.
 */
export const getRiskFreeRate = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const now = Math.floor(Date.now() / 1000);
    const weekAgo = now - 7 * 86400;
    const result = await yahooChart("%5EIRX", weekAgo, now); // ^IRX URL-encoded
    const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
    const last = [...closes].reverse().find((v) => v != null);
    return last != null ? last / 100 : 0.045; // ^IRX is in percent (e.g. 4.25 → 0.0425)
  } catch {
    return 0.045;
  }
});

/**
 * Fetch historical dividend events for a batch of symbols from Yahoo Finance.
 * Returns ex-dates and per-share amounts sourced from Yahoo's chart events API.
 */
export const getDividendEvents = createServerFn({ method: "POST" })
  .inputValidator((d: { symbols: string[]; startDate: string; endDate: string }) =>
    z
      .object({
        symbols: z.array(z.string()).max(100),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const p1 = Math.floor(new Date(data.startDate + "T00:00:00Z").getTime() / 1000);
    const p2 = Math.floor(new Date(data.endDate + "T23:59:59Z").getTime() / 1000) + 86400;
    const out: Record<string, { date: string; amount: number }[]> = {};

    await Promise.all(
      data.symbols.map(async (sym) => {
        const yhSym = sym.replace(".", "-");
        try {
          await ensureYahooSession();
          const base = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
            yhSym,
          )}?period1=${p1}&period2=${p2}&interval=1d&events=div`;
          const url = _yhCrumb ? `${base}&crumb=${encodeURIComponent(_yhCrumb)}` : base;
          const res = await fetch(url, { headers: yahooHeaders() });
          if (!res.ok) throw new Error(`${res.status}`);
          const json = (await res.json()) as any;
          const divMap: Record<string, { amount: number; date: number }> =
            json?.chart?.result?.[0]?.events?.dividends ?? {};
          out[sym.toUpperCase()] = Object.values(divMap)
            .map((d) => ({
              date: new Date(d.date * 1000).toISOString().slice(0, 10),
              amount: Number(d.amount),
            }))
            .sort((a, b) => a.date.localeCompare(b.date));
        } catch {
          out[sym.toUpperCase()] = [];
        }
      }),
    );
    return out;
  });

/**
 * Get a daily time-series of closes for a symbol between two dates (inclusive).
 * Used for charts (e.g. S&P 500 comparison).
 */
export const getSeries = createServerFn({ method: "POST" })
  .inputValidator((d: { symbol: string; start: string; end: string }) =>
    z
      .object({
        symbol: z.string(),
        start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const p1 = Math.floor(new Date(data.start + "T00:00:00Z").getTime() / 1000);
    const p2 = Math.floor(new Date(data.end + "T23:59:59Z").getTime() / 1000);
    const r = await yahooChart(data.symbol, p1, p2);
    const ts: number[] = r.timestamp ?? [];
    const closes: (number | null)[] = r.indicators?.quote?.[0]?.close ?? [];
    const series: { date: string; close: number }[] = [];
    for (let i = 0; i < ts.length; i++) {
      if (closes[i] != null) {
        series.push({ date: toISO(new Date(ts[i] * 1000)), close: Number(closes[i]) });
      }
    }
    return series;
  });