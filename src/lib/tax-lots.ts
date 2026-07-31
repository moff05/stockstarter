import type { Transaction } from "./portfolio";

export type TaxLot = {
  id: string;
  symbol: string;
  acquiredDate: string;
  qtyOriginal: number;
  qtyRemaining: number;
  costPerShare: number;
  totalCost: number;
  holdingPeriod: "short" | "long";
};

export type LotDisposal = {
  symbol: string;
  acquiredDate: string;
  disposedDate: string;
  sellTxnId: string;
  qtyDisposed: number;
  costPerShare: number;
  proceedsPerShare: number;
  realizedGain: number;
  holdingPeriod: "short" | "long";
};

function classifyHP(acquired: string, reference: string): "short" | "long" {
  const diffMs =
    new Date(reference + "T00:00:00Z").getTime() -
    new Date(acquired + "T00:00:00Z").getTime();
  return diffMs >= 365.25 * 86400_000 ? "long" : "short";
}

/**
 * Derives open tax lots and disposal history purely from the resolved transaction list.
 * method: "FIFO" = oldest lot first; "HIFO" = highest cost-per-share first.
 */
export function buildLots(
  txns: Transaction[],
  method: "FIFO" | "HIFO",
  asOfDate: string,
): {
  holdingsBySymbol: Record<string, TaxLot[]>;
  disposals: LotDisposal[];
} {
  const relevant = txns
    .filter(
      (t) =>
        t.trade_date <= asOfDate &&
        (t.action === "BUY" || t.action === "SELL") &&
        t.symbol,
    )
    .slice()
    .sort((a, b) => a.trade_date.localeCompare(b.trade_date) || a.id.localeCompare(b.id));

  const openLots: Record<string, TaxLot[]> = {};
  const disposals: LotDisposal[] = [];
  let seq = 0;

  for (const t of relevant) {
    const sym = t.symbol!.toUpperCase();
    const qty = Math.abs(Number(t.quantity ?? 0));
    const px = Number(t.price ?? 0);
    const amt = Number(t.amount ?? 0);
    const fee = Number(t.fees ?? 0);

    if (t.action === "BUY" && qty > 1e-9) {
      const costIn = Math.abs(amt) || qty * px + fee;
      const cps = qty > 0 ? costIn / qty : 0;
      openLots[sym] ??= [];
      openLots[sym].push({
        id: `${t.id}:${seq++}`,
        symbol: sym,
        acquiredDate: t.trade_date,
        qtyOriginal: qty,
        qtyRemaining: qty,
        costPerShare: cps,
        totalCost: costIn,
        holdingPeriod: classifyHP(t.trade_date, asOfDate),
      });
    }

    if (t.action === "SELL" && qty > 1e-9) {
      const lots = openLots[sym];
      if (!lots?.length) continue;

      if (method === "FIFO") {
        lots.sort((a, b) => a.acquiredDate.localeCompare(b.acquiredDate));
      } else {
        // HIFO: highest cost per share consumed first (minimizes realized gain)
        lots.sort((a, b) => b.costPerShare - a.costPerShare);
      }

      const proceeds = Math.abs(amt) || qty * px - fee;
      const pps = qty > 0 ? proceeds / qty : 0;
      let rem = qty;

      for (const lot of lots) {
        if (rem <= 1e-9) break;
        const consumed = Math.min(lot.qtyRemaining, rem);
        disposals.push({
          symbol: sym,
          acquiredDate: lot.acquiredDate,
          disposedDate: t.trade_date,
          sellTxnId: t.id,
          qtyDisposed: consumed,
          costPerShare: lot.costPerShare,
          proceedsPerShare: pps,
          realizedGain: consumed * (pps - lot.costPerShare),
          holdingPeriod: classifyHP(lot.acquiredDate, t.trade_date),
        });
        lot.qtyRemaining -= consumed;
        lot.totalCost = lot.costPerShare * lot.qtyRemaining;
        rem -= consumed;
      }

      openLots[sym] = lots.filter((l) => l.qtyRemaining > 1e-9);
    }
  }

  // Refresh holding periods to asOfDate for all open lots
  for (const lots of Object.values(openLots)) {
    for (const lot of lots) {
      lot.holdingPeriod = classifyHP(lot.acquiredDate, asOfDate);
    }
  }

  return { holdingsBySymbol: openLots, disposals };
}
