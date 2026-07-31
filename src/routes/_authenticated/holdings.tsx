import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo, Fragment } from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown, ChevronRight } from "lucide-react";
import { usePortfolio } from "@/hooks/use-portfolio";
import { AsOfDatePicker } from "@/components/AsOfDatePicker";
import { UnmappedBanner } from "@/components/UnmappedBanner";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/portfolio";
import { buildLots, type TaxLot } from "@/lib/tax-lots";
import { cn } from "@/lib/utils";
import type { Holding } from "@/lib/portfolio";

export const Route = createFileRoute("/_authenticated/holdings")({
  head: () => ({ meta: [{ title: "Holdings — StockStarter" }] }),
  component: Holdings,
});

type SortKey = keyof Holding;
type SortDir = "asc" | "desc";
type SortConfig = { key: SortKey; dir: SortDir } | null;
type LotMethod = "FIFO" | "HIFO";

function localDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown className="w-3 h-3 opacity-30 shrink-0" />;
  return dir === "desc"
    ? <ChevronDown className="w-3.5 h-3.5 shrink-0" />
    : <ChevronUp className="w-3.5 h-3.5 shrink-0" />;
}

function SortHead({
  label, sortKey, sort, onSort, className,
}: {
  label: string; sortKey: SortKey; sort: SortConfig;
  onSort: (k: SortKey) => void; className?: string;
}) {
  const active = sort?.key === sortKey;
  return (
    <TableHead
      className={cn("cursor-pointer select-none hover:text-foreground", className)}
      onClick={() => onSort(sortKey)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <SortIcon active={active} dir={sort?.dir ?? "desc"} />
      </span>
    </TableHead>
  );
}

function sortHoldings(holdings: Holding[], sort: SortConfig): Holding[] {
  if (!sort) return holdings;
  return [...holdings].sort((a, b) => {
    const av = a[sort.key];
    const bv = b[sort.key];
    let cmp: number;
    if (typeof av === "string" && typeof bv === "string") {
      cmp = av.localeCompare(bv);
    } else {
      const an = av == null ? -Infinity : Number(av);
      const bn = bv == null ? -Infinity : Number(bv);
      cmp = an > bn ? 1 : an < bn ? -1 : 0;
    }
    return sort.dir === "desc" ? -cmp : cmp;
  });
}

function fmtDate(iso: string) {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

function LotRows({ lots, marketPrice }: { lots: TaxLot[]; marketPrice: number }) {
  const sorted = [...lots].sort((a, b) => a.acquiredDate.localeCompare(b.acquiredDate));
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={13} className="p-0">
        <div className="mx-4 mb-3 mt-1 rounded-md border border-border/60 bg-muted/30 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/60 text-muted-foreground/70">
                <th className="text-left px-3 py-2 font-medium">Acquired</th>
                <th className="text-right px-3 py-2 font-medium">Qty</th>
                <th className="text-right px-3 py-2 font-medium">Cost / Share</th>
                <th className="text-right px-3 py-2 font-medium">Total Cost</th>
                <th className="text-right px-3 py-2 font-medium">Mkt Value</th>
                <th className="text-right px-3 py-2 font-medium">Gain / Loss</th>
                <th className="text-right px-3 py-2 font-medium">%</th>
                <th className="px-3 py-2 font-medium">Term</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((lot) => {
                const mv = marketPrice * lot.qtyRemaining;
                const gain = mv - lot.totalCost;
                const gainPct = lot.totalCost > 0 ? (gain / lot.totalCost) * 100 : 0;
                return (
                  <tr key={lot.id} className="border-b border-border/40 last:border-0">
                    <td className="px-3 py-1.5 tabular-nums text-foreground">{fmtDate(lot.acquiredDate)}</td>
                    <td className="px-3 py-1.5 tabular-nums text-right">
                      {lot.qtyRemaining.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                    </td>
                    <td className="px-3 py-1.5 tabular-nums text-right">{formatMoney(lot.costPerShare)}</td>
                    <td className="px-3 py-1.5 tabular-nums text-right">{formatMoney(lot.totalCost)}</td>
                    <td className="px-3 py-1.5 tabular-nums text-right text-foreground">
                      {marketPrice > 0 ? formatMoney(mv) : <span className="text-muted-foreground/40">—</span>}
                    </td>
                    <td className={cn("px-3 py-1.5 tabular-nums text-right font-medium", gain >= 0 ? "text-gain" : "text-loss")}>
                      {marketPrice > 0 ? formatMoney(gain) : <span className="text-muted-foreground/40">—</span>}
                    </td>
                    <td className={cn("px-3 py-1.5 tabular-nums text-right", gain >= 0 ? "text-gain" : "text-loss")}>
                      {marketPrice > 0 ? `${gainPct.toFixed(2)}%` : <span className="text-muted-foreground/40">—</span>}
                    </td>
                    <td className="px-3 py-1.5">
                      <span className={cn(
                        "inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                        lot.holdingPeriod === "long"
                          ? "bg-gain/10 text-gain"
                          : "bg-amber-500/10 text-amber-600",
                      )}>
                        {lot.holdingPeriod === "long" ? "Long" : "Short"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </TableCell>
    </TableRow>
  );
}

function PerformerBar({ pct, maxPct, gain }: { pct: number; maxPct: number; gain: boolean }) {
  const width = maxPct > 0 ? Math.abs(pct) / maxPct * 100 : 0;
  return (
    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden min-w-0">
      <div
        className={cn("h-full rounded-full transition-all", gain ? "bg-gain" : "bg-loss")}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

function Holdings() {
  const [asOf, setAsOf] = useState(localDateStr);
  const [sort, setSort] = useState<SortConfig>(null);
  const [method, setMethod] = useState<LotMethod>("HIFO");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { txns, snapshot, isLoading, unmapped } = usePortfolio(asOf);

  function handleSort(key: SortKey) {
    setSort((prev) =>
      prev?.key === key
        ? { key, dir: prev.dir === "desc" ? "asc" : "desc" }
        : { key, dir: "desc" },
    );
  }

  function toggleExpand(symbol: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(symbol) ? next.delete(symbol) : next.add(symbol);
      return next;
    });
  }

  const holdings = useMemo(
    () => sortHoldings(snapshot.holdings, sort),
    [snapshot.holdings, sort],
  );

  const { holdingsBySymbol } = useMemo(
    () => buildLots(txns, method, asOf),
    [txns, method, asOf],
  );

  // Top/worst 5 performers (by unrealized P/L %)
  const rankedHoldings = useMemo(
    () => [...snapshot.holdings].filter((h) => h.marketValue > 0 && h.costBasis > 0),
    [snapshot.holdings],
  );
  const top5   = useMemo(() => [...rankedHoldings].sort((a, b) => b.unrealizedPLPct - a.unrealizedPLPct).slice(0, 5), [rankedHoldings]);
  const worst5 = useMemo(() => [...rankedHoldings].sort((a, b) => a.unrealizedPLPct - b.unrealizedPLPct).slice(0, 5), [rankedHoldings]);

  // Scale for progress bars — max of each group (minimum 1 to avoid division by zero)
  const maxTopPct   = useMemo(() => Math.max(...top5.map((h) => h.unrealizedPLPct), 1), [top5]);
  const maxWorstPct = useMemo(() => Math.max(...worst5.map((h) => Math.abs(h.unrealizedPLPct)), 1), [worst5]);

  // Totals row
  const totals = useMemo(() => {
    const h = snapshot.holdings;
    const marketValue    = h.reduce((s, x) => s + x.marketValue, 0);
    const costBasis      = h.reduce((s, x) => s + x.costBasis, 0);
    const unrealizedPL   = marketValue - costBasis;
    const unrealizedPLPct = costBasis > 0 ? (unrealizedPL / costBasis) * 100 : 0;
    const annualIncome   = h.reduce((s, x) => s + x.annualDividendIncome, 0);

    // Weighted-average beta: only holdings with a known beta, weighted by market value
    const betaHoldings  = h.filter((x) => x.beta != null && x.marketValue > 0);
    const betaCoveredMV = betaHoldings.reduce((s, x) => s + x.marketValue, 0);
    const weightedBeta  = betaCoveredMV > 0
      ? betaHoldings.reduce((s, x) => s + x.beta! * x.marketValue, 0) / betaCoveredMV
      : null;

    // Portfolio yield = total annual income / total market value
    const portfolioYield = marketValue > 0 && annualIncome > 0 ? annualIncome / marketValue : null;

    return { marketValue, costBasis, unrealizedPL, unrealizedPLPct, annualIncome, weightedBeta, portfolioYield };
  }, [snapshot.holdings]);

  return (
    <div className="p-6 lg:p-8 space-y-6 text-muted-foreground">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Holdings</h1>
          <p className="text-sm">
            {isLoading ? "Loading…" : `${snapshot.holdings.length} positions`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 rounded-full glass-surface p-0.5 text-xs">
            {(["FIFO", "HIFO"] as LotMethod[]).map((m) => (
              <button
                key={m}
                onClick={() => setMethod(m)}
                className={cn(
                  "px-2.5 py-1 rounded font-medium transition-colors",
                  method === m
                    ? "bg-gradient-to-r from-sky-400/90 to-blue-600/80 text-white shadow-[0_0_12px_-4px_oklch(0.74_0.135_235_/_0.8)]"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m}
              </button>
            ))}
          </div>
          <AsOfDatePicker value={asOf} onChange={setAsOf} />
        </div>
      </div>

      <UnmappedBanner unmapped={unmapped} />

      {/* Top / Worst performers */}
      {rankedHoldings.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Card className="p-5">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">
              Top Performers
            </p>
            <div className="space-y-3">
              {top5.map((h) => (
                <div key={h.symbol} className="flex items-center gap-3">
                  <span className="w-14 shrink-0 text-sm font-semibold text-foreground">{h.symbol}</span>
                  <PerformerBar pct={h.unrealizedPLPct} maxPct={maxTopPct} gain={true} />
                  <div className="shrink-0 text-right w-28">
                    <div className="text-sm font-bold text-gain leading-snug">
                      +{h.unrealizedPLPct.toFixed(1)}%
                    </div>
                    <div className="text-[11px] text-muted-foreground leading-snug">
                      {formatMoney(h.unrealizedPL)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <Card className="p-5">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">
              Worst Performers
            </p>
            <div className="space-y-3">
              {worst5.map((h) => (
                <div key={h.symbol} className="flex items-center gap-3">
                  <span className="w-14 shrink-0 text-sm font-semibold text-foreground">{h.symbol}</span>
                  <PerformerBar pct={h.unrealizedPLPct} maxPct={maxWorstPct} gain={h.unrealizedPLPct >= 0} />
                  <div className="shrink-0 text-right w-28">
                    <div className={cn("text-sm font-bold leading-snug", h.unrealizedPLPct >= 0 ? "text-gain" : "text-loss")}>
                      {h.unrealizedPLPct >= 0 ? "+" : ""}{h.unrealizedPLPct.toFixed(1)}%
                    </div>
                    <div className="text-[11px] text-muted-foreground leading-snug">
                      {formatMoney(h.unrealizedPL)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <SortHead label="Symbol"         sortKey="symbol"               sort={sort} onSort={handleSort} />
              <SortHead label="Qty"            sortKey="quantity"             sort={sort} onSort={handleSort} className="text-right" />
              <SortHead label="Avg Cost"       sortKey="avgCost"              sort={sort} onSort={handleSort} className="text-right" />
              <SortHead label="Price"          sortKey="marketPrice"          sort={sort} onSort={handleSort} className="text-right" />
              <SortHead label="Market Value"   sortKey="marketValue"          sort={sort} onSort={handleSort} className="text-right" />
              <SortHead label="Cost Basis"     sortKey="costBasis"            sort={sort} onSort={handleSort} className="text-right" />
              <SortHead label="Unrealized P/L" sortKey="unrealizedPL"         sort={sort} onSort={handleSort} className="text-right" />
              <SortHead label="%"              sortKey="unrealizedPLPct"      sort={sort} onSort={handleSort} className="text-right" />
              <SortHead label="Weight"         sortKey="weightPct"            sort={sort} onSort={handleSort} className="text-right" />
              <SortHead label="Beta"           sortKey="beta"                 sort={sort} onSort={handleSort} className="text-right" />
              <SortHead label="Yield"          sortKey="dividendYield"        sort={sort} onSort={handleSort} className="text-right" />
              <SortHead label="Ann. Income"    sortKey="annualDividendIncome" sort={sort} onSort={handleSort} className="text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* Total row — pinned at top */}
            {holdings.length > 0 && (
              <TableRow className="bg-muted/30 font-semibold border-b-2 border-border">
                <TableCell className="w-8" />
                <TableCell className="text-foreground">Total</TableCell>
                <TableCell />
                <TableCell />
                <TableCell />
                <TableCell className="text-right tabular-nums text-foreground">{formatMoney(totals.marketValue)}</TableCell>
                <TableCell className="text-right tabular-nums text-foreground">{formatMoney(totals.costBasis)}</TableCell>
                <TableCell className={cn("text-right tabular-nums font-semibold", totals.unrealizedPL >= 0 ? "text-gain" : "text-loss")}>
                  {formatMoney(totals.unrealizedPL)}
                </TableCell>
                <TableCell className={cn("text-right tabular-nums", totals.unrealizedPLPct >= 0 ? "text-gain" : "text-loss")}>
                  {totals.unrealizedPLPct.toFixed(2)}%
                </TableCell>
                <TableCell className="text-right tabular-nums">100.00%</TableCell>
                <TableCell className="text-right tabular-nums text-foreground">
                  {totals.weightedBeta != null ? totals.weightedBeta.toFixed(2) : <span className="text-muted-foreground/40">—</span>}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {totals.portfolioYield != null
                    ? `${(totals.portfolioYield * 100).toFixed(2)}%`
                    : <span className="text-muted-foreground/40">—</span>}
                </TableCell>
                <TableCell className="text-right tabular-nums text-gain">
                  {totals.annualIncome > 0 ? formatMoney(totals.annualIncome) : "—"}
                </TableCell>
              </TableRow>
            )}
            {holdings.length === 0 && (
              <TableRow>
                <TableCell colSpan={13} className="text-center text-muted-foreground py-12">
                  No holdings as of this date.
                </TableCell>
              </TableRow>
            )}
            {holdings.map((h) => {
              const lots = holdingsBySymbol[h.symbol] ?? [];
              const isExpanded = expanded.has(h.symbol);
              const hasLots = lots.length > 0;
              return (
                <Fragment key={h.symbol}>
                  <TableRow className={cn(isExpanded && "bg-muted/20")}>
                    <TableCell className="w-8 pr-0">
                      {hasLots && (
                        <button
                          onClick={() => toggleExpand(h.symbol)}
                          className="flex items-center justify-center w-6 h-6 rounded hover:bg-muted transition-colors text-muted-foreground"
                          aria-label={isExpanded ? "Collapse lots" : "Expand lots"}
                        >
                          <ChevronRight className={cn("w-3.5 h-3.5 transition-transform", isExpanded && "rotate-90")} />
                        </button>
                      )}
                    </TableCell>
                    <TableCell
                      className={cn("font-medium text-foreground", hasLots && "cursor-pointer")}
                      onClick={() => hasLots && toggleExpand(h.symbol)}
                    >
                      <span className="flex items-center gap-1">
                        {h.symbol}
                        {lots.length > 1 && (
                          <span className="text-[10px] text-muted-foreground font-normal">
                            {lots.length} lots
                          </span>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{h.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(h.avgCost)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(h.marketPrice)}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium text-foreground">{formatMoney(h.marketValue)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(h.costBasis)}</TableCell>
                    <TableCell className={cn("text-right tabular-nums font-medium", h.unrealizedPL >= 0 ? "text-gain" : "text-loss")}>
                      {formatMoney(h.unrealizedPL)}
                    </TableCell>
                    <TableCell className={cn("text-right tabular-nums", h.unrealizedPLPct >= 0 ? "text-gain" : "text-loss")}>
                      {h.unrealizedPLPct.toFixed(2)}%
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{h.weightPct.toFixed(2)}%</TableCell>
                    <TableCell className="text-right tabular-nums text-foreground">
                      {h.beta != null ? h.beta.toFixed(2) : <span className="text-muted-foreground/40">—</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {h.dividendYield != null
                        ? `${(h.dividendYield * 100).toFixed(2)}%`
                        : <span className="text-muted-foreground/40">—</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-gain">
                      {h.annualDividendIncome > 0 ? formatMoney(h.annualDividendIncome) : <span className="text-muted-foreground/40">—</span>}
                    </TableCell>
                  </TableRow>
                  {isExpanded && hasLots && (
                    <LotRows lots={lots} marketPrice={h.marketPrice} />
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

