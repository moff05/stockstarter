import type { TxnInput } from "./transactions.functions";

export type OurField =
  | "trade_date"
  | "symbol"
  | "action"
  | "quantity"
  | "price"
  | "amount"
  | "description"
  | "fees"
  | "account";

export type ColumnMapping = Partial<Record<OurField, string>>;

export type BrokerFormat = {
  id: string;
  name: string;
  /** All must be present (case-insensitive) to fingerprint this broker */
  fingerprint: string[];
  /** Pre-built column mapping: our field → exact header name in this broker's export */
  columnMap: ColumnMapping;
  /**
   * For brokers that prepend account info rows before the real header
   * (e.g. Schwab). We scan rows until we find one containing this substring.
   */
  findHeaderContaining?: string;
  /** Broker action value (uppercase) → our action enum */
  actionMap: Record<string, TxnInput["action"]>;
};

export const BROKER_FORMATS: BrokerFormat[] = [
  {
    id: "fidelity",
    name: "Fidelity",
    // Fidelity exports use "Run Date" for the trade date column
    fingerprint: ["Run Date", "Action", "Symbol", "Price ($)", "Amount ($)"],
    columnMap: {
      trade_date: "Run Date",
      account: "Account",
      action: "Action",
      symbol: "Symbol",
      description: "Description",
      quantity: "Quantity",
      price: "Price ($)",
      amount: "Amount ($)",
      fees: "Commission ($)",
    },
    actionMap: {
      "BOUGHT": "BUY",
      "YOU BOUGHT": "BUY",
      "SOLD": "SELL",
      "YOU SOLD": "SELL",
      "DIVIDEND RECEIVED": "DIVIDEND",
      "QUALIFIED DIVIDEND": "DIVIDEND",
      "REINVESTMENT": "DIVIDEND",
      "LONG-TERM CAP GAIN REINVEST": "DIVIDEND",
      "SHORT-TERM CAP GAIN REINVEST": "DIVIDEND",
      "INTEREST EARNED": "INTEREST",
      "INTEREST INCOME": "INTEREST",
      "TRANSFERRED FROM": "CONTRIBUTION",
      "JOURNALED": "CONTRIBUTION",
      "ROLLOVER": "CONTRIBUTION",
      "DIRECT DEPOSIT": "CONTRIBUTION",
      "ELECTRONIC FUNDS TRANSFER": "CONTRIBUTION",
      "TRANSFERRED TO": "DISTRIBUTION",
      "FEE": "FEE",
      "COMMISSION": "FEE",
    },
  },
  {
    id: "schwab",
    name: "Charles Schwab",
    fingerprint: ["Action", "Symbol", "Quantity", "Price", "Fees & Comm", "Amount"],
    findHeaderContaining: "Date",
    columnMap: {
      trade_date: "Date",
      action: "Action",
      symbol: "Symbol",
      description: "Description",
      quantity: "Quantity",
      price: "Price",
      amount: "Amount",
      fees: "Fees & Comm",
    },
    actionMap: {
      "BUY": "BUY",
      "SELL": "SELL",
      "QUALIFIED DIVIDEND": "DIVIDEND",
      "CASH DIVIDEND": "DIVIDEND",
      "SPECIAL QUALIFIED DIV": "DIVIDEND",
      "SPECIAL DIVIDEND": "DIVIDEND",
      "PR YR DIV REINVEST": "DIVIDEND",
      "REINVESTED DIVIDEND": "DIVIDEND",
      "LONG TERM CAP GAIN": "DIVIDEND",
      "SHORT TERM CAP GAIN": "DIVIDEND",
      "BANK INTEREST": "INTEREST",
      "MARGIN INTEREST": "INTEREST",
      "WIRE RECEIVED": "CONTRIBUTION",
      "ELECTRONIC FUNDS TRANSFER RECEIVED": "CONTRIBUTION",
      "JOURNAL": "CONTRIBUTION",
      "WIRE SENT": "DISTRIBUTION",
      "ELECTRONIC FUNDS TRANSFER": "DISTRIBUTION",
      "SERVICE FEE": "FEE",
      "ADR MGMT FEE": "FEE",
      "STOCK SPLIT": "SPLIT",
    },
  },
  {
    id: "vanguard",
    name: "Vanguard",
    fingerprint: ["Trade date", "Transaction type", "Investment name", "Share price"],
    columnMap: {
      trade_date: "Trade date",
      action: "Transaction type",
      symbol: "Symbol",
      description: "Investment name",
      quantity: "Shares",
      price: "Share price",
      amount: "Net amount",
    },
    actionMap: {
      "BUY": "BUY",
      "SELL": "SELL",
      "DIVIDEND": "DIVIDEND",
      "INCOME DIVIDEND": "DIVIDEND",
      "CAPITAL GAIN (ST)": "DIVIDEND",
      "CAPITAL GAIN (LT)": "DIVIDEND",
      "REINVESTMENT": "DIVIDEND",
      "INTEREST INCOME": "INTEREST",
      "CONTRIBUTION": "CONTRIBUTION",
      "ROLLOVER": "CONTRIBUTION",
      "WITHDRAWAL": "DISTRIBUTION",
      "FEE": "FEE",
    },
  },
  {
    id: "robinhood",
    name: "Robinhood",
    fingerprint: ["Activity Date", "Trans Code", "Instrument", "Settle Date"],
    columnMap: {
      trade_date: "Activity Date",
      action: "Trans Code",
      symbol: "Instrument",
      description: "Description",
      quantity: "Quantity",
      price: "Price",
      amount: "Amount",
    },
    actionMap: {
      "BUY": "BUY",
      "SELL": "SELL",
      "CDIV": "DIVIDEND",
      "SREC": "DIVIDEND",
      "INT": "INTEREST",
      "ACH": "CONTRIBUTION",
      "ACATS": "CONTRIBUTION",
      "STO": "FEE",
    },
  },
  {
    id: "etrade",
    name: "E*TRADE",
    fingerprint: ["TransactionDate", "TransactionType", "SecurityType", "Symbol"],
    columnMap: {
      trade_date: "TransactionDate",
      action: "TransactionType",
      symbol: "Symbol",
      description: "Description",
      quantity: "Quantity",
      price: "Price",
      amount: "Amount",
      fees: "Commission",
    },
    actionMap: {
      "BOUGHT": "BUY",
      "SOLD": "SELL",
      "DIVIDEND": "DIVIDEND",
      "QUALIFIED DIVIDEND": "DIVIDEND",
      "INTEREST": "INTEREST",
      "CONTRIBUTION": "CONTRIBUTION",
      "WIRE TRANSFER IN": "CONTRIBUTION",
      "WITHDRAWAL": "DISTRIBUTION",
      "WIRE TRANSFER OUT": "DISTRIBUTION",
      "FEE": "FEE",
    },
  },
  {
    id: "tdameritrade",
    name: "TD Ameritrade",
    fingerprint: ["DATE", "DESCRIPTION", "QUANTITY", "SYMBOL", "PRICE", "COMMISSION", "AMOUNT"],
    columnMap: {
      trade_date: "DATE",
      action: "DESCRIPTION",
      symbol: "SYMBOL",
      description: "DESCRIPTION",
      quantity: "QUANTITY",
      price: "PRICE",
      amount: "AMOUNT",
      fees: "COMMISSION",
    },
    actionMap: {
      "BUY": "BUY",
      "SELL": "SELL",
      "DIVIDEND": "DIVIDEND",
      "QUALIFIED DIVIDEND": "DIVIDEND",
      "INTEREST": "INTEREST",
      "WIRE": "CONTRIBUTION",
      "ACH": "CONTRIBUTION",
      "FEE": "FEE",
    },
  },
  {
    id: "merrill",
    name: "Merrill Lynch / Edge",
    fingerprint: ["Date", "Type", "Description", "Gross Amount", "Net Amount", "Shares", "Price Per Share"],
    columnMap: {
      trade_date: "Date",
      action: "Type",
      description: "Description",
      quantity: "Shares",
      price: "Price Per Share",
      amount: "Net Amount",
    },
    actionMap: {
      "BUY": "BUY",
      "SELL": "SELL",
      "DIVIDEND": "DIVIDEND",
      "QUALIFIED DIVIDEND": "DIVIDEND",
      "INTEREST": "INTEREST",
      "DEPOSIT": "CONTRIBUTION",
      "WITHDRAWAL": "DISTRIBUTION",
      "FEE": "FEE",
    },
  },
];

/**
 * Try to identify the broker from the file's header row.
 * Case-insensitive match — all fingerprint strings must appear.
 */
export function detectBroker(headers: string[]): BrokerFormat | null {
  const lower = new Set(headers.map((h) => h.toLowerCase().trim()));
  for (const format of BROKER_FORMATS) {
    if (format.fingerprint.every((fp) => lower.has(fp.toLowerCase()))) {
      return format;
    }
  }
  return null;
}

/**
 * Use a broker's actionMap OR the generic regex fallback to resolve
 * a raw action string to our action enum.
 */
export function resolveAction(
  raw: string,
  brokerMap?: Record<string, TxnInput["action"]>,
): TxnInput["action"] | null {
  const up = raw.toUpperCase().trim();

  // Broker-specific map first (exact match)
  if (brokerMap) {
    const hit = brokerMap[up];
    if (hit) return hit;
    // Partial prefix match
    for (const [k, v] of Object.entries(brokerMap)) {
      if (up.startsWith(k) || k.startsWith(up)) return v;
    }
  }

  // Generic regex fallback (same logic as csv-import)
  if (/\bBUY\b|BOUGHT|PURCHASE/.test(up)) return "BUY";
  if (/\bSELL\b|SOLD|\bSALE\b|REDEMPTION/.test(up)) return "SELL";
  if (/SPLIT/.test(up)) return "SPLIT";
  if (/DIV(IDEND)?/.test(up)) return "DIVIDEND";
  if (/INTEREST/.test(up)) return "INTEREST";
  if (/CONTRIB|DEPOSIT|WIRE.*(IN|RECEIVED)|ACH.*(IN|RECEIVED)|FUNDS RECEIVED/.test(up)) return "CONTRIBUTION";
  if (/DISTRIB|WITHDRAW|WIRE.*(OUT|SENT)|ACH.*(OUT|SENT)|DISBURSEMENT/.test(up)) return "DISTRIBUTION";
  if (/FEE|COMMISSION/.test(up)) return "FEE";

  return null;
}
