import type { SubPeriod, ChartPoint } from "./twr";

/**
 * Annualized volatility from sub-period returns.
 * Normalizes each sub-period to a daily return before computing variance so that
 * short and long sub-periods are compared on the same scale, then scales by √252.
 * Same-day (0-length) sub-periods from in-kind boundaries are excluded.
 * Returns null when fewer than 4 meaningful sub-periods are available.
 */
export function annualizedVolatility(subPeriods: SubPeriod[]): number | null {
  // Exclude same-day sub-periods (in-kind transfer boundaries — always 0% return, add noise)
  const meaningful = subPeriods.filter((sp) => sp.start !== sp.end);
  if (meaningful.length < 4) return null;

  const calDaysPerPeriod = meaningful.map((sp) =>
    (new Date(sp.end + "T00:00:00Z").getTime() -
      new Date(sp.start + "T00:00:00Z").getTime()) /
    86400_000,
  );
  // Normalize each sub-period return to a per-day equivalent before computing variance.
  // This prevents short sub-periods (1-day in-kind splits) from inflating variance
  // relative to long sub-periods with comparable absolute moves.
  const dailyReturns = meaningful.map((sp, i) =>
    Math.pow(1 + sp.periodReturn, 1 / Math.max(1, calDaysPerPeriod[i])) - 1,
  );

  const mean = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length;
  const variance =
    dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (dailyReturns.length - 1);

  return Math.sqrt(variance * 252);
}

/**
 * Portfolio beta vs. a benchmark.
 * Normalizes each sub-period return to a daily equivalent so that periods of
 * different lengths are weighted fairly, then computes Cov(portfolio, bench) / Var(bench).
 */
export function portfolioBeta(
  subPeriods: SubPeriod[],
  benchmarkPrices: Record<string, number>,
): number | null {
  const meaningful = subPeriods.filter((sp) => sp.start !== sp.end);
  if (meaningful.length < 4) return null;

  const portfolioDaily: number[] = [];
  const benchDaily: number[] = [];

  for (const sp of meaningful) {
    const bStart = benchmarkPrices[sp.start];
    const bEnd = benchmarkPrices[sp.end];
    if (!bStart || !bEnd) continue;

    const calDays = Math.max(
      1,
      (new Date(sp.end + "T00:00:00Z").getTime() -
        new Date(sp.start + "T00:00:00Z").getTime()) /
        86400_000,
    );
    portfolioDaily.push(Math.pow(1 + sp.periodReturn, 1 / calDays) - 1);
    benchDaily.push(Math.pow(1 + (bEnd / bStart - 1), 1 / calDays) - 1);
  }

  if (portfolioDaily.length < 4) return null;

  const n = portfolioDaily.length;
  const meanP = portfolioDaily.reduce((s, r) => s + r, 0) / n;
  const meanB = benchDaily.reduce((s, r) => s + r, 0) / n;

  let cov = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    cov += (portfolioDaily[i] - meanP) * (benchDaily[i] - meanB);
    varB += (benchDaily[i] - meanB) ** 2;
  }

  return varB > 0 ? cov / varB : null;
}

/**
 * Maximum peak-to-trough drawdown from the cumulative return series.
 * Returns a positive decimal (0.15 = 15% drawdown), or null if no data.
 */
export function maxDrawdown(chartPoints: ChartPoint[]): number | null {
  if (chartPoints.length < 2) return null;
  let peak = -Infinity;
  let maxDD = 0;
  for (const pt of chartPoints) {
    const val = 1 + pt.portfolioReturn;
    if (val > peak) peak = val;
    const dd = (peak - val) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

/**
 * Sharpe ratio: (annualizedReturn − riskFreeRate) / annualizedVolatility.
 * riskFreeRate defaults to 4.5% (approximate short-term rate, 2024–2025).
 */
export function sharpeRatio(
  annualizedReturn: number,
  volatility: number,
  riskFreeRate = 0.045,
): number {
  if (volatility <= 0) return 0;
  return (annualizedReturn - riskFreeRate) / volatility;
}
