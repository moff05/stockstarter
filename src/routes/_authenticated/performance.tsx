import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { SortHead, useSortable, sortRows } from "@/components/SortHead";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  LineChart,
  BarChart,
  Bar,
  Cell,
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Loader2 } from "lucide-react";
import type { ChartPoint, AttributionRow, SubPeriod } from "@/lib/twr";
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

function ReturnBadge({ value }: { value: number }) {
  const positive = value >= 0;
  return (
    <span className={cn("inline-flex items-center gap-1 font-semibold tabular-nums", positive ? "text-gain" : "text-loss")}>
      {positive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
      {fmt(value)}
    </span>
  );
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

function AttributionTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload as AttributionRow;
  const pos = row.dollarsGained >= 0;
  return (
    <div className="bg-card border border-border rounded-lg shadow-lg px-3 py-2 text-sm space-y-1 min-w-[200px]">
      <div className="font-semibold text-foreground">{label}</div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">$ Gain/Loss</span>
        <span className={cn("font-semibold tabular-nums", pos ? "text-gain" : "text-loss")}>
          {pos ? "+" : ""}{formatMoney(row.dollarsGained)}
        </span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">% of Gain</span>
        <span className={cn("font-semibold tabular-nums", pos ? "text-gain" : "text-loss")}>
          {fmt(row.contribution)}
        </span>
      </div>
      {row.startValue > 0 && (
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Position return</span>
          <span className={cn("tabular-nums", row.positionReturn >= 0 ? "text-gain" : "text-loss")}>
            {fmt(row.positionReturn)}
          </span>
        </div>
      )}
    </div>
  );
}

type RollupRow = {
  label: string;
  startValue: number;
  endValue: number;
  externalFlow: number;
  chainedReturn: number; // chain-linked over all sub-periods in the bucket
};

/** Last calendar day of the quarter containing `iso` (e.g. "2025-11-07" → "2025-12-31"). */
function quarterEndDate(iso: string): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const endMonth = Math.ceil(m / 3) * 3; // 3, 6, 9, or 12
  // Date.UTC with 0-indexed month: month=endMonth, day=0 → last day of (endMonth)
  const d = new Date(Date.UTC(y, endMonth, 0));
  return d.toISOString().slice(0, 10);
}

/** Last calendar day of the year containing `iso`. */
function yearEndDate(iso: string): string {
  return `${iso.slice(0, 4)}-12-31`;
}

/**
 * Split sub-periods at calendar boundaries (quarter-ends or year-ends) so that
 * every resulting sub-period lives entirely within one bucket. Uses compound
 * interpolation: partReturn = (1+totalReturn)^frac − 1. This ensures
 * Q-n endValue === Q-(n+1) startValue with no gaps or jumps.
 */
function splitAtBoundaries(periods: SubPeriod[], getBoundary: (iso: string) => string): SubPeriod[] {
  const result: SubPeriod[] = [];
  for (const sp of periods) {
    let remaining: SubPeriod = sp;
    for (let guard = 0; guard < 100; guard++) {
      const startBucket = getBoundary(remaining.start);
      const endBucket = getBoundary(remaining.end);
      if (startBucket === endBucket) {
        result.push(remaining);
        break;
      }
      // Split at startBucket (the quarter/year-end of the starting bucket)
      const splitAt = startBucket;
      const splitNext = isoAddDays(splitAt, 1);
      const totalMs = Date.parse(remaining.end) - Date.parse(remaining.start);
      const partAMs = Date.parse(splitAt) - Date.parse(remaining.start);
      const frac = totalMs > 0 ? Math.min(1, Math.max(0, partAMs / totalMs)) : 0;
      const partAReturn = frac > 0 ? Math.pow(1 + remaining.periodReturn, frac) - 1 : 0;
      const partBReturn = frac < 1 ? (1 + remaining.periodReturn) / (1 + partAReturn) - 1 : 0;
      const midValue = remaining.startValue * (1 + partAReturn);
      result.push({
        start: remaining.start,
        end: splitAt,
        startValue: remaining.startValue,
        endValue: midValue,
        externalFlow: remaining.externalFlow,
        periodReturn: partAReturn,
      });
      remaining = {
        start: splitNext,
        end: remaining.end,
        startValue: midValue,
        endValue: remaining.endValue,
        externalFlow: 0, // original flow was in part A
        periodReturn: partBReturn,
      };
    }
  }
  return result;
}

function rollupByQuarterAndYear(subPeriods: SubPeriod[]): RollupRow[] {
  if (subPeriods.length === 0) return [];

  // Split any sub-periods that straddle quarter boundaries so start/end values align.
  const split = splitAtBoundaries(subPeriods, quarterEndDate);

  function bucketKey(iso: string) {
    const y = iso.slice(0, 4);
    const m = Number(iso.slice(5, 7));
    const q = Math.ceil(m / 3);
    return `${y}-Q${q}`;
  }

  const buckets = new Map<string, SubPeriod[]>();
  for (const sp of split) {
    const key = bucketKey(sp.start); // bucket by start so each row covers its own calendar quarter
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(sp);
  }

  const rows: RollupRow[] = [];
  for (const [label, periods] of buckets) {
    const sorted = [...periods].sort((a, b) => a.start.localeCompare(b.start));
    let product = 1;
    for (const sp of sorted) product *= 1 + sp.periodReturn;
    const extFlow = sorted.reduce((s, sp) => s + sp.externalFlow, 0);
    rows.push({
      label,
      startValue: sorted[0].startValue,
      endValue: sorted[sorted.length - 1].endValue,
      externalFlow: extFlow,
      chainedReturn: product - 1,
    });
  }

  return rows.sort((a, b) => a.label.localeCompare(b.label));
}

function SubPeriodsSection({ subPeriods }: { subPeriods: SubPeriod[] }) {
  const [view, setView] = useState<"quarterly" | "annual">("quarterly");

  const quarterlyRows = useMemo(() => rollupByQuarterAndYear(subPeriods), [subPeriods]);
  const annualRows = useMemo(() => {
    if (subPeriods.length === 0) return [];
    const split = splitAtBoundaries(subPeriods, yearEndDate);
    const yearBuckets = new Map<string, SubPeriod[]>();
    for (const sp of split) {
      const y = sp.start.slice(0, 4);
      if (!yearBuckets.has(y)) yearBuckets.set(y, []);
      yearBuckets.get(y)!.push(sp);
    }
    return Array.from(yearBuckets.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([year, periods]) => {
        const sorted = [...periods].sort((a, b) => a.start.localeCompare(b.start));
        let product = 1;
        for (const sp of sorted) product *= 1 + sp.periodReturn;
        return {
          label: year,
          startValue: sorted[0].startValue,
          endValue: sorted[sorted.length - 1].endValue,
          externalFlow: sorted.reduce((s, sp) => s + sp.externalFlow, 0),
          chainedReturn: product - 1,
        };
      });
  }, [subPeriods]);

  const rows = view === "quarterly" ? quarterlyRows : annualRows;

  return (
    <Card>
      <div className="px-5 py-4 border-b flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-foreground">Period Returns</h2>
          <p className="text-xs mt-0.5">Returns chain-linked across cash flow sub-periods within each bucket.</p>
        </div>
        <div className="flex gap-1 rounded-full glass-surface p-0.5 text-xs">
          {(["quarterly", "annual"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                "px-2.5 py-1 rounded font-medium transition-colors capitalize",
                view === v ? "bg-primary text-primary-foreground shadow-[0_0_10px_-4px_var(--primary)]" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Period</TableHead>
            <TableHead className="text-right">Start Value</TableHead>
            <TableHead className="text-right">End Value</TableHead>
            <TableHead className="text-right">Cash Flow</TableHead>
            <TableHead className="text-right">Return</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.label}>
              <TableCell className="font-medium text-foreground">{row.label}</TableCell>
              <TableCell className="text-right tabular-nums">{formatMoney(row.startValue)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatMoney(row.endValue)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {Math.abs(row.externalFlow) >= 1 ? (
                  <span className={row.externalFlow > 0 ? "text-primary" : "text-loss"}>
                    {row.externalFlow > 0 ? "+" : ""}{formatMoney(row.externalFlow)}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-right">
                <ReturnBadge value={row.chainedReturn} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function AttributionSection({ rows }: { rows: AttributionRow[] }) {
  if (rows.length === 0) return null;

  const [sort, handleSort] = useSortable("dollarsGained");
  const sortedRows = useMemo(() => sortRows(rows as any[], sort), [rows, sort]);

  return (
    <Card>
      <div className="px-5 py-4 border-b">
        <h2 className="font-semibold text-foreground">Performance Attribution</h2>
        <p className="text-xs mt-0.5">
          Dollar gain/loss per position, net of any capital added or removed mid-period.
        </p>
      </div>

      <div className="p-5">
        <div className="text-muted-foreground h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
              <XAxis
                dataKey="symbol"
                tick={TICK}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tickFormatter={(v: number) => {
                  const abs = Math.abs(v);
                  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
                  if (abs >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
                  return `$${v.toFixed(0)}`;
                }}
                tick={TICK}
                tickLine={false}
                axisLine={false}
                width={60}
              />
              <ReferenceLine y={0} stroke="var(--color-border)" />
              <Tooltip content={<AttributionTooltip />} cursor={{ fill: "var(--color-muted)", opacity: 0.3 }} />
              <Bar dataKey="dollarsGained" radius={[3, 3, 0, 0]}>
                {rows.map((row, i) => (
                  <Cell key={i} fill={row.dollarsGained >= 0 ? "#1F9D6B" : "#CF4444"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <SortHead label="Symbol"           sortKey="symbol"          sort={sort} onSort={handleSort} />
            <SortHead label="Start Value"      sortKey="startValue"      sort={sort} onSort={handleSort} className="text-right" />
            <SortHead label="Capital Added"    sortKey="netInvested"     sort={sort} onSort={handleSort} className="text-right" />
            <SortHead label="End Value"        sortKey="endValue"        sort={sort} onSort={handleSort} className="text-right" />
            <SortHead label="$ Gain / Loss"    sortKey="dollarsGained"   sort={sort} onSort={handleSort} className="text-right" />
            <SortHead label="Return"           sortKey="positionReturn"  sort={sort} onSort={handleSort} className="text-right" />
            <SortHead label="% of Gain"         sortKey="contribution"    sort={sort} onSort={handleSort} className="text-right" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedRows.map((row) => {
            const pos = row.dollarsGained >= 0;
            return (
              <TableRow key={row.symbol}>
                <TableCell className="font-medium text-foreground">{row.symbol}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {row.startValue > 0 ? formatMoney(row.startValue) : <span>—</span>}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {row.netInvested > 0 ? formatMoney(row.netInvested) : <span>—</span>}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {row.endValue > 0 ? formatMoney(row.endValue) : <span>—</span>}
                </TableCell>
                <TableCell className={cn("text-right tabular-nums font-medium", pos ? "text-gain" : "text-loss")}>
                  {pos ? "+" : ""}{formatMoney(row.dollarsGained)}
                </TableCell>
                <TableCell className={cn("text-right tabular-nums",
                  row.startValue > 0 || row.netInvested > 0
                    ? (row.positionReturn >= 0 ? "text-gain" : "text-loss")
                    : "text-muted-foreground"
                )}>
                  {row.startValue > 0 || row.netInvested > 0
                    ? <>{fmt(row.positionReturn)}{row.startValue === 0 && <span className="text-muted-foreground font-normal text-[10px] ml-0.5">roi</span>}</>
                    : "—"}
                </TableCell>
                <TableCell className={cn("text-right tabular-nums font-semibold", pos ? "text-gain" : "text-loss")}>
                  {fmt(row.contribution)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <div className="px-5 py-3 border-t text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Capital Added</span> = new BUYs mid-period (in-kind transfers + cash purchases).{" "}
        <span className="font-medium text-foreground">$ Gain</span> = End − Start − Capital Added.{" "}
        <span className="font-medium text-foreground">roi</span> = gain ÷ capital added (no prior position).{" "}
        <span className="font-medium text-foreground">% of Gain</span> = this position’s $ gain ÷ total portfolio $ gain (gainers sum to &gt;100%, losers reduce it).
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
          {/* Row 1: MKT Value, Ann Return, Cum Return, Portfolio Beta */}
          <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
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

            <Card className="p-5 min-w-0">
              {(() => {
                const beta = benchSym === "QQQ" ? result.betaQQQ : result.beta;
                const benchLabel = BENCH_LABELS[benchSym];
                if (beta != null) {
                  const desc =
                    beta > 1.05
                      ? "more volatile than market"
                      : beta < 0.95
                        ? "less volatile than market"
                        : "moves with market";
                  return (
                    <>
                      <KpiLabel tip={"How much the portfolio moves relative to the benchmark.\nÎ² = 1: moves in lockstep; Î² > 1: amplifies market swings; Î² < 1: dampens them."}>Portfolio Beta</KpiLabel>
                      <div className="text-2xl font-bold tabular-nums leading-tight text-foreground">{beta.toFixed(2)}</div>
                      <div className="text-xs mt-1 text-muted-foreground">vs. {benchLabel} — {desc}</div>
                    </>
                  );
                }
                return (
                  <>
                    <KpiLabel tip={"How much the portfolio moves relative to the benchmark.\nÎ² = 1: moves in lockstep; Î² > 1: amplifies market swings; Î² < 1: dampens them."}>Portfolio Beta</KpiLabel>
                    <div className="text-2xl font-bold tracking-tight text-muted-foreground">—</div>
                    <div className="text-xs mt-1">needs ≥ 4 sub-periods</div>
                  </>
                );
              })()}
            </Card>
          </div>

          {/* Row 2: IRR, MOIC, Volatility, Sharpe */}
          <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
            <Card className="p-5 min-w-0">
              <KpiLabel tip={"Dollar-weighted return, annualized.\nUnlike TWR, big contributions before good periods boost this. Best measure of how much money actually grew."}>IRR</KpiLabel>
              {result.irr != null ? (
                <>
                  <div className={numCls(fmt(result.irr), result.irr >= 0 ? "text-gain" : "text-loss")}>
                    {fmt(result.irr)}
                  </div>
                  <div className="text-xs mt-1 text-muted-foreground">dollar-weighted, annualized</div>
                </>
              ) : (
                <>
                  <div className="text-2xl font-bold tracking-tight text-muted-foreground">—</div>
                  <div className="text-xs mt-1">insufficient cash flows</div>
                </>
              )}
            </Card>

            <Card className="p-5 min-w-0">
              <KpiLabel tip={"Formula: (end value + distributions) ÷ (start value + contributions)\n1.5× means $1 in → $1.50 out."}>MOIC</KpiLabel>
              {result.moic != null ? (
                <>
                  <div className={cn("text-2xl font-bold tracking-tight tabular-nums", result.moic >= 1 ? "text-gain" : "text-loss")}>
                    {result.moic.toFixed(2)}x
                  </div>
                  <div className="text-xs mt-1 text-muted-foreground">multiple on invested capital</div>
                </>
              ) : (
                <>
                  <div className="text-2xl font-bold tracking-tight text-muted-foreground">—</div>
                  <div className="text-xs mt-1">no starting value</div>
                </>
              )}
            </Card>

            <Card className="p-5 min-w-0">
              <KpiLabel tip={"Annualized std dev of sub-period returns.\nHigher = bigger month-to-month swings."}>Volatility</KpiLabel>
              {result.volatility != null ? (
                <>
                  <div className={numCls(`${(result.volatility * 100).toFixed(2)}%`, "text-foreground")}>
                    {(result.volatility * 100).toFixed(2)}%
                  </div>
                  <div className="text-xs mt-1 text-muted-foreground">annualized std dev</div>
                </>
              ) : (
                <>
                  <div className="text-2xl font-bold tracking-tight text-muted-foreground">—</div>
                  <div className="text-xs mt-1">needs ≥ 4 sub-periods</div>
                </>
              )}
            </Card>

            <Card className="p-5 min-w-0">
              <KpiLabel tip={"Formula: (ann. return − risk-free rate) ÷ volatility\n>1.0 good · >2.0 excellent · <0 underperformed cash."}>Sharpe Ratio</KpiLabel>
              {result.sharpe != null ? (
                <>
                  <div className={cn("text-2xl font-bold tracking-tight tabular-nums", result.sharpe >= 1 ? "text-gain" : result.sharpe >= 0 ? "text-foreground" : "text-loss")}>
                    {result.sharpe.toFixed(2)}
                  </div>
                  <div className="text-xs mt-1 text-muted-foreground">
                    risk-free rate {(result.riskFreeRate * 100).toFixed(2)}%
                  </div>
                </>
              ) : (
                <>
                  <div className="text-2xl font-bold tracking-tight text-muted-foreground">—</div>
                  <div className="text-xs mt-1">requires volatility</div>
                </>
              )}
            </Card>
          </div>

          <PerformanceChart points={result.chartPoints} benchSym={benchSym} />

          <AttributionSection rows={result.attribution} />

          {result.subPeriods.length > 0 && (
            <SubPeriodsSection subPeriods={result.subPeriods} />
          )}

          {result.subPeriods.length === 0 && (
            <Card className="p-10 text-center text-sm">
              No sub-periods found for this date range.
            </Card>
          )}
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

