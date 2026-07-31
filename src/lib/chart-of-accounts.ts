import type { Transaction } from "./portfolio";

export type AccountEntry = {
  code: number;
  name: string;
  category: "asset" | "liability" | "equity" | "income" | "expense";
  normalBalance: "debit" | "credit";
  symbol?: string;
};

export const STATIC_COA: AccountEntry[] = [
  // Assets
  { code: 1000, name: "Cash — Brokerage",                    category: "asset",     normalBalance: "debit" },
  { code: 1010, name: "Cash — Money Market",                 category: "asset",     normalBalance: "debit" },
  { code: 1200, name: "Dividends Receivable",                category: "asset",     normalBalance: "debit" },
  { code: 1210, name: "Interest Receivable",                 category: "asset",     normalBalance: "debit" },
  // 1701+ Stock Investment accounts are generated dynamically by buildSymbolAccountMap

  // Liabilities
  { code: 2050, name: "Accounts Payable",                    category: "liability", normalBalance: "credit" },
  { code: 2300, name: "Taxes Payable",                       category: "liability", normalBalance: "credit" },
  { code: 2320, name: "Other Liabilities",                   category: "liability", normalBalance: "credit" },

  // Equity
  { code: 3501, name: "Partner Capital",                     category: "equity",    normalBalance: "credit" },
  { code: 3800, name: "Retained Earnings",                   category: "equity",    normalBalance: "credit" },

  // Income
  { code: 4100, name: "Investment Income — Realized G/L",    category: "income",    normalBalance: "credit" },
  { code: 4200, name: "Dividend Income",                     category: "income",    normalBalance: "credit" },
  { code: 4300, name: "Interest Income",                     category: "income",    normalBalance: "credit" },
  { code: 4800, name: "Other Income",                        category: "income",    normalBalance: "credit" },

  // Expenses
  { code: 5100, name: "Investment Expenses",                 category: "expense",   normalBalance: "debit" },
  { code: 6100, name: "Non-Investment Expenses",             category: "expense",   normalBalance: "debit" },
  { code: 7100, name: "Interest Expense",                    category: "expense",   normalBalance: "debit" },
  { code: 9500, name: "Applicable Income Taxes",             category: "expense",   normalBalance: "debit" },
];

export function buildSymbolAccountMap(txns: Transaction[]): {
  symbolAccountMap: Record<string, number>;
  dynamicAccounts: AccountEntry[];
} {
  const symbolAccountMap: Record<string, number> = {};
  const dynamicAccounts: AccountEntry[] = [];
  let nextCode = 1701;

  const relevant = txns
    .filter((t) => (t.action === "BUY" || t.action === "SELL") && t.symbol)
    .slice()
    .sort((a, b) => a.trade_date.localeCompare(b.trade_date) || a.id.localeCompare(b.id));

  // First pass: BUYs in chronological order
  for (const t of relevant) {
    if (t.action !== "BUY") continue;
    const sym = t.symbol!.toUpperCase();
    if (!(sym in symbolAccountMap)) {
      symbolAccountMap[sym] = nextCode;
      dynamicAccounts.push({
        code: nextCode,
        name: `Stock Investment — ${sym}`,
        category: "asset",
        normalBalance: "debit",
        symbol: sym,
      });
      nextCode++;
    }
  }

  // Second pass: SELLs whose symbol was never in a BUY
  for (const t of relevant) {
    if (t.action !== "SELL") continue;
    const sym = t.symbol!.toUpperCase();
    if (!(sym in symbolAccountMap)) {
      symbolAccountMap[sym] = nextCode;
      dynamicAccounts.push({
        code: nextCode,
        name: `Stock Investment — ${sym}`,
        category: "asset",
        normalBalance: "debit",
        symbol: sym,
      });
      nextCode++;
    }
  }

  return { symbolAccountMap, dynamicAccounts };
}

export function buildFullCOA(dynamicAccounts: AccountEntry[]): AccountEntry[] {
  return [...STATIC_COA, ...dynamicAccounts].sort((a, b) => a.code - b.code);
}

export function getAccountName(code: number, fullCOA: AccountEntry[]): string {
  const entry = fullCOA.find((a) => a.code === code);
  return entry ? `${code} — ${entry.name}` : `${code}`;
}
