import { test, expect, describe } from "bun:test";
import { buildSnapshot, type Transaction } from "./portfolio";

let seq = 0;
function mkTxn(t: Partial<Transaction> & { trade_date: string; action: Transaction["action"] }): Transaction {
  seq++;
  return {
    id: `t${seq}`,
    user_id: "u1",
    created_at: t.trade_date,
    symbol: null,
    description: null,
    quantity: 0,
    price: 0,
    amount: 0,
    fees: 0,
    ...t,
  } as Transaction;
}

describe("buildSnapshot", () => {
  test("single BUY: cost basis, market value, and unrealized gain are correct", () => {
    // Buy 10 shares at $100 (amount = 1000), price is now $150.
    // Expected: costBasis=1000, marketValue=1500, unrealizedPL=500, unrealizedPLPct=50%.
    const txns = [
      mkTxn({ trade_date: "2024-01-01", action: "BUY", symbol: "AAPL", quantity: 10, price: 100, amount: 1000 }),
    ];
    const snap = buildSnapshot(txns, "2024-06-01", { AAPL: 150 });
    expect(snap.holdings).toHaveLength(1);
    const h = snap.holdings[0];
    expect(h.quantity).toBe(10);
    expect(h.costBasis).toBe(1000);
    expect(h.avgCost).toBe(100);
    expect(h.marketValue).toBe(1500);
    expect(h.unrealizedPL).toBe(500);
    expect(h.unrealizedPLPct).toBe(50);
  });

  test("partial SELL: realized gain uses average cost, remaining position shrinks correctly", () => {
    // Buy 10 @ $100 (cost 1000, avg 100/sh). Sell 4 @ $150 (proceeds 600).
    // Realized gain = proceeds - avgCost*sellQty = 600 - 100*4 = 200.
    // Remaining: qty=6, cost=1000-400=600, avgCost=100.
    const txns = [
      mkTxn({ trade_date: "2024-01-01", action: "BUY", symbol: "AAPL", quantity: 10, price: 100, amount: 1000 }),
      mkTxn({ trade_date: "2024-02-01", action: "SELL", symbol: "AAPL", quantity: 4, price: 150, amount: 600 }),
    ];
    const snap = buildSnapshot(txns, "2024-06-01", { AAPL: 150 });
    expect(snap.realizedGain).toBe(200);
    const h = snap.holdings[0];
    expect(h.quantity).toBe(6);
    expect(h.costBasis).toBe(600);
    expect(h.avgCost).toBe(100);
  });

  test("SELL exceeding tracked position clamps at zero instead of going negative", () => {
    // Buy 5, then sell 10 (5 more than held) — e.g. from an incomplete transaction history.
    // The position should clamp to 0, not go negative.
    const txns = [
      mkTxn({ trade_date: "2024-01-01", action: "BUY", symbol: "AAPL", quantity: 5, price: 100, amount: 500 }),
      mkTxn({ trade_date: "2024-02-01", action: "SELL", symbol: "AAPL", quantity: 10, price: 150, amount: 1500 }),
    ];
    const snap = buildSnapshot(txns, "2024-06-01", { AAPL: 150 });
    expect(snap.holdings.find((h) => h.symbol === "AAPL")).toBeUndefined();
    expect(snap.totalCostBasis).toBeGreaterThanOrEqual(0);
  });

  test("stock split (2:1): quantity doubles, total cost basis unchanged, avg cost halves", () => {
    const txns = [
      mkTxn({ trade_date: "2024-01-01", action: "BUY", symbol: "AAPL", quantity: 10, price: 100, amount: 1000 }),
      mkTxn({ trade_date: "2024-02-01", action: "SPLIT", symbol: "AAPL", quantity: 2 }),
    ];
    const snap = buildSnapshot(txns, "2024-06-01", { AAPL: 60 });
    const h = snap.holdings[0];
    expect(h.quantity).toBe(20);
    expect(h.costBasis).toBe(1000);
    expect(h.avgCost).toBe(50);
  });

  test("reverse split (1:10, ratio 0.1): quantity shrinks, avg cost rises proportionally", () => {
    const txns = [
      mkTxn({ trade_date: "2024-01-01", action: "BUY", symbol: "XYZ", quantity: 1000, price: 1, amount: 1000 }),
      mkTxn({ trade_date: "2024-02-01", action: "SPLIT", symbol: "XYZ", quantity: 0.1 }),
    ];
    const snap = buildSnapshot(txns, "2024-06-01", { XYZ: 10 });
    const h = snap.holdings[0];
    expect(h.quantity).toBe(100);
    expect(h.costBasis).toBe(1000);
    expect(h.avgCost).toBe(10);
  });

  test("DIVIDEND and CONTRIBUTION both increase cash and their respective totals", () => {
    const txns = [
      mkTxn({ trade_date: "2024-01-01", action: "CONTRIBUTION", amount: 1000 }),
      mkTxn({ trade_date: "2024-02-01", action: "DIVIDEND", symbol: "AAPL", amount: 25 }),
    ];
    const snap = buildSnapshot(txns, "2024-06-01", {});
    expect(snap.contributions).toBe(1000);
    expect(snap.dividendIncome).toBe(25);
    expect(snap.cash).toBe(1025);
  });

  test("asOfDate filtering: transactions after the as-of date are excluded", () => {
    const txns = [
      mkTxn({ trade_date: "2024-01-01", action: "BUY", symbol: "AAPL", quantity: 10, price: 100, amount: 1000 }),
      mkTxn({ trade_date: "2024-06-01", action: "BUY", symbol: "AAPL", quantity: 10, price: 200, amount: 2000 }),
    ];
    const snap = buildSnapshot(txns, "2024-03-01", { AAPL: 150 });
    expect(snap.holdings[0].quantity).toBe(10); // only the January buy counts
  });

  test("multiple symbols: weightPct across all holdings sums to 100", () => {
    const txns = [
      mkTxn({ trade_date: "2024-01-01", action: "BUY", symbol: "AAPL", quantity: 10, price: 100, amount: 1000 }),
      mkTxn({ trade_date: "2024-01-01", action: "BUY", symbol: "MSFT", quantity: 5, price: 200, amount: 1000 }),
    ];
    const snap = buildSnapshot(txns, "2024-06-01", { AAPL: 100, MSFT: 200 });
    const totalWeight = snap.holdings.reduce((s, h) => s + h.weightPct, 0);
    expect(totalWeight).toBeCloseTo(100, 6);
  });
});
