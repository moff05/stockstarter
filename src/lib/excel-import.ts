import * as XLSX from "xlsx";
import type { TxnInput } from "./transactions.functions";

// CUSIPs that represent cash/placeholder — not real securities
const DUMMY_CUSIPS = new Set(["000000000", "999999999", "99FEDGOP6", ""]);

// Real tickers are 1-5 uppercase letters, optionally dot + 1 letter (e.g. BRK.B)
function isRealTicker(t: string): boolean {
  return /^[A-Z]{1,5}(\.[A-Z])?$/.test((t ?? "").trim());
}

function mapAction(txnType: string): TxnInput["action"] | "SKIP" | null {
  switch (txnType.trim().toUpperCase()) {
    case "SECURITY PURCHASES:":           return "BUY";
    case "SECURITY SALES:":               return "SELL";
    case "DIVIDENDS:":                    return "DIVIDEND";
    case "OTHER INTEREST:":
    case "U.S. GOVERNMENT INTEREST:":     return "INTEREST";
    case "ADDITIONAL FUNDS CONTRIBUTED:":
    case "OTHER FUNDS RECEIVED:":         return "CONTRIBUTION";
    case "TRUSTEE/AGENT COMPENSATION:":   return "FEE";
    // Internal cash moves and tax-lot adjustments — not real economic events
    case "CASH TRANSFERS:":
    case "ASSET RECEIPTS:":               return "SKIP";
    default:                              return null;
  }
}

function cellDate(val: any): string | null {
  if (val instanceof Date) {
    return isNaN(val.getTime()) ? null : val.toISOString().slice(0, 10);
  }
  if (typeof val === "number" && val > 20000) {
    // Excel serial date
    const d = XLSX.SSF.parse_date_code(val);
    if (!d) return null;
    return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  if (typeof val === "string") {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  return null;
}

function n(val: any): number {
  const v = Number(val ?? 0);
  return isFinite(v) ? v : 0;
}

function extractCommission(desc: string | null): number {
  const m = (desc ?? "").match(/COMM\s+([\d,.]+)/i);
  return m ? Number(m[1].replace(/,/g, "")) : 0;
}

function resolveSymbol(ticker: string, cusip: string, allowCusipFallback: boolean): string | null {
  const t = (ticker ?? "").trim().toUpperCase();
  const c = (cusip ?? "").trim().toUpperCase();
  if (isRealTicker(t)) return t;
  // Only fall back to CUSIP for equity transactions (BUY). Income/fee rows don't
  // represent positions and don't need a symbol for pricing purposes.
  if (allowCusipFallback && c && !DUMMY_CUSIPS.has(c)) return c;
  return null;
}

/**
 * Parse the Fifth Third Securities Excel template.
 *
 * Reads two sheets:
 *  - "Transaction History"  → BUY, DIVIDEND, INTEREST, CONTRIBUTION, FEE
 *  - "Realized Sales"       → SELL only (purchases/dividends there duplicate TH)
 */
export function parsePortfolioExcel(buffer: ArrayBuffer, accountName?: string): { rows: TxnInput[]; errors: string[] } {
  const rows: TxnInput[] = [];
  const errors: string[] = [];

  // Reading the workbook can throw on a corrupt/non-Excel file (a renamed PDF, a
  // truncated upload, a lock file). Keep the parser total: turn that into an
  // error result so the sync classifies it as "unsupported" instead of crashing.
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(new Uint8Array(buffer), { type: "array", cellDates: true });
  } catch (e) {
    return { rows, errors: [`Not a readable Excel workbook: ${e instanceof Error ? e.message : String(e)}`] };
  }

  // ── Transaction History ─────────────────────────────────────────────────────
  // Col indices (0-based):
  //  4=Ticker  6=PostDate  7=TxnTypeDesc  8=CUSIP  9=Description
  //  10=Units  11=Price  12=CostBasis  13=IncomeCash  14=PrincipalCash
  const thSheet = wb.Sheets["Transaction History"];
  if (!thSheet) {
    errors.push("Sheet 'Transaction History' not found");
  } else {
    const data = XLSX.utils.sheet_to_json<any[]>(thSheet, {
      header: 1,
      defval: null,
      // @ts-expect-error: xlsx 0.18.5 types omit cellDates but it exists at runtime
      cellDates: true,
    });

    for (let i = 1; i < data.length; i++) {
      const r = data[i] as any[];
      if (!r?.length) continue;

      const txnType = String(r[7] ?? "").trim();
      const action = mapAction(txnType);
      if (!action || action === "SKIP") continue;

      const trade_date = cellDate(r[6]);
      if (!trade_date) { errors.push(`TH row ${i + 1}: no date — skipped`); continue; }

      const symbol = resolveSymbol(String(r[4] ?? ""), String(r[8] ?? ""), action === "BUY");
      const description = String(r[9] ?? "").trim() || null;
      const units = Math.abs(n(r[10]));
      const price = Math.abs(n(r[11]));
      const costBasis   = n(r[12]);
      const incomeCash  = n(r[13]);
      const principalCash = n(r[14]);

      let amount = 0;
      switch (action) {
        case "BUY":
          amount = Math.abs(costBasis) || Math.abs(principalCash);
          break;
        case "DIVIDEND":
        case "INTEREST":
          amount = Math.abs(incomeCash) || Math.abs(principalCash);
          break;
        case "CONTRIBUTION":
          amount = Math.abs(principalCash) || Math.abs(incomeCash) || Math.abs(costBasis);
          break;
        case "FEE":
          amount = Math.abs(principalCash) || Math.abs(incomeCash);
          break;
      }

      if (!amount) {
        errors.push(`TH row ${i + 1}: ${action} ${symbol ?? "cash"} zero amount — skipped`);
        continue;
      }

      rows.push({ trade_date, symbol, description, action, quantity: units, price, amount, fees: 0, account: accountName ?? null, source: "excel" });
    }
  }

  // ── Realized Sales ──────────────────────────────────────────────────────────
  // Only import SECURITY SALES: rows. Purchases/dividends here are already in TH.
  // Col indices (0-based):
  //  1=PostDate  2=TxnType  3=CUSIP  4=Description
  //  5=Units  6=Price  7=CostBasis  8=IncomeCash  9=PrincipalCash
  // "Realized Sales" is the standard Fifth Third sheet name; some exports use "Transaction History (2)"
  const rsSheet = wb.Sheets["Realized Sales"] ?? wb.Sheets["Transaction History (2)"];
  if (rsSheet) {
    const data = XLSX.utils.sheet_to_json<any[]>(rsSheet, {
      header: 1,
      defval: null,
      // @ts-expect-error: xlsx 0.18.5 types omit cellDates but it exists at runtime
      cellDates: true,
    });

    for (let i = 1; i < data.length; i++) {
      const r = data[i] as any[];
      if (!r?.length) continue;

      if (String(r[2] ?? "").trim().toUpperCase() !== "SECURITY SALES:") continue;

      const trade_date = cellDate(r[1]);
      if (!trade_date) continue;

      const cusip = String(r[3] ?? "").trim().toUpperCase();
      const description = String(r[4] ?? "").trim() || null;
      const units  = Math.abs(n(r[5]));  // stored as negative in file
      const price  = Math.abs(n(r[6]));
      const amount = Math.abs(n(r[9]));  // PrincipalCash is positive for sales
      const fees   = extractCommission(description);
      const symbol = DUMMY_CUSIPS.has(cusip) ? null : cusip || null;

      if (!amount) continue;

      rows.push({ trade_date, symbol, description, action: "SELL", quantity: units, price, amount, fees, account: accountName ?? null, source: "excel" });
    }
  }

  rows.sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  return { rows, errors };
}
