import Papa from "papaparse";
import * as XLSX from "xlsx";
import type { TxnInput } from "./transactions.functions";
import type { OurField, ColumnMapping, BrokerFormat } from "./broker-formats";
import { detectBroker, resolveAction } from "./broker-formats";

export type RawFileData = {
  headers: string[];
  rows: Record<string, string>[];
  detectedBroker: BrokerFormat | null;
  /** Pre-filled column mapping (from broker or best-effort fuzzy match) */
  suggestedColumnMap: ColumnMapping;
  /** Unique non-empty values found in the detected action column */
  actionValues: string[];
};

// ---------------------------------------------------------------------------
// File readers
// ---------------------------------------------------------------------------

export async function readFileData(file: File): Promise<RawFileData> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "xlsx" || ext === "xls") {
    return readExcel(file);
  }
  return readCsv(file);
}

async function readCsv(file: File): Promise<RawFileData> {
  const text = await file.text();
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  const headers = parsed.meta.fields ?? [];
  const rows = parsed.data;
  return buildFileData(headers, rows);
}

async function readExcel(file: File): Promise<RawFileData> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];

  // Get all rows as arrays so we can find the real header row
  const raw: string[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });

  // Find the header row: first row with ≥3 non-empty cells (skips Schwab junk rows)
  let headerIdx = 0;
  for (let i = 0; i < Math.min(raw.length, 15); i++) {
    const nonEmpty = raw[i].filter((c) => String(c).trim().length > 0).length;
    if (nonEmpty >= 3) { headerIdx = i; break; }
  }

  const headers = raw[headerIdx].map((h) => String(h).trim()).filter(Boolean);
  const rows: Record<string, string>[] = [];

  for (let i = headerIdx + 1; i < raw.length; i++) {
    const obj: Record<string, string> = {};
    let hasValue = false;
    headers.forEach((h, col) => {
      const val = String(raw[i][col] ?? "").trim();
      obj[h] = val;
      if (val) hasValue = true;
    });
    if (hasValue) rows.push(obj);
  }

  return buildFileData(headers, rows);
}

function buildFileData(
  headers: string[],
  rows: Record<string, string>[],
): RawFileData {
  const broker = detectBroker(headers);
  const suggestedColumnMap = broker
    ? { ...broker.columnMap }
    : fuzzyGuessMapping(headers);

  const actionCol = suggestedColumnMap.action;
  const actionValues = actionCol
    ? Array.from(
        new Set(
          rows
            .map((r) => (r[actionCol] ?? "").trim())
            .filter(Boolean),
        ),
      ).sort()
    : [];

  return { headers, rows, detectedBroker: broker, suggestedColumnMap, actionValues };
}

// ---------------------------------------------------------------------------
// Fuzzy column guesser for unknown brokers
// ---------------------------------------------------------------------------

const FIELD_SYNONYMS: Record<OurField, string[]> = {
  trade_date:  ["trade date", "run date", "date", "transaction date", "activity date", "post date", "posting date", "settlement date"],
  account:     ["account", "account name", "portfolio"],
  action:      ["action", "transaction type", "type", "trans code", "activity", "description"],
  symbol:      ["symbol", "ticker", "instrument", "security", "cusip", "asset"],
  description: ["description", "security description", "investment name", "security name", "name"],
  quantity:    ["quantity", "shares", "qty", "units", "share quantity"],
  price:       ["price", "unit price", "share price", "price ($)", "price per share"],
  amount:      ["amount", "net amount", "total", "amount ($)", "transaction amount", "principal amount", "gross amount"],
  fees:        ["fees", "commission", "commission ($)", "fees & comm", "fee"],
};

function fuzzyGuessMapping(headers: string[]): ColumnMapping {
  const lower = headers.map((h) => h.toLowerCase().trim());
  const result: ColumnMapping = {};

  for (const [field, synonyms] of Object.entries(FIELD_SYNONYMS) as [OurField, string[]][]) {
    for (const syn of synonyms) {
      const idx = lower.indexOf(syn);
      if (idx !== -1) {
        result[field] = headers[idx];
        break;
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Parser — applies a confirmed column mapping to raw rows
// ---------------------------------------------------------------------------

export type ActionOverrideMap = Record<string, TxnInput["action"] | "skip">;

export function parseWithMapping(
  rows: Record<string, string>[],
  columnMap: ColumnMapping,
  actionOverrides: ActionOverrideMap,
  brokerActionMap?: Record<string, TxnInput["action"]>,
  defaultAccount?: string | null,
): { rows: TxnInput[]; skipped: number } {
  const out: TxnInput[] = [];
  let skipped = 0;

  for (const raw of rows) {
    const dateStr = get(raw, columnMap.trade_date);
    if (!dateStr) { skipped++; continue; }
    const trade_date = normalizeDate(dateStr);
    if (!trade_date) { skipped++; continue; }

    const rawAction = get(raw, columnMap.action);
    const overrideKey = rawAction.toUpperCase().trim();
    let action: TxnInput["action"] | null = null;

    if (actionOverrides[overrideKey] === "skip") { skipped++; continue; }
    if (actionOverrides[overrideKey]) {
      action = actionOverrides[overrideKey] as TxnInput["action"];
    } else {
      action = resolveAction(rawAction, brokerActionMap);
    }
    if (!action) { skipped++; continue; }

    const amount = num(get(raw, columnMap.amount));
    if (!amount && action !== "SPLIT") { skipped++; continue; }

    const symbol = (get(raw, columnMap.symbol) || "").toUpperCase() || null;
    const description = get(raw, columnMap.description) || null;
    const quantity = Math.abs(num(get(raw, columnMap.quantity)));
    const price = Math.abs(num(get(raw, columnMap.price)));
    const fees = Math.abs(num(get(raw, columnMap.fees)));
    const account = get(raw, columnMap.account) || defaultAccount || null;

    out.push({
      trade_date,
      symbol,
      description,
      action,
      quantity,
      price,
      amount: Math.abs(amount),
      fees,
      account,
      source: "csv",
    });
  }

  return { rows: out, skipped };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function get(row: Record<string, string>, col: string | undefined): string {
  if (!col) return "";
  return (row[col] ?? "").trim();
}

function num(s: string): number {
  if (!s) return 0;
  const cleaned = s.replace(/[,$\s]/g, "").replace(/[()]/g, (m) => (m === "(" ? "-" : ""));
  const n = Number(cleaned);
  return isFinite(n) ? n : 0;
}

function normalizeDate(s: string): string | null {
  if (!s) return null;
  // Excel serial (e.g. 45736)
  if (/^\d{4,6}(\.\d+)?$/.test(s)) {
    const serial = Number(s);
    if (serial > 20000 && serial < 80000) {
      const ms = Math.round((serial - 25569) * 86400 * 1000);
      const d = new Date(ms);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (m) {
    let [, mo, da, yr] = m;
    if (yr.length === 2) yr = (Number(yr) < 50 ? "20" : "19") + yr;
    return `${yr}-${mo.padStart(2, "0")}-${da.padStart(2, "0")}`;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}
