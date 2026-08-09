import { bulkInsertTransactions, DEMO_ACCOUNT, type TxnInput } from "./transactions.functions";

// A small, diversified sample portfolio for first-time visitors to click through
// before uploading their own statement. Dates are computed relative to "today"
// (not hardcoded) so the demo always looks current, however long it's been live.
// Multiple contributions + a partial sale are deliberate: they exercise the same
// code paths (TWR sub-periods, multi-lot tax accounting, realized gains) a real
// statement would, so every page has something real to show, not just Holdings.

function monthsAgo(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function buildDemoTransactions(): TxnInput[] {
  const account = DEMO_ACCOUNT;
  const rows: TxnInput[] = [];

  const add = (t: Omit<TxnInput, "account" | "fees" | "notes" | "source">) =>
    rows.push({ ...t, account, fees: 0, notes: null, source: "demo" });

  // Inception: initial deposit + first round of buys
  add({ trade_date: monthsAgo(14), symbol: null, description: "Initial deposit", action: "CONTRIBUTION", quantity: 0, price: 0, amount: 50000 });
  add({ trade_date: monthsAgo(14), symbol: "VOO", description: "Vanguard S&P 500 ETF", action: "BUY", quantity: 60, price: 430, amount: 25800 });
  add({ trade_date: monthsAgo(14), symbol: "AAPL", description: "Apple Inc", action: "BUY", quantity: 40, price: 180, amount: 7200 });
  add({ trade_date: monthsAgo(14), symbol: "MSFT", description: "Microsoft Corp", action: "BUY", quantity: 30, price: 390, amount: 11700 });

  // A bit later: first NVDA lot
  add({ trade_date: monthsAgo(13), symbol: "NVDA", description: "NVIDIA Corp", action: "BUY", quantity: 15, price: 450, amount: 6750 });

  // Second contribution + a dividend-focused holding
  add({ trade_date: monthsAgo(9), symbol: null, description: "Additional deposit", action: "CONTRIBUTION", quantity: 0, price: 0, amount: 10000 });
  add({ trade_date: monthsAgo(9), symbol: "SCHD", description: "Schwab US Dividend Equity ETF", action: "BUY", quantity: 100, price: 78, amount: 7800 });

  // Second NVDA lot at a different cost basis — gives Holdings/Tax Loss something
  // real to show for FIFO vs. HIFO lot selection
  add({ trade_date: monthsAgo(6), symbol: "NVDA", description: "NVIDIA Corp", action: "BUY", quantity: 10, price: 600, amount: 6000 });

  // Partial sale — exercises realized gain / tax-lot consumption
  add({ trade_date: monthsAgo(2), symbol: "NVDA", description: "NVIDIA Corp", action: "SELL", quantity: 5, price: 700, amount: 3500 });

  // Recent top-up, close enough to "today" to land in the most recent sub-period
  add({ trade_date: monthsAgo(1), symbol: null, description: "Additional deposit", action: "CONTRIBUTION", quantity: 0, price: 0, amount: 5000 });

  return rows;
}

export async function loadDemoData(): Promise<{ inserted: number }> {
  return bulkInsertTransactions({ data: { rows: buildDemoTransactions() } });
}
