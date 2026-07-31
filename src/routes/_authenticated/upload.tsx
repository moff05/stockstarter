import { createFileRoute, Link } from "@tanstack/react-router";
import { usePortfolio } from "@/hooks/use-portfolio";
import { getHistoricalCloses, getQuotes } from "@/lib/prices.functions";
import { buildPeriodActivity, quarterBounds, isoAddDays } from "@/lib/portfolio";
import { exportStatementPDF } from "@/lib/export-pdf";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { parsePortfolioExcel } from "@/lib/excel-import";
import { parseOFXFile } from "@/lib/ofx-import";
import { bulkInsertTransactions, type TxnInput } from "@/lib/transactions.functions";
import { bulkUpsertMappings } from "@/lib/symbol-mappings.functions";
import { CUSIP_SEED, isCusip } from "@/lib/symbol-resolver";
import { readFileData, parseWithMapping, type RawFileData, type ActionOverrideMap } from "@/lib/generic-import";
import { resolveAction, type OurField, type ColumnMapping } from "@/lib/broker-formats";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, FileText, CheckCircle2, FileSpreadsheet, FileDown, ExternalLink, Loader2, ChevronRight, X, Tag } from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { formatMoney } from "@/lib/portfolio";

export const Route = createFileRoute("/_authenticated/upload")({
  head: () => ({ meta: [{ title: "Upload — StockStarter" }] }),
  component: UploadPage,
});

// ---------------------------------------------------------------------------
// Action badge styling
// ---------------------------------------------------------------------------

function actionBadge(action: string): string {
  switch (action) {
    case "BUY":          return "bg-sky-500/15 text-sky-500 dark:text-sky-400";
    case "SELL":         return "bg-rose-500/15 text-rose-600 dark:text-rose-400";
    case "DIVIDEND":     return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
    case "INTEREST":     return "bg-teal-500/15 text-teal-600 dark:text-teal-400";
    case "CONTRIBUTION": return "bg-violet-500/15 text-violet-600 dark:text-violet-400";
    case "DISTRIBUTION": return "bg-orange-500/15 text-orange-600 dark:text-orange-400";
    case "FEE":          return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
    default:             return "bg-muted text-muted-foreground";
  }
}

// ---------------------------------------------------------------------------
// PDF export button (unchanged)
// ---------------------------------------------------------------------------

function ExportFromUploadButton({ quarter, year }: { quarter: 1|2|3|4; year: number }) {
  const today = new Date().toISOString().slice(0, 10);
  const { start, end } = quarterBounds(year, quarter);
  const effectiveEnd = end > today ? today : end;
  const startBefore = isoAddDays(start, -1);
  const [exporting, setExporting] = useState(false);

  const { txns } = usePortfolio();

  const symbols = Array.from(new Set(
    txns.filter((t) => t.symbol && t.trade_date <= effectiveEnd).map((t) => t.symbol!.toUpperCase())
  ));

  const startPricesQ = useQuery({
    queryKey: ["histprices", startBefore, symbols],
    enabled: symbols.length > 0,
    queryFn: () => getHistoricalCloses({ data: { symbols, asOfDate: startBefore } }),
    staleTime: 5 * 60_000,
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
    staleTime: 60_000,
  });

  const pricesLoading = startPricesQ.isLoading || endPricesQ.isLoading;

  async function handleExport() {
    if (pricesLoading || !startPricesQ.data || !endPricesQ.data) return;
    setExporting(true);
    try {
      const period = buildPeriodActivity(txns, start, effectiveEnd, startPricesQ.data, endPricesQ.data);
      const lines = [
        { label: "Beginning Capital", value: period.beginningCapital, bold: true },
        { label: "Contributions", value: period.contributions, indent: true },
        { label: "Distributions", value: -period.distributions, indent: true },
        { label: "Interest Income", value: period.interestIncome, indent: true },
        { label: "Dividend Income", value: period.dividendIncome, indent: true },
        { label: "Realized Gain / (Loss)", value: period.realizedGain, indent: true },
        { label: "Unrealized Gain / (Loss)", value: period.unrealizedGain, indent: true },
        { label: "Fees", value: -period.fees, indent: true },
        { label: "Net Income (Loss)", value: period.netIncome, bold: true, separator: true },
        { label: "Ending Capital", value: period.endingCapital, bold: true, separator: true },
      ];
      await exportStatementPDF({ quarter, year, periodStart: start, periodEnd: effectiveEnd, isPartial: effectiveEnd !== end, lines });
    } finally {
      setExporting(false);
    }
  }

  return (
    <Button size="sm" onClick={handleExport} disabled={pricesLoading || exporting}>
      {exporting || pricesLoading
        ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
        : <FileDown className="w-3.5 h-3.5 mr-1.5" />}
      {pricesLoading ? "Loading prices…" : "Download PDF"}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Column mapping step
// ---------------------------------------------------------------------------

const ALL_ACTIONS: Array<TxnInput["action"] | "skip"> = [
  "BUY", "SELL", "DIVIDEND", "INTEREST", "CONTRIBUTION", "DISTRIBUTION", "FEE", "SPLIT", "skip",
];

const FIELD_LABELS: Record<OurField, { label: string; required?: boolean }> = {
  trade_date:  { label: "Date",        required: true },
  action:      { label: "Action/Type", required: true },
  amount:      { label: "Amount",      required: true },
  symbol:      { label: "Symbol" },
  quantity:    { label: "Quantity" },
  price:       { label: "Price" },
  description: { label: "Description" },
  fees:        { label: "Fees" },
  account:     { label: "Account" },
};

const FIELD_ORDER: OurField[] = ["trade_date", "action", "amount", "symbol", "quantity", "price", "description", "fees", "account"];

interface MappingStepProps {
  fileData: RawFileData;
  filename: string;
  columnMap: ColumnMapping;
  actionOverrides: ActionOverrideMap;
  onColumnChange: (field: OurField, header: string | null) => void;
  onActionChange: (rawValue: string, mapped: TxnInput["action"] | "skip") => void;
  onConfirm: () => void;
  onReset: () => void;
}

function MappingStep({
  fileData,
  filename,
  columnMap,
  actionOverrides,
  onColumnChange,
  onActionChange,
  onConfirm,
  onReset,
}: MappingStepProps) {
  const { headers, rows, detectedBroker, actionValues } = fileData;
  const headerOptions = ["(skip)", ...headers];

  // Live preview: apply current mapping to first 5 rows
  const preview = useMemo(() => {
    if (!columnMap.trade_date || !columnMap.amount) return [];
    const { rows: parsed } = parseWithMapping(
      rows.slice(0, 20),
      columnMap,
      actionOverrides,
      detectedBroker?.actionMap,
    );
    return parsed.slice(0, 5);
  }, [rows, columnMap, actionOverrides, detectedBroker]);

  const canConfirm = !!columnMap.trade_date && !!columnMap.amount;

  return (
    <div className="space-y-5">
      {/* File + broker banner */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm text-foreground font-medium">
          <FileText className="w-4 h-4 text-muted-foreground" />
          {filename}
        </div>
        {detectedBroker ? (
          <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-gain/15 text-gain">
            Detected: {detectedBroker.name} âœ“
          </span>
        ) : (
          <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-amber-500/15 text-amber-600 dark:text-amber-400">
            Unknown format — map columns below
          </span>
        )}
        <button onClick={onReset} className="ml-auto text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
          <X className="w-3.5 h-3.5" /> Change file
        </button>
      </div>

      {/* Column assignment */}
      <Card className="p-4">
        <div className="font-medium text-sm text-foreground mb-3">Column assignment</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2">
          {FIELD_ORDER.map((field) => {
            const { label, required } = FIELD_LABELS[field];
            const current = columnMap[field] ?? "";
            return (
              <div key={field} className="flex items-center gap-3 min-w-0">
                <span className="text-xs w-24 shrink-0 text-right text-muted-foreground">
                  {label}{required && <span className="text-rose-500 ml-0.5">*</span>}
                </span>
                <Select
                  value={current || "(skip)"}
                  onValueChange={(v) => onColumnChange(field, v === "(skip)" ? null : v)}
                >
                  <SelectTrigger className="h-7 text-xs flex-1 min-w-0">
                    <SelectValue placeholder="(skip)" />
                  </SelectTrigger>
                  <SelectContent>
                    {headerOptions.map((h) => (
                      <SelectItem key={h} value={h} className="text-xs">
                        {h}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground mt-3">* Required fields</p>
      </Card>

      {/* Action mapping — only show when an action column is selected */}
      {columnMap.action && actionValues.length > 0 && (
        <Card className="p-4">
          <div className="font-medium text-sm text-foreground mb-1">Action mapping</div>
          <p className="text-xs text-muted-foreground mb-3">
            Map each value in <span className="font-mono">{columnMap.action}</span> to a transaction type. "skip" excludes those rows.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2">
            {actionValues.map((val) => (
              <div key={val} className="flex items-center gap-3 min-w-0">
                <span className="text-xs font-mono truncate w-36 shrink-0 text-right text-foreground" title={val}>
                  {val}
                </span>
                <Select
                  value={actionOverrides[val.toUpperCase()] ?? "skip"}
                  onValueChange={(v) => onActionChange(val, v as TxnInput["action"] | "skip")}
                >
                  <SelectTrigger className="h-7 text-xs flex-1 min-w-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ALL_ACTIONS.map((a) => (
                      <SelectItem key={a} value={a} className="text-xs">
                        {a === "skip" ? "— skip" : a}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Live preview */}
      {preview.length > 0 && (
        <Card className="overflow-hidden">
          <div className="px-4 pt-3 pb-1 text-xs font-medium text-muted-foreground">
            Preview (first {preview.length} parsed rows)
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Date</TableHead>
                <TableHead className="text-xs">Action</TableHead>
                <TableHead className="text-xs">Symbol</TableHead>
                <TableHead className="text-xs">Description</TableHead>
                <TableHead className="text-right text-xs">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="text-xs tabular-nums">{r.trade_date}</TableCell>
                  <TableCell>
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${actionBadge(r.action)}`}>{r.action}</span>
                  </TableCell>
                  <TableCell className="text-xs font-medium text-foreground">{r.symbol ?? "—"}</TableCell>
                  <TableCell className="text-xs max-w-[180px] truncate">{r.description ?? ""}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{formatMoney(r.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={onConfirm} disabled={!canConfirm} className="gap-1.5">
          Parse all rows
          <ChevronRight className="w-4 h-4" />
        </Button>
        {!canConfirm && (
          <span className="text-xs text-muted-foreground">Date and Amount columns are required</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main upload page
// ---------------------------------------------------------------------------

type Stage = "idle" | "mapping" | "preview";

function buildInitialActionOverrides(
  fileData: RawFileData,
): ActionOverrideMap {
  const overrides: ActionOverrideMap = {};
  for (const val of fileData.actionValues) {
    const resolved = resolveAction(val, fileData.detectedBroker?.actionMap ?? undefined);
    overrides[val.toUpperCase()] = resolved ?? "skip";
  }
  return overrides;
}

function UploadPage() {
  const qc = useQueryClient();

  // --- mapping flow state ---
  const [stage, setStage] = useState<Stage>("idle");
  const [reading, setReading] = useState(false);
  const [filename, setFilename] = useState("");
  const [rawFileData, setRawFileData] = useState<RawFileData | null>(null);
  const [columnMap, setColumnMap] = useState<ColumnMapping>({});
  const [actionOverrides, setActionOverrides] = useState<ActionOverrideMap>({});
  const [accountName, setAccountName] = useState("");

  // --- preview/import state ---
  const [rows, setRows] = useState<TxnInput[]>([]);
  const [skippedCount, setSkippedCount] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [lastImport, setLastImport] = useState<{ quarter: number; year: number } | null>(null);

  const submit = useMutation({
    mutationFn: async () => {
      const result = await bulkInsertTransactions({ data: { rows } });

      const cusipDescriptions = new Map<string, string>();
      for (const r of rows) {
        if (r.symbol && isCusip(r.symbol)) {
          const c = r.symbol.toUpperCase();
          if (!cusipDescriptions.has(c)) {
            cusipDescriptions.set(c, (r.description ?? "").split(/\d/)[0].trim().slice(0, 80));
          }
        }
      }
      if (cusipDescriptions.size > 0) {
        const mappingRows = Array.from(cusipDescriptions.entries()).map(([cusip, desc]) => {
          const seed = CUSIP_SEED.find((s) => s.cusip === cusip);
          return {
            cusip,
            ticker: seed?.ticker ?? null,
            name: seed?.name ?? desc ?? null,
            asset_class: seed?.asset_class ?? null,
          };
        });
        try {
          await bulkUpsertMappings({ data: { rows: mappingRows } });
        } catch { /* non-fatal */ }
      }
      return result;
    },
    onSuccess: (r: any) => {
      setImportError(null);
      toast.success(`Imported ${r.inserted} transactions`);
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["symbol_mappings"] });
      qc.invalidateQueries({ queryKey: ["prices"] });
      qc.invalidateQueries({ queryKey: ["inception-date"] });
      qc.invalidateQueries({ queryKey: ["nav-history"] });
      const dates = rows.map((r) => r.trade_date).filter(Boolean).sort();
      if (dates.length > 0) {
        const latest = new Date(dates[dates.length - 1] + "T00:00:00Z");
        setLastImport({ quarter: Math.floor(latest.getUTCMonth() / 3) + 1, year: latest.getUTCFullYear() });
      }
      resetAll();
    },
    onError: (e: any) => {
      const msg = e?.message ?? e?.data?.message ?? JSON.stringify(e) ?? "Unknown error";
      console.error("[import error]", e);
      setImportError(msg);
      toast.error("Import failed: " + msg);
    },
  });

  function resetAll() {
    setStage("idle");
    setReading(false);
    setFilename("");
    setImportError(null);
    setRawFileData(null);
    setColumnMap({});
    setActionOverrides({});
    setAccountName("");
    setRows([]);
    setSkippedCount(0);
    setErrors([]);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    const fname = file.name;
    const ext = fname.split(".").pop()?.toLowerCase();
    setFilename(fname);
    setReading(true);

    // Fifth Third-specific Excel: try it first; skip mapping step if it works
    if (ext === "xlsx" || ext === "xls") {
      try {
        const buffer = await file.arrayBuffer();
        const parsed = parsePortfolioExcel(buffer, accountName.trim() || undefined);
        if (parsed.rows.length > 0) {
          setRows(parsed.rows);
          setErrors(parsed.errors);
          setSkippedCount(0);
          setStage("preview");
          setReading(false);
          toast.success(`Parsed ${parsed.rows.length} transactions — review and import.`);
          return;
        }
      } catch { /* fall through to generic */ }
    }

    // OFX (v1 SGML or v2 XML) — supported by Fidelity, Schwab, Vanguard, IBKR, etc.
    if (ext === "ofx" || ext === "qfx") {
      try {
        const text = await file.text();
        const parsed = parseOFXFile(text, accountName.trim() || undefined);
        if (parsed.rows.length > 0) {
          setRows(parsed.rows);
          setErrors(parsed.errors);
          setSkippedCount(0);
          setStage("preview");
          setReading(false);
          toast.success(`Parsed ${parsed.rows.length} transactions from OFX — review and import.`);
          return;
        }
        toast.error("No transactions found in this OFX file.");
        setReading(false);
        return;
      } catch (err: any) {
        toast.error("Failed to parse OFX: " + (err?.message ?? "unknown error"));
        setReading(false);
        return;
      }
    }

    // Generic path: read headers + raw rows, show mapping step
    try {
      const fileData = await readFileData(file);
      if (fileData.headers.length === 0) {
        toast.error("Could not read column headers from this file.");
        setReading(false);
        return;
      }
      setRawFileData(fileData);
      setColumnMap({ ...fileData.suggestedColumnMap });
      setActionOverrides(buildInitialActionOverrides(fileData));
      setStage("mapping");
    } catch (err: any) {
      toast.error("Failed to read file: " + (err?.message ?? "unknown error"));
    } finally {
      setReading(false);
    }
  }

  function onColumnChange(field: OurField, header: string | null) {
    setColumnMap((prev) => {
      const next = { ...prev };
      if (header) next[field] = header;
      else delete next[field];
      return next;
    });

    // If the action column changed, rebuild action overrides for the new column
    if (field === "action" && rawFileData) {
      const newValues = header
        ? Array.from(new Set(rawFileData.rows.map((r) => (r[header] ?? "").trim()).filter(Boolean))).sort()
        : [];
      const overrides: ActionOverrideMap = {};
      for (const val of newValues) {
        const resolved = resolveAction(val, rawFileData.detectedBroker?.actionMap);
        overrides[val.toUpperCase()] = resolved ?? "skip";
      }
      setActionOverrides(overrides);
    }
  }

  function onActionChange(rawValue: string, mapped: TxnInput["action"] | "skip") {
    setActionOverrides((prev) => ({ ...prev, [rawValue.toUpperCase()]: mapped }));
  }

  function onConfirmMapping() {
    if (!rawFileData) return;
    const { rows: parsed, skipped } = parseWithMapping(
      rawFileData.rows,
      columnMap,
      actionOverrides,
      rawFileData.detectedBroker?.actionMap,
      accountName.trim() || null,
    );
    if (parsed.length === 0) {
      toast.error(`No transactions could be parsed. ${skipped} rows were skipped — check your column and action mappings.`);
      return;
    }
    setRows(parsed);
    setSkippedCount(skipped);
    setErrors([]);
    setStage("preview");
    toast.success(`Parsed ${parsed.length} transactions${skipped > 0 ? ` (${skipped} skipped)` : ""} — review and import.`);
  }

  const actionCounts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.action] = (acc[r.action] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-6xl mx-auto text-muted-foreground">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Upload Transactions</h1>
        <p className="text-sm">
          Upload a broker statement or CSV export (.xlsx or .csv) to import transactions.
        </p>
      </div>

      {/* File picker — only shown in idle stage */}
      {stage === "idle" && (
        <Card className="p-6 border-dashed border-2">
          <div className="flex items-center gap-2.5 mb-5 max-w-xs">
            <Tag className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <Input
              placeholder="Account name (optional, e.g. Fifth Third)"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <label className="flex flex-col items-center justify-center gap-3 cursor-pointer">
            <div className="p-4 rounded-full bg-primary/10">
              {reading
                ? <Loader2 className="w-7 h-7 text-primary animate-spin" />
                : <Upload className="w-7 h-7 text-primary" />}
            </div>
            <div className="text-center">
              <div className="font-medium text-foreground">
                {reading ? "Reading file…" : "Choose a file"}
              </div>
              {!reading && (
                <div className="text-xs mt-1">.xlsx or .csv — Fidelity, Schwab, Vanguard, Robinhood, E*TRADE and more</div>
              )}
            </div>
            <input
              type="file"
              accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={onFile}
              disabled={reading}
            />
            <Button type="button" asChild disabled={reading}>
              <span>{reading ? "Reading…" : "Select file"}</span>
            </Button>
          </label>
        </Card>
      )}

      {/* Mapping step */}
      {stage === "mapping" && rawFileData && (
        <MappingStep
          fileData={rawFileData}
          filename={filename}
          columnMap={columnMap}
          actionOverrides={actionOverrides}
          onColumnChange={onColumnChange}
          onActionChange={onActionChange}
          onConfirm={onConfirmMapping}
          onReset={resetAll}
        />
      )}

      {/* Parse errors */}
      {stage === "preview" && errors.length > 0 && (
        <Card className="p-4 border-amber-400/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-sm">
          <div className="font-medium mb-1">Parsing notes ({errors.length})</div>
          <ul className="list-disc pl-5 max-h-40 overflow-auto">
            {errors.slice(0, 20).map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </Card>
      )}

      {/* Success card after import */}
      {lastImport && (
        <Card className="p-5 flex items-center justify-between gap-4 border-gain/30 bg-gain/5">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-full bg-gain/10">
              <CheckCircle2 className="w-5 h-5 text-gain" />
            </div>
            <div>
              <div className="font-semibold text-foreground text-sm">Import complete</div>
              <div className="text-xs mt-0.5">
                Q{lastImport.quarter} {lastImport.year} statement is now in the database.
              </div>
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button variant="outline" size="sm" asChild>
              <Link to="/statement">
                <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                View Statement
              </Link>
            </Button>
            <ExportFromUploadButton quarter={lastImport.quarter as 1|2|3|4} year={lastImport.year} />
          </div>
        </Card>
      )}

      {/* Import error */}
      {importError && (
        <Card className="p-4 border-rose-400/40 bg-rose-500/10 text-rose-600 dark:text-rose-400 text-sm">
          <div className="font-medium mb-1">Import failed</div>
          <div className="font-mono text-xs break-all">{importError}</div>
        </Card>
      )}

      {/* Preview table */}
      {stage === "preview" && rows.length > 0 && (
        <>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              {filename && (
                <div className="flex items-center gap-1.5 text-sm text-foreground">
                  <FileSpreadsheet className="w-4 h-4 text-muted-foreground" />
                  {filename}
                </div>
              )}
              <span className="text-sm">—&nbsp;{rows.length} transactions</span>
              {Object.entries(actionCounts).map(([k, v]) => (
                <span key={k} className={`text-xs px-1.5 py-0.5 rounded font-medium ${actionBadge(k)}`}>{v} {k}</span>
              ))}
              {skippedCount > 0 && (
                <span className="text-xs text-muted-foreground">{skippedCount} skipped</span>
              )}
            </div>
            <div className="flex gap-2 shrink-0">
              <Button variant="outline" size="sm" onClick={() => rawFileData ? setStage("mapping") : resetAll()}>
                ← Back
              </Button>
              <Button onClick={() => submit.mutate()} disabled={submit.isPending}>
                {submit.isPending
                  ? <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  : <CheckCircle2 className="w-4 h-4 mr-1" />}
                {submit.isPending ? "Importing…" : `Import ${rows.length} transactions`}
              </Button>
            </div>
          </div>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.slice(0, 200).map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="tabular-nums">{r.trade_date}</TableCell>
                    <TableCell>
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${actionBadge(r.action)}`}>
                        {r.action}
                      </span>
                    </TableCell>
                    <TableCell className="font-medium text-foreground">{r.symbol ?? "—"}</TableCell>
                    <TableCell className="max-w-[220px] truncate text-xs">{r.description ?? ""}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.quantity || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.price ? formatMoney(r.price) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(r.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {rows.length > 200 && (
              <div className="p-3 text-xs text-center">
                Showing first 200 of {rows.length} rows.
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

