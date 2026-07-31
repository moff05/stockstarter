import { buildSnapshot, isoAddDays } from "./portfolio";
import type { Transaction } from "./portfolio";

/**
 * xIRR — dollar-weighted return for irregular cash flows.
 * cashFlows must include the opening portfolio value as a negative flow on startDate
 * and the closing portfolio value as a positive flow on endDate.
 * Returns an annualized decimal rate (0.12 = 12%) or null if it doesn't converge.
 */
export function computeIRR(cashFlows: { date: string; amount: number }[]): number | null {
  if (cashFlows.length < 2) return null;
  const ms = cashFlows.map((cf) => new Date(cf.date + "T00:00:00Z").getTime());
  const t0 = ms[0];

  function npv(r: number) {
    let s = 0;
    for (let i = 0; i < cashFlows.length; i++) {
      const t = (ms[i] - t0) / (365.25 * 86400_000);
      s += cashFlows[i].amount / Math.pow(1 + r, t);
    }
    return s;
  }
  function dnpv(r: number) {
    let s = 0;
    for (let i = 0; i < cashFlows.length; i++) {
      const t = (ms[i] - t0) / (365.25 * 86400_000);
      s -= (t * cashFlows[i].amount) / Math.pow(1 + r, t + 1);
    }
    return s;
  }

  let r = 0.1;
  for (let i = 0; i < 200; i++) {
    const f = npv(r);
    const df = dnpv(r);
    if (Math.abs(df) < 1e-14) break;
    const next = r - f / df;
    if (Math.abs(next - r) < 1e-8) { r = next; break; }
    r = Math.max(-0.999, Math.min(10, next));
  }
  return Math.abs(npv(r)) < 1 ? r : null;
}

export type SubPeriod = {
  start: string;
  end: string;
  startValue: number;
  endValue: number;
  externalFlow: number; // net CONTRIBUTION - DISTRIBUTION (display only)
  periodReturn: number; // decimal, e.g. 0.05 = 5%
};

export type ChartPoint = {
  date: string;
  portfolioReturn: number;        // cumulative decimal from startDate (0 = baseline)
  benchmarkReturn: number | null; // SPY cumulative return, null if not available
  qqqReturn: number | null;       // QQQ cumulative return, null if not available
};

export type AttributionRow = {
  symbol: string;
  startValue: number;
  endValue: number;
  netInvested: number;    // BUY cost - SELL proceeds added mid-period (for this symbol)
  dollarsGained: number;  // endValue - startValue - netInvested
  positionReturn: number; // dollarsGained / startValue (0 when no opening position)
  contribution: number;   // dollarsGained / |total portfolio $ gain| — share of total gain
};

export type PerformanceResult = {
  startDate: string;
  endDate: string;
  twr: number;
  twrAnnualized: number;
  irr: number | null;
  volatility: number | null;
  maxDrawdown: number | null;
  sharpe: number | null;
  moic: number | null;
  riskFreeRate: number;
  attribution: AttributionRow[];
  subPeriods: SubPeriod[];
  startValue: number;
  endValue: number;
  totalDays: number;
  totalContributions: number;
  totalDistributions: number;
  benchmarkReturn: number | null;
  benchmarkAnnualized: number | null;
  qqqReturn: number | null;
  qqqAnnualized: number | null;
  beta: number | null;
  betaQQQ: number | null;
  chartPoints: ChartPoint[];
};

// Contributions below this threshold are ignored as period boundaries (accounting noise).
const MIN_CF_AMOUNT = 1;

/**
 * Time-Weighted Return.
 *
 * External cash flows (CONTRIBUTION / DISTRIBUTION) ≥ $1 define sub-period boundaries.
 * Within each sub-period there are no meaningful external flows, so the simple return
 * (endValue / startValue - 1) is the true investment return for that period.
 * Sub-period returns are chain-linked to produce the cumulative TWR.
 *
 * pricesByDate must contain closes (using most-recent-≤-date logic) for:
 *   - startDate, endDate
 *   - each CF date and isoAddDays(cfDate, -1)
 *
 * benchmarkPrices: flat map of date → price (e.g. SPY) for the same dates.
 */
export function computeTWR(
  txns: Transaction[],
  startDate: string,
  endDate: string,
  pricesByDate: Record<string, Record<string, number>>,
  benchmarkPrices: Record<string, number> = {},
  benchmarkPricesQQQ: Record<string, number> = {},
  extraBoundaries: string[] = [],
): PerformanceResult {
  // Separate contribution/distribution dates from in-kind boundaries so we can
  // adjust startValue for the contribution case (see below).
  const contributionDates = new Set(
    txns
      .filter(
        (t) =>
          t.trade_date > startDate &&
          t.trade_date < endDate &&
          (t.action === "CONTRIBUTION" || t.action === "DISTRIBUTION") &&
          Math.abs(Number(t.amount)) >= MIN_CF_AMOUNT,
      )
      .map((t) => t.trade_date),
  );

  const allBoundaryDates = Array.from(
    new Set([
      ...contributionDates,
      ...extraBoundaries.filter((d) => d > startDate && d < endDate),
    ]),
  ).sort();

  const boundaries = [startDate, ...allBoundaryDates, endDate];
  const subPeriods: SubPeriod[] = [];
  let cumProduct = 1;
  let validPeriods = 0;

  const spyBase = benchmarkPrices[startDate] ?? null;
  const qqqBase = benchmarkPricesQQQ[startDate] ?? null;
  const chartPoints: ChartPoint[] = [
    { date: startDate, portfolioReturn: 0, benchmarkReturn: spyBase ? 0 : null, qqqReturn: qqqBase ? 0 : null },
  ];

  for (let i = 0; i < boundaries.length - 1; i++) {
    const periodStart = boundaries[i];
    const nextBoundary = boundaries[i + 1];
    const periodEnd = nextBoundary === endDate ? endDate : isoAddDays(nextBoundary, -1);

    const startSnap = buildSnapshot(txns, periodStart, pricesByDate[periodStart] ?? {});
    const endSnap = buildSnapshot(txns, periodEnd, pricesByDate[periodEnd] ?? {});

    // For sub-periods that start on a CONTRIBUTION date: the contribution cash arrived
    // but may not yet be deployed into securities (BUYs may be 1–5 days later). Using
    // totalMarketValue alone omits that cash from the denominator, inflating the return
    // when those securities later appear in endValue. Add the undeployed contribution
    // cash so the denominator correctly reflects all capital at risk.
    let startValue = startSnap.totalMarketValue;
    if (contributionDates.has(periodStart)) {
      const contributedToday = txns
        .filter((t) => t.trade_date === periodStart && t.action === "CONTRIBUTION")
        .reduce((s, t) => s + Number(t.amount), 0);
      const deployedToday = txns
        .filter((t) => t.trade_date === periodStart && t.action === "BUY")
        .reduce((s, t) => s + (Math.abs(Number(t.amount)) || Number(t.quantity) * Number(t.price)), 0);
      const undeployedCash = Math.max(0, contributedToday - deployedToday);
      startValue = startSnap.totalMarketValue + undeployedCash;
    }

    const endValue = endSnap.totalMarketValue;
    if (startValue <= 0) continue;

    const externalFlow = txns
      .filter(
        (t) =>
          t.trade_date >= periodStart &&
          t.trade_date <= periodEnd &&
          (t.action === "CONTRIBUTION" || t.action === "DISTRIBUTION"),
      )
      .reduce((sum, t) => {
        return t.action === "CONTRIBUTION"
          ? sum + Number(t.amount)
          : sum - Math.abs(Number(t.amount));
      }, 0);

    const periodReturn = (endValue - startValue) / startValue;
    cumProduct *= 1 + periodReturn;
    validPeriods++;

    const spyAtEnd = benchmarkPrices[periodEnd] ?? null;
    const qqqAtEnd = benchmarkPricesQQQ[periodEnd] ?? null;
    chartPoints.push({
      date: periodEnd,
      portfolioReturn: cumProduct - 1,
      benchmarkReturn: spyBase && spyAtEnd ? spyAtEnd / spyBase - 1 : null,
      qqqReturn: qqqBase && qqqAtEnd ? qqqAtEnd / qqqBase - 1 : null,
    });

    subPeriods.push({ start: periodStart, end: periodEnd, startValue, endValue, externalFlow, periodReturn });
  }

  const twr = validPeriods > 0 ? cumProduct - 1 : 0;
  const totalDays = Math.max(
    1,
    (new Date(endDate + "T00:00:00Z").getTime() - new Date(startDate + "T00:00:00Z").getTime()) /
      86400000,
  );
  // Always annualize so Sharpe can be computed even for sub-year periods.
  // The UI decides whether to display it (hides it for periods < 365 days).
  const twrAnnualized = Math.pow(1 + twr, 365 / totalDays) - 1;

  const spyAtEnd = benchmarkPrices[endDate] ?? null;
  const benchmarkReturn = spyBase && spyAtEnd ? spyAtEnd / spyBase - 1 : null;
  const benchmarkAnnualized =
    benchmarkReturn !== null && totalDays >= 365
      ? Math.pow(1 + benchmarkReturn, 365 / totalDays) - 1
      : null;

  const qqqAtEndFinal = benchmarkPricesQQQ[endDate] ?? null;
  const qqqReturn = qqqBase && qqqAtEndFinal ? qqqAtEndFinal / qqqBase - 1 : null;
  const qqqAnnualized =
    qqqReturn !== null && totalDays >= 365
      ? Math.pow(1 + qqqReturn, 365 / totalDays) - 1
      : null;

  const startSnap = buildSnapshot(txns, startDate, pricesByDate[startDate] ?? {});
  const endSnap = buildSnapshot(txns, endDate, pricesByDate[endDate] ?? {});
  const startTotal = startSnap.totalMarketValue;

  // Per-symbol attribution: how much did each position contribute to total return?
  const startMV = new Map<string, number>(startSnap.holdings.map((h) => [h.symbol, h.marketValue]));
  const endMV = new Map<string, number>(endSnap.holdings.map((h) => [h.symbol, h.marketValue]));
  const attrSymbols = new Set([...startMV.keys(), ...endMV.keys()]);

  type PartialRow = Omit<AttributionRow, "contribution">;
  const partialRows: PartialRow[] = [];
  for (const sym of attrSymbols) {
    const startValue = startMV.get(sym) ?? 0;
    const endValue = endMV.get(sym) ?? 0;

    // Net capital invested into this position during the period
    const netInvested = txns
      .filter(
        (t) =>
          (t.symbol ?? "").toUpperCase() === sym &&
          t.trade_date > startDate &&
          t.trade_date <= endDate &&
          (t.action === "BUY" || t.action === "SELL"),
      )
      .reduce((sum, t) => {
        const amt = Math.abs(Number(t.amount) || Number(t.quantity) * Number(t.price));
        return t.action === "BUY" ? sum + amt : sum - amt;
      }, 0);

    const dollarsGained = endValue - startValue - netInvested;
    if (startValue === 0 && endValue === 0 && Math.abs(dollarsGained) < 1) continue;

    partialRows.push({
      symbol: sym,
      startValue,
      endValue,
      netInvested,
      dollarsGained,
      positionReturn: startValue > 0 ? dollarsGained / startValue : (netInvested > 0 ? dollarsGained / netInvested : 0),
    });
  }

  // Contribution = each position's share of total portfolio $ gain.
  // Using totalDollarGain (not startTotal) keeps percentages meaningful even when
  // the starting portfolio was tiny relative to mid-period inflows (e.g., Inception).
  const totalDollarGain = partialRows.reduce((s, r) => s + r.dollarsGained, 0);
  const attribution: AttributionRow[] = partialRows.map((r) => ({
    ...r,
    contribution: totalDollarGain !== 0 ? r.dollarsGained / Math.abs(totalDollarGain) : 0,
  }));
  attribution.sort((a, b) => b.dollarsGained - a.dollarsGained);

  return {
    startDate,
    endDate,
    twr,
    twrAnnualized,
    irr: null,        // populated by the server fn
    volatility: null, // populated by the server fn
    maxDrawdown: null,
    sharpe: null,
    moic: null,       // populated by the server fn
    riskFreeRate: 0.045,
    attribution,
    subPeriods,
    startValue: startTotal,
    endValue: endSnap.totalMarketValue,
    totalDays,
    totalContributions: 0, // populated by the server fn
    totalDistributions: 0, // populated by the server fn
    benchmarkReturn,
    benchmarkAnnualized,
    qqqReturn,
    qqqAnnualized,
    beta: null,    // populated by the server fn
    betaQQQ: null, // populated by the server fn
    chartPoints,
  };
}
