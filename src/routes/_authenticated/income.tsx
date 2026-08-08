import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Loader2 } from "lucide-react";
import { SortHead, useSortable, sortRows } from "@/components/SortHead";
import { KpiLabel } from "@/components/KpiLabel";
import { usePortfolio } from "@/hooks/use-portfolio";
import { getDividendEvents } from "@/lib/prices.functions";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/portfolio";
import { cn } from "@/lib/utils";
import type { Transaction } from "@/lib/portfolio";

export const Route = createFileRoute("/_authenticated/income")({
  head: () => ({ meta: [{ title: "Income — StockStarter" }] }),
  component: IncomePage,
});

/** Shares of a symbol held on a given date, derived from transaction history. */
function sharesAtDate(txns: Transaction[], symbol: string, date: string): number {
  let qty = 0;
  const sym = symbol.toUpperCase();
  for (const t of txns) {
    if ((t.symbol ?? "").toUpperCase() !== sym) continue;
    if (t.trade_date > date) continue;
    if (t.action === "BUY") qty += Math.abs(Number(t.quantity ?? 0));
    if (t.action === "SELL") qty -= Math.abs(Number(t.quantity ?? 0));
  }
  return Math.max(0, qty);
}

function fmtDate(iso: string) {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

type DivEvent = { date: string; amount: number; shares: number; received: number };

function EventRows({ events }: { events: DivEvent[] }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={7} className="p-0">
        <div className="mx-4 mb-3 mt-1 rounded-md border border-border/60 bg-muted/30 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/60 text-muted-foreground/70">
                <th className="text-left px-3 py-2 font-medium">Ex-Date</th>
                <th className="text-right px-3 py-2 font-medium">Per Share</th>
                <th className="text-right px-3 py-2 font-medium">Shares Held</th>
                <th className="text-right px-3 py-2 font-medium">Received</th>
              </tr>
            </thead>
            <tbody>
              {[...events].reverse().map((e) => (
                <tr key={e.date} className="border-b border-border/40 last:border-0">
                  <td className="px-3 py-1.5 text-foreground">{fmtDate(e.date)}</td>
                  <td className="px-3 py-1.5 tabular-nums text-right">{formatMoney(e.amount)}</td>
                  <td className="px-3 py-1.5 tabular-nums text-right">
                    {e.shares.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                  </td>
                  <td className="px-3 py-1.5 tabular-nums text-right font-medium text-gain">
                    {e.received > 0 ? formatMoney(e.received) : <span className="text-muted-foreground/40">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </TableCell>
    </TableRow>
  );
}

function localDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function IncomePage() {
  const today = localDateStr();
  const fiveYearsAgo = `${Number(today.slice(0, 4)) - 5}-01-01`;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { txns, snapshot, isLoading } = usePortfolio(today);

  // Only fetch for equity-like holdings that pay dividends (filter by yield > 0 or just all)
  const equitySymbols = useMemo(
    () => snapshot.holdings.map((h) => h.symbol).filter(Boolean),
    [snapshot.holdings],
  );

  const divQ = useQuery({
    queryKey: ["dividend-events", equitySymbols.join(","), fiveYearsAgo, today],
    queryFn: () =>
      getDividendEvents({ data: { symbols: equitySymbols, startDate: fiveYearsAgo, endDate: today } }),
    enabled: equitySymbols.length > 0 && !isLoading,
    staleTime: 4 * 60 * 60_000, // 4 hours — dividend calendars don't change intraday
  });

  const divEvents = divQ.data ?? {};

  // Build per-position attribution: for each event, compute shares held at ex-date
  const positionIncome = useMemo(() => {
    return snapshot.holdings
      .map((h) => {
        const events: DivEvent[] = (divEvents[h.symbol] ?? []).map((e) => {
          const shares = sharesAtDate(txns, h.symbol, e.date);
          return { ...e, shares, received: shares * e.amount };
        }).filter((e) => e.received > 0);

        const totalReceived = events.reduce((s, e) => s + e.received, 0);
        const lastEvent = events.at(-1) ?? null;
        const ttmReceived = events
          .filter((e) => e.date >= `${Number(today.slice(0, 4)) - 1}-${today.slice(5)}`)
          .reduce((s, e) => s + e.received, 0);

        return { ...h, events, totalReceived, ttmReceived, lastEvent, lastEventDate: lastEvent?.date ?? "" };
      })
      .filter((p) => p.events.length > 0 || (p.dividendYield != null && p.dividendYield > 0))
      .sort((a, b) => b.annualDividendIncome - a.annualDividendIncome);
  }, [snapshot.holdings, divEvents, txns, today]);

  const [sort, handleSort] = useSortable("annualDividendIncome");
  const displayed = useMemo(() => sortRows(positionIncome as any[], sort), [positionIncome, sort]);

  // Totals
  const ttmTotal = positionIncome.reduce((s, p) => s + p.ttmReceived, 0);
  // Expected annual = trailing yield × current market value for each position (forward estimate)
  const expectedAnnual = snapshot.holdings.reduce((s, h) => s + h.annualDividendIncome, 0);
  const dbDividendIncome = snapshot.dividendIncome + snapshot.interestIncome;

  function toggle(symbol: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(symbol) ? next.delete(symbol) : next.add(symbol);
      return next;
    });
  }

  return (
    <div className="p-6 lg:p-8 space-y-6 text-muted-foreground">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Income</h1>
        <p className="text-sm mt-0.5">
          Per-position dividend history sourced from Yahoo Finance, cross-referenced with shares held at each ex-date.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="p-5">
          <KpiLabel tip="Actual dividend cash paid out over the last 12 months, per Yahoo Finance's recorded ex-dividend events for what you held at the time.">
            TTM Dividend Income
          </KpiLabel>
          <p className="text-2xl font-bold tabular-nums text-foreground">
            {divQ.isLoading || isLoading ? "—" : formatMoney(ttmTotal)}
          </p>
          <p className="text-xs mt-1">trailing 12 months (Yahoo events)</p>
        </Card>
        <Card className="p-5">
          <KpiLabel tip="Forward-looking estimate: each position's current dividend yield applied to its current market value. Not a guarantee — yields and prices change.">
            Expected Annual Income
          </KpiLabel>
          <p className="text-2xl font-bold tabular-nums text-gain">
            {isLoading ? "—" : formatMoney(expectedAnnual)}
          </p>
          <p className="text-xs mt-1">trailing yield × current market value</p>
        </Card>
        <Card className="p-5">
          <KpiLabel tip="Dividend and interest amounts as they actually appeared on your uploaded broker statements, all-time. Useful as a sanity check against the Yahoo-sourced TTM figure.">
            Recorded Div + Interest
          </KpiLabel>
          <p className="text-2xl font-bold tabular-nums text-foreground">
            {isLoading ? "—" : formatMoney(dbDividendIncome)}
          </p>
          <p className="text-xs mt-1">from statement (all-time)</p>
        </Card>
      </div>

      {(divQ.isLoading || isLoading) && (
        <div className="flex items-center gap-2 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          Fetching dividend history from Yahoo Finance…
        </div>
      )}

      {!divQ.isLoading && !isLoading && (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <SortHead label="Symbol"       sortKey="symbol"               sort={sort} onSort={handleSort} />
                <SortHead label="Shares"       sortKey="quantity"             sort={sort} onSort={handleSort} className="text-right" />
                <SortHead label="Yield"        sortKey="dividendYield"        sort={sort} onSort={handleSort} className="text-right" tip="Annual dividend as a percentage of the current share price." />
                <SortHead label="Ann. Income"  sortKey="annualDividendIncome" sort={sort} onSort={handleSort} className="text-right" tip="Expected yearly dividend income from this position, at current yield and share count." />
                <SortHead label="TTM Received" sortKey="ttmReceived"          sort={sort} onSort={handleSort} className="text-right" tip="Dividends actually paid on this position over the trailing 12 months." />
                <SortHead label="Last Dividend" sortKey="lastEventDate"       sort={sort} onSort={handleSort} className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {positionIncome.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-12">
                    No dividend history found. This may take a moment to load.
                  </TableCell>
                </TableRow>
              )}
              {displayed.map((p) => {
                const isExpanded = expanded.has(p.symbol);
                return (
                  <Fragment key={p.symbol}>
                    <TableRow
                      className={cn(isExpanded && "bg-muted/20", p.events.length > 0 && "cursor-pointer")}
                      onClick={() => p.events.length > 0 && toggle(p.symbol)}
                    >
                      <TableCell className="w-8 pr-0">
                        {p.events.length > 0 && (
                          <ChevronRight className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform", isExpanded && "rotate-90")} />
                        )}
                      </TableCell>
                      <TableCell className="font-medium text-foreground">
                        <span className="flex items-center gap-1">
                          {p.symbol}
                          {p.events.length > 0 && (
                            <span className="text-[10px] text-muted-foreground font-normal">
                              {p.events.length} payments
                            </span>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {p.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {p.dividendYield != null
                          ? `${(p.dividendYield * 100).toFixed(2)}%`
                          : <span className="text-muted-foreground/40">—</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-gain">
                        {p.annualDividendIncome > 0
                          ? formatMoney(p.annualDividendIncome)
                          : <span className="text-muted-foreground/40">—</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-foreground">
                        {p.ttmReceived > 0 ? formatMoney(p.ttmReceived) : <span className="text-muted-foreground/40">—</span>}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {p.lastEvent ? (
                          <span className="tabular-nums">
                            {fmtDate(p.lastEvent.date)}{" "}
                            <span className="text-muted-foreground">({formatMoney(p.lastEvent.amount)}/sh)</span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                    {isExpanded && p.events.length > 0 && (
                      <EventRows events={p.events} />
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      <p className="text-xs text-muted-foreground/70">
        * Dividend events sourced from Yahoo Finance (ex-dates + per-share amounts). Shares held at each ex-date computed from transaction history.
        Yahoo may not carry all distributions — REITs, foreign ADRs, and special dividends can have gaps. TTM = trailing 12 months.
      </p>
    </div>
  );
}

