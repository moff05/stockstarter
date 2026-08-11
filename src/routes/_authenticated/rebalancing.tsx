import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { usePortfolio } from "@/hooks/use-portfolio";
import { getSector } from "@/lib/sector";
import { lookupSP500Weight } from "@/lib/sp500-weights";
import { formatMoney } from "@/lib/portfolio";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { SortHead, useSortable, sortRows } from "@/components/SortHead";

export const Route = createFileRoute("/_authenticated/rebalancing")({
  head: () => ({ meta: [{ title: "Rebalancing — StockStarter" }] }),
  component: RebalancingPage,
});

type Observation = { level: "notable" | "info"; text: string };

function generateObservations(holdings: any[]): Observation[] {
  const obs: Observation[] = [];
  if (holdings.length === 0) return obs;

  const sorted = [...holdings].sort((a, b) => b.weightPct - a.weightPct);
  const n = sorted.length;

  // Single-name concentration — flag anything > 5%
  const large = sorted.filter((h) => h.weightPct > 5);
  for (const h of large) {
    const rank = sorted.indexOf(h) + 1;
    const rankLabel = rank === 1 ? "largest" : rank === 2 ? "2nd largest" : rank === 3 ? "3rd largest" : `${rank}th largest`;
    obs.push({
      level: h.weightPct > 10 ? "notable" : "info",
      text: `${h.symbol} is the ${rankLabel} position at ${h.weightPct.toFixed(1)}% of the portfolio.`,
    });
  }

  // Top 3 combined
  if (n >= 3) {
    const top3 = sorted.slice(0, 3);
    const top3Pct = top3.reduce((s, h) => s + h.weightPct, 0);
    if (top3Pct > 35) {
      obs.push({
        level: top3Pct > 50 ? "notable" : "info",
        text: `Top 3 positions (${top3.map((h) => h.symbol).join(", ")}) account for ${top3Pct.toFixed(1)}% of the portfolio.`,
      });
    }
  }

  // Top 5 combined
  if (n >= 5) {
    const top5 = sorted.slice(0, 5);
    const top5Pct = top5.reduce((s, h) => s + h.weightPct, 0);
    if (top5Pct > 50) {
      obs.push({
        level: "info",
        text: `Top 5 positions account for ${top5Pct.toFixed(1)}% of the portfolio combined.`,
      });
    }
  }

  // Sector concentration — flag anything > 30%
  const sectorTotals: Record<string, number> = {};
  for (const h of holdings) {
    const s = getSector(h.symbol);
    sectorTotals[s] = (sectorTotals[s] ?? 0) + h.weightPct;
  }
  const topSectors = Object.entries(sectorTotals).sort((a, b) => b[1] - a[1]);
  for (const [sector, pct] of topSectors) {
    if (pct > 30) {
      obs.push({
        level: pct > 45 ? "notable" : "info",
        text: `${sector} represents ${pct.toFixed(1)}% of the portfolio — the largest sector exposure.`,
      });
      break; // only flag the top sector if it's large; rest covered by the sector chart
    }
  }

  // Outside S&P 500
  const outside = holdings.filter((h) => lookupSP500Weight(h.symbol) === 0);
  if (outside.length > 0) {
    const names = outside.map((h) => h.symbol).slice(0, 5).join(", ");
    const extra = outside.length > 5 ? ` and ${outside.length - 5} more` : "";
    obs.push({
      level: "info",
      text: `${outside.length} position${outside.length > 1 ? "s" : ""} (${names}${extra}) ${outside.length > 1 ? "are" : "is"} outside the S&P 500 top holdings.`,
    });
  }

  // Low position count
  if (n > 0 && n < 8) {
    obs.push({ level: "notable", text: `Portfolio holds ${n} distinct position${n === 1 ? "" : "s"} — a relatively concentrated book.` });
  }

  return obs;
}

/** Plain-English synthesis of why this specific position looks the way it does, relative to the rest of the book. */
function positionNarrative(
  h: { symbol: string; weightPct: number; spxWeight: number },
  rank: number,
  n: number,
  avgWeight: number,
): string {
  const parts: string[] = [];
  const rankLabel = rank === 1 ? "Largest position" : rank === 2 ? "2nd largest position" : rank === 3 ? "3rd largest position" : null;
  parts.push(rankLabel ? `${rankLabel} at ${h.weightPct.toFixed(1)}% of the portfolio` : `${h.weightPct.toFixed(1)}% of the portfolio (rank ${rank} of ${n})`);

  const ratio = avgWeight > 0 ? h.weightPct / avgWeight : 0;
  if (ratio >= 2) {
    parts.push(`about ${ratio.toFixed(1)}x the average position size`);
  }

  if (h.spxWeight === 0) {
    parts.push("not among the S&P 500's top holdings");
  } else {
    const relative = h.weightPct / h.spxWeight;
    if (relative >= 3) {
      parts.push(`weighted ${relative.toFixed(1)}x heavier here than in the S&P 500`);
    } else if (relative <= 0.34) {
      parts.push(`weighted lighter here than in the S&P 500`);
    }
  }

  return parts.join(" — ") + ".";
}

function fmtDate(iso: string) {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

function RebalancingPage() {
  const { snapshot, txns, isLoading } = usePortfolio();
  const holdings = snapshot.holdings;

  const sorted = useMemo(
    () => [...holdings].sort((a, b) => b.weightPct - a.weightPct),
    [holdings],
  );

  const enriched = useMemo(
    () => sorted.map((h) => ({ ...h, sector: getSector(h.symbol), spxWeight: lookupSP500Weight(h.symbol) })),
    [sorted],
  );

  const [tableSort, handleTableSort] = useSortable("weightPct");
  const tableRows = useMemo(() => sortRows(enriched as any[], tableSort), [enriched, tableSort]);

  const recentBuys = useMemo(
    () => txns.filter((t) => t.action === "BUY" && t.symbol)
      .sort((a, b) => b.trade_date.localeCompare(a.trade_date))
      .slice(0, 5),
    [txns],
  );
  const recentSells = useMemo(
    () => txns.filter((t) => t.action === "SELL" && t.symbol)
      .sort((a, b) => b.trade_date.localeCompare(a.trade_date))
      .slice(0, 5),
    [txns],
  );

  const sectorTotals = useMemo(() => {
    const map: Record<string, number> = {};
    for (const h of holdings) {
      const s = getSector(h.symbol);
      map[s] = (map[s] ?? 0) + h.weightPct;
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [holdings]);

  const observations = useMemo(() => generateObservations(holdings), [holdings]);

  const avgWeight = useMemo(
    () => (sorted.length > 0 ? sorted.reduce((s, h) => s + h.weightPct, 0) / sorted.length : 0),
    [sorted],
  );
  const rankBySymbol = useMemo(() => {
    const m = new Map<string, number>();
    sorted.forEach((h, i) => m.set(h.symbol, i + 1));
    return m;
  }, [sorted]);

  const top5Pct = sorted.slice(0, 5).reduce((s, h) => s + h.weightPct, 0);
  const top10Pct = sorted.slice(0, 10).reduce((s, h) => s + h.weightPct, 0);
  const largestPct = sorted[0]?.weightPct ?? 0;
  const topSectorPct = sectorTotals[0]?.[1] ?? 0;
  const topSectorName = sectorTotals[0]?.[0] ?? "—";

  if (isLoading) {
    return (
      <div className="p-6 lg:p-8 text-sm text-muted-foreground animate-pulse">
        Loading portfolio…
      </div>
    );
  }

  if (holdings.length === 0) {
    return (
      <div className="p-6 lg:p-8">
        <Card className="p-10 text-center text-sm text-muted-foreground">
          No holdings found. Upload a statement to get started.
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 space-y-6 text-muted-foreground">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Concentration Monitor</h1>
        <p className="text-sm mt-0.5">
          Factual observations about portfolio composition. Not investment advice.
        </p>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-4">
          <div className="text-[11px] font-medium uppercase tracking-wider">Positions</div>
          <div className="text-2xl font-bold text-foreground mt-1">{sorted.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] font-medium uppercase tracking-wider">Largest Position</div>
          <div className="text-2xl font-bold text-foreground mt-1">{largestPct.toFixed(1)}%</div>
          <div className="text-xs mt-0.5">{sorted[0]?.symbol}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] font-medium uppercase tracking-wider">Top 5 Combined</div>
          <div className="text-2xl font-bold text-foreground mt-1">{top5Pct.toFixed(1)}%</div>
          <div className="text-xs mt-0.5">top 10: {top10Pct.toFixed(1)}%</div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] font-medium uppercase tracking-wider">Top Sector</div>
          <div className="text-2xl font-bold text-foreground mt-1">{topSectorPct.toFixed(1)}%</div>
          <div className="text-xs mt-0.5">{topSectorName}</div>
        </Card>
      </div>

      {/* Recent Activity */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="p-5">
          <h2 className="font-semibold text-foreground mb-3">5 Most Recent Buys</h2>
          {recentBuys.length === 0 ? (
            <p className="text-xs">No buy transactions found.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/60 text-muted-foreground/70">
                  <th className="text-left pb-1.5 font-medium">Date</th>
                  <th className="text-left pb-1.5 font-medium">Symbol</th>
                  <th className="text-right pb-1.5 font-medium">Qty</th>
                  <th className="text-right pb-1.5 font-medium">Price</th>
                  <th className="text-right pb-1.5 font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {recentBuys.map((t) => (
                  <tr key={`${t.id}`} className="border-b border-border/30 last:border-0">
                    <td className="py-1.5">{fmtDate(t.trade_date)}</td>
                    <td className="py-1.5 font-medium text-foreground">{(t.symbol ?? "").toUpperCase()}</td>
                    <td className="py-1.5 tabular-nums text-right">
                      {Number(t.quantity ?? 0).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                    </td>
                    <td className="py-1.5 tabular-nums text-right">
                      {Number(t.price ?? 0) > 0 ? `$${Number(t.price).toFixed(2)}` : "—"}
                    </td>
                    <td className="py-1.5 tabular-nums text-right font-medium text-foreground">
                      {Number(t.amount ?? 0) !== 0 ? `$${Math.abs(Number(t.amount)).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold text-foreground mb-3">5 Most Recent Sells</h2>
          {recentSells.length === 0 ? (
            <p className="text-xs">No sell transactions found.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/60 text-muted-foreground/70">
                  <th className="text-left pb-1.5 font-medium">Date</th>
                  <th className="text-left pb-1.5 font-medium">Symbol</th>
                  <th className="text-right pb-1.5 font-medium">Qty</th>
                  <th className="text-right pb-1.5 font-medium">Price</th>
                  <th className="text-right pb-1.5 font-medium">Proceeds</th>
                </tr>
              </thead>
              <tbody>
                {recentSells.map((t) => (
                  <tr key={`${t.id}`} className="border-b border-border/30 last:border-0">
                    <td className="py-1.5">{fmtDate(t.trade_date)}</td>
                    <td className="py-1.5 font-medium text-foreground">{(t.symbol ?? "").toUpperCase()}</td>
                    <td className="py-1.5 tabular-nums text-right">
                      {Number(t.quantity ?? 0).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                    </td>
                    <td className="py-1.5 tabular-nums text-right">
                      {Number(t.price ?? 0) > 0 ? `$${Number(t.price).toFixed(2)}` : "—"}
                    </td>
                    <td className="py-1.5 tabular-nums text-right font-medium text-gain">
                      {Number(t.amount ?? 0) !== 0 ? `$${Math.abs(Number(t.amount)).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Sector breakdown */}
        <Card className="p-5">
          <h2 className="font-semibold text-foreground mb-4">Sector Allocation</h2>
          <div className="overflow-y-auto max-h-72 space-y-2.5 pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border">
            {sectorTotals.map(([sector, pct]) => (
              <div key={sector}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-foreground font-medium">{sector}</span>
                  <span className="tabular-nums">{pct.toFixed(1)}%</span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      pct > 40 ? "bg-amber-400" : "bg-sky-500",
                    )}
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* All positions bar */}
        <Card className="p-5">
          <h2 className="font-semibold text-foreground mb-4">Position Sizing</h2>
          <div className="overflow-y-auto max-h-72 space-y-2.5 pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border">
            {sorted.map((h, i) => (
              <div key={h.symbol}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-foreground font-medium">{h.symbol}</span>
                  <span className="tabular-nums">{h.weightPct.toFixed(1)}%</span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      h.weightPct > 10 ? "bg-amber-400" : i < 3 ? "bg-sky-500" : "bg-sky-400/70",
                    )}
                    style={{ width: `${(h.weightPct / largestPct) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Observations (moved below sector/position) */}
      {observations.length > 0 && (
        <Card className="p-5">
          <h2 className="font-semibold text-foreground mb-3">Observations</h2>
          <ul className="space-y-2">
            {observations.map((o, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm">
                <span className={cn(
                  "mt-0.5 w-2 h-2 rounded-full shrink-0",
                  o.level === "notable" ? "bg-amber-400" : "bg-sky-400",
                )} />
                <span>{o.text}</span>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-1.5 mt-4 pt-3 border-t text-[11px]">
            <Info className="w-3 h-3 shrink-0" />
            These are factual observations only — no action is implied or recommended.
          </div>
        </Card>
      )}

      {/* Full holdings table */}
      <Card>
        <div className="px-5 py-4 border-b">
          <h2 className="font-semibold text-foreground">All Positions</h2>
          <p className="text-xs mt-0.5">Sorted by portfolio weight, largest first.</p>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">Rank</TableHead>
              <SortHead label="Symbol"       sortKey="symbol"     sort={tableSort} onSort={handleTableSort} />
              <SortHead label="Sector"       sortKey="sector"     sort={tableSort} onSort={handleTableSort} />
              <SortHead label="Market Value" sortKey="marketValue" sort={tableSort} onSort={handleTableSort} className="text-right" />
              <SortHead label="Weight"       sortKey="weightPct"  sort={tableSort} onSort={handleTableSort} className="text-right" />
              <SortHead label="In S&P 500"   sortKey="spxWeight"  sort={tableSort} onSort={handleTableSort} className="text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {tableRows.map((h, i) => (
                <TableRow key={h.symbol} className={h.weightPct > 5 ? "bg-amber-50/40 dark:bg-amber-950/10" : ""}>
                  <TableCell className="text-muted-foreground tabular-nums">{i + 1}</TableCell>
                  <TableCell className="font-medium text-foreground">
                    <span className="flex items-center gap-1">
                      {h.symbol}
                      <TooltipProvider delayDuration={300}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-muted-foreground/40 text-muted-foreground/50 text-[9px] leading-none hover:border-muted-foreground hover:text-muted-foreground transition-colors cursor-help flex-shrink-0">
                              ?
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="right" className="max-w-[260px] text-xs leading-relaxed">
                            {positionNarrative(h, rankBySymbol.get(h.symbol) ?? i + 1, sorted.length, avgWeight)}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted">{h.sector}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(h.marketValue)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span className={cn("font-medium", h.weightPct > 5 ? "text-amber-600" : "text-foreground")}>
                      {h.weightPct.toFixed(2)}%
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {h.spxWeight > 0
                      ? <span className="text-xs text-muted-foreground">{h.spxWeight.toFixed(1)}%</span>
                      : <span className="text-xs text-muted-foreground">—</span>}
                  </TableCell>
                </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

