import { test, expect, describe } from "bun:test";
import { findUnmatchedSells, affectedSymbols } from "./data-integrity";
import type { Transaction } from "./portfolio";

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

describe("findUnmatchedSells", () => {
  test("no issues when every SELL is covered by a prior BUY", () => {
    const txns = [
      mkTxn({ trade_date: "2024-01-01", action: "BUY", symbol: "AAPL", quantity: 10 }),
      mkTxn({ trade_date: "2024-02-01", action: "SELL", symbol: "AAPL", quantity: 5 }),
    ];
    expect(findUnmatchedSells(txns)).toHaveLength(0);
  });

  test("flags a SELL with zero prior BUY (the classic 'uploaded partial history' case)", () => {
    const txns = [
      mkTxn({ trade_date: "2024-01-01", action: "SELL", symbol: "AAPL", quantity: 10 }),
    ];
    const issues = findUnmatchedSells(txns);
    expect(issues).toHaveLength(1);
    expect(issues[0].symbol).toBe("AAPL");
    expect(issues[0].requestedQty).toBe(10);
    expect(issues[0].availableQty).toBe(0);
    expect(issues[0].shortfallQty).toBe(10);
  });

  test("flags a partial shortfall: SELL qty exceeds what was bought, but some was", () => {
    const txns = [
      mkTxn({ trade_date: "2024-01-01", action: "BUY", symbol: "AAPL", quantity: 5 }),
      mkTxn({ trade_date: "2024-02-01", action: "SELL", symbol: "AAPL", quantity: 8 }),
    ];
    const issues = findUnmatchedSells(txns);
    expect(issues).toHaveLength(1);
    expect(issues[0].availableQty).toBe(5);
    expect(issues[0].shortfallQty).toBe(3);
  });

  test("a stock split correctly scales available quantity before a later SELL — no false positive", () => {
    const txns = [
      mkTxn({ trade_date: "2024-01-01", action: "BUY", symbol: "AAPL", quantity: 10 }),
      mkTxn({ trade_date: "2024-02-01", action: "SPLIT", symbol: "AAPL", quantity: 2 }), // 2:1 split -> 20 shares
      mkTxn({ trade_date: "2024-03-01", action: "SELL", symbol: "AAPL", quantity: 20 }),
    ];
    expect(findUnmatchedSells(txns)).toHaveLength(0);
  });

  test("symbols are tracked independently — a shortfall in one doesn't affect another", () => {
    const txns = [
      mkTxn({ trade_date: "2024-01-01", action: "BUY", symbol: "AAPL", quantity: 10 }),
      mkTxn({ trade_date: "2024-02-01", action: "SELL", symbol: "AAPL", quantity: 5 }),
      mkTxn({ trade_date: "2024-02-01", action: "SELL", symbol: "MSFT", quantity: 5 }), // no MSFT buy at all
    ];
    const issues = findUnmatchedSells(txns);
    expect(issues).toHaveLength(1);
    expect(issues[0].symbol).toBe("MSFT");
  });

  test("affectedSymbols returns distinct symbols in first-occurrence order", () => {
    const txns = [
      mkTxn({ trade_date: "2024-01-01", action: "SELL", symbol: "AAPL", quantity: 5 }),
      mkTxn({ trade_date: "2024-01-02", action: "SELL", symbol: "MSFT", quantity: 5 }),
      mkTxn({ trade_date: "2024-01-03", action: "SELL", symbol: "AAPL", quantity: 5 }), // AAPL again
    ];
    const issues = findUnmatchedSells(txns);
    expect(affectedSymbols(issues)).toEqual(["AAPL", "MSFT"]);
  });
});
