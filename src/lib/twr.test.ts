import { test, expect, describe } from "bun:test";
import { computeTWR, computeIRR } from "./twr";
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

describe("computeTWR", () => {
  test("no external cash flows: TWR equals the simple return", () => {
    // Buy once, hold, price rises from $100 to $110 with no contributions/distributions
    // in between -> single sub-period -> TWR is just (end-start)/start = 10%.
    const txns = [
      mkTxn({ trade_date: "2024-01-01", action: "BUY", symbol: "AAPL", quantity: 10, price: 100, amount: 1000 }),
    ];
    const prices = {
      "2024-01-01": { AAPL: 100 },
      "2024-03-01": { AAPL: 110 },
    };
    const result = computeTWR(txns, "2024-01-01", "2024-03-01", prices);
    expect(result.twr).toBeCloseTo(0.10, 10);
  });

  test("chain-linked sub-periods correctly isolate performance from a mid-period contribution", () => {
    // This is TWR's entire reason to exist: a naive (end-start-contribution)/start
    // calculation gets badly distorted by contribution timing. TWR should not be.
    //
    // Day 1:  buy 10 AAPL @ $100          (mv = $1,000)
    // Day 31: price rises to $110         (mv = $1,100) -> sub-period 1 return = +10%
    // Day 32: contribute $1,000, fully deployed same day into 10 more shares @ $110
    //         (mv = 20 * $110 = $2,200, fully invested, $0 undeployed cash)
    // Day 60: price rises to $121         (mv = 20 * $121 = $2,420) -> sub-period 2 return = +10%
    //
    // Chain-linked TWR = 1.10 * 1.10 - 1 = 0.21 (21%).
    // A naive calc would say (2420 - 1000 - 1000) / 1000 = 42%, or ignoring the
    // contribution entirely, (2420-1000)/1000 = 142% -- both are wrong. 21% is right.
    const txns = [
      mkTxn({ trade_date: "2024-01-01", action: "BUY", symbol: "AAPL", quantity: 10, price: 100, amount: 1000 }),
      mkTxn({ trade_date: "2024-02-01", action: "CONTRIBUTION", amount: 1000 }),
      mkTxn({ trade_date: "2024-02-01", action: "BUY", symbol: "AAPL", quantity: 10, price: 110, amount: 1000 }),
    ];
    const prices = {
      "2024-01-01": { AAPL: 100 },
      "2024-01-31": { AAPL: 110 },
      "2024-02-01": { AAPL: 110 },
      "2024-03-01": { AAPL: 121 },
    };
    const result = computeTWR(txns, "2024-01-01", "2024-03-01", prices);
    expect(result.twr).toBeCloseTo(0.21, 10);
    expect(result.subPeriods).toHaveLength(2);
    expect(result.subPeriods[0].periodReturn).toBeCloseTo(0.10, 10);
    expect(result.subPeriods[1].periodReturn).toBeCloseTo(0.10, 10);
  });
});

describe("computeIRR", () => {
  test("returns null for fewer than two cash flows", () => {
    expect(computeIRR([{ date: "2024-01-01", amount: -1000 }])).toBeNull();
  });

  test("break-even cash flows (no time-value gain) resolve to ~0%", () => {
    const irr = computeIRR([
      { date: "2024-01-01", amount: -1000 },
      { date: "2025-01-01", amount: 1000 },
    ]);
    expect(irr).not.toBeNull();
    expect(irr!).toBeCloseTo(0, 2);
  });

  test("Newton-Raphson solver recovers a known planted rate", () => {
    // Construct a cash flow pair engineered to have IRR = 12% under the function's own
    // day-count convention (t = actualDays / 365.25), then verify the solver finds it.
    // This directly tests correctness of the root-finding, not just "it returns a number."
    const start = "2024-01-01";
    const end = "2025-01-01"; // 2024 is a leap year: 366 actual days
    const actualDays = (new Date(end + "T00:00:00Z").getTime() - new Date(start + "T00:00:00Z").getTime()) / 86_400_000;
    const t = actualDays / 365.25;
    const plantedRate = 0.12;
    const investment = 1000;
    const payout = investment * Math.pow(1 + plantedRate, t);

    const irr = computeIRR([
      { date: start, amount: -investment },
      { date: end, amount: payout },
    ]);
    expect(irr).not.toBeNull();
    expect(irr!).toBeCloseTo(plantedRate, 6);
  });
});
