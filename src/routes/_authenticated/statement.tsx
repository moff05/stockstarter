import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePortfolio } from "@/hooks/use-portfolio";
import { getHistoricalCloses, getQuotes } from "@/lib/prices.functions";
import { buildPeriodActivity, formatMoney, isoAddDays } from "@/lib/portfolio";
import { exportStatementPDF, type StatementPDFData } from "@/lib/export-pdf";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/statement")({
  head: () => ({ meta: [{ title: "Capital Statement — StockStarter" }] }),
  component: Statement,
});

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

function lastDayOfMonth(year: number, month: number): string {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2,"0")}-${String(last).padStart(2,"0")}`;
}

function firstDayOfMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2,"0")}-01`;
}

function Statement() {
  const now = new Date();
  const currentYear  = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-based, local

  const [startYear,  setStartYear]  = useState(currentYear);
  const [startMonth, setStartMonth] = useState(1);          // default: Jan of current year
  const [endYear,    setEndYear]    = useState(currentYear);
  const [endMonth,   setEndMonth]   = useState(currentMonth);
  const [exporting,  setExporting]  = useState(false);

  const start       = firstDayOfMonth(startYear, startMonth);
  const endNominal  = lastDayOfMonth(endYear, endMonth);
  const today       = todayIso();
  const effectiveEnd = endNominal > today ? today : endNominal;

  const { txns, isLoading: portfolioLoading } = usePortfolio();

  const symbols = useMemo(() => {
    const set = new Set<string>();
    for (const t of txns) if (t.symbol && t.trade_date <= effectiveEnd) set.add(t.symbol.toUpperCase());
    return Array.from(set);
  }, [txns, effectiveEnd]);

  const startBefore = isoAddDays(start, -1);
  const startPricesQ = useQuery({
    queryKey: ["histprices", startBefore, symbols],
    enabled: symbols.length > 0,
    queryFn: () => getHistoricalCloses({ data: { symbols, asOfDate: startBefore } }),
  });
  const endPricesQ = useQuery({
    queryKey: ["histprices", effectiveEnd, symbols, effectiveEnd === today ? "live" : "hist"],
    enabled: symbols.length > 0,
    queryFn: async () => {
      if (effectiveEnd === today) {
        const q = await getQuotes({ data: { symbols } });
        const m: Record<string, number> = {};
        for (const [k, v] of Object.entries(q)) m[k] = v.price;
        return m;
      }
      return getHistoricalCloses({ data: { symbols, asOfDate: effectiveEnd } });
    },
  });

  const isLoading = portfolioLoading || startPricesQ.isLoading || endPricesQ.isLoading;

  const period = useMemo(
    () =>
      buildPeriodActivity(
        txns,
        start,
        effectiveEnd,
        startPricesQ.data ?? {},
        endPricesQ.data ?? {},
      ),
    [txns, start, effectiveEnd, startPricesQ.data, endPricesQ.data],
  );

  const lines: { label: string; value: number; bold?: boolean; indent?: boolean; separator?: boolean }[] = [
    { label: "Beginning Capital",     value: period.beginningCapital, bold: true },
    { label: "Contributions",         value: period.contributions,    indent: true },
    { label: "Distributions",         value: -period.distributions,   indent: true },
    { label: "Interest Income",       value: period.interestIncome,   indent: true },
    { label: "Dividend Income",       value: period.dividendIncome,   indent: true },
    { label: "Realized Gain / (Loss)",value: period.realizedGain,     indent: true },
    { label: "Unrealized Gain / (Loss)", value: period.unrealizedGain, indent: true },
    { label: "Fees",                  value: -period.fees,            indent: true },
    { label: "Net Income (Loss)",     value: period.netIncome,        bold: true, separator: true },
    { label: "Ending Capital",        value: period.endingCapital,    bold: true, separator: true },
  ];

  async function handleExportPDF() {
    setExporting(true);
    try {
      const pdfData: StatementPDFData = {
        quarter: Math.ceil(startMonth / 3) as 1|2|3|4,
        year: startYear,
        periodStart: start,
        periodEnd: effectiveEnd,
        isPartial: effectiveEnd !== endNominal,
        lines,
      };
      await exportStatementPDF(pdfData);
    } finally {
      setExporting(false);
    }
  }

  const years: number[] = [];
  for (let y = currentYear; y >= currentYear - 10; y--) years.push(y);

  const periodLabel = start === firstDayOfMonth(startYear, startMonth) && effectiveEnd === endNominal
    ? `${MONTH_NAMES[startMonth-1]} ${startYear} — ${MONTH_NAMES[endMonth-1]} ${endYear}`
    : `${start} — ${effectiveEnd}`;

  return (
    <div className="p-6 lg:p-8 space-y-6 text-muted-foreground">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Capital Statement</h1>
          <p className="text-sm">
            Select a start and end month. Start = 1st of that month, end = last day.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          {/* Start month */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">From</span>
            <Select value={String(startMonth)} onValueChange={(v) => setStartMonth(Number(v))}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTH_NAMES.map((name, i) => (
                  <SelectItem key={i+1} value={String(i+1)}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={String(startYear)} onValueChange={(v) => setStartYear(Number(v))}>
              <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* End month */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">To</span>
            <Select value={String(endMonth)} onValueChange={(v) => setEndMonth(Number(v))}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTH_NAMES.map((name, i) => (
                  <SelectItem key={i+1} value={String(i+1)}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={String(endYear)} onValueChange={(v) => setEndYear(Number(v))}>
              <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={handleExportPDF}
            disabled={isLoading || exporting}
          >
            {exporting
              ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              : <Download className="w-4 h-4 mr-1.5" />}
            Export PDF
          </Button>
        </div>
      </div>

      <Card className="p-8 max-w-2xl mx-auto">
        <div className="text-center border-b border-border pb-5 mb-6">
          <div className="text-xs font-medium uppercase tracking-widest">Statement of Partner's Capital</div>
          <div className="text-xl font-semibold text-foreground mt-2">{periodLabel}</div>
          <div className="text-xs mt-1">
            {start} — {effectiveEnd}{effectiveEnd !== endNominal && " (to-date)"}
          </div>
          {isLoading && (
            <div className="text-xs mt-2 animate-pulse">Loading prices…</div>
          )}
        </div>

        <table className="w-full">
          <tbody>
            {lines.map((l, i) => (
              <tr
                key={i}
                className={cn(
                  "transition-colors",
                  l.separator ? "border-t border-border/60" : "",
                  l.bold ? "border-t border-border/60" : "",
                )}
              >
                <td className={cn(
                  "py-2.5",
                  l.indent ? "pl-5 text-sm" : "text-sm",
                  l.bold ? "font-semibold text-foreground" : "",
                )}>
                  {l.label}
                </td>
                <td className={cn(
                  "py-2.5 text-right font-mono tabular-nums text-sm",
                  l.bold ? "font-semibold text-foreground" : "",
                  l.value < 0 ? "text-loss" : l.value > 0 && l.indent ? "text-gain" : "",
                )}>
                  {formatMoney(l.value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-6 pt-4 border-t border-border/40 text-xs space-y-1">
          <div>Unrealized gain reflects mark-to-market change between {startBefore} and {effectiveEnd}.</div>
          <div>Numbers may be incomplete for securities without a matched ticker symbol.</div>
        </div>
      </Card>
    </div>
  );
}

