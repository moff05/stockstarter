import { useQuery } from "@tanstack/react-query";
import { listTransactions } from "@/lib/transactions.functions";
import { getQuotes, getHistoricalCloses, getQuoteMetrics } from "@/lib/prices.functions";
import { buildSnapshot, type Transaction } from "@/lib/portfolio";
import { useMemo } from "react";
import { listMappings } from "@/lib/symbol-mappings.functions";
import { buildResolver } from "@/lib/symbol-resolver";
import { useAccountFilter } from "@/lib/account-filter";

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function usePortfolio(asOfDate?: string) {
  const dateIso = asOfDate ?? todayIso();
  const isToday = dateIso === todayIso();
  const { account } = useAccountFilter();

  const txnsQ = useQuery({
    queryKey: ["transactions", account ?? "all"],
    queryFn: () => listTransactions({ data: { account } }),
    staleTime: Infinity,
  });

  const mappingsQ = useQuery({
    queryKey: ["symbol_mappings"],
    queryFn: () => listMappings(),
    staleTime: Infinity,
  });

  const rawTxns = (txnsQ.data ?? []) as unknown as Transaction[];
  const mappings = mappingsQ.data ?? [];
  const resolve = useMemo(() => buildResolver(mappings), [mappings]);

  const txns: Transaction[] = useMemo(
    () =>
      rawTxns.map((t) => {
        if (!t.symbol) return t;
        const r = resolve(t.symbol);
        return { ...t, symbol: r.ticker ?? r.original };
      }),
    [rawTxns, resolve],
  );

  const unmapped = useMemo(() => {
    const set = new Set<string>();
    for (const t of rawTxns) {
      if (!t.symbol) continue;
      const r = resolve(t.symbol);
      if (!r.isMapped) set.add(r.original);
    }
    return Array.from(set);
  }, [rawTxns, resolve]);

  const symbols = useMemo(() => {
    const set = new Set<string>();
    for (const t of txns) {
      if (t.trade_date <= dateIso && t.symbol) set.add(t.symbol.toUpperCase());
    }
    return Array.from(set);
  }, [txns, dateIso]);

  const pricesQ = useQuery({
    queryKey: ["prices", isToday ? "today" : dateIso, symbols],
    enabled: symbols.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      if (isToday) {
        const quotes = await getQuotes({ data: { symbols } });
        const map: Record<string, number> = {};
        for (const [k, v] of Object.entries(quotes)) map[k] = v.price;
        return map;
      }
      return await getHistoricalCloses({ data: { symbols, asOfDate: dateIso } });
    },
  });

  // Beta + trailing dividend yield — current market data, always fetched for today's view
  const metricsQ = useQuery({
    queryKey: ["quote-metrics", symbols],
    enabled: symbols.length > 0 && isToday,
    staleTime: 5 * 60_000,
    queryFn: () => getQuoteMetrics({ data: { symbols } }),
  });

  const prices = pricesQ.data ?? {};
  const quoteMetrics = metricsQ.data ?? {};

  const baseSnapshot = useMemo(
    () => buildSnapshot(txns, dateIso, prices),
    [txns, dateIso, prices],
  );

  // Enrich holdings with beta + dividend yield from live quotes
  const snapshot = useMemo(() => {
    const enriched = baseSnapshot.holdings.map((h) => {
      const m = quoteMetrics[h.symbol];
      const dividendYield = m?.dividendYield ?? null;
      return {
        ...h,
        beta: m?.beta ?? null,
        dividendYield,
        annualDividendIncome: dividendYield != null ? dividendYield * h.marketValue : 0,
      };
    });
    return { ...baseSnapshot, holdings: enriched };
  }, [baseSnapshot, quoteMetrics]);

  // Portfolio beta = value-weighted average of positions with known beta
  const portfolioBeta = useMemo(() => {
    const withBeta = snapshot.holdings.filter((h) => h.beta != null);
    if (withBeta.length === 0) return null;
    const coveredValue = withBeta.reduce((s, h) => s + h.marketValue, 0);
    if (coveredValue === 0) return null;
    return withBeta.reduce((s, h) => s + (h.marketValue / coveredValue) * h.beta!, 0);
  }, [snapshot.holdings]);

  // Forward annual income projection from trailing dividend yield
  const annualIncomeProjection = useMemo(
    () => snapshot.holdings.reduce((s, h) => s + h.annualDividendIncome, 0),
    [snapshot.holdings],
  );

  return {
    txns,
    snapshot,
    portfolioBeta,
    annualIncomeProjection,
    prices,
    mappings,
    unmapped,
    isLoading: txnsQ.isLoading || pricesQ.isLoading || mappingsQ.isLoading,
    refetch: () => {
      txnsQ.refetch();
      pricesQ.refetch();
      mappingsQ.refetch();
    },
  };
}
