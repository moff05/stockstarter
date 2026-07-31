import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo, Fragment } from "react";
import { ChevronRight } from "lucide-react";
import { usePortfolio } from "@/hooks/use-portfolio";
import { AsOfDatePicker } from "@/components/AsOfDatePicker";
import { UnmappedBanner } from "@/components/UnmappedBanner";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { lookupSP500Weight } from "@/lib/sp500-weights";
import { lookupQQQWeight } from "@/lib/qqq-weights";
import { getSector } from "@/lib/sector";
import { SPY_SECTOR_WEIGHTS, QQQ_SECTOR_WEIGHTS } from "@/lib/index-sector-weights";
import { cn } from "@/lib/utils";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

export const Route = createFileRoute("/_authenticated/sp500")({
  head: () => ({ meta: [{ title: "Index Compare — StockStarter" }] }),
  component: SP500Compare,
});

const TICK = { fontSize: 11, fill: "currentColor" };
const TOOLTIP_STYLE = {
  background: "var(--color-card)",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  fontSize: 12,
};

const PORTFOLIO_COLOR = "#3B6FD4"; // suite blue
const SPY_COLOR       = "#6b6455"; // warm slate
const QQQ_COLOR       = "#7c5cbf"; // muted violet

function localDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function SP500Compare() {
  const [asOf, setAsOf] = useState(localDateStr);
  const [sectorBenchmark, setSectorBenchmark] = useState<"SPY" | "QQQ">("SPY");
  const [expandedSectors, setExpandedSectors] = useState<Set<string>>(new Set());

  const { snapshot, unmapped } = usePortfolio(asOf);

  function toggleSector(s: string) {
    setExpandedSectors((prev) => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });
  }

  // Portfolio sector weights
  const portfolioSectorWeights = useMemo(() => {
    const map: Record<string, number> = {};
    for (const h of snapshot.holdings) {
      const s = getSector(h.symbol);
      map[s] = (map[s] ?? 0) + h.weightPct;
    }
    return map;
  }, [snapshot.holdings]);

  // Chart data — include all sectors that appear in either index
  const sectorChartData = useMemo(() => {
    const allSectors = new Set([
      ...Object.keys(portfolioSectorWeights),
      ...Object.keys(SPY_SECTOR_WEIGHTS),
      ...Object.keys(QQQ_SECTOR_WEIGHTS),
    ]);
    return Array.from(allSectors)
      .map((s) => ({
        sector: s,
        Portfolio: parseFloat((portfolioSectorWeights[s] ?? 0).toFixed(2)),
        SPY:       parseFloat((SPY_SECTOR_WEIGHTS[s]       ?? 0).toFixed(2)),
        QQQ:       parseFloat((QQQ_SECTOR_WEIGHTS[s]       ?? 0).toFixed(2)),
      }))
      .filter((d) => d.Portfolio > 0.1 || d.SPY > 0 || d.QQQ > 0)
      .sort((a, b) => b.Portfolio - a.Portfolio);
  }, [portfolioSectorWeights]);

  // Lock Y-axis across both benchmarks so toggling doesn't rescale
  const sectorYMax = useMemo(() => {
    if (sectorChartData.length === 0) return 50;
    let max = 0;
    for (const d of sectorChartData) max = Math.max(max, d.Portfolio, d.SPY, d.QQQ);
    return Math.ceil(max / 5) * 5;
  }, [sectorChartData]);

  // Grouped holdings: sector → stocks, sorted by portfolio weight
  const groupedBySector = useMemo(() => {
    const map: Record<string, { symbol: string; weightPct: number; spyWeight: number; qqqWeight: number }[]> = {};
    for (const h of snapshot.holdings) {
      const s = getSector(h.symbol);
      (map[s] ??= []).push({
        symbol: h.symbol,
        weightPct: h.weightPct,
        spyWeight: lookupSP500Weight(h.symbol),
        qqqWeight: lookupQQQWeight(h.symbol),
      });
    }
    return Object.entries(map)
      .map(([sectorName, stocks]) => {
        const portfolioPct = stocks.reduce((s, h) => s + h.weightPct, 0);
        const spyPct  = SPY_SECTOR_WEIGHTS[sectorName]  ?? 0;
        const qqqPct  = QQQ_SECTOR_WEIGHTS[sectorName]  ?? 0;
        return {
          sectorName,
          portfolioPct,
          spyPct,
          qqqPct,
          stocks: [...stocks].sort((a, b) => b.weightPct - a.weightPct),
        };
      })
      .sort((a, b) => b.portfolioPct - a.portfolioPct);
  }, [snapshot.holdings]);

  return (
    <div className="p-6 lg:p-8 space-y-6 text-muted-foreground">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Index Comparison</h1>
          <p className="text-sm">Portfolio sector weights vs. S&P 500 (SPY) and NASDAQ 100 (QQQ).</p>
        </div>
        <AsOfDatePicker value={asOf} onChange={setAsOf} />
      </div>

      <UnmappedBanner unmapped={unmapped} />

      {/* Sector grouped bar — matches dashboard style */}
      {sectorChartData.length > 0 && (
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Sector Allocation vs. Indices</h2>
              <p className="text-xs mt-0.5">
                Portfolio weight by sector vs. {sectorBenchmark === "SPY" ? "S&P 500 (SPY)" : "NASDAQ 100 (QQQ)"}
              </p>
            </div>
            <div className="flex gap-0.5 rounded-full glass-surface p-0.5">
              {(["SPY", "QQQ"] as const).map((b) => (
                <button
                  key={b}
                  onClick={() => setSectorBenchmark(b)}
                  className={cn(
                    "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                    sectorBenchmark === b
                      ? "bg-gradient-to-r from-sky-400/90 to-blue-600/80 text-white shadow-[0_0_12px_-4px_oklch(0.74_0.135_235_/_0.8)]"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {b}
                </button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={360}>
            <BarChart data={sectorChartData} margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis
                dataKey="sector"
                tick={{ ...TICK, fontSize: 10 } as any}
                tickLine={false}
                axisLine={false}
                angle={-45}
                textAnchor="end"
                interval={0}
                height={75}
              />
              <YAxis
                tickFormatter={(v) => `${v}%`}
                tick={TICK}
                tickLine={false}
                axisLine={false}
                width={40}
                domain={[0, sectorYMax]}
              />
              <Tooltip
                formatter={(v: number, name: string) => [`${v.toFixed(2)}%`, name]}
                contentStyle={TOOLTIP_STYLE}
              />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
              <Bar dataKey="Portfolio" fill={PORTFOLIO_COLOR} maxBarSize={22} />
              {sectorBenchmark === "SPY"
                ? <Bar dataKey="SPY" fill={SPY_COLOR} maxBarSize={22} />
                : <Bar dataKey="QQQ" fill={QQQ_COLOR} maxBarSize={22} />
              }
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Holdings by Sector — collapsible */}
      <Card>
        <div className="px-5 py-4 border-b">
          <h2 className="font-semibold text-foreground">Holdings by Sector</h2>
          <p className="text-xs mt-0.5">Click a sector to see individual positions and their index weights.</p>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Sector</TableHead>
              <TableHead className="text-right">Portfolio %</TableHead>
              <TableHead className="text-right">SPY %</TableHead>
              <TableHead className="text-right">QQQ %</TableHead>
              <TableHead className="text-right">vs. SPY</TableHead>
              <TableHead className="text-right pr-5">vs. QQQ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groupedBySector.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                  No holdings.
                </TableCell>
              </TableRow>
            )}
            {groupedBySector.map(({ sectorName, portfolioPct, spyPct, qqqPct, stocks }) => {
              const isExpanded = expandedSectors.has(sectorName);
              const spyDiff = spyPct > 0 ? portfolioPct - spyPct : null;
              const qqqDiff = qqqPct > 0 ? portfolioPct - qqqPct : null;
              return (
                <Fragment key={sectorName}>
                  {/* Sector summary row */}
                  <TableRow
                    className={cn(
                      "cursor-pointer select-none border-b border-border/60",
                      isExpanded ? "bg-muted/25" : "hover:bg-muted/10",
                    )}
                    onClick={() => toggleSector(sectorName)}
                  >
                    <TableCell className="w-8 pr-0 py-3">
                      <ChevronRight className={cn(
                        "w-3.5 h-3.5 text-muted-foreground/70 transition-transform duration-150",
                        isExpanded && "rotate-90",
                      )} />
                    </TableCell>
                    <TableCell className="py-3">
                      <span className="flex items-center gap-2">
                        <span className="font-semibold text-foreground text-[13px]">{sectorName}</span>
                        <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground/70 leading-tight">
                          {stocks.length}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-semibold text-foreground py-3">
                      {portfolioPct.toFixed(2)}%
                    </TableCell>
                    <TableCell className="text-right tabular-nums py-3">
                      {spyPct > 0
                        ? `${spyPct.toFixed(2)}%`
                        : <span className="text-muted-foreground/40">—</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums py-3">
                      {qqqPct > 0
                        ? `${qqqPct.toFixed(2)}%`
                        : <span className="text-muted-foreground/40">—</span>}
                    </TableCell>
                    <TableCell className={cn(
                      "text-right tabular-nums py-3",
                      spyDiff == null ? "" : spyDiff >= 0 ? "text-gain" : "text-loss",
                    )}>
                      {spyDiff != null
                        ? `${spyDiff >= 0 ? "+" : ""}${spyDiff.toFixed(2)}%`
                        : <span className="text-muted-foreground/40">—</span>}
                    </TableCell>
                    <TableCell className={cn(
                      "text-right tabular-nums pr-5 py-3",
                      qqqDiff == null ? "" : qqqDiff >= 0 ? "text-gain" : "text-loss",
                    )}>
                      {qqqDiff != null
                        ? `${qqqDiff >= 0 ? "+" : ""}${qqqDiff.toFixed(2)}%`
                        : <span className="text-muted-foreground/40">—</span>}
                    </TableCell>
                  </TableRow>

                  {/* Individual stock rows */}
                  {isExpanded && stocks.map((r, i) => {
                    const sSpyDiff = r.spyWeight > 0 ? r.weightPct - r.spyWeight : null;
                    const sQqqDiff = r.qqqWeight > 0 ? r.weightPct - r.qqqWeight : null;
                    const isLast = i === stocks.length - 1;
                    return (
                      <TableRow
                        key={r.symbol}
                        className={cn(
                          "bg-muted/[0.06] hover:bg-muted/[0.12]",
                          isLast && "border-b-2 border-border/60",
                        )}
                      >
                        <TableCell className="w-8 py-2" />
                        <TableCell className="py-2 pl-8">
                          <span className="flex items-center gap-2">
                            <span className="w-1 h-1 rounded-full bg-muted-foreground/30 shrink-0" />
                            <span className="text-[13px] text-muted-foreground font-medium">{r.symbol}</span>
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-[13px] text-foreground py-2">
                          {r.weightPct.toFixed(2)}%
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-[13px] text-muted-foreground py-2">
                          {r.spyWeight > 0
                            ? `${r.spyWeight.toFixed(2)}%`
                            : <span className="text-muted-foreground/30">—</span>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-[13px] text-muted-foreground py-2">
                          {r.qqqWeight > 0
                            ? `${r.qqqWeight.toFixed(2)}%`
                            : <span className="text-muted-foreground/30">—</span>}
                        </TableCell>
                        <TableCell className={cn(
                          "text-right tabular-nums text-[12px] py-2",
                          sSpyDiff == null ? "text-muted-foreground/40" : sSpyDiff >= 0 ? "text-gain/80" : "text-loss/80",
                        )}>
                          {sSpyDiff != null
                            ? `${sSpyDiff >= 0 ? "+" : ""}${sSpyDiff.toFixed(2)}%`
                            : <span className="text-muted-foreground/30">—</span>}
                        </TableCell>
                        <TableCell className={cn(
                          "text-right tabular-nums text-[12px] pr-5 py-2",
                          sQqqDiff == null ? "text-muted-foreground/40" : sQqqDiff >= 0 ? "text-gain/80" : "text-loss/80",
                        )}>
                          {sQqqDiff != null
                            ? `${sQqqDiff >= 0 ? "+" : ""}${sQqqDiff.toFixed(2)}%`
                            : <span className="text-muted-foreground/30">—</span>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <p className="text-xs">
        Benchmark weights are static snapshots of the top holdings for SPY and QQQ. Stocks outside the top tier show 0%. Sector classification uses GICS.
      </p>
    </div>
  );
}

