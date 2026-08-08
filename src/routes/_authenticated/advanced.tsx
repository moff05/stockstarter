import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePortfolio } from "@/hooks/use-portfolio";
import { AsOfDatePicker } from "@/components/AsOfDatePicker";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SortHead, useSortable, sortRows } from "@/components/SortHead";
import { KpiLabel } from "@/components/KpiLabel";
import { formatMoney, isoAddDays } from "@/lib/portfolio";
import { getSector } from "@/lib/sector";
import { getNavHistory, getPerformance, getInceptionDate } from "@/lib/performance.functions";
import { useAccountFilter } from "@/lib/account-filter";
import { SPY_SECTOR_WEIGHTS, QQQ_SECTOR_WEIGHTS } from "@/lib/index-sector-weights";
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Legend, Tooltip,
  ResponsiveContainer, ReferenceLine, LineChart, Line,
} from "recharts";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Loader2 } from "lucide-react";
import { buildSnapshot } from "@/lib/portfolio";
import type { Transaction } from "@/lib/portfolio";
import type { ChartPoint, AttributionRow, SubPeriod } from "@/lib/twr";

export const Route = createFileRoute("/_authenticated/advanced")({
  head: () => ({ meta: [{ title: "Advanced Analytics — StockStarter" }] }),
  component: AdvancedPage,
});

const TICK = { fontSize: 11, fill: "currentColor" };
const TOOLTIP_STYLE = {
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  border: "1px solid var(--color-border)",
  borderRadius: 10,
  fontSize: 13,
  fontWeight: 500,
  boxShadow: "0 8px 24px rgba(0,0,0,0.13)",
  padding: "8px 14px",
};

function localDateStr(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ────────────────────────────────────────────────────────────────────────
   Capital Snapshot (moved from Dashboard)
   ──────────────────────────────────────────────────────────────────────── */

type NavPeriod = "1D" | "1W" | "6M" | "YTD" | "1Y" | "3Y" | "5Y" | "Max";
const NAV_PERIODS: NavPeriod[] = ["1D", "1W", "6M", "YTD", "1Y", "3Y", "5Y", "Max"];

function getNavCutoff(period: NavPeriod, asOfDate?: string): string {
  const refMs = asOfDate ? new Date(asOfDate + "T12:00:00").getTime() : Date.now();
  switch (period) {
    case "1D":  return localDateStr(new Date(refMs -          86400_000));
    case "1W":  return localDateStr(new Date(refMs -      7 * 86400_000));
    case "6M":  return localDateStr(new Date(refMs -    180 * 86400_000));
    case "YTD": {
      const y = asOfDate ? parseInt(asOfDate.slice(0, 4)) : new Date().getFullYear();
      return `${y}-01-01`;
    }
    case "1Y":  return localDateStr(new Date(refMs -    365 * 86400_000));
    case "3Y":  return localDateStr(new Date(refMs -  3*365 * 86400_000));
    case "5Y":  return localDateStr(new Date(refMs -  5*365 * 86400_000));
    default:    return ""; // "Max"
  }
}

function getNavAtDate(series: { date: string; value: number }[], targetDate: string): number {
  let best = 0;
  for (const p of series) {
    if (p.date <= targetDate) best = p.value;
    else break;
  }
  return best;
}

function periodSince(period: NavPeriod, navSeries: { date: string; value: number }[], asOfDate?: string): string {
  let startDate: string;
  if (period === "Max") {
    startDate = navSeries[0]?.date ?? "";
  } else {
    startDate = getNavCutoff(period, asOfDate);
  }
  if (!startDate) return "";
  const d = new Date(startDate + "T00:00:00Z");
  return `Since ${d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })}`;
}

function PeriodToggle({ value, onChange, compact }: {
  value: NavPeriod;
  onChange: (p: NavPeriod) => void;
  compact?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-0.5 w-fit rounded-full glass-surface p-0.5">
      {NAV_PERIODS.map((p) => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className={cn(
            "rounded font-medium transition-colors",
            compact ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs",
            value === p
              ? "bg-primary text-primary-foreground shadow-[0_0_10px_-4px_var(--primary)]"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {p}
        </button>
      ))}
    </div>
  );
}

function computePeriodActivity(
  txns: Transaction[],
  periodStart: string,
  startNavMV: number,
  endNavMV: number,
  asOf: string,
) {
  const dayBefore = isoAddDays(periodStart, -1);
  const startSnap = buildSnapshot(txns, dayBefore, {});
  const startingBalance = startNavMV;
  const endingBalance = endNavMV;

  const periodTxns = txns
    .filter((t) => t.trade_date >= periodStart && t.trade_date <= asOf)
    .slice()
    .sort((a, b) => a.trade_date.localeCompare(b.trade_date));

  let contributions = 0, distributions = 0, dividends = 0, interest = 0, fees = 0, realized = 0;

  const positions: Record<string, { qty: number; cost: number }> = {};
  for (const h of startSnap.holdings) {
    positions[h.symbol] = { qty: h.quantity, cost: h.costBasis };
  }

  for (const t of periodTxns) {
    const sym = (t.symbol ?? "").toUpperCase();
    const qty = Math.abs(Number(t.quantity ?? 0));
    const px  = Number(t.price ?? 0);
    const amt = Number(t.amount ?? 0);
    const fee = Number(t.fees ?? 0);
    fees += fee;

    switch (t.action) {
      case "BUY": {
        const pos = (positions[sym] ??= { qty: 0, cost: 0 });
        pos.qty  += qty;
        pos.cost += Math.abs(amt) || qty * px + fee;
        break;
      }
      case "SELL": {
        const pos = positions[sym] ?? { qty: 0, cost: 0 };
        const avg = pos.qty > 0 ? pos.cost / pos.qty : 0;
        const sellQty = Math.min(qty, pos.qty);
        const proceeds = Math.abs(amt) || qty * px - fee;
        realized += proceeds - avg * sellQty;
        pos.qty  -= sellQty;
        pos.cost -= avg * sellQty;
        break;
      }
      case "DIVIDEND":     dividends += amt; break;
      case "INTEREST":     interest  += amt; break;
      case "CONTRIBUTION": contributions += Math.abs(amt); break;
      case "DISTRIBUTION": distributions += Math.abs(amt); break;
    }
  }

  const unrealizedChange =
    endingBalance - startingBalance - contributions + distributions - dividends - interest - realized + fees;

  return { startingBalance, contributions, distributions, dividends, interest, fees, realized, unrealizedChange, endingBalance };
}

type ActivityLine = { label: string; value: number; indent?: boolean; bold?: boolean; separator?: boolean };

function CapitalSnapshot({
  txns, navSeries, endMV, period, asOf,
}: {
  txns: Transaction[];
  navSeries: { date: string; value: number }[];
  endMV: number;
  period: NavPeriod;
  asOf: string;
}) {
  const activity = useMemo(() => {
    let cutoff: string;
    if (period === "Max") {
      if (navSeries.length === 0) return null;
      cutoff = navSeries[0].date;
    } else {
      cutoff = getNavCutoff(period, asOf);
      if (!cutoff) return null;
    }
    const startNavMV = getNavAtDate(navSeries, cutoff);
    if (startNavMV === 0 && navSeries.length === 0) return null;
    return computePeriodActivity(txns, cutoff, startNavMV, endMV, asOf);
  }, [txns, navSeries, endMV, period, asOf]);

  const since = periodSince(period, navSeries, asOf);

  if (!activity) return (
    <div className="flex-1 flex items-center justify-center text-center text-xs text-muted-foreground py-8">
      No activity yet for this period.
    </div>
  );

  const lines: ActivityLine[] = [
    { label: "Starting Balance", value: activity.startingBalance, bold: true },
    { label: "Contributions",    value: activity.contributions,   indent: true },
    { label: "Distributions",    value: -activity.distributions,  indent: true },
    { label: "Interest",         value: activity.interest,        indent: true },
    { label: "Dividends",        value: activity.dividends,       indent: true },
    { label: "Fees & Exp.",      value: -activity.fees,           indent: true },
    { label: "Unrealized G/L",   value: activity.unrealizedChange,indent: true },
    { label: "Realized G/L",     value: activity.realized,        indent: true },
    { label: "Ending Balance",   value: activity.endingBalance,   bold: true, separator: true },
  ];

  return (
    <div>
      <p className="text-xs text-muted-foreground mb-1">
        {period} period{since ? <span className="text-muted-foreground"> · {since}</span> : null}
      </p>
      <table className="w-full text-xs mt-1">
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className={cn(l.separator ? "border-t border-border/60" : "")}>
              <td className={cn("py-1.5", l.indent ? "pl-3 text-muted-foreground" : "font-semibold text-foreground")}>
                {l.label}
              </td>
              <td className={cn(
                "py-1.5 text-right tabular-nums",
                l.bold ? "font-semibold text-foreground" : "",
                l.value < 0 ? "text-loss" : l.value > 0 && l.indent ? "text-gain" : "text-foreground",
              )}>
                {formatMoney(l.value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   Performance helpers (moved from Performance page)
   ──────────────────────────────────────────────────────────────────────── */

function fmt(n: number, decimals = 2) {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(decimals)}%`;
}
function fmtBig(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000)    return `$${(n / 1_000).toFixed(0)}K`;
  return formatMoney(n);
}
function numCls(s: string, colorCls = "") {
  const n = s.replace(/[^0-9.,%-+$]/g, "").length;
  const size = n > 13 ? "text-base" : n > 10 ? "text-lg" : n > 7 ? "text-xl" : "text-2xl";
  return cn(size, "font-bold tracking-tight tabular-nums leading-tight", colorCls);
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

type BenchSym = "SPY" | "QQQ";
const BENCH_LABELS: Record<BenchSym, string> = { SPY: "S&P 500", QQQ: "NASDAQ 100" };

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
  chainedReturn: number;
};

function quarterEndDate(iso: string): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const endMonth = Math.ceil(m / 3) * 3;
  const d = new Date(Date.UTC(y, endMonth, 0));
  return d.toISOString().slice(0, 10);
}
function yearEndDate(iso: string): string {
  return `${iso.slice(0, 4)}-12-31`;
}

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
        externalFlow: 0,
        periodReturn: partBReturn,
      };
    }
  }
  return result;
}

function rollupByQuarterAndYear(subPeriods: SubPeriod[]): RollupRow[] {
  if (subPeriods.length === 0) return [];
  const split = splitAtBoundaries(subPeriods, quarterEndDate);
  function bucketKey(iso: string) {
    const y = iso.slice(0, 4);
    const m = Number(iso.slice(5, 7));
    const q = Math.ceil(m / 3);
    return `${y}-Q${q}`;
  }
  const buckets = new Map<string, SubPeriod[]>();
  for (const sp of split) {
    const key = bucketKey(sp.start);
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
              <XAxis dataKey="symbol" tick={TICK} tickLine={false} axisLine={false} />
              <YAxis
                tickFormatter={(v: number) => {
                  const abs = Math.abs(v);
                  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
                  if (abs >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
                  return `$${v.toFixed(0)}`;
                }}
                tick={TICK} tickLine={false} axisLine={false} width={60}
              />
              <ReferenceLine y={0} stroke="var(--color-border)" />
              <Tooltip content={<AttributionTooltip />} cursor={{ fill: "var(--color-muted)", opacity: 0.3 }} />
              <Bar dataKey="dollarsGained" radius={[3, 3, 0, 0]}>
                {rows.map((row, i) => (
                  <Cell key={i} fill={row.dollarsGained >= 0 ? "#4E9B72" : "#C1573C"} />
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
            <SortHead label="Capital Added"    sortKey="netInvested"     sort={sort} onSort={handleSort} className="text-right" tip="Money added to (or pulled out of) this position during the period, separate from market gains." />
            <SortHead label="End Value"        sortKey="endValue"        sort={sort} onSort={handleSort} className="text-right" />
            <SortHead label="$ Gain / Loss"    sortKey="dollarsGained"   sort={sort} onSort={handleSort} className="text-right" tip="Dollar gain or loss from price movement alone — capital you added or withdrew doesn't count as a gain." />
            <SortHead label="Return"           sortKey="positionReturn"  sort={sort} onSort={handleSort} className="text-right" />
            <SortHead label="% of Gain"         sortKey="contribution"    sort={sort} onSort={handleSort} className="text-right" tip="This position's share of your portfolio's total dollar gain or loss for the period." />
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

type PerfPeriod = "YTD" | "1Y" | "3Y" | "Inception";
function getPeriodDates(period: PerfPeriod, inceptionDate: string | null): { start: string; end: string } {
  const today = localDateStr();
  const thisYear = today.slice(0, 4);
  switch (period) {
    case "YTD":       return { start: `${thisYear}-01-01`, end: today };
    case "1Y":        return { start: isoAddDays(today, -365), end: today };
    case "3Y":        return { start: isoAddDays(today, -3 * 365), end: today };
    case "Inception": return { start: inceptionDate ?? `${thisYear}-01-01`, end: today };
  }
}

/* ────────────────────────────────────────────────────────────────────────
   Page
   ──────────────────────────────────────────────────────────────────────── */

function AdvancedPage() {
  const today = localDateStr();
  const [asOf, setAsOf] = useState(today);
  const [snapshotPeriod, setSnapshotPeriod] = useState<NavPeriod>("YTD");
  const [sectorBenchmark, setSectorBenchmark] = useState<"SPY" | "QQQ">("SPY");
  const [perfPeriod, setPerfPeriod] = useState<PerfPeriod>("YTD");
  const [benchSym, setBenchSym] = useState<BenchSym>("SPY");

  const { account } = useAccountFilter();
  const { snapshot, txns, isLoading } = usePortfolio(asOf);

  const clientToday = localDateStr();
  const navQ = useQuery({
    queryKey: ["nav-history", account ?? "all", clientToday],
    queryFn: () => getNavHistory({ data: { account, maxDate: localDateStr() } }),
    staleTime: 10 * 60_000,
  });
  const navSeries = navQ.data ?? [];

  const sectorChartData = useMemo(() => {
    const portfolioMap: Record<string, number> = {};
    for (const h of snapshot.holdings) {
      const s = getSector(h.symbol);
      portfolioMap[s] = (portfolioMap[s] ?? 0) + h.weightPct;
    }
    const allSectors = new Set([
      ...Object.keys(portfolioMap),
      ...Object.keys(SPY_SECTOR_WEIGHTS),
      ...Object.keys(QQQ_SECTOR_WEIGHTS),
    ]);
    return Array.from(allSectors)
      .map((s) => ({
        sector: s,
        Portfolio: parseFloat((portfolioMap[s] ?? 0).toFixed(2)),
        SPY:       parseFloat((SPY_SECTOR_WEIGHTS[s] ?? 0).toFixed(2)),
        QQQ:       parseFloat((QQQ_SECTOR_WEIGHTS[s] ?? 0).toFixed(2)),
      }))
      .filter((d) => d.Portfolio > 0.1 || d.SPY > 0 || d.QQQ > 0)
      .sort((a, b) => b.Portfolio - a.Portfolio);
  }, [snapshot.holdings]);

  const sectorYMax = useMemo(() => {
    if (sectorChartData.length === 0) return 50;
    let max = 0;
    for (const d of sectorChartData) max = Math.max(max, d.Portfolio, d.SPY, d.QQQ);
    return Math.ceil(max / 5) * 5;
  }, [sectorChartData]);

  // Performance data — own period/benchmark controls, independent of the main Performance page.
  const inceptionQ = useQuery({
    queryKey: ["inception-date", account ?? "all"],
    queryFn: () => getInceptionDate({ data: { account } }),
    staleTime: Infinity,
  });
  const inceptionDate = inceptionQ.data ?? null;
  const { start: perfStart, end: perfEnd } = getPeriodDates(perfPeriod, inceptionDate);
  const perfQ = useQuery({
    queryKey: ["performance", perfStart, perfEnd, account ?? "all"],
    queryFn: () => getPerformance({ data: { startDate: perfStart, endDate: perfEnd, account } }),
    staleTime: 2 * 60_000,
    enabled: !!perfStart && perfStart < perfEnd && (perfPeriod !== "Inception" || !!inceptionDate),
  });
  const result = perfQ.data;
  const perfLoading = perfQ.isFetching;
  const perfPeriods: PerfPeriod[] = ["YTD", "1Y", "3Y", "Inception"];

  return (
    <div className="p-6 lg:p-8 space-y-6 text-muted-foreground">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Advanced Analytics</h1>
        <p className="text-sm mt-0.5">
          Deeper metrics for people who want them — risk stats, benchmark comparisons, and full capital
          accounting. Nothing here is needed for the everyday Dashboard/Performance view.
        </p>
      </div>

      {/* Capital Snapshot */}
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Card className="p-5 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground">Capital Snapshot</h2>
            <AsOfDatePicker value={asOf} onChange={setAsOf} />
          </div>
          <PeriodToggle value={snapshotPeriod} onChange={setSnapshotPeriod} compact />
          <div className="mt-3 flex-1 flex flex-col">
            {isLoading ? (
              <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground animate-pulse">Loading…</div>
            ) : (
              <CapitalSnapshot txns={txns} navSeries={navSeries} endMV={snapshot.totalMarketValue} period={snapshotPeriod} asOf={asOf} />
            )}
          </div>
        </Card>

        {/* Sector Allocation vs. Benchmarks */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Sector Allocation vs. Benchmarks</h2>
              <p className="text-xs mt-0.5">Portfolio weight by sector vs. {sectorBenchmark === "SPY" ? "S&P 500 (SPY)" : "NASDAQ 100 (QQQ)"}</p>
            </div>
            <div className="flex gap-0.5 rounded-full glass-surface p-0.5">
              {(["SPY", "QQQ"] as const).map((b) => (
                <button
                  key={b}
                  onClick={() => setSectorBenchmark(b)}
                  className={cn(
                    "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                    sectorBenchmark === b
                      ? "bg-primary text-primary-foreground shadow-[0_0_10px_-4px_var(--primary)]"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {b}
                </button>
              ))}
            </div>
          </div>
          {sectorChartData.length === 0 ? (
            <div className="h-[280px] flex items-center justify-center text-sm">No positions yet.</div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={sectorChartData} margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="sector" tick={{ ...TICK, fontSize: 10 } as any} tickLine={false} axisLine={false} angle={-45} textAnchor="end" interval={0} height={75} />
                <YAxis tickFormatter={(v) => `${v}%`} tick={TICK} tickLine={false} axisLine={false} width={40} domain={[0, sectorYMax]} />
                <Tooltip formatter={(v: number, name: string) => [`${v.toFixed(2)}%`, name]} contentStyle={TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                <Bar dataKey="Portfolio" fill="#C9A050" maxBarSize={22} />
                {sectorBenchmark === "SPY"
                  ? <Bar dataKey="SPY" fill="#6b6455" maxBarSize={22} />
                  : <Bar dataKey="QQQ" fill="#8B6FB0" maxBarSize={22} />
                }
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* Advanced performance metrics */}
      <div className="pt-2 border-t border-border">
        <div className="flex flex-wrap items-end justify-between gap-4 py-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-foreground">Risk &amp; Attribution</h2>
            <p className="text-sm mt-0.5">Beta, IRR, MOIC, volatility, Sharpe, and per-position attribution.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 rounded-full glass-surface p-1">
              {(["SPY", "QQQ"] as BenchSym[]).map((b) => (
                <button key={b} onClick={() => setBenchSym(b)}
                  className={cn("px-2.5 py-1 rounded text-xs font-medium transition-colors",
                    benchSym === b ? "bg-primary text-primary-foreground shadow-[0_0_10px_-4px_var(--primary)]" : "text-muted-foreground hover:text-foreground")}>
                  vs. {BENCH_LABELS[b]}
                </button>
              ))}
            </div>
            <div className="flex gap-1 rounded-full glass-surface p-1">
              {perfPeriods.map((p) => (
                <button key={p} onClick={() => setPerfPeriod(p)} disabled={p === "Inception" && !inceptionDate}
                  className={cn("px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                    perfPeriod === p ? "bg-primary text-primary-foreground shadow-[0_0_10px_-4px_var(--primary)]" : "text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed")}>
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>

        {perfLoading && (
          <div className="flex items-center gap-2 text-sm mb-4">
            <Loader2 className="w-4 h-4 animate-spin" />
            Fetching historical prices — this may take a moment on first load.
          </div>
        )}

        {result && !perfLoading && (
          <div className="space-y-4">
            <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
              <Card className="p-5 min-w-0">
                {(() => {
                  const beta = benchSym === "QQQ" ? result.betaQQQ : result.beta;
                  const benchLabel = BENCH_LABELS[benchSym];
                  if (beta != null) {
                    const desc = beta > 1.05 ? "more volatile than market" : beta < 0.95 ? "less volatile than market" : "moves with market";
                    return (
                      <>
                        <KpiLabel tip="How much your portfolio tends to move relative to the benchmark. 1.0 = moves with it, above 1.0 = swings harder in both directions, below 1.0 = steadier.">Portfolio Beta</KpiLabel>
                        <div className="text-2xl font-bold tabular-nums leading-tight text-foreground">{beta.toFixed(2)}</div>
                        <div className="text-xs mt-1 text-muted-foreground">vs. {benchLabel} — {desc}</div>
                      </>
                    );
                  }
                  return (
                    <>
                      <KpiLabel tip="How much your portfolio tends to move relative to the benchmark. 1.0 = moves with it, above 1.0 = swings harder in both directions, below 1.0 = steadier.">Portfolio Beta</KpiLabel>
                      <div className="text-2xl font-bold tracking-tight text-muted-foreground">—</div>
                      <div className="text-xs mt-1">needs ≥ 4 sub-periods</div>
                    </>
                  );
                })()}
              </Card>

              <Card className="p-5 min-w-0">
                <KpiLabel tip="Internal rate of return: the annualized growth rate that accounts for exactly when you added or withdrew money, not just the start and end value.">IRR</KpiLabel>
                {result.irr != null ? (
                  <>
                    <div className={numCls(fmt(result.irr), result.irr >= 0 ? "text-gain" : "text-loss")}>{fmt(result.irr)}</div>
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
                <KpiLabel tip="Multiple on invested capital: total value divided by total cash put in. 1.50x means every dollar invested is now worth $1.50.">MOIC</KpiLabel>
                {result.moic != null ? (
                  <>
                    <div className={cn("text-2xl font-bold tracking-tight tabular-nums", result.moic >= 1 ? "text-gain" : "text-loss")}>{result.moic.toFixed(2)}x</div>
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
                <KpiLabel tip="Return earned per unit of risk taken, above the risk-free rate. Higher is better — it rewards steady gains over volatile ones, not just raw return.">Sharpe Ratio</KpiLabel>
                {result.sharpe != null ? (
                  <>
                    <div className={cn("text-2xl font-bold tracking-tight tabular-nums", result.sharpe >= 1 ? "text-gain" : result.sharpe >= 0 ? "text-foreground" : "text-loss")}>{result.sharpe.toFixed(2)}</div>
                    <div className="text-xs mt-1 text-muted-foreground">&gt;1.0 good · &gt;2.0 excellent · risk-free {(result.riskFreeRate * 100).toFixed(2)}%</div>
                  </>
                ) : (
                  <>
                    <div className="text-2xl font-bold tracking-tight text-muted-foreground">—</div>
                    <div className="text-xs mt-1">requires volatility</div>
                  </>
                )}
              </Card>
            </div>

            <AttributionSection rows={result.attribution} />
            {result.subPeriods.length > 0 && <SubPeriodsSection subPeriods={result.subPeriods} />}
          </div>
        )}

        {!result && !perfLoading && (
          <Card className="p-10 text-center text-sm">No transaction data found for this period.</Card>
        )}
      </div>
    </div>
  );
}
