import { test, expect, describe } from "bun:test";
import { buildLots } from "./tax-lots";
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

// Shared scenario for both methods:
// Buy 10 @ $10/sh (2024-01-01), buy 10 @ $20/sh (2024-02-01), sell 15 @ $30/sh (2024-03-01).
function twoLotScenario(): Transaction[] {
  return [
    mkTxn({ trade_date: "2024-01-01", action: "BUY", symbol: "AAPL", quantity: 10, price: 10, amount: 100 }),
    mkTxn({ trade_date: "2024-02-01", action: "BUY", symbol: "AAPL", quantity: 10, price: 20, amount: 200 }),
    mkTxn({ trade_date: "2024-03-01", action: "SELL", symbol: "AAPL", quantity: 15, price: 30, amount: 450 }),
  ];
}

describe("buildLots — FIFO", () => {
  test("consumes the oldest (cheapest) lot first, producing the larger realized gain", () => {
    // FIFO consumes all 10 from the $10/sh lot, then 5 from the $20/sh lot.
    // Realized gain = 10*(30-10) + 5*(30-20) = 200 + 50 = 250.
    const { holdingsBySymbol, disposals } = buildLots(twoLotScenario(), "FIFO", "2024-06-01");
    const totalRealized = disposals.reduce((s, d) => s + d.realizedGain, 0);
    expect(totalRealized).toBe(250);

    const remaining = holdingsBySymbol["AAPL"];
    expect(remaining).toHaveLength(1);
    expect(remaining[0].qtyRemaining).toBe(5);
    expect(remaining[0].costPerShare).toBe(20); // the $20 lot is what's left
    expect(remaining[0].acquiredDate).toBe("2024-02-01");
  });
});

describe("buildLots — HIFO", () => {
  test("consumes the highest-cost lot first, minimizing realized gain", () => {
    // HIFO consumes all 10 from the $20/sh lot first, then 5 from the $10/sh lot.
    // Realized gain = 10*(30-20) + 5*(30-10) = 100 + 100 = 200 — lower than FIFO's 250,
    // which is the entire point of HIFO (minimize taxable gain).
    const { holdingsBySymbol, disposals } = buildLots(twoLotScenario(), "HIFO", "2024-06-01");
    const totalRealized = disposals.reduce((s, d) => s + d.realizedGain, 0);
    expect(totalRealized).toBe(200);

    const remaining = holdingsBySymbol["AAPL"];
    expect(remaining).toHaveLength(1);
    expect(remaining[0].qtyRemaining).toBe(5);
    expect(remaining[0].costPerShare).toBe(10); // the cheap $10 lot is what's left
    expect(remaining[0].acquiredDate).toBe("2024-01-01");
  });

  test("HIFO realized gain is never greater than FIFO's for the same trades", () => {
    const fifo = buildLots(twoLotScenario(), "FIFO", "2024-06-01");
    const hifo = buildLots(twoLotScenario(), "HIFO", "2024-06-01");
    const fifoGain = fifo.disposals.reduce((s, d) => s + d.realizedGain, 0);
    const hifoGain = hifo.disposals.reduce((s, d) => s + d.realizedGain, 0);
    expect(hifoGain).toBeLessThanOrEqual(fifoGain);
  });
});

describe("buildLots — holding period classification", () => {
  test("a lot held more than a year is long-term; a lot held a month is short-term", () => {
    const txns = [
      mkTxn({ trade_date: "2022-01-01", action: "BUY", symbol: "LONG", quantity: 1, price: 100, amount: 100 }),
      mkTxn({ trade_date: "2024-05-01", action: "BUY", symbol: "SHORT", quantity: 1, price: 100, amount: 100 }),
    ];
    const { holdingsBySymbol } = buildLots(txns, "FIFO", "2024-06-01");
    expect(holdingsBySymbol["LONG"][0].holdingPeriod).toBe("long");
    expect(holdingsBySymbol["SHORT"][0].holdingPeriod).toBe("short");
  });
});

describe("buildLots — incomplete history", () => {
  test("a SELL with no matching lot doesn't crash and produces no disposal for that symbol", () => {
    const txns = [
      mkTxn({ trade_date: "2024-01-01", action: "SELL", symbol: "AAPL", quantity: 10, price: 100, amount: 1000 }),
    ];
    const { holdingsBySymbol, disposals } = buildLots(txns, "FIFO", "2024-06-01");
    expect(disposals).toHaveLength(0);
    expect(holdingsBySymbol["AAPL"] ?? []).toHaveLength(0);
  });

  test("a SELL larger than all open lots combined only disposes what was actually available", () => {
    const txns = [
      mkTxn({ trade_date: "2024-01-01", action: "BUY", symbol: "AAPL", quantity: 5, price: 10, amount: 50 }),
      mkTxn({ trade_date: "2024-02-01", action: "SELL", symbol: "AAPL", quantity: 20, price: 30, amount: 600 }),
    ];
    const { holdingsBySymbol, disposals } = buildLots(txns, "FIFO", "2024-06-01");
    const disposedQty = disposals.reduce((s, d) => s + d.qtyDisposed, 0);
    expect(disposedQty).toBe(5); // only the 5 shares actually on record
    expect(holdingsBySymbol["AAPL"] ?? []).toHaveLength(0);
  });
});
