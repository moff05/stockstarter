import type { TxnInput } from "./transactions.functions";

/**
 * Parse an OFX file (v1.x SGML or v2.x XML) into TxnInput rows.
 * Handles investment transactions (INVBUY, INVSELL, REINVEST, INCOME) and
 * bank/transfer transactions (DEP, XFER, INT, DIV).
 */
export function parseOFXFile(
  content: string,
  accountName?: string,
): { rows: TxnInput[]; errors: string[] } {
  const errors: string[] = [];
  const rows: TxnInput[] = [];

  // OFX v1.x has an ASCII header block and SGML body (no closing tags).
  // OFX v2.x is proper XML. Detect by presence of "OFXHEADER:" at the top.
  const isV1 = /^OFXHEADER:/im.test(content.slice(0, 200));
  const body = isV1 ? stripOfxV1Header(content) : content;

  // Extract all investment transactions (buys, sells, income, reinvest)
  const invTxns = extractBlocks(body, "INVTRANLIST", isV1);
  for (const block of invTxns) {
    const subBlocks = [
      ...extractBlocks(block, "BUYMF", isV1).map((b) => ({ b, rawType: "BUY" as const })),
      ...extractBlocks(block, "BUYSTOCK", isV1).map((b) => ({ b, rawType: "BUY" as const })),
      ...extractBlocks(block, "SELLMF", isV1).map((b) => ({ b, rawType: "SELL" as const })),
      ...extractBlocks(block, "SELLSTOCK", isV1).map((b) => ({ b, rawType: "SELL" as const })),
      ...extractBlocks(block, "REINVEST", isV1).map((b) => ({ b, rawType: "BUY" as const })),
      ...extractBlocks(block, "INCOME", isV1).map((b) => ({ b, rawType: "INCOME" as const })),
      ...extractBlocks(block, "TRANSFER", isV1).map((b) => ({ b, rawType: "TRANSFER" as const })),
    ];

    for (const { b, rawType } of subBlocks) {
      const invTxn = getBlock(b, "INVTRAN", isV1) ?? b;
      const secId = getBlock(b, "SECID", isV1) ?? "";
      const uniqueIdType = getTag(secId, "UNIQUEIDTYPE", isV1)?.toUpperCase() ?? "";
      const uniqueId = getTag(secId, "UNIQUEID", isV1) ?? "";

      const dateRaw = getTag(invTxn, "DTTRADE", isV1) ?? getTag(invTxn, "DTPOSTED", isV1);
      const trade_date = parseOfxDate(dateRaw);
      if (!trade_date) {
        errors.push(`Skipped investment transaction: invalid date "${dateRaw}"`);
        continue;
      }

      const symbol = resolveSymbol(uniqueId, uniqueIdType);
      const memo = getTag(invTxn, "MEMO", isV1) ?? getTag(b, "MEMO", isV1) ?? null;
      const units = parseFloat(getTag(b, "UNITS", isV1) ?? "0") || 0;
      const unitPrice = parseFloat(getTag(b, "UNITPRICE", isV1) ?? "0") || 0;
      const total = Math.abs(parseFloat(getTag(b, "TOTAL", isV1) ?? "0") || 0);
      const commission = parseFloat(getTag(b, "COMMISSION", isV1) ?? "0") || 0;
      const fees = parseFloat(getTag(b, "FEES", isV1) ?? "0") || 0;
      const incometype = getTag(b, "INCOMETYPE", isV1)?.toUpperCase() ?? "";

      let action: TxnInput["action"];
      if (rawType === "BUY") action = "BUY";
      else if (rawType === "SELL") action = "SELL";
      else if (rawType === "INCOME") {
        action = incometype === "INTINC" ? "INTEREST" : "DIVIDEND";
      } else {
        action = "CONTRIBUTION";
      }

      rows.push({
        trade_date,
        symbol: symbol || null,
        description: memo,
        action,
        quantity: Math.abs(units),
        price: unitPrice,
        amount: total,
        fees: Math.abs(commission + fees),
        account: accountName ?? null,
        notes: null,
        source: "ofx",
      });
    }
  }

  // Extract bank/statement transactions (DEP, XFER, INT, DIV, DEBIT, CREDIT, etc.)
  const bankTxns = extractBlocks(body, "BANKTRANLIST", isV1);
  for (const block of bankTxns) {
    const stmtTxns = extractBlocks(block, "STMTTRN", isV1);
    for (const txn of stmtTxns) {
      const dateRaw = getTag(txn, "DTTRADE", isV1) ?? getTag(txn, "DTPOSTED", isV1);
      const trade_date = parseOfxDate(dateRaw);
      if (!trade_date) {
        errors.push(`Skipped bank transaction: invalid date "${dateRaw}"`);
        continue;
      }

      const trnType = getTag(txn, "TRNTYPE", isV1)?.toUpperCase() ?? "";
      const amount = parseFloat(getTag(txn, "TRNAMT", isV1) ?? "0") || 0;
      const name = getTag(txn, "NAME", isV1) ?? getTag(txn, "MEMO", isV1) ?? null;

      const action = mapBankTrnType(trnType, amount);

      rows.push({
        trade_date,
        symbol: null,
        description: name,
        action,
        quantity: 0,
        price: 0,
        amount: Math.abs(amount),
        fees: 0,
        account: accountName ?? null,
        notes: null,
        source: "ofx",
      });
    }
  }

  rows.sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  return { rows, errors };
}

// ---------------------------------------------------------------------------
// OFX v1.x: strip the OFXHEADER/FI/ORG preamble and return just the body
// ---------------------------------------------------------------------------
function stripOfxV1Header(content: string): string {
  const idx = content.indexOf("<OFX>");
  return idx >= 0 ? content.slice(idx) : content;
}

// ---------------------------------------------------------------------------
// Tag extraction — works for both v1 SGML (no closing tags) and v2 XML
// ---------------------------------------------------------------------------

function getTag(block: string, tag: string, isV1: boolean): string | null {
  if (isV1) {
    // SGML: <TAG>value  (no closing tag; value ends at next tag or EOL)
    const re = new RegExp(`<${tag}>([^<\r\n]*)`, "i");
    const m = block.match(re);
    return m ? m[1].trim() : null;
  } else {
    // XML: <TAG>value</TAG>
    const re = new RegExp(`<${tag}>([^<]*)</${tag}>`, "i");
    const m = block.match(re);
    return m ? m[1].trim() : null;
  }
}

function getBlock(content: string, tag: string, isV1: boolean): string | null {
  if (isV1) {
    // SGML blocks: <TAG>...<\/ENDTAG> — closing tags exist for containers
    const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i");
    const m = content.match(re);
    if (m) return m[1];
    // Some v1 files omit the closing container tag — return from open tag to next peer
    const startRe = new RegExp(`<${tag}>([\\s\\S]*)`, "i");
    const sm = content.match(startRe);
    return sm ? sm[1] : null;
  } else {
    const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i");
    const m = content.match(re);
    return m ? m[1] : null;
  }
}

function extractBlocks(content: string, tag: string, isV1: boolean): string[] {
  const results: string[] = [];
  if (isV1) {
    const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) results.push(m[1]);
    return results;
  } else {
    const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) results.push(m[1]);
    return results;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseOfxDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // OFX dates: YYYYMMDD or YYYYMMDDHHMMSS[.mmm][TZ offset]
  const digits = raw.replace(/[^0-9]/g, "").slice(0, 8);
  if (digits.length < 8) return null;
  const yyyy = digits.slice(0, 4);
  const mm = digits.slice(4, 6);
  const dd = digits.slice(6, 8);
  const date = new Date(`${yyyy}-${mm}-${dd}T12:00:00Z`);
  if (isNaN(date.getTime())) return null;
  return `${yyyy}-${mm}-${dd}`;
}

function resolveSymbol(uniqueId: string, uniqueIdType: string): string | null {
  if (!uniqueId) return null;
  // CUSIP: 9-character alphanumeric — store as-is, symbol resolver handles it
  if (uniqueIdType === "CUSIP" || /^[A-Z0-9]{9}$/.test(uniqueId)) return uniqueId.toUpperCase();
  // Ticker: store uppercase
  if (uniqueIdType === "TICKER" || uniqueIdType === "SYMBOL") return uniqueId.toUpperCase();
  // ISIN: 12 chars — not directly supported, store as-is and let user map it
  return uniqueId.toUpperCase();
}

function mapBankTrnType(trnType: string, amount: number): TxnInput["action"] {
  switch (trnType) {
    case "DIV": return "DIVIDEND";
    case "INT": return "INTEREST";
    case "FEE":
    case "SRVCHG": return "FEE";
    case "DEP":
    case "XFER":
    case "DIRECTDEP": return amount >= 0 ? "CONTRIBUTION" : "DISTRIBUTION";
    case "DEBIT":
    case "PAYMENT": return "DISTRIBUTION";
    case "CREDIT":
    case "ATM":
    case "POS":
    case "OTHER":
    default: return amount >= 0 ? "CONTRIBUTION" : "DISTRIBUTION";
  }
}
