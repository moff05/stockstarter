import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePortfolio } from "@/hooks/use-portfolio";
import { getHistoricalCloses } from "@/lib/prices.functions";
import { buildPeriodActivity, formatMoney, isoAddDays } from "@/lib/portfolio";
import type { PortfolioSnapshot, Transaction } from "@/lib/portfolio";
import { buildLots } from "@/lib/tax-lots";
import { buildSymbolAccountMap, buildFullCOA, getAccountName } from "@/lib/chart-of-accounts";
import type { AccountEntry } from "@/lib/chart-of-accounts";
import { buildGLEntries } from "@/lib/general-ledger";
import type { GLEntry } from "@/lib/general-ledger";
import { exportStatementPDF } from "@/lib/export-pdf";
import type { StatementPDFData } from "@/lib/export-pdf";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Download, Loader2, Search, X, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/financials")({
  validateSearch: (search: Record<string, unknown>) => ({
    tab: (search.tab as string) ?? "capital",
  }),
  component: FinancialsPage,
});

const TAB_TITLES: Record<string, string> = {
  capital: "Capital Statement",
  income:  "Income Statement",
  balance: "Balance Sheet",
  ledger:  "General Ledger",
  coa:     "Chart of Accounts",
};

// â”€â”€â”€ Shared helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function lastDayOfMonth(year: number, month: number): string {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

function firstDayOfMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

// â”€â”€â”€ Page root â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function FinancialsPage() {
  const { tab } = Route.useSearch();
  const { txns, snapshot, isLoading } = usePortfolio();
  const today = todayIso();

  const { holdingsBySymbol: _h, disposals } = useMemo(
    () => (txns.length ? buildLots(txns, "FIFO", today) : { holdingsBySymbol: {}, disposals: [] }),
    [txns, today],
  );

  const { symbolAccountMap, dynamicAccounts } = useMemo(
    () => buildSymbolAccountMap(txns),
    [txns],
  );

  const fullCOA = useMemo(() => buildFullCOA(dynamicAccounts), [dynamicAccounts]);

  const glEntries = useMemo(
    () => buildGLEntries(txns, disposals, symbolAccountMap),
    [txns, disposals, symbolAccountMap],
  );

  return (
    <div className="p-6 lg:p-8 space-y-6 text-muted-foreground">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {TAB_TITLES[tab] ?? "Financials"}
        </h1>
        <p className="text-sm">Derived from transaction history.</p>
      </div>

      {tab === "capital" && <CapitalTab txns={txns} snapshot={snapshot} isLoading={isLoading} />}
      {tab === "income"  && <IncomeStatementTab snapshot={snapshot} />}
      {tab === "balance" && <BalanceSheetTab snapshot={snapshot} symbolAccountMap={symbolAccountMap} />}
      {tab === "ledger"  && <GeneralLedgerTab glEntries={glEntries} fullCOA={fullCOA} />}
      {tab === "coa"     && <ChartOfAccountsTab fullCOA={fullCOA} glEntries={glEntries} />}
    </div>
  );
}

// â”€â”€â”€ Tab 1: Capital Statement â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function CapitalTab({
  txns,
  snapshot,
  isLoading: portfolioLoading,
}: {
  txns: Transaction[];
  snapshot: PortfolioSnapshot;
  isLoading: boolean;
}) {
  const now = new Date();
  const currentYear  = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const [startYear,  setStartYear]  = useState(currentYear);
  const [startMonth, setStartMonth] = useState(1);
  const [endYear,    setEndYear]    = useState(currentYear);
  const [endMonth,   setEndMonth]   = useState(currentMonth);
  const [exporting,  setExporting]  = useState(false);

  const start       = firstDayOfMonth(startYear, startMonth);
  const endNominal  = lastDayOfMonth(endYear, endMonth);
  const today       = todayIso();
  const effectiveEnd = endNominal > today ? today : endNominal;
  const isToday     = effectiveEnd === today;

  // When the period ends today, reuse the prices already in the portfolio snapshot
  // so the ending capital ties exactly to the dashboard — no separate API call needed.
  const snapshotPrices = useMemo(() => {
    if (!isToday) return null;
    const m: Record<string, number> = {};
    for (const h of snapshot.holdings) m[h.symbol.toUpperCase()] = h.marketPrice;
    return m;
  }, [isToday, snapshot.holdings]);

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
    queryKey: ["histprices", effectiveEnd, symbols],
    enabled: symbols.length > 0 && !isToday,
    queryFn: () => getHistoricalCloses({ data: { symbols, asOfDate: effectiveEnd } }),
  });

  const endPrices = isToday ? (snapshotPrices ?? {}) : (endPricesQ.data ?? {});
  const isLoading = portfolioLoading || startPricesQ.isLoading || (!isToday && endPricesQ.isLoading);

  const period = useMemo(
    () => buildPeriodActivity(txns, start, effectiveEnd, startPricesQ.data ?? {}, endPrices),
    [txns, start, effectiveEnd, startPricesQ.data, endPrices],
  );

  const lines: { label: string; value: number; bold?: boolean; indent?: boolean; separator?: boolean }[] = [
    { label: "Beginning Capital",        value: period.beginning.totalMarketValue, bold: true },
    { label: "Contributions",            value: period.contributions,              indent: true },
    { label: "Distributions",            value: -period.distributions,             indent: true },
    { label: "Interest Income",          value: period.interestIncome,             indent: true },
    { label: "Dividend Income",          value: period.dividendIncome,             indent: true },
    { label: "Realized Gain / (Loss)",   value: period.realizedGain,               indent: true },
    { label: "Unrealized Gain / (Loss)", value: period.unrealizedGain,             indent: true },
    { label: "Fees",                     value: -period.fees,                      indent: true },
    { label: "Net Income (Loss)",        value: period.netIncome,                  bold: true, separator: true },
    { label: "Ending Capital",           value: period.ending.totalMarketValue,    bold: true, separator: true },
  ];

  async function handleExportPDF() {
    setExporting(true);
    try {
      const pdfData: StatementPDFData = {
        quarter: Math.ceil(startMonth / 3) as 1 | 2 | 3 | 4,
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

  const periodLabel = `${MONTH_NAMES[startMonth - 1]} ${startYear} — ${MONTH_NAMES[endMonth - 1]} ${endYear}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">From</span>
          <Select value={String(startMonth)} onValueChange={(v) => setStartMonth(Number(v))}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MONTH_NAMES.map((name, i) => (
                <SelectItem key={i + 1} value={String(i + 1)}>{name}</SelectItem>
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
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">To</span>
          <Select value={String(endMonth)} onValueChange={(v) => setEndMonth(Number(v))}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MONTH_NAMES.map((name, i) => (
                <SelectItem key={i + 1} value={String(i + 1)}>{name}</SelectItem>
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
        <Button variant="outline" size="sm" onClick={handleExportPDF} disabled={isLoading || exporting}>
          {exporting
            ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            : <Download className="w-4 h-4 mr-1.5" />}
          Export PDF
        </Button>
      </div>

      <Card className="p-8 max-w-2xl mx-auto">
        <div className="text-center border-b border-border pb-5 mb-6">
          <div className="text-xs font-medium uppercase tracking-widest">Statement of Partner's Capital</div>
          <div className="text-xl font-semibold text-foreground mt-2">{periodLabel}</div>
          <div className="text-xs mt-1">
            {start} — {effectiveEnd}{effectiveEnd !== endNominal && " (to-date)"}
          </div>
          {isLoading && <div className="text-xs mt-2 animate-pulse">Loading prices…</div>}
        </div>

        <table className="w-full">
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className={cn(l.separator || l.bold ? "border-t border-border/60" : "")}>
                <td className={cn("py-2.5 text-sm", l.indent ? "pl-5" : "", l.bold ? "font-semibold text-foreground" : "")}>
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

// â”€â”€â”€ Tab 2: Income Statement â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function IncomeStatementTab({ snapshot }: { snapshot: PortfolioSnapshot }) {
  const gross = snapshot.realizedGain + snapshot.dividendIncome + snapshot.interestIncome;
  const netInvestmentIncome = gross - snapshot.fees;

  type Row = { label: string; value: number };
  type Section = { header: string; rows: Row[]; total: { label: string; value: number; highlight?: boolean } };

  const sections: Section[] = [
    {
      header: "INVESTMENT INCOME",
      rows: [
        { label: "Realized Gain / (Loss)", value: snapshot.realizedGain },
        { label: "Dividend Income",        value: snapshot.dividendIncome },
        { label: "Interest Income",        value: snapshot.interestIncome },
        { label: "Other Income",           value: 0 },
      ],
      total: { label: "GROSS INVESTMENT INCOME", value: gross },
    },
    {
      header: "INVESTMENT EXPENSES",
      rows: [{ label: "Investment Expenses / Fees", value: -snapshot.fees }],
      total: { label: "NET INVESTMENT INCOME", value: netInvestmentIncome },
    },
    {
      header: "OTHER EXPENSES",
      rows: [
        { label: "Non-Investment Expenses", value: 0 },
        { label: "Interest Expense",        value: 0 },
      ],
      total: { label: "PRE-TAX NET INCOME", value: netInvestmentIncome },
    },
    {
      header: "TAXES",
      rows: [{ label: "Applicable Income Taxes", value: 0 }],
      total: { label: "NET INCOME", value: netInvestmentIncome, highlight: true },
    },
  ];

  return (
    <Card className="p-8 max-w-2xl mx-auto">
      <div className="text-center border-b border-border pb-5 mb-6">
        <div className="text-xs font-medium uppercase tracking-widest">Income Statement</div>
        <div className="text-xl font-semibold text-foreground mt-2">Inception to Date</div>
        <div className="text-xs mt-1 text-muted-foreground">All periods from inception through today</div>
      </div>

      <table className="w-full">
        <tbody>
          {sections.map((section, si) => (
            <Fragment key={si}>
              <tr className={cn(si > 0 ? "border-t border-border/40" : "")}>
                <td colSpan={2} className="pt-5 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {section.header}
                </td>
              </tr>
              {section.rows.map((row, ri) => (
                <tr key={ri}>
                  <td className="py-1.5 pl-5 text-sm">{row.label}</td>
                  <td className={cn(
                    "py-1.5 text-right font-mono tabular-nums text-sm",
                    row.value === 0 ? "text-muted-foreground/40" : row.value < 0 ? "text-loss" : "text-gain",
                  )}>
                    {row.value === 0 ? "—" : formatMoney(row.value)}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-border/60">
                <td className="py-2.5 text-sm font-semibold text-foreground">{section.total.label}</td>
                <td className={cn(
                  "py-2.5 text-right font-mono tabular-nums text-sm font-semibold",
                  section.total.value < 0 ? "text-loss" : section.total.value > 0 ? "text-gain" : "text-foreground",
                )}>
                  {formatMoney(section.total.value)}
                </td>
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// â”€â”€â”€ Tab 3: Balance Sheet â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function BalanceSheetTab({
  snapshot,
  symbolAccountMap,
}: {
  snapshot: PortfolioSnapshot;
  symbolAccountMap: Record<string, number>;
}) {
  // Balance sheet at fair market value.
  // Partner Capital is computed as the balancing item so the sheet always ties:
  //   Total Assets = totalMarketValue
  //   Equity = partnerCapital + retainedEarnings + unrealizedGain = totalMarketValue
  const totalAssets      = snapshot.totalMarketValue;
  const retainedEarnings = snapshot.realizedGain + snapshot.dividendIncome + snapshot.interestIncome - snapshot.fees;
  const partnerCapital   = snapshot.totalCostBasis - retainedEarnings;
  const totalEquity      = partnerCapital + retainedEarnings + snapshot.unrealizedGain; // = totalMarketValue
  const balanced         = Math.abs(totalAssets - totalEquity) < 0.02;

  return (
    <Card className="p-8 max-w-2xl mx-auto">
      <div className="text-center border-b border-border pb-5 mb-6">
        <div className="text-xs font-medium uppercase tracking-widest">Balance Sheet</div>
        <div className="text-xl font-semibold text-foreground mt-2">As of Today</div>
        <div className="text-xs mt-1 text-muted-foreground">At fair market value</div>
      </div>

      <table className="w-full">
        <tbody>
          {/* ASSETS */}
          <tr>
            <td colSpan={2} className="pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Assets
            </td>
          </tr>
          <tr>
            <td className="py-1 pl-5 text-sm text-muted-foreground italic">Equity Securities (at fair market value)</td>
            <td />
          </tr>
          {snapshot.holdings.map((h) => {
            const acct = symbolAccountMap[h.symbol.toUpperCase()] ?? 1799;
            return (
              <tr key={h.symbol}>
                <td className="py-0.5 pl-10 text-xs text-muted-foreground">
                  {h.symbol} — {h.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })} sh @ ${h.marketPrice.toFixed(2)} (Acct {acct})
                </td>
                <td className="py-0.5 text-right font-mono tabular-nums text-xs">{formatMoney(h.marketValue)}</td>
              </tr>
            );
          })}
          <tr className="border-t border-border/60">
            <td className="py-2.5 text-sm font-semibold text-foreground">Total Assets</td>
            <td className="py-2.5 text-right font-mono tabular-nums text-sm font-semibold text-foreground">{formatMoney(totalAssets)}</td>
          </tr>

          {/* LIABILITIES */}
          <tr className="border-t border-border/40">
            <td colSpan={2} className="pt-5 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Liabilities
            </td>
          </tr>
          <tr>
            <td className="py-1.5 pl-5 text-sm text-muted-foreground">(None tracked)</td>
            <td className="py-1.5 text-right font-mono tabular-nums text-sm text-muted-foreground/40">—</td>
          </tr>
          <tr className="border-t border-border/60">
            <td className="py-2.5 text-sm font-semibold text-foreground">Total Liabilities</td>
            <td className="py-2.5 text-right font-mono tabular-nums text-sm font-semibold text-foreground">{formatMoney(0)}</td>
          </tr>

          {/* EQUITY */}
          <tr className="border-t border-border/40">
            <td colSpan={2} className="pt-5 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Partners' Capital (Equity)
            </td>
          </tr>
          <tr>
            <td className="py-1.5 pl-5 text-sm">
              Net Invested Capital (Acct 3501)
              <span className="ml-2 text-[10px] text-muted-foreground">cost basis minus income earned</span>
            </td>
            <td className="py-1.5 text-right font-mono tabular-nums text-sm">{formatMoney(partnerCapital)}</td>
          </tr>
          <tr>
            <td className="py-0.5 pl-10 text-xs text-muted-foreground">Dividends &amp; Interest</td>
            <td className="py-0.5 text-right font-mono tabular-nums text-xs text-muted-foreground">
              {formatMoney(snapshot.dividendIncome + snapshot.interestIncome)}
            </td>
          </tr>
          <tr>
            <td className="py-0.5 pl-10 text-xs text-muted-foreground">Realized Gain / (Loss)</td>
            <td className={cn("py-0.5 text-right font-mono tabular-nums text-xs", snapshot.realizedGain < 0 ? "text-loss" : "text-muted-foreground")}>
              {formatMoney(snapshot.realizedGain)}
            </td>
          </tr>
          <tr>
            <td className="py-0.5 pl-10 text-xs text-muted-foreground">Less: Fees &amp; Expenses</td>
            <td className="py-0.5 text-right font-mono tabular-nums text-xs text-muted-foreground">
              {formatMoney(-snapshot.fees)}
            </td>
          </tr>
          <tr>
            <td className="py-1.5 pl-5 text-sm font-medium">Retained Earnings</td>
            <td className={cn("py-1.5 text-right font-mono tabular-nums text-sm font-medium border-t border-border/40", retainedEarnings < 0 ? "text-loss" : retainedEarnings > 0 ? "text-gain" : "")}>
              {formatMoney(retainedEarnings)}
            </td>
          </tr>
          <tr>
            <td className="py-1.5 pl-5 text-sm">Unrealized Appreciation / (Depreciation)</td>
            <td className={cn("py-1.5 text-right font-mono tabular-nums text-sm", snapshot.unrealizedGain < 0 ? "text-loss" : snapshot.unrealizedGain > 0 ? "text-gain" : "")}>
              {formatMoney(snapshot.unrealizedGain)}
            </td>
          </tr>
          <tr className="border-t border-border/60">
            <td className="py-2.5 text-sm font-semibold text-foreground">Total Equity</td>
            <td className="py-2.5 text-right font-mono tabular-nums text-sm font-semibold text-foreground">{formatMoney(totalEquity)}</td>
          </tr>
        </tbody>
      </table>

      <div className="mt-4 text-xs text-muted-foreground italic">
        Equity is presented at fair market value. "Net Invested Capital" = total cost basis of current holdings minus cumulative income earned, which captures both cash contributions and in-kind transfers.
      </div>

      <div className={cn("mt-4 pt-4 border-t border-border/40 flex items-center gap-2 text-sm font-medium", balanced ? "text-emerald-500" : "text-amber-500")}>
        {balanced
          ? <><CheckCircle2 className="w-4 h-4 shrink-0" /> Balanced — Assets = Liabilities + Equity</>
          : <><AlertCircle className="w-4 h-4 shrink-0" /> Out of balance by {formatMoney(Math.abs(totalAssets - totalEquity))}</>}
      </div>
    </Card>
  );
}

// â”€â”€â”€ Tab 4: General Ledger â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const GL_ACTIONS = ["BUY", "SELL", "DIVIDEND", "INTEREST", "CONTRIBUTION", "DISTRIBUTION", "FEE"] as const;

function GeneralLedgerTab({ glEntries, fullCOA }: { glEntries: GLEntry[]; fullCOA: AccountEntry[] }) {
  const [search,       setSearch]       = useState("");
  const [actionFilter, setActionFilter] = useState("ALL");
  const [yearFilter,   setYearFilter]   = useState("ALL");
  const [acctFilter,   setAcctFilter]   = useState("ALL");

  const years = useMemo(() => {
    const set = new Set<string>();
    for (const e of glEntries) set.add(e.date.slice(0, 4));
    return ["ALL", ...Array.from(set).sort().reverse()];
  }, [glEntries]);

  const acctOptions = useMemo(() => {
    const seen = new Set<number>();
    for (const e of glEntries) { seen.add(e.debitAccount); seen.add(e.creditAccount); }
    return Array.from(seen).sort((a, b) => a - b).map((code) => ({
      code,
      label: getAccountName(code, fullCOA),
    }));
  }, [glEntries, fullCOA]);

  const filtered = useMemo(() => {
    let rows = glEntries;
    if (actionFilter !== "ALL") rows = rows.filter((e) => e.action === actionFilter);
    if (yearFilter   !== "ALL") rows = rows.filter((e) => e.date.startsWith(yearFilter));
    if (acctFilter   !== "ALL") {
      const code = Number(acctFilter);
      rows = rows.filter((e) => e.debitAccount === code || e.creditAccount === code);
    }
    if (search.trim()) {
      const term = search.toLowerCase();
      rows = rows.filter(
        (e) => e.description.toLowerCase().includes(term) || (e.symbol ?? "").toLowerCase().includes(term),
      );
    }
    return rows;
  }, [glEntries, actionFilter, yearFilter, acctFilter, search]);

  const showRunningBal = acctFilter !== "ALL";
  const acctCode       = Number(acctFilter);
  const acctEntry      = fullCOA.find((a) => a.code === acctCode);
  const normalDebit    = acctEntry?.normalBalance === "debit";

  // Pre-compute running balances for single-account view
  const runningBals = useMemo(() => {
    if (!showRunningBal) return [];
    let bal = 0;
    return filtered.map((e) => {
      if (e.debitAccount  === acctCode) bal += normalDebit ?  e.amount : -e.amount;
      if (e.creditAccount === acctCode) bal += normalDebit ? -e.amount :  e.amount;
      return bal;
    });
  }, [filtered, showRunningBal, acctCode, normalDebit]);

  const totalDebits  = filtered.reduce((s, e) => s + e.amount, 0);
  const totalCredits = filtered.reduce((s, e) => s + e.amount, 0);
  const booksBalance = Math.abs(totalDebits - totalCredits) < 0.02;

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search description or symbol…"
            className="pl-8 pr-8 h-8 text-sm"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <Select value={yearFilter} onValueChange={setYearFilter}>
          <SelectTrigger className="w-28 h-8 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            {years.map((y) => <SelectItem key={y} value={y}>{y === "ALL" ? "All years" : y}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={acctFilter} onValueChange={setAcctFilter}>
          <SelectTrigger className="w-64 h-8 text-sm"><SelectValue placeholder="All accounts" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All accounts</SelectItem>
            {acctOptions.map((a) => <SelectItem key={a.code} value={String(a.code)}>{a.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Action badges */}
      <div className="flex flex-wrap gap-1 items-center">
        {(["ALL", ...GL_ACTIONS] as const).map((a) => (
          <button
            key={a}
            onClick={() => setActionFilter(a)}
            className={cn(
              "px-2.5 py-1 rounded text-xs font-medium transition-colors border",
              actionFilter === a
                ? "bg-foreground text-background border-foreground"
                : "text-muted-foreground hover:text-foreground border-transparent hover:border-border",
            )}
          >
            {a === "ALL" ? "All" : a}
          </button>
        ))}
        {filtered.length !== glEntries.length && (
          <span className="text-xs text-muted-foreground ml-2">{filtered.length} of {glEntries.length} entries</span>
        )}
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Symbol</TableHead>
              <TableHead>Debit Account</TableHead>
              <TableHead className="text-right">Debit $</TableHead>
              <TableHead>Credit Account</TableHead>
              <TableHead className="text-right">Credit $</TableHead>
              {showRunningBal && <TableHead className="text-right">Balance</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((e, i) => (
              <TableRow key={`${e.txnId}-${e.debitAccount}-${i}`}>
                <TableCell className="whitespace-nowrap tabular-nums text-sm">{e.date}</TableCell>
                <TableCell>
                  <span className={cn(
                    "inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide",
                    e.action === "BUY"          ? "bg-blue-500/15 text-blue-400" :
                    e.action === "SELL"         ? "bg-rose-500/15 text-rose-400" :
                    e.action === "DIVIDEND"     ? "bg-emerald-500/15 text-emerald-400" :
                    e.action === "INTEREST"     ? "bg-teal-500/15 text-teal-400" :
                    e.action === "CONTRIBUTION" ? "bg-violet-500/15 text-violet-400" :
                    e.action === "FEE"          ? "bg-amber-500/15 text-amber-400" :
                    "bg-muted/60 text-muted-foreground"
                  )}>
                    {e.action}
                  </span>
                </TableCell>
                <TableCell className="text-sm max-w-[200px] truncate">{e.description}</TableCell>
                <TableCell className="text-sm font-medium text-foreground">{e.symbol ?? "—"}</TableCell>
                <TableCell className="text-xs font-mono text-muted-foreground">{getAccountName(e.debitAccount, fullCOA)}</TableCell>
                <TableCell className="text-right tabular-nums text-sm">{formatMoney(e.amount)}</TableCell>
                <TableCell className="text-xs font-mono text-muted-foreground">{getAccountName(e.creditAccount, fullCOA)}</TableCell>
                <TableCell className="text-right tabular-nums text-sm">{formatMoney(e.amount)}</TableCell>
                {showRunningBal && (
                  <TableCell className={cn("text-right tabular-nums text-sm font-medium", runningBals[i] < 0 ? "text-loss" : "text-foreground")}>
                    {formatMoney(runningBals[i])}
                  </TableCell>
                )}
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={showRunningBal ? 9 : 8} className="text-center py-12">
                  No entries match the current filter.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {filtered.length > 0 && (
          <div className="px-4 py-3 border-t border-border/60 flex justify-between items-center text-sm">
            <span className="text-muted-foreground">{filtered.length} entries</span>
            <div className="flex gap-8 tabular-nums font-mono font-medium text-foreground">
              <span>Dr: {formatMoney(totalDebits)}</span>
              <span>Cr: {formatMoney(totalCredits)}</span>
              <span className={booksBalance ? "text-emerald-500" : "text-rose-500"}>
                {booksBalance ? "âœ“ Balanced" : `âš  Î” ${formatMoney(Math.abs(totalDebits - totalCredits))}`}
              </span>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

// â”€â”€â”€ Tab 5: Chart of Accounts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const CATEGORY_ORDER: AccountEntry["category"][] = ["asset", "liability", "equity", "income", "expense"];
const CATEGORY_LABELS: Record<AccountEntry["category"], string> = {
  asset:     "Assets",
  liability: "Liabilities",
  equity:    "Equity",
  income:    "Income",
  expense:   "Expenses",
};

function ChartOfAccountsTab({ fullCOA, glEntries }: { fullCOA: AccountEntry[]; glEntries: GLEntry[] }) {
  const acctStats = useMemo(() => {
    const debits  = new Map<number, number>();
    const credits = new Map<number, number>();
    const counts  = new Map<number, number>();
    for (const e of glEntries) {
      debits.set(e.debitAccount,   (debits.get(e.debitAccount)   ?? 0) + e.amount);
      credits.set(e.creditAccount, (credits.get(e.creditAccount) ?? 0) + e.amount);
      counts.set(e.debitAccount,   (counts.get(e.debitAccount)   ?? 0) + 1);
      counts.set(e.creditAccount,  (counts.get(e.creditAccount)  ?? 0) + 1);
    }
    return { debits, credits, counts };
  }, [glEntries]);

  const grouped = useMemo(() => {
    const map = new Map<AccountEntry["category"], AccountEntry[]>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    for (const acct of fullCOA) map.get(acct.category)!.push(acct);
    return map;
  }, [fullCOA]);

  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-20">Acct #</TableHead>
            <TableHead>Account Name</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Normal Bal</TableHead>
            <TableHead className="text-right"># Entries</TableHead>
            <TableHead className="text-right">Balance</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {CATEGORY_ORDER.map((cat) => {
            const accounts = grouped.get(cat) ?? [];
            return (
              <Fragment key={cat}>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableCell colSpan={6} className="py-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    {CATEGORY_LABELS[cat]}
                  </TableCell>
                </TableRow>
                {accounts.map((acct) => {
                  const dr  = acctStats.debits.get(acct.code)  ?? 0;
                  const cr  = acctStats.credits.get(acct.code) ?? 0;
                  const cnt = acctStats.counts.get(acct.code)  ?? 0;
                  const bal = acct.normalBalance === "debit" ? dr - cr : cr - dr;
                  return (
                    <TableRow key={acct.code} className={cn(cnt === 0 ? "opacity-40" : "")}>
                      <TableCell className="font-mono text-sm">{acct.code}</TableCell>
                      <TableCell className="text-sm text-foreground">{acct.name}</TableCell>
                      <TableCell className="text-sm capitalize">{acct.category}</TableCell>
                      <TableCell className="text-sm">{acct.normalBalance === "debit" ? "Dr" : "Cr"}</TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{cnt > 0 ? cnt : "—"}</TableCell>
                      <TableCell className={cn(
                        "text-right tabular-nums text-sm font-medium",
                        cnt === 0 ? "text-muted-foreground/40" : bal < 0 ? "text-loss" : "text-foreground",
                      )}>
                        {cnt > 0 ? formatMoney(bal) : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
      <div className="px-4 py-3 border-t border-border/40 text-xs text-muted-foreground italic">
        Account 1000 (Cash) may show a negative balance. This is an accounting artifact: securities received as in-kind contributions were recorded as purchases (cash outflow) without a matching cash deposit. The negative cash exactly offsets the cost basis of those transferred positions — it does not reflect an actual cash shortfall.
      </div>
    </Card>
  );
}

