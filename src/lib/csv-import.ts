import Papa from "papaparse";
import type { TxnInput } from "./transactions.functions";

/** Best-effort mapper for Fifth Third Securities and generic broker CSV exports. */
export function parseBrokerCsv(text: string): { rows: TxnInput[]; errors: string[] } {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    // Strip broker annotations like "Price ($)" → "Price", "Quantity (#)" → "Quantity"
    transformHeader: (h) => h.trim().replace(/\s*\([#$%]\)$/, ""),
  });
  // FieldMismatch errors are expected for broker footer/disclaimer rows — they're already
  // skipped in the loop below (no valid date), so don't surface them to the user.
  const errors: string[] = parsed.errors
    .filter((e) => e.type !== "FieldMismatch")
    .map((e) => `Row ${e.row}: ${e.message}`);
  const rows: TxnInput[] = [];

  for (const raw of parsed.data) {
    if (!raw) continue;
    const lower: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) lower[k.toLowerCase()] = (v ?? "").trim();

    const dateStr =
      lower["trade date"] ||
      lower["run date"] ||
      lower["date"] ||
      lower["post date"] ||
      lower["posting date"] ||
      lower["settlement date"] ||
      lower["activity date"] ||
      lower["transaction date"];
    if (!dateStr) continue;
    const trade_date = normalizeDate(dateStr);
    if (!trade_date) continue;

    const rawAction = (
      lower["action"] ||
      lower["activity"] ||
      lower["transaction type description"] ||
      lower["transaction type"] ||
      lower["type"] ||
      lower["description"] ||
      ""
    ).toUpperCase();

    const action = mapAction(rawAction, lower["description"] ?? "");
    if (!action) continue;

    const symbol =
      (
        lower["symbol"] ||
        lower["ticker"] ||
        lower["security"] ||
        lower["asset number"] ||
        lower["cusip"] ||
        ""
      ).toUpperCase() || null;
    const description = lower["description"] || lower["security description"] || null;
    const quantity = num(
      lower["quantity"] || lower["shares"] || lower["qty"] || lower["units"],
    );
    const price = num(lower["price"] || lower["unit price"] || lower["share price"]);
    // Prefer signed cash columns when present (Fifth Third "Principal Cash" / "Income Cash")
    const principalCash = num(lower["principal cash"]);
    const incomeCash = num(lower["income cash"]);
    const costBasis = num(lower["cost basis"]);
    let amount = num(
      lower["amount"] || lower["net amount"] || lower["total"] || lower["transaction amount"],
    );
    if (!amount) {
      if (action === "DIVIDEND" || action === "INTEREST") {
        amount = incomeCash || principalCash || costBasis;
      } else if (action === "BUY") {
        // Cost basis is the cleanest positive figure for a purchase
        amount = costBasis || Math.abs(principalCash) || Math.abs(incomeCash);
      } else if (action === "SELL") {
        amount = Math.abs(principalCash) || Math.abs(incomeCash) || costBasis;
      } else {
        amount = principalCash || incomeCash || costBasis;
      }
    }
    // Normalize sign by action so downstream math + display stay positive.
    if (action === "BUY" || action === "SELL" || action === "DIVIDEND" || action === "INTEREST" || action === "CONTRIBUTION" || action === "DISTRIBUTION" || action === "FEE") {
      amount = Math.abs(amount);
    }
    const fees = num(lower["commission"] || lower["fees"] || lower["fee"]);

    rows.push({
      trade_date,
      symbol,
      description,
      action,
      quantity: Math.abs(quantity),
      price: Math.abs(price),
      amount,
      fees: Math.abs(fees),
      source: "csv",
    });
  }
  return { rows, errors };
}

function num(s: string | undefined): number {
  if (!s) return 0;
  const cleaned = s.replace(/[,$\s]/g, "").replace(/[()]/g, (m) => (m === "(" ? "-" : ""));
  const n = Number(cleaned);
  return isFinite(n) ? n : 0;
}

function normalizeDate(s: string): string | null {
  // Excel serial date (e.g. 45736 → 2025-03-20). Excel epoch is 1899-12-30.
  if (/^\d{4,6}(\.\d+)?$/.test(s)) {
    const serial = Number(s);
    if (serial > 20000 && serial < 80000) {
      const ms = Math.round((serial - 25569) * 86400 * 1000);
      const d = new Date(ms);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
  }
  // accept YYYY-MM-DD, MM/DD/YYYY, M/D/YY
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

function mapAction(
  raw: string,
  desc: string,
): TxnInput["action"] | null {
  const x = (raw + " " + desc).toUpperCase();
  if (/\bBUY\b|BOUGHT|PURCHASE|PURCHASES/.test(x)) return "BUY";
  if (/\bSELL\b|SOLD|\bSALE\b|\bSALES\b|REDEMPTION|REDEEM/.test(x)) return "SELL";
  if (/DIV(IDEND)?/.test(x)) return "DIVIDEND";
  if (/INTEREST/.test(x)) return "INTEREST";
  if (/CONTRIB|DEPOSIT|FUNDS RECEIVED|TRANSFER RECEIVED|FUNDS TRANSFER|ACH IN|WIRE IN|CASH RECEIPT|RECEIPT OF/.test(x))
    return "CONTRIBUTION";
  if (/DISTRIB|WITHDRAW|ACH OUT|WIRE OUT|CASH DISBURSE|DISBURSEMENT/.test(x))
    return "DISTRIBUTION";
  if (/FEE|COMMISSION/.test(x)) return "FEE";
  if (/SPLIT/.test(x)) return "SPLIT";
  return null;
}