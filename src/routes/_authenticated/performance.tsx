import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";
import { getPerformance, getInceptionDate } from "@/lib/performance.functions";
import { useAccountFilter } from "@/lib/account-filter";
import { isoAddDays, formatMoney } from "@/lib/portfolio";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Loader2, Gauge } from "lucide-react";
import type { ChartPoint } from "@/lib/twr";
import {
  Tooltip as KTip,
  TooltipContent as KTipContent,
  TooltipProvider as KTipProvider,
  TooltipTrigger as KTipTrigger,
} from "@/components/ui/tooltip";

export const Route = createFileRoute("/_authenticated/performance")({
  head: () => ({ meta: [{ title: "Performance — StockStarter" }] }),
  component: PerformancePage,
});

function localDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
const TICK = { fontSize: 11, fill: "currentColor" };

type Period = "YTD" | "1Y" | "3Y" | "Inception";

function getPeriodDates(period: Period, inceptionDate: string | null): { start: string; end: string } {
  const today = localDateStr();
  const thisYear = today.slice(0, 4);
  switch (period) {
    case "YTD":       return { start: `${thisYear}-01-01`, end: today };
    case "1Y":        return { start: isoAddDays(today, -365), end: today };
    case "3Y":        return { start: isoAddDays(today, -3 * 365), end: today };
    case "Inception": return { start: inceptionDate ?? `${thisYear}-01-01`, end: today };
  }
}

function fmt(n: number, decimals = 2) {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(decimals)}%`;
}

/** Abbreviate a dollar value: $16.2M, $842K, or exact for < $10K. */
function fmtBig(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000)    return `$${(n / 1_000).toFixed(0)}K`;
  return formatMoney(n);
}

/** Pick a font-size class that keeps numbers inside their card. */
function numCls(s: string, colorCls = "") {
  const n = s.replace(/[^0-9.,%-+$]/g, "").length;
  const size = n > 13 ? "text-base" : n > 10 ? "text-lg" : n > 7 ? "text-xl" : "text-2xl";
  return cn(size, "font-bold tracking-tight tabular-nums leading-tight", colorCls);
}

function KpiLabel({ tip, children }: { tip: string; children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
      {children}
      <KTipProvider delayDuration={300}>
        <KTip>
          <KTipTrigger asChild>
            <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-muted-foreground/40 text-muted-foreground/50 text-[9px] leading-none hover:border-muted-foreground hover:text-muted-foreground transition-colors cursor-help flex-shrink-0">
              ?
            </span>
          </KTipTrigger>
          <KTipContent side="top" className="max-w-[200px] text-xs leading-relaxed">
            {tip}
          </KTipContent>
        </KTip>
      </KTipProvider>
    </div>
  );
}

function fmtDate(iso: string) {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

function ChartTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const dateStr: string = payload[0]?.payload?.date ?? "";
  return (
    <div className="bg-card border border-border rounded-lg shadow-lg px-3 py-2 text-sm">
      <div className="font-medium mb-1 text-foreground">{dateStr ? fmtDate(dateStr) : ""}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span style={{ color: p.color }}>●</span>
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-semibold tabular-nums" style={{ color: p.color }}>
            {fmt(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

type BenchSym = "SPY" | "QQQ";
const BENCH_LABELS: Record<BenchSym, string> = { SPY: "S&P 500", QQQ: "NASDAQ 100" };

/** Collapse chart points to one per month — always applied so that multiple sub-period
 *  boundaries in the same month (e.g. daily in-kind BUYs during a transfer) don't
 *  produce duplicate x-axis labels. */
function resampleChartPoints(pts: ChartPoint[]): ChartPoint[] {
  if (pts.length < 3) return pts;
  const months = new Map<string, ChartPoint>();
  for (const p of pts) {
    months.set(p.date.slice(0, 7), p); // YYYY-MM — last point in month wins
  }
  const resampled = Array.from(months.values());
  // Ensure the baseline (0%) start point is always included
  if (pts[0] && resampled[0]?.date !== pts[0].date) resampled.unshift(pts[0]);
  return resampled;
}

function PerformanceChart({ points, benchSym }: { points: ChartPoint[]; benchSym: BenchSym }) {
  if (points.length < 2) return null;
  const dataKey = benchSym === "QQQ" ? "qqqReturn" : "benchmarkReturn";
  const chartData = resampleChartPoints(points).map((p) => ({
    ...p,
    dateMs: new Date(p.date + "T00:00:00Z").getTime(),
  }));
  const hasBenchmark = chartData.some((p) => p[dataKey as keyof typeof p] !== null);
  const benchLabel = BENCH_LABELS[benchSym];

  return (
    <Card className="p-5">
      <div className="mb-4">
        <h2 className="font-semibold text-foreground">Cumulative Return</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Portfolio vs. {benchLabel}</p>
      </div>
      <div className="text-muted-foreground">
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
            <XAxis
              dataKey="dateMs"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(ms: number) =>
                new Date(ms).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })
              }
              tick={TICK}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
              tick={TICK}
              tickLine={false}
              axisLine={false}
              width={48}
            />
            <ReferenceLine y={0} stroke="var(--color-border)" strokeDasharray="3 3" />
            <Tooltip content={<ChartTooltip />} />
            <Legend
              wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
              formatter={(value) => <span className="text-foreground">{value}</span>}
            />
            <Line
              type="monotone"
              dataKey="portfolioReturn"
              name="Portfolio"
              stroke="#3B6FD4"
              strokeWidth={2}
              dot={chartData.length <= 20 ? { r: 3, fill: "#3B6FD4" } : false}
              activeDot={{ r: 5 }}
            />
            {hasBenchmark && (
              <Line
                type="monotone"
                dataKey={dataKey}
                name={benchLabel}
                stroke="var(--color-muted-foreground)"
                strokeWidth={2}
                strokeDasharray="5 3"
                dot={chartData.length <= 20 ? { r: 3, fill: "var(--color-muted-foreground)" } : false}
                activeDot={{ r: 5 }}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function PerformancePage() {
  const [period, setPeriod] = useState<Period>("YTD");
  const [benchSym, setBenchSym] = useState<BenchSym>("SPY");
  const { account } = useAccountFilter();

  const inceptionQ = useQuery({
    queryKey: ["inception-date", account ?? "all"],
    queryFn: () => getInceptionDate({ data: { account } }),
    staleTime: Infinity,
  });
  const inceptionDate = inceptionQ.data ?? null;

  const { start: startDate, end: endDate } = getPeriodDates(period, inceptionDate);

  const perfQ = useQuery({
    queryKey: ["performance", startDate, endDate, account ?? "all"],
    queryFn: () => getPerformance({ data: { startDate, endDate, account } }),
    staleTime: 2 * 60_000,
    enabled: !!startDate && startDate < endDate && (period !== "Inception" || !!inceptionDate),
  });

  const result = perfQ.data;
  const loading = perfQ.isFetching;

  const periods: Period[] = ["YTD", "1Y", "3Y", "Inception"];

  return (
    <div className="p-6 lg:p-8 space-y-6 text-muted-foreground">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Performance Returns</h1>
          <p className="text-sm mt-0.5">
            Time-weighted return removes the effect of contributions and withdrawals.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-full glass-surface p-1">
            {(["SPY", "QQQ"] as BenchSym[]).map((b) => (
              <button
                key={b}
                onClick={() => setBenchSym(b)}
                className={cn(
                  "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                  benchSym === b
                    ? "bg-primary text-primary-foreground shadow-[0_0_10px_-4px_var(--primary)]"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                vs. {BENCH_LABELS[b]}
              </button>
            ))}
          </div>
          <div className="flex gap-1 rounded-full glass-surface p-1">
            {periods.map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                disabled={p === "Inception" && !inceptionDate}
                className={cn(
                  "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                  period === p
                    ? "bg-primary text-primary-foreground shadow-[0_0_10px_-4px_var(--primary)]"
                    : "text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed",
                )}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          Fetching historical prices — this may take a moment on first load.
        </div>
      )}

      {result && !loading && (
        <>
          {/* Market Value, Ann Return, Cum Return */}
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
            <Card className="p-5 min-w-0">
              <KpiLabel tip="Total market value of all holdings at the most recent market close.">Market Value</KpiLabel>
              <div className="text-2xl font-bold tabular-nums leading-tight text-foreground">{fmtBig(result.endValue)}</div>
              <div className="text-xs mt-1 tabular-nums text-muted-foreground">{formatMoney(result.endValue)}</div>
            </Card>

            <Card className="p-5 min-w-0">
              <KpiLabel tip={"Time-weighted return per year.\nFormula: (1 + TWR)^(365/days) − 1\nContributions don't count as gains."}>Ann. Return</KpiLabel>
              {result.totalDays >= 365 ? (
                <>
                  <div className={numCls(fmt(result.twrAnnualized), result.twrAnnualized >= 0 ? "text-gain" : "text-loss")}>
                    {fmt(result.twrAnnualized)}
                  </div>
                  <div className="text-xs mt-1">time-weighted, per year</div>
                </>
              ) : (
                <>
                  <div className="text-2xl font-bold tracking-tight text-muted-foreground">—</div>
                  <div className="text-xs mt-1">period under 1 year</div>
                </>
              )}
            </Card>

            <Card className="p-5 min-w-0">
              <KpiLabel tip={"Total return over the period.\nFormula: ∏(1 + sub-period return) − 1\nContributions don't count as gains."}>Cum. Return</KpiLabel>
              <div className={numCls(fmt(result.twr), result.twr >= 0 ? "text-gain" : "text-loss")}>
                {fmt(result.twr)}
              </div>
              <div className="text-xs mt-1 truncate text-muted-foreground">
                {fmtDate(result.startDate)} → {fmtDate(result.endDate)}
              </div>
            </Card>
          </div>

          <PerformanceChart points={result.chartPoints} benchSym={benchSym} />

          <Link
            to="/advanced"
            className="flex items-center gap-3 rounded-xl border border-border bg-card px-5 py-4 hover:border-primary/40 transition-colors group"
          >
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 text-primary shrink-0">
              <Gauge className="w-4.5 h-4.5" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">Want more? See Beta, IRR, MOIC, Volatility, Sharpe &amp; attribution</span>
              <span className="block text-xs text-muted-foreground mt-0.5">Deeper risk stats and per-position performance breakdown live on the Advanced Analytics page.</span>
            </span>
            <span className="ml-auto text-xs font-medium text-primary group-hover:underline shrink-0">Open Advanced →</span>
          </Link>
        </>
      )}

      {!result && !loading && (
        <Card className="p-10 text-center text-sm">
          No transaction data found for this period.
        </Card>
      )}

      <p className="text-xs">
        TWR divides the period at each external cash flow, computes returns for each sub-period independently, then chain-links.
        Prices sourced from Yahoo Finance and cached locally. Benchmark: {BENCH_LABELS[benchSym]}.
      </p>
    </div>
  );
}

