import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { isoAddDays } from "./portfolio";
import { computeTWR, computeIRR } from "./twr";
import { annualizedVolatility, maxDrawdown, sharpeRatio, portfolioBeta } from "./risk";
import { getRiskFreeRate } from "./prices.functions";
import { buildResolver } from "./symbol-resolver";
import { yahooChart } from "./prices.functions";
import type { Transaction } from "./portfolio";

export const getInceptionDate = createServerFn({ method: "GET" })
  .inputValidator((d: { account?: string | null }) =>
    z.object({ account: z.string().nullable().optional() }).parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const { getDb } = await import("@/lib/db.server");
    const db = getDb();
    const row = data?.account
      ? (db.prepare("SELECT MIN(trade_date) as d FROM transactions WHERE account = ?").get(data.account) as { d: string | null })
      : (db.prepare("SELECT MIN(trade_date) as d FROM transactions").get() as { d: string | null });
    return row?.d ?? null;
  });

export const getPerformance = createServerFn({ method: "POST" })
  .inputValidator((d: { startDate: string; endDate: string; account?: string | null }) =>
    z
      .object({
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        account: z.string().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { getDb } = await import("@/lib/db.server");
    const db = getDb();
    const { startDate, endDate, account } = data;

    // Load + resolve transactions
    const rawTxns = (account
      ? db.prepare("SELECT * FROM transactions WHERE account = ? ORDER BY trade_date").all(account)
      : db.prepare("SELECT * FROM transactions ORDER BY trade_date").all()) as any[];
    const rawMappings = db.prepare("SELECT * FROM symbol_mappings").all() as any[];
    const resolve = buildResolver(rawMappings as any);
    const txns: Transaction[] = rawTxns.map((t: any) => ({
      ...t,
      symbol: t.symbol ? (resolve(t.symbol).ticker ?? t.symbol) : null,
    }));

    // Sub-period CF dates — ignore noise contributions below $1
    const cfDates = Array.from(
      new Set(
        txns
          .filter(
            (t) =>
              t.trade_date > startDate &&
              t.trade_date < endDate &&
              (t.action === "CONTRIBUTION" || t.action === "DISTRIBUTION") &&
              Math.abs(Number(t.amount)) >= 1,
          )
          .map((t) => t.trade_date),
      ),
    ).sort();

    // Detect in-kind transfers: BUY transactions not funded by contributions or sale proceeds.
    // These are identified by the running cash balance going below -$100K.
    // Key: after flagging a BUY as in-kind, add its amount BACK to runningCash so the
    // detection baseline resets. Without this, the permanently-negative post-in-kind cash
    // balance would falsely flag every subsequent normal BUY in the analysis period.
    const IN_KIND_THRESHOLD = -100_000;
    let runningCash = 0;
    const inKindSet = new Set<string>(cfDates); // seed with existing CF dates to avoid dupes
    const inKindBoundaries: string[] = [];
    for (const t of txns) {
      const amt = Math.abs(Number(t.amount) || 0);
      if (t.action === "CONTRIBUTION" || t.action === "DIVIDEND" || t.action === "INTEREST") {
        runningCash += amt;
      } else if (t.action === "FEE") {
        runningCash -= amt;
      } else if (t.action === "SELL" || t.action === "DISTRIBUTION") {
        runningCash += amt;
      } else if (t.action === "BUY") {
        runningCash -= amt;
        if (runningCash < IN_KIND_THRESHOLD) {
          // Unfunded BUY — treat as in-kind external inflow.
          // Add back the amount so subsequent normal BUYs aren't also flagged.
          runningCash += amt;
          if (t.trade_date > startDate && t.trade_date < endDate && !inKindSet.has(t.trade_date)) {
            inKindSet.add(t.trade_date);
            inKindBoundaries.push(t.trade_date);
          }
        }
      }
    }
    const extraBoundaries = [...inKindBoundaries].sort();

    // Unique price dates needed: startDate, endDate, each CF/in-kind date + day before
    const priceDateSet = new Set<string>([startDate, endDate]);
    for (const d of [...cfDates, ...extraBoundaries]) {
      priceDateSet.add(d);
      priceDateSet.add(isoAddDays(d, -1));
    }
    const priceDates = Array.from(priceDateSet).sort();

    // All symbols held at any point in the period + benchmarks
    const allSymbols = new Set<string>(["SPY", "QQQ"]);
    for (const t of txns) {
      if (t.symbol && t.trade_date <= endDate && (t.action === "BUY" || t.action === "SELL")) {
        allSymbols.add(t.symbol.toUpperCase());
      }
    }

    const pricesByDate: Record<string, Record<string, number>> = {};
    for (const d of priceDates) pricesByDate[d] = {};

    const upsert = db.prepare(
      "INSERT OR REPLACE INTO price_cache (symbol, as_of_date, close) VALUES (?, ?, ?)",
    );

    // Extend lookback 7 days before startDate so most-recent-≤ works on market holidays
    // (e.g. YTD startDate = Jan 1 holiday needs Dec 31 price from cache)
    const lookbackStart = isoAddDays(startDate, -7);
    const p1Unix = Math.floor(new Date(lookbackStart + "T00:00:00Z").getTime() / 1000);
    // No +86400: prevents fetching next-day pre-market data from Yahoo
    const p2Unix = Math.floor(new Date(endDate + "T23:59:59Z").getTime() / 1000);

    await Promise.all(
      Array.from(allSymbols).map(async (sym) => {
        // Yahoo Finance uses hyphens for class-share tickers (BRK.B → BRK-B)
        const yhSym = sym.replace(".", "-");

        // Load cached closes for this symbol — include 7-day lookback to handle holiday starts
        const cached = db
          .prepare(
            "SELECT as_of_date, close FROM price_cache WHERE symbol = ? AND as_of_date >= ? AND as_of_date <= ?",
          )
          .all(yhSym, lookbackStart, endDate) as { as_of_date: string; close: number }[];

        const closeMap = new Map<string, number>(cached.map((r) => [r.as_of_date, Number(r.close)]));
        const cachedSortedDays = Array.from(closeMap.keys()).sort();

        // Only hit Yahoo if cache has a price within 7 trading days before each needed date
        const allCached = priceDates.every(pd => {
          const cutoff = isoAddDays(pd, -7);
          for (const d of cachedSortedDays) {
            if (d > pd) break;
            if (d >= cutoff) return true;
          }
          return false;
        });

        if (!allCached) {
          try {
            const result = await yahooChart(yhSym, p1Unix, p2Unix);
            const timestamps: number[] = result.timestamp ?? [];
            const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
            for (let i = 0; i < timestamps.length; i++) {
              const date = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
              if (date > endDate) continue; // never cache future-dated prices
              const close = closes[i];
              if (close != null && close > 0 && !closeMap.has(date)) {
                closeMap.set(date, Number(close));
                try {
                  upsert.run(yhSym, date, Number(close));
                } catch { /* non-fatal cache write */ }
              }
            }
          } catch { /* symbol may not trade on Yahoo — skip */ }
        }

        // For each price date, use the most recent close on or before that date
        const sortedDays = Array.from(closeMap.keys()).sort();
        for (const priceDate of priceDates) {
          let best: number | undefined;
          for (const d of sortedDays) {
            if (d <= priceDate) best = closeMap.get(d);
            else break;
          }
          // Store under yhSym; buildSnapshot falls back to yhSym via dot→hyphen lookup
          if (best != null && best > 0) pricesByDate[priceDate][yhSym] = best;
        }
      }),
    );

    // Extract SPY + QQQ prices for benchmark comparison
    const benchmarkPrices: Record<string, number> = {};
    const benchmarkPricesQQQ: Record<string, number> = {};
    for (const [date, prices] of Object.entries(pricesByDate)) {
      if (prices["SPY"]) benchmarkPrices[date] = prices["SPY"];
      if (prices["QQQ"]) benchmarkPricesQQQ[date] = prices["QQQ"];
    }

    const result = computeTWR(txns, startDate, endDate, pricesByDate, benchmarkPrices, benchmarkPricesQQQ, extraBoundaries);

    // IRR (dollar-weighted return): start value as outflow, end value as inflow,
    // with contributions/distributions as intermediate flows.
    let totalContributions = 0;
    let totalDistributions = 0;
    if (result.startValue > 0) {
      const irrFlows: { date: string; amount: number }[] = [
        { date: startDate, amount: -result.startValue },
      ];
      for (const t of txns) {
        if (t.trade_date <= startDate || t.trade_date > endDate) continue;
        if (t.action === "CONTRIBUTION") {
          const amt = Math.abs(Number(t.amount));
          totalContributions += amt;
          irrFlows.push({ date: t.trade_date, amount: -amt });
        } else if (t.action === "DISTRIBUTION") {
          const amt = Math.abs(Number(t.amount));
          totalDistributions += amt;
          irrFlows.push({ date: t.trade_date, amount: amt });
        }
      }
      irrFlows.push({ date: endDate, amount: result.endValue });
      result.irr = computeIRR(irrFlows);
    }
    result.totalContributions = totalContributions;
    result.totalDistributions = totalDistributions;

    // MOIC = (ending value + distributions returned) / (starting value + contributions invested)
    const totalIn = result.startValue + totalContributions;
    const totalOut = result.endValue + totalDistributions;
    result.moic = totalIn > 0 ? totalOut / totalIn : null;

    // Risk metrics — computed from the sub-period series already in hand
    const rfr = await getRiskFreeRate();
    result.riskFreeRate = rfr;
    result.volatility = annualizedVolatility(result.subPeriods);
    result.maxDrawdown = maxDrawdown(result.chartPoints);
    if (result.volatility != null) {
      result.sharpe = sharpeRatio(result.twrAnnualized, result.volatility, rfr);
    }
    result.beta = portfolioBeta(result.subPeriods, benchmarkPrices);
    result.betaQQQ = portfolioBeta(result.subPeriods, benchmarkPricesQQQ);

    return result;
  });

/**
 * Compute monthly portfolio NAV from inception to today.
 * Returns one data point per month-end, computed from transaction history × cached prices.
 */
export const getNavHistory = createServerFn({ method: "GET" })
  .inputValidator((d: { account?: string | null; maxDate?: string }) =>
    z.object({ account: z.string().nullable().optional(), maxDate: z.string().optional() }).parse(d ?? {}),
  )
  .handler(async ({ data }) => {
  const { getDb } = await import("@/lib/db.server");
  const db = getDb();

  const rawTxns = (data?.account
    ? db.prepare("SELECT * FROM transactions WHERE account = ? ORDER BY trade_date").all(data.account)
    : db.prepare("SELECT * FROM transactions ORDER BY trade_date").all()) as any[];
  if (rawTxns.length === 0) return [] as { date: string; value: number }[];

  const rawMappings = db.prepare("SELECT * FROM symbol_mappings").all() as any[];
  const resolve = buildResolver(rawMappings as any);
  const txns = rawTxns.map((t: any) => ({
    ...t,
    symbol: t.symbol ? (resolve(t.symbol).ticker ?? t.symbol) : null,
  }));

  const inceptionDate: string = txns[0].trade_date;

  const _now = new Date();
  const serverToday = `${_now.getFullYear()}-${String(_now.getMonth()+1).padStart(2,"0")}-${String(_now.getDate()).padStart(2,"0")}`;
  // Client passes its local date to resolve server/client timezone ambiguity; use the earlier of the two
  const today = (data?.maxDate && data.maxDate <= serverToday) ? data.maxDate : serverToday;
  const _oya = new Date(Date.now() - 365 * 86400_000);
  const oneYearAgo = `${_oya.getFullYear()}-${String(_oya.getMonth()+1).padStart(2,"0")}-${String(_oya.getDate()).padStart(2,"0")}`;

  // Hybrid date spine: monthly from inception to 1 year ago, daily for the last year
  const dates: string[] = [];

  // Monthly dates for older history
  let year = Number(inceptionDate.slice(0, 4));
  let month = Number(inceptionDate.slice(5, 7));
  while (true) {
    const lastDay = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    if (lastDay >= oneYearAgo) break;
    dates.push(lastDay);
    month++;
    if (month > 12) { month = 1; year++; }
  }

  // Daily dates for the last year — use local date throughout to avoid UTC-offset bugs
  for (let d = new Date(oneYearAgo); ; d.setDate(d.getDate() + 1)) {
    const dStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    if (dStr > today) break;
    dates.push(dStr);
  }

  // Unique symbols ever traded
  const symbols = new Set<string>();
  for (const t of txns) {
    if (t.symbol && (t.action === "BUY" || t.action === "SELL")) symbols.add(t.symbol.toUpperCase());
  }
  if (symbols.size === 0) return [] as { date: string; value: number }[];

  // Purge any price_cache rows with future dates — these accumulate when the previous
  // code queried Yahoo with an extra +86400 offset and stored tomorrow's data
  try { db.prepare("DELETE FROM price_cache WHERE as_of_date > ?").run(today); } catch { /* non-fatal */ }

  const p1Unix = Math.floor(new Date(inceptionDate + "T00:00:00Z").getTime() / 1000);
  // No +86400: querying beyond today causes Yahoo to return pre-market "next day" data
  const p2Unix = Math.floor(new Date(today + "T23:59:59Z").getTime() / 1000);

  const upsert = db.prepare("INSERT OR REPLACE INTO price_cache (symbol, as_of_date, close) VALUES (?, ?, ?)");

  // closeMap per symbol: date → close
  const closeMaps = new Map<string, Map<string, number>>();

  await Promise.all(Array.from(symbols).map(async (sym) => {
    const yhSym = sym.replace(".", "-");
    const cached = db
      .prepare("SELECT as_of_date, close FROM price_cache WHERE symbol = ? AND as_of_date >= ? AND as_of_date <= ?")
      .all(yhSym, inceptionDate, today) as { as_of_date: string; close: number }[];

    const closeMap = new Map<string, number>(cached.map((r) => [r.as_of_date, Number(r.close)]));

    try {
      const result = await yahooChart(yhSym, p1Unix, p2Unix);
      const timestamps: number[] = result.timestamp ?? [];
      const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
      for (let i = 0; i < timestamps.length; i++) {
        const date = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
        if (date > today) continue; // never cache future-dated prices
        const close = closes[i];
        if (close != null && close > 0 && !closeMap.has(date)) {
          closeMap.set(date, Number(close));
          try { upsert.run(yhSym, date, Number(close)); } catch { /* non-fatal */ }
        }
      }
    } catch { /* symbol may not trade on Yahoo */ }

    closeMaps.set(sym, closeMap);
  }));

  // Pre-sort each symbol's date list for fast "most recent price on or before date" lookups
  const sortedDays = new Map<string, string[]>();
  for (const [sym, map] of closeMaps) sortedDays.set(sym, Array.from(map.keys()).sort());

  function priceAt(sym: string, date: string): number {
    const map = closeMaps.get(sym);
    if (!map) return 0;
    const days = sortedDays.get(sym) ?? [];
    let p = 0;
    for (const d of days) {
      if (d > date) break;
      const v = map.get(d);
      if (v && v > 0) p = v;
    }
    return p;
  }

  // For each month-end: accumulate holdings from transactions and compute value
  const series: { date: string; value: number }[] = [];
  for (const date of dates) {
    const qty = new Map<string, number>();
    for (const t of txns) {
      if (t.trade_date > date) break;
      if (!t.symbol) continue;
      const sym = t.symbol.toUpperCase();
      const q = Math.abs(Number(t.quantity ?? 0));
      if (t.action === "BUY") qty.set(sym, (qty.get(sym) ?? 0) + q);
      else if (t.action === "SELL") qty.set(sym, (qty.get(sym) ?? 0) - q);
    }
    let value = 0;
    for (const [sym, q] of qty) {
      if (q <= 0.001) continue;
      const p = priceAt(sym, date);
      if (p > 0) value += q * p;
    }
    if (value > 0) series.push({ date, value });
  }

  return series;
});
