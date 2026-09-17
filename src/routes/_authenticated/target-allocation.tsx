import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { usePortfolio } from "@/hooks/use-portfolio";
import { useAccountFilter } from "@/lib/account-filter";
import { formatMoney } from "@/lib/portfolio";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Info, RotateCcw } from "lucide-react";

export const Route = createFileRoute("/_authenticated/target-allocation")({
  head: () => ({ meta: [{ title: "Rebalancing — StockStarter" }] }),
  component: TargetAllocationPage,
});

const CASH_KEY = "__CASH__";
// Pre-account-scoping key — targets saved here applied globally regardless of
// the account filter. Migrated into the "all accounts" bucket below so nobody
// loses existing targets when this page became account-aware.
const LEGACY_STORAGE_KEY = "targetAllocations";

function storageKeyFor(account: string | null): string {
  return account ? `targetAllocations:${account}` : "targetAllocations:__ALL__";
}

function loadTargets(account: string | null): Record<string, number> {
  try {
    const raw = localStorage.getItem(storageKeyFor(account));
    if (raw) return JSON.parse(raw);
    if (!account) {
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) return JSON.parse(legacy);
    }
    return {};
  } catch {
    return {};
  }
}

function saveTargets(account: string | null, targets: Record<string, number>) {
  try {
    localStorage.setItem(storageKeyFor(account), JSON.stringify(targets));
  } catch {}
}

function TargetAllocationPage() {
  const { snapshot, isLoading } = usePortfolio();
  const { account } = useAccountFilter();
  const holdings = snapshot.holdings;

  const [targets, setTargets] = useState<Record<string, number>>({});
  const [loaded, setLoaded] = useState(false);
  const [tolerance, setTolerance] = useState(2);

  useEffect(() => {
    setTargets(loadTargets(account));
    setLoaded(true);
  }, [account]);

  // Rows: every currently held symbol + a synthetic Cash row, sorted by current market value.
  const rows = useMemo(() => {
    const held = [...holdings].sort((a, b) => b.marketValue - a.marketValue);
    return [
      ...held.map((h) => ({
        key: h.symbol,
        label: h.symbol,
        currentValue: h.marketValue,
        marketPrice: h.marketPrice,
        isCash: false,
      })),
      { key: CASH_KEY, label: "Cash", currentValue: snapshot.cash, marketPrice: 1, isCash: true },
    ];
  }, [holdings, snapshot.cash]);

  const totalEquity = snapshot.totalEquity;

  function targetPctFor(key: string, currentValue: number): number {
    if (targets[key] != null) return targets[key];
    // Default an unconfigured row's target to its current weight — starts "on target"
    // until the user deliberately sets a different goal.
    return totalEquity > 0 ? (currentValue / totalEquity) * 100 : 0;
  }

  function setTarget(key: string, pct: number) {
    const next = { ...targets, [key]: pct };
    setTargets(next);
    saveTargets(account, next);
  }

  function resetToCurrent() {
    const next: Record<string, number> = {};
    for (const r of rows) {
      next[r.key] = totalEquity > 0 ? (r.currentValue / totalEquity) * 100 : 0;
    }
    setTargets(next);
    saveTargets(account, next);
  }

  const enrichedRows = useMemo(() => {
    return rows.map((r) => {
      const currentPct = totalEquity > 0 ? (r.currentValue / totalEquity) * 100 : 0;
      const targetPct = targetPctFor(r.key, r.currentValue);
      const targetValue = (targetPct / 100) * totalEquity;
      const driftValue = r.currentValue - targetValue;
      const driftPct = currentPct - targetPct;
      const overTolerance = Math.abs(driftPct) > tolerance;
      const action: "buy" | "sell" | "hold" = !overTolerance ? "hold" : driftValue < 0 ? "buy" : "sell";
      const suggestedShares = !r.isCash && r.marketPrice > 0 ? Math.abs(driftValue) / r.marketPrice : null;
      return { ...r, currentPct, targetPct, targetValue, driftValue, driftPct, action, suggestedShares };
    });
  }, [rows, targets, totalEquity, tolerance]);

  const targetTotal = enrichedRows.reduce((s, r) => s + r.targetPct, 0);
  const targetTotalOff = Math.abs(targetTotal - 100) > 0.1;

  const buys = enrichedRows.filter((r) => r.action === "buy");
  const sells = enrichedRows.filter((r) => r.action === "sell");

  if (isLoading || !loaded) {
    return (
      <div className="p-6 lg:p-8 text-sm text-muted-foreground animate-pulse">
        Loading portfolio…
      </div>
    );
  }

  if (holdings.length === 0 && snapshot.cash === 0) {
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
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Rebalancing</h1>
          <p className="text-sm mt-0.5">
            Set a target % for each position and cash — the rest is computed. Not investment advice.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs">
            Tolerance band
            <Input
              type="number"
              min={0}
              max={50}
              step={0.5}
              value={tolerance}
              onChange={(e) => setTolerance(Math.max(0, Number(e.target.value) || 0))}
              className="w-16 h-7 text-xs"
            />
            pp
          </label>
          <button
            type="button"
            onClick={resetToCurrent}
            className="inline-flex items-center gap-1.5 rounded-full border border-border text-foreground text-xs font-medium px-3 py-1.5 hover:bg-muted/60 transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            Set targets to current
          </button>
        </div>
      </div>

      {targetTotalOff && (
        <Card className="p-3 border-amber-500/30 bg-amber-500/5 text-xs text-amber-700 dark:text-amber-400">
          Targets sum to {targetTotal.toFixed(1)}%, not 100% — drift figures below will be off until targets add up correctly.
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="p-5">
          <div className="text-[11px] font-medium uppercase tracking-wider">Total Capital</div>
          <div className="text-2xl font-bold text-foreground mt-1">{formatMoney(totalEquity)}</div>
          <div className="text-xs mt-0.5">market value + cash</div>
        </Card>
        <Card className="p-5">
          <div className="text-[11px] font-medium uppercase tracking-wider">Suggested Buys</div>
          <div className="text-2xl font-bold text-gain mt-1">{buys.length}</div>
          <div className="text-xs mt-0.5">
            {formatMoney(buys.reduce((s, r) => s + Math.abs(r.driftValue), 0))} total
          </div>
        </Card>
        <Card className="p-5">
          <div className="text-[11px] font-medium uppercase tracking-wider">Suggested Sells</div>
          <div className="text-2xl font-bold text-loss mt-1">{sells.length}</div>
          <div className="text-xs mt-0.5">
            {formatMoney(sells.reduce((s, r) => s + Math.abs(r.driftValue), 0))} total
          </div>
        </Card>
      </div>

      <Card>
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-foreground">Targets vs. Current</h2>
            <p className="text-xs mt-0.5">Edit the Target % column — everything else recomputes.</p>
          </div>
          <div className="text-xs tabular-nums">
            Target total: <span className={cn("font-semibold", targetTotalOff ? "text-amber-600" : "text-foreground")}>{targetTotal.toFixed(1)}%</span>
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Symbol</TableHead>
              <TableHead className="text-right">Current Value</TableHead>
              <TableHead className="text-right">Current %</TableHead>
              <TableHead className="text-right">Target %</TableHead>
              <TableHead className="text-right">Drift</TableHead>
              <TableHead className="text-right">Suggested Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {enrichedRows.map((r) => (
              <TableRow key={r.key}>
                <TableCell className="font-medium text-foreground">{r.label}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(r.currentValue)}</TableCell>
                <TableCell className="text-right tabular-nums">{r.currentPct.toFixed(1)}%</TableCell>
                <TableCell className="text-right">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={Number(r.targetPct.toFixed(2))}
                    onChange={(e) => setTarget(r.key, Number(e.target.value) || 0)}
                    className="w-20 h-7 text-xs text-right ml-auto"
                  />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <span className={cn("font-medium", Math.abs(r.driftPct) > tolerance ? (r.driftValue < 0 ? "text-gain" : "text-loss") : "text-muted-foreground")}>
                    {r.driftValue >= 0 ? "+" : ""}{formatMoney(r.driftValue)}
                  </span>
                  <span className="text-muted-foreground ml-1">({r.driftPct >= 0 ? "+" : ""}{r.driftPct.toFixed(1)}pp)</span>
                </TableCell>
                <TableCell className="text-right">
                  {r.action === "hold" ? (
                    <span className="text-xs text-muted-foreground/50">On target</span>
                  ) : (
                    <span className={cn("text-xs font-medium", r.action === "buy" ? "text-gain" : "text-loss")}>
                      {r.action === "buy" ? "Buy" : "Sell"} {formatMoney(Math.abs(r.driftValue))}
                      {r.suggestedShares != null && (
                        <span className="text-muted-foreground font-normal"> (~{r.suggestedShares.toLocaleString(undefined, { maximumFractionDigits: 2 })} sh)</span>
                      )}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <div className="flex items-start gap-1.5 text-[11px]">
        <Info className="w-3 h-3 shrink-0 mt-0.5" />
        <span>
          Suggestions are computed purely from your target % vs. current weight — they ignore taxes, trading fees, wash-sale risk, and order minimums.
          Targets are saved locally in this browser only. Not investment advice.
        </span>
      </div>
    </div>
  );
}
