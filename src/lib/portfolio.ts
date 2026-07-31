import type { TxnInput } from "./transactions.functions";

export type Transaction = TxnInput & {
  id: string;
  user_id: string;
  created_at: string;
};

export type Holding = {
  symbol: string;
  quantity: number;
  costBasis: number; // total cost remaining
  avgCost: number;
  marketPrice: number;
  marketValue: number;
  unrealizedPL: number;
  unrealizedPLPct: number;
  weightPct: number;
  // Enriched from Yahoo quote — null until metrics load or if unavailable (bonds, funds)
  beta: number | null;
  dividendYield: number | null;     // trailing annual yield as decimal (0.015 = 1.5%)
  annualDividendIncome: number;     // dividendYield × marketValue
};

export type PortfolioSnapshot = {
  asOfDate: string;
  holdings: Holding[];
  cash: number;
  totalMarketValue: number;
  totalCostBasis: number;
  totalEquity: number; // mv + cash
  realizedGain: number;
  unrealizedGain: number;
  dividendIncome: number;
  interestIncome: number;
  contributions: number;
  distributions: number;
  fees: number;
};

/** Build holdings as of a date using average-cost basis. */
export function buildSnapshot(
  txns: Transaction[],
  asOfDate: string,
  prices: Record<string, number>,
): PortfolioSnapshot {
  const relevant = txns
    .filter((t) => t.trade_date <= asOfDate)
    .slice()
    .sort((a, b) => a.trade_date.localeCompare(b.trade_date));

  const positions: Record<string, { qty: number; cost: number }> = {};
  let cash = 0;
  let realized = 0;
  let dividends = 0;
  let interest = 0;
  let contributions = 0;
  let distributions = 0;
  let fees = 0;

  for (const t of relevant) {
    const sym = (t.symbol ?? "").toUpperCase();
    const qty = Number(t.quantity ?? 0);
    const px = Number(t.price ?? 0);
    const amt = Number(t.amount ?? 0);
    const fee = Number(t.fees ?? 0);
    fees += fee;

    switch (t.action) {
      case "BUY": {
        const pos = (positions[sym] ??= { qty: 0, cost: 0 });
        const costIn = amt || qty * px + fee; // prefer statement amount (includes commissions, handles $0 price)
        pos.qty += qty;
        pos.cost += costIn;
        cash -= Math.abs(costIn);
        break;
      }
      case "SELL": {
        const pos = (positions[sym] ??= { qty: 0, cost: 0 });
        const avg = pos.qty > 0 ? pos.cost / pos.qty : 0;
        const sellQty = Math.min(qty, pos.qty);
        const costOut = avg * sellQty;
        const proceeds = Math.abs(amt || qty * px - fee);
        realized += proceeds - costOut;
        pos.qty -= sellQty;
        pos.cost -= costOut;
        if (pos.qty <= 1e-9) {
          pos.qty = 0;
          pos.cost = 0;
        }
        cash += proceeds;
        break;
      }
      case "DIVIDEND":
        dividends += amt;
        cash += amt;
        break;
      case "INTEREST":
        interest += amt;
        cash += amt;
        break;
      case "CONTRIBUTION":
        contributions += amt;
        cash += amt;
        break;
      case "DISTRIBUTION":
        distributions += Math.abs(amt);
        cash -= Math.abs(amt);
        break;
      case "FEE":
        cash -= Math.abs(amt);
        break;
      case "SPLIT": {
        const pos = (positions[sym] ??= { qty: 0, cost: 0 });
        if (qty > 0) pos.qty *= qty; // qty stores split ratio (e.g. 2 for 2:1)
        break;
      }
    }
  }

  const holdings: Holding[] = Object.entries(positions)
    .filter(([, p]) => p.qty > 1e-9)
    .map(([symbol, p]) => {
      const marketPrice = Number(prices[symbol] ?? prices[symbol.replace(".", "-")] ?? 0);
      const marketValue = marketPrice * p.qty;
      const unrealizedPL = marketValue - p.cost;
      return {
        symbol,
        quantity: p.qty,
        costBasis: p.cost,
        avgCost: p.qty > 0 ? p.cost / p.qty : 0,
        marketPrice,
        marketValue,
        unrealizedPL,
        unrealizedPLPct: p.cost > 0 ? (unrealizedPL / p.cost) * 100 : 0,
        weightPct: 0,
        beta: null,
        dividendYield: null,
        annualDividendIncome: 0,
      };
    });

  const totalMarketValue = holdings.reduce((s, h) => s + h.marketValue, 0);
  const totalCostBasis = holdings.reduce((s, h) => s + h.costBasis, 0);
  const unrealizedGain = totalMarketValue - totalCostBasis;
  const totalEquity = totalMarketValue + cash;

  for (const h of holdings) {
    h.weightPct = totalMarketValue > 0 ? (h.marketValue / totalMarketValue) * 100 : 0;
  }
  holdings.sort((a, b) => b.marketValue - a.marketValue);

  return {
    asOfDate,
    holdings,
    cash,
    totalMarketValue,
    totalCostBasis,
    totalEquity,
    realizedGain: realized,
    unrealizedGain,
    dividendIncome: dividends,
    interestIncome: interest,
    contributions,
    distributions,
    fees,
  };
}

/** Compute snapshot for a date window (used in quarterly partner statement). */
export function buildPeriodActivity(
  txns: Transaction[],
  periodStart: string,
  periodEnd: string,
  startPrices: Record<string, number>,
  endPrices: Record<string, number>,
) {
  // Snapshot at start (day BEFORE periodStart)
  const dayBefore = isoAddDays(periodStart, -1);
  const beginning = buildSnapshot(txns, dayBefore, startPrices);
  const ending = buildSnapshot(txns, periodEnd, endPrices);

  const periodTxns = txns.filter(
    (t) => t.trade_date >= periodStart && t.trade_date <= periodEnd,
  );

  let contributions = 0;
  let distributions = 0;
  let dividendIncome = 0;
  let interestIncome = 0;
  let realized = 0;
  let fees = 0;

  // Replay period transactions against beginning positions to compute realized gains.
  const positions: Record<string, { qty: number; cost: number }> = {};
  for (const h of beginning.holdings) {
    positions[h.symbol] = { qty: h.quantity, cost: h.costBasis };
  }

  for (const t of periodTxns.slice().sort((a, b) => a.trade_date.localeCompare(b.trade_date))) {
    const sym = (t.symbol ?? "").toUpperCase();
    const qty = Number(t.quantity ?? 0);
    const px = Number(t.price ?? 0);
    const amt = Number(t.amount ?? 0);
    const fee = Number(t.fees ?? 0);
    fees += fee;
    switch (t.action) {
      case "BUY": {
        const pos = (positions[sym] ??= { qty: 0, cost: 0 });
        pos.qty += qty;
        pos.cost += amt || qty * px + fee;
        break;
      }
      case "SELL": {
        const pos = (positions[sym] ??= { qty: 0, cost: 0 });
        const avg = pos.qty > 0 ? pos.cost / pos.qty : 0;
        const sellQty = Math.min(qty, pos.qty);
        const proceeds = Math.abs(amt || qty * px - fee);
        realized += proceeds - avg * sellQty;
        pos.qty -= sellQty;
        pos.cost -= avg * sellQty;
        break;
      }
      case "DIVIDEND":
        dividendIncome += amt;
        break;
      case "INTEREST":
        interestIncome += amt;
        break;
      case "CONTRIBUTION":
        contributions += amt;
        break;
      case "DISTRIBUTION":
        distributions += Math.abs(amt);
        break;
    }
  }

  const unrealizedChange =
    ending.unrealizedGain - beginning.unrealizedGain;

  return {
    periodStart,
    periodEnd,
    beginningCapital: beginning.totalEquity,
    endingCapital: ending.totalEquity,
    contributions,
    distributions,
    dividendIncome,
    interestIncome,
    realizedGain: realized,
    unrealizedGain: unrealizedChange,
    fees,
    netIncome:
      dividendIncome + interestIncome + realized + unrealizedChange - fees,
    beginning,
    ending,
  };
}

export function isoAddDays(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function quarterBounds(year: number, quarter: 1 | 2 | 3 | 4) {
  const startMonth = (quarter - 1) * 3 + 1;
  const start = `${year}-${String(startMonth).padStart(2, "0")}-01`;
  const endMonth = startMonth + 2;
  const lastDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
  const end = `${year}-${String(endMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

export function formatMoney(n: number) {
  const v = Math.abs(n);
  const s = v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `($${s})` : `$${s}`;
}

export function formatPct(n: number) {
  return `${n >= 0 ? "" : ""}${n.toFixed(2)}%`;
}