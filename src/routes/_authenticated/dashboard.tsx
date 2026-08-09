import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usePortfolio } from "@/hooks/use-portfolio";
import { AsOfDatePicker } from "@/components/AsOfDatePicker";
import { DataIntegrityBanner } from "@/components/DataIntegrityBanner";
import { Card } from "@/components/ui/card";
import { formatMoney } from "@/lib/portfolio";
import { getAssetClass, getSector } from "@/lib/sector";
import { getNavHistory } from "@/lib/performance.functions";
import { getHistoricalCloses } from "@/lib/prices.functions";
import { useAccountFilter } from "@/lib/account-filter";
import { loadDemoData } from "@/lib/demo-data";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend,
  Treemap, AreaChart, Area, type TooltipProps,
} from "recharts";
import { PiggyBank, Sparkles, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — StockStarter" }] }),
  component: Dashboard,
});

// Warm charcoal + muted gold categorical palette — built from the suite tokens
// (chart-1..5) plus warm/muted extensions. Gold leads (it's the primary/brand
// hue); everything else sits in the same warm-muted family, no neon.
const PALETTE = [
  "#C9A050", // gold        (chart-1 / primary)
  "#4E9B72", // warm green  (chart-2)
  "#C1573C", // terracotta  (chart-3)
  "#6f8fae", // muted steel-blue (chart-4)
  "#6b6455", // warm slate
  "#4c9a8e", // muted teal
  "#a97c1c", // amber
  "#8B6FB0", // muted violet (chart-5)
];

// Fixed colors per GICS sector — warm, muted, on-brand and visually
// distinct; consistent across all charts.
const SECTOR_COLORS: Record<string, string> = {
  "Technology":     "#6f8fae", // muted steel-blue
  "Financials":     "#4E9B72", // warm green
  "Healthcare":     "#8B6FB0", // muted violet
  "Industrials":    "#a97c1c", // amber
  "Comm. Services": "#b5567f", // muted rose
  "Cons. Disc.":    "#c26a3a", // clay / warm orange
  "Cons. Staples":  "#7a9440", // muted olive
  "Energy":         "#C1573C", // terracotta
  "Materials":      "#4c9a8e", // muted teal
  "Real Estate":    "#9a6ea0", // mauve
  "Utilities":      "#5a8c6f", // sage
  "Bond Funds":     "#6b6455", // warm slate
  "Funds":          "#C9A050", // gold
  "Other":          "#a3998a", // warm gray
};
function sectorColor(name: string, fallbackIdx: number): string {
  return SECTOR_COLORS[name] ?? PALETTE[fallbackIdx % PALETTE.length];
}

const TICK = { fontSize: 11, fill: "currentColor" };
const RADIAN = Math.PI / 180;

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

// Expand abbreviated GICS sector names for display
const SECTOR_FULL: Record<string, string> = {
  "Comm. Services": "Communication Services",
  "Cons. Disc.":    "Consumer Discretionary",
  "Cons. Staples":  "Consumer Staples",
};
function sectorLabel(s: string) { return SECTOR_FULL[s] ?? s; }


function plBgFg(pct: number): { bg: string; fg: string } {
  if (pct >= 10)  return { bg: "#3f7a5c", fg: "#e3f3ec" };
  if (pct >= 5)   return { bg: "#4E9B72", fg: "#ecfdf5" };
  if (pct >= 2)   return { bg: "#a8cdb8", fg: "#123524" };
  if (pct >= 0)   return { bg: "#dbe8de", fg: "#123524" };
  if (pct >= -2)  return { bg: "#efd9d0", fg: "#6b2a1a" };
  if (pct >= -5)  return { bg: "#dba28c", fg: "#5c2214" };
  if (pct >= -10) return { bg: "#C1573C", fg: "#fff"    };
  return            { bg: "#8f3823",      fg: "#fff"    };
}

function TreemapContent(props: any) {
  const { x, y, width, height, name, pct, depth } = props;
  if (depth !== 1 || !name || width < 4 || height < 4) return null;
  const { bg, fg } = plBgFg(pct ?? 0);
  const isTiny  = width < 32 || height < 26;
  const isSmall = width < 52 || height < 40;
  if (isTiny) {
    return <rect x={x+1} y={y+1} width={Math.max(0,width-2)} height={Math.max(0,height-2)} fill={bg} rx={4} />;
  }
  const fontSize = Math.min(13, Math.max(9, (width / Math.max(name.length, 2)) * 1.5));
  return (
    <g>
      <rect x={x+1} y={y+1} width={Math.max(0,width-2)} height={Math.max(0,height-2)} fill={bg} rx={6} />
      <text x={x+width/2} y={y+height/2+(isSmall?1:-9)} textAnchor="middle" dominantBaseline="middle"
        fill={fg} fontSize={fontSize} fontWeight="600" fontFamily="'SourceSans3', ui-sans-serif, system-ui, sans-serif">
        {name}
      </text>
      {!isSmall && (
        <text x={x+width/2} y={y+height/2+9} textAnchor="middle" dominantBaseline="middle"
          fill={fg} fontSize={10} opacity={0.85} fontFamily="'SourceSans3', ui-sans-serif, system-ui, sans-serif">
          {pct >= 0 ? "+" : ""}{(pct ?? 0).toFixed(1)}%
        </text>
      )}
    </g>
  );
}

function TreemapTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload as { name: string; pct: number; pl: number; value: number };
  return (
    <div className="rounded-lg border bg-card px-3 py-2 text-xs shadow-lg pointer-events-none">
      <div className="font-semibold text-foreground mb-1">{d.name}</div>
      <div className={cn("tabular-nums font-medium", d.pct >= 0 ? "text-gain" : "text-loss")}>
        {d.pct >= 0 ? "+" : ""}{d.pct?.toFixed(2)}% unrealized
      </div>
      <div className="tabular-nums text-foreground">{formatMoney(d.pl ?? 0)}</div>
      <div className="text-muted-foreground mt-0.5">{formatMoney(d.value)} mkt val</div>
    </div>
  );
}

function PieSliceLabel({ cx, cy, midAngle, outerRadius, name, portfolioPct }: any) {
  if ((portfolioPct ?? 0) < 2.0) return null;
  const labelR = outerRadius + 24;
  const lineR  = outerRadius + 6;
  const lx = cx + labelR * Math.cos(-midAngle * RADIAN);
  const ly = cy + labelR * Math.sin(-midAngle * RADIAN);
  const sx = cx + lineR  * Math.cos(-midAngle * RADIAN);
  const sy = cy + lineR  * Math.sin(-midAngle * RADIAN);
  const anchor = lx > cx ? "start" : "end";
  return (
    <g>
      <line x1={sx} y1={sy} x2={lx} y2={ly} stroke="var(--color-muted-foreground)" strokeWidth={1} />
      <text x={lx} y={ly-5} textAnchor={anchor} fontSize={10} fontWeight={600} fill="var(--color-foreground)">{name}</text>
      <text x={lx} y={ly+7} textAnchor={anchor} fontSize={9} fill="var(--color-muted-foreground)">{(portfolioPct ?? 0).toFixed(1)}%</text>
    </g>
  );
}

// Tooltip: "Jun 24, 2026" — unambiguous, shows the actual day
function fmtNavDate(iso: string) {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function NavTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg shadow-lg px-3 py-2 text-sm">
      <div className="text-muted-foreground text-xs mb-1">{fmtNavDate(label)}</div>
      <div className="font-semibold text-foreground tabular-nums">{formatMoney(payload[0].value)}</div>
    </div>
  );
}

type NavPeriod = "1D" | "1W" | "6M" | "YTD" | "1Y" | "3Y" | "5Y" | "Max";

// Uses local date components to avoid UTC-offset date shifts
function localDateStr(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

// asOfDate = the "end" date for the period; defaults to today when not provided
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

function filterNavSeries(series: { date: string; value: number }[], period: NavPeriod, asOfDate?: string) {
  if (period === "Max" || series.length === 0) return series;
  const cutoff = getNavCutoff(period, asOfDate);
  return series.filter((p) => p.date >= cutoff);
}

// Collapse daily nav data to one point per month (last value in each month).
// Fixes the hybrid date-spine problem: monthly old data + daily recent data causes
// Recharts to give the recent year 365x more horizontal space than earlier years.
function resampleNavToMonthly(data: { date: string; value: number }[]): { date: string; value: number }[] {
  const months = new Map<string, { date: string; value: number }>();
  for (const p of data) {
    months.set(p.date.slice(0, 7), p); // last point per month wins (data is sorted asc)
  }
  return Array.from(months.values()).sort((a, b) => a.date.localeCompare(b.date));
}

const NAV_PERIODS: NavPeriod[] = ["1D", "1W", "6M", "YTD", "1Y", "3Y", "5Y", "Max"];

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

// â”€â”€ Dashboard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function Dashboard() {
  const today = localDateStr();
  const [asOf, setAsOf] = useState(today);

  // Clamp asOf to today on the client — guards against SSR computing a UTC date
  // that's ahead of the user's local date (e.g. server UTC = Jun 26, local CDT = Jun 24)
  useEffect(() => {
    const cap = localDateStr();
    if (asOf > cap) setAsOf(cap);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [navPeriod, setNavPeriod] = useState<NavPeriod>("YTD");
  const [treemapPeriod, setTreemapPeriod] = useState<NavPeriod>("YTD");

  const { snapshot, txns, isLoading, unmatchedSells } = usePortfolio(asOf);
  const { account } = useAccountFilter();

  const clientToday = localDateStr();
  const navQ = useQuery({
    queryKey: ["nav-history", account ?? "all", clientToday, txns.length],
    queryFn: () => getNavHistory({ data: { transactions: txns as any, maxDate: localDateStr() } }),
    staleTime: 10 * 60_000,
  });
  const navSeries = navQ.data ?? [];

  // Historical prices at treemap period start — relative to asOf, not today
  const periodStartDate = useMemo(() => {
    if (treemapPeriod === "Max") return null;
    return getNavCutoff(treemapPeriod, asOf);
  }, [treemapPeriod, asOf]);

  const holdingSymbols = useMemo(
    () => snapshot.holdings.map((h) => h.symbol),
    [snapshot.holdings],
  );

  const periodStartPricesQ = useQuery({
    queryKey: ["hist-prices-period-start", periodStartDate, holdingSymbols.join(",")],
    enabled: !!periodStartDate && holdingSymbols.length > 0,
    staleTime: 30 * 60_000,
    queryFn: () =>
      getHistoricalCloses({ data: { symbols: holdingSymbols, asOfDate: periodStartDate! } }),
  });
  const periodStartPrices = periodStartPricesQ.data ?? {};

  // â”€â”€ Treemap (treemapPeriod-based) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const treemapData = useMemo(() => snapshot.holdings
    .filter((h) => h.marketValue > 0)
    .map((h) => {
      const pStartPrice = periodStartPrices[h.symbol] ?? periodStartPrices[h.symbol.replace(".", "-")] ?? 0;
      let pct: number;
      if (pStartPrice > 0 && h.marketPrice > 0 && treemapPeriod !== "Max") {
        pct = ((h.marketPrice - pStartPrice) / pStartPrice) * 100;
      } else {
        pct = h.unrealizedPLPct;
      }
      const pl = pStartPrice > 0 && h.marketPrice > 0 && treemapPeriod !== "Max"
        ? (h.marketPrice - pStartPrice) * h.quantity
        : h.unrealizedPL;
      return { name: h.symbol, value: h.marketValue, pct, pl };
    }), [snapshot.holdings, periodStartPrices, treemapPeriod]);

  // â”€â”€ Equity sector breakdown pie — 100% = direct equity holdings only â”€â”€â”€â”€â”€â”€
  const equityBreakdownData = useMemo(() => {
    const equityHoldings = snapshot.holdings.filter((h) => getAssetClass(h.symbol) === "Equities");
    const totalEquityMV = equityHoldings.reduce((s, h) => s + h.marketValue, 0);
    const map: Record<string, number> = {};
    for (const h of equityHoldings) {
      const sector = getSector(h.symbol);
      map[sector] = (map[sector] ?? 0) + h.marketValue;
    }
    const slices = Object.entries(map)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => ({
        name, value,
        pct: totalEquityMV > 0 ? (value / totalEquityMV) * 100 : 0,
      }));
    return { totalEquityMV, slices };
  }, [snapshot.holdings]);

  // â”€â”€ Asset class breakdown (bar chart) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const assetClassData = useMemo(() => {
    const map: Record<string, { value: number; symbols: string[] }> = {};
    for (const h of snapshot.holdings) {
      const cls = getAssetClass(h.symbol);
      if (!map[cls]) map[cls] = { value: 0, symbols: [] };
      map[cls].value += h.marketValue;
      map[cls].symbols.push(h.symbol);
    }
    if (snapshot.cash > 0) {
      map["Cash"] = { value: (map["Cash"]?.value ?? 0) + snapshot.cash, symbols: map["Cash"]?.symbols ?? [] };
    }
    const total = Object.values(map).reduce((s, v) => s + v.value, 0);
    return Object.entries(map)
      .filter(([, v]) => v.value > 0)
      .sort((a, b) => b[1].value - a[1].value)
      .map(([name, v]) => ({
        name,
        value: v.value,
        symbols: v.symbols,
        portfolioPct: total > 0 ? (v.value / total) * 100 : 0,
      }));
  }, [snapshot.holdings, snapshot.cash]);

  // â”€â”€ Monthly income â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const incomeByMonth = useMemo(() => {
    const months: { month: string; label: string; Dividends: number; Interest: number }[] = [];
    const [asOfY, asOfM] = asOf.split("-").map(Number);
    for (let i = 11; i >= 0; i--) {
      const d = new Date(asOfY, asOfM - 1 - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
      months.push({ month: key, label: d.toLocaleDateString("en-US", { month: "short" }), Dividends: 0, Interest: 0 });
    }
    for (const t of txns) {
      if (t.action !== "DIVIDEND" && t.action !== "INTEREST") continue;
      const entry = months.find((m) => m.month === t.trade_date.slice(0, 7));
      if (!entry) continue;
      const amt = Number(t.amount ?? 0);
      if (t.action === "DIVIDEND") entry.Dividends += amt;
      else entry.Interest += amt;
    }
    return months.map((m) => ({ ...m, Dividends: +m.Dividends.toFixed(2), Interest: +m.Interest.toFixed(2) }));
  }, [txns, asOf]);

  const totalIncome = incomeByMonth.reduce((s, m) => s + m.Dividends + m.Interest, 0);

  // nav series filtered to selected period, capped at asOf AND today
  const navData = useMemo(() => {
    const end = asOf < clientToday ? asOf : clientToday;
    const filtered = filterNavSeries(navSeries, navPeriod, end);
    return filtered.filter((p) => p.date <= end);
  }, [navSeries, navPeriod, asOf, clientToday]);

  // For periods > 1W: resample to monthly so every year gets proportional width.
  // 1D and 1W keep daily granularity since the day-level detail matters there.
  const navChartData = useMemo(() => {
    if (navPeriod === "1D" || navPeriod === "1W") return navData;
    return resampleNavToMonthly(navData);
  }, [navData, navPeriod]);

  // X-axis tick format — avoids "Jun 26" ambiguity (looks like June 26th but means June 2026)
  const navTickFormatter = useMemo(() => {
    if (navPeriod === "1D" || navPeriod === "1W") {
      // "Jun 24" — month + day, unambiguously a date
      return (iso: string) => new Date(iso + "T00:00:00Z")
        .toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    }
    if (navPeriod === "6M" || navPeriod === "YTD") {
      // "Jun" — just month name, no year; avoids "Jun 26" confusion for single-year spans
      return (iso: string) => new Date(iso + "T00:00:00Z")
        .toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
    }
    // 1Y, 3Y, 5Y, Max — "Jun 2026": full 4-digit year, cannot be confused with a day
    return (iso: string) => new Date(iso + "T00:00:00Z")
      .toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  }, [navPeriod]);

  const isGain = snapshot.unrealizedGain >= 0;

  return (
    <div className="p-6 lg:p-8 space-y-5 text-muted-foreground">

      {/* â”€â”€ Header stats â”€â”€ */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Portfolio Value</p>
          <p className="text-4xl font-bold tracking-tight tabular-nums text-foreground">
            {isLoading ? "—" : formatMoney(snapshot.totalMarketValue)}
          </p>
          <div className="flex flex-wrap items-center gap-3 mt-2 text-[15px]">
            <span>
              <span className={cn("font-semibold tabular-nums", isGain ? "text-gain" : "text-loss")}>
                {isGain ? "+" : ""}{formatMoney(snapshot.unrealizedGain)}
              </span>
              <span className="ml-1 text-muted-foreground">unrealized</span>
            </span>
            <span className="text-muted-foreground/30">·</span>
            <span className="text-muted-foreground">{snapshot.holdings.length} positions</span>
          </div>
        </div>
        <AsOfDatePicker value={asOf} onChange={setAsOf} />
      </div>

      <DataIntegrityBanner issues={unmatchedSells} />

      {/* â”€â”€ NAV chart â”€â”€ */}
      <Card className="p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-4">
          <h2 className="text-sm font-semibold text-foreground">Portfolio Value Over Time</h2>
          <PeriodToggle value={navPeriod} onChange={setNavPeriod} compact />
        </div>
        {navData.length < 2 ? (
          <EmptyState height={280} showDemo={txns.length === 0} />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={navChartData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="navGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#C9A050" stopOpacity={0.22} />
                  <stop offset="95%" stopColor="#C9A050" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tickFormatter={navTickFormatter} tick={TICK} tickLine={false} axisLine={false} minTickGap={48} />
              <YAxis
                tickFormatter={(v: number) => v >= 1_000_000 ? `$${(v/1_000_000).toFixed(1)}M` : `$${(v/1_000).toFixed(0)}K`}
                tick={TICK} tickLine={false} axisLine={false} width={56}
                domain={[(dataMin: number) => dataMin * 0.995, (dataMax: number) => dataMax * 1.005]}
              />
              <Tooltip content={<NavTooltip />} />
              <Area type="monotone" dataKey="value" stroke="#C9A050" strokeWidth={2} fill="url(#navGrad)" dot={false} activeDot={{ r: 4, fill: "#C9A050" }} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* â”€â”€ Treemap — own period toggle in header â”€â”€ */}
      <div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-2">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-sm font-semibold text-foreground">Unrealized P/L by Position</h2>
            <PeriodToggle value={treemapPeriod} onChange={setTreemapPeriod} compact />
          </div>
          <span className="text-xs hidden sm:inline">sized by market value · hover for details</span>
        </div>
        <div className="bg-card rounded-xl border border-border overflow-hidden" style={{ height: 480 }}>
          {treemapData.length === 0 ? <EmptyState height={480} /> : (
            <ResponsiveContainer width="100%" height={480}>
              <Treemap data={treemapData} dataKey="value" nameKey="name" content={<TreemapContent />}>
                <Tooltip content={<TreemapTooltip />} />
              </Treemap>
            </ResponsiveContainer>
          )}
        </div>
        <div className="flex items-center gap-2 mt-2 px-0.5">
          <span className="text-[10px] tabular-nums text-muted-foreground shrink-0">≤ −10%</span>
          <div className="flex-1 h-1.5 rounded-l-full"
            style={{ background: "linear-gradient(to right, #8f3823, #C1573C, #dba28c, #efd9d0)" }} />
          <span className="text-[10px] text-muted-foreground shrink-0 px-0.5">0</span>
          <div className="flex-1 h-1.5 rounded-r-full"
            style={{ background: "linear-gradient(to right, #dbe8de, #a8cdb8, #4E9B72, #3f7a5c)" }} />
          <span className="text-[10px] tabular-nums text-muted-foreground shrink-0">≥ +10%</span>
        </div>
      </div>

      {/* â”€â”€ Asset Class Allocation Pie + Asset Class bar â”€â”€ */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Equity sector breakdown pie — 100% = direct equity holdings */}
        <Card className="p-5">
          <div className="mb-2">
            <h2 className="text-sm font-semibold text-foreground">Equity Sector Allocation</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {formatMoney(equityBreakdownData.totalEquityMV)} equities
              {snapshot.totalMarketValue > 0 && (
                <> · {((equityBreakdownData.totalEquityMV / snapshot.totalMarketValue) * 100).toFixed(1)}% of portfolio</>
              )}
            </p>
          </div>
          {equityBreakdownData.slices.length === 0 ? <EmptyState height={280} /> : (
            <div>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={equityBreakdownData.slices} dataKey="value" nameKey="name"
                    outerRadius={100} innerRadius={58}
                    paddingAngle={2} strokeWidth={0}
                  >
                    {equityBreakdownData.slices.map((d, i) => <Cell key={i} fill={sectorColor(d.name, i)} />)}
                  </Pie>
                  <Tooltip
                    formatter={(v: number, name: string) => [
                      `${formatMoney(v)}  ·  ${equityBreakdownData.slices.find(s => s.name === name)?.pct.toFixed(1) ?? ""}%`,
                      sectorLabel(name as string),
                    ]}
                    contentStyle={TOOLTIP_STYLE}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 mt-3">
                {equityBreakdownData.slices.map((d, i) => (
                  <div key={d.name} className="flex items-center gap-2 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: sectorColor(d.name, i) }} />
                    <span className="text-[13px] text-foreground font-medium truncate">{sectorLabel(d.name)}</span>
                    <span className="text-[13px] tabular-nums text-muted-foreground ml-auto font-semibold">{d.pct.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        {/* Asset class bar */}
        <Card className="p-5">
          <div className="flex items-start justify-between mb-5">
            <h2 className="text-sm font-semibold text-foreground">Asset Class</h2>
            <div className="text-right">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total AUM</p>
              <p className="text-sm font-semibold tabular-nums text-foreground">{formatMoney(snapshot.totalMarketValue)}</p>
            </div>
          </div>
          {assetClassData.length === 0 ? <EmptyState height={180} /> : (
            <div className="space-y-5">
              {assetClassData.map((d, i) => (
                <div key={d.name}>
                  <div className="flex items-center justify-between text-sm mb-1.5">
                    {d.name === "Other" ? (
                      <span className="relative group cursor-default flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full shrink-0" style={{ background: PALETTE[i % PALETTE.length] }} />
                        <span className="text-foreground font-medium underline decoration-dotted decoration-muted-foreground/50">Other</span>
                        <span className="absolute left-0 bottom-full mb-1.5 z-50 hidden group-hover:block w-52 rounded-md border bg-card shadow-lg px-2.5 py-2 text-[11px] text-foreground whitespace-normal">
                          {d.symbols.slice(0, 12).join(", ")}{d.symbols.length > 12 ? ` +${d.symbols.length - 12} more` : ""}
                        </span>
                      </span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full shrink-0" style={{ background: PALETTE[i % PALETTE.length] }} />
                        <span className="text-foreground font-medium">{d.name}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-3 tabular-nums">
                      <span className="text-muted-foreground text-xs">{formatMoney(d.value)}</span>
                      <span className="font-semibold text-foreground w-10 text-right">{d.portfolioPct.toFixed(1)}%</span>
                    </div>
                  </div>
                  <div className="h-4 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${d.portfolioPct}%`, background: PALETTE[i % PALETTE.length] }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* â”€â”€ Monthly Income (bottom) â”€â”€ */}
      <Card className="p-5">
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-foreground">Monthly Income</h2>
          <p className="text-xs mt-0.5">
            <span className="text-foreground tabular-nums font-semibold">{formatMoney(totalIncome)}</span>
            {" "}last 12 months
          </p>
        </div>
        {incomeByMonth.every((m) => m.Dividends === 0 && m.Interest === 0) ? <EmptyState height={200} /> : (
          <div className="text-muted-foreground">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={incomeByMonth} margin={{ left: 4, right: 4, top: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                <XAxis dataKey="label" tick={{ ...TICK, fontSize: 10 } as any} interval={0} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} tick={TICK} width={40} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v: number, n: string) => [formatMoney(v), n]} contentStyle={TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Dividends" stackId="i" fill="#4E9B72" stroke="white" strokeWidth={1} maxBarSize={28} />
                <Bar dataKey="Interest"  stackId="i" fill="#C9A050" stroke="white" strokeWidth={1} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
    </div>
  );
}

function EmptyState({ height = 240, showDemo = false }: { height?: number; showDemo?: boolean }) {
  const qc = useQueryClient();
  const demoMutation = useMutation({
    mutationFn: loadDemoData,
    onSuccess: () => {
      toast.success("Demo data loaded — this is sample data, not real holdings.");
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["nav-history"] });
      qc.invalidateQueries({ queryKey: ["inception-date"] });
    },
    onError: () => toast.error("Couldn't load demo data. Try again."),
  });

  return (
    <div className="flex items-center justify-center" style={{ height }}>
      <div className="text-center max-w-xs px-4">
        <PiggyBank className="w-9 h-9 mx-auto mb-3 text-primary/50" />
        <p className="text-sm font-medium text-foreground mb-1">No positions yet</p>
        <p className="text-xs text-muted-foreground mb-4">
          Upload a broker statement or CSV export and this chart fills in automatically.
        </p>
        <div className="flex items-center justify-center gap-2 flex-wrap">
          <Link
            to="/upload"
            className="inline-flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground text-xs font-medium px-3.5 py-1.5 hover:opacity-90 transition-opacity"
          >
            Upload a statement
          </Link>
          {showDemo && (
            <button
              type="button"
              onClick={() => demoMutation.mutate()}
              disabled={demoMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-full border border-border text-foreground text-xs font-medium px-3.5 py-1.5 hover:bg-muted/60 transition-colors disabled:opacity-60"
            >
              {demoMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              Load demo data
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

