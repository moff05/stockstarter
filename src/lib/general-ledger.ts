import type { Transaction } from "./portfolio";
import type { LotDisposal } from "./tax-lots";

export type GLEntry = {
  date: string;
  txnId: string;
  description: string;
  debitAccount: number;
  creditAccount: number;
  amount: number;
  action: string;
  symbol?: string;
};

export function buildGLEntries(
  txns: Transaction[],
  disposals: LotDisposal[],
  symbolAccountMap: Record<string, number>,
): GLEntry[] {
  // Group disposals by sell transaction id for O(1) lookup
  const disposalsBySellId = new Map<string, LotDisposal[]>();
  for (const d of disposals) {
    const arr = disposalsBySellId.get(d.sellTxnId) ?? [];
    arr.push(d);
    disposalsBySellId.set(d.sellTxnId, arr);
  }

  const entries: GLEntry[] = [];

  for (const t of txns) {
    const sym = t.symbol?.toUpperCase();
    const stockAcct = sym ? (symbolAccountMap[sym] ?? 1799) : 1799;
    const qty = Math.abs(Number(t.quantity ?? 0));
    const px = Number(t.price ?? 0);
    const amt = Math.abs(Number(t.amount ?? 0));
    const fee = Number(t.fees ?? 0);
    const desc = t.description ?? t.symbol ?? t.action;

    switch (t.action) {
      case "BUY": {
        const cost = amt || qty * px + Math.abs(fee);
        entries.push({
          date: t.trade_date,
          txnId: t.id,
          description: desc,
          debitAccount: stockAcct,
          creditAccount: 1000,
          amount: cost,
          action: t.action,
          symbol: sym,
        });
        break;
      }

      case "SELL": {
        const proceeds = amt || qty * px - Math.abs(fee);
        const lots = disposalsBySellId.get(t.id) ?? [];
        const costBasis = lots.reduce((s, d) => s + d.costPerShare * d.qtyDisposed, 0);
        const realizedGain = lots.reduce((s, d) => s + d.realizedGain, 0);

        const effectiveCostBasis = costBasis || proceeds; // fallback if no lots found

        // Entry 1: return of cost basis (proceeds received, investment account reduced)
        entries.push({
          date: t.trade_date,
          txnId: t.id,
          description: desc,
          debitAccount: 1000,
          creditAccount: stockAcct,
          amount: effectiveCostBasis,
          action: t.action,
          symbol: sym,
        });

        // Entry 2: recognize gain or loss (only if lots were matched)
        if (lots.length > 0 && Math.abs(realizedGain) > 0.001) {
          if (realizedGain > 0) {
            // Gain: debit cash for the excess, credit realized G/L income
            entries.push({
              date: t.trade_date,
              txnId: t.id,
              description: `${desc} — realized gain`,
              debitAccount: 1000,
              creditAccount: 4100,
              amount: realizedGain,
              action: t.action,
              symbol: sym,
            });
          } else {
            // Loss: debit investment expense, credit cash
            entries.push({
              date: t.trade_date,
              txnId: t.id,
              description: `${desc} — realized loss`,
              debitAccount: 5100,
              creditAccount: 1000,
              amount: Math.abs(realizedGain),
              action: t.action,
              symbol: sym,
            });
          }
        }
        break;
      }

      case "DIVIDEND": {
        if (amt === 0) break;
        entries.push({
          date: t.trade_date,
          txnId: t.id,
          description: desc,
          debitAccount: 1000,
          creditAccount: 4200,
          amount: amt,
          action: t.action,
          symbol: sym,
        });
        break;
      }

      case "INTEREST": {
        if (amt === 0) break;
        entries.push({
          date: t.trade_date,
          txnId: t.id,
          description: desc,
          debitAccount: 1000,
          creditAccount: 4300,
          amount: amt,
          action: t.action,
          symbol: sym,
        });
        break;
      }

      case "CONTRIBUTION": {
        if (amt === 0) break;
        entries.push({
          date: t.trade_date,
          txnId: t.id,
          description: desc,
          debitAccount: 1000,
          creditAccount: 3501,
          amount: amt,
          action: t.action,
        });
        break;
      }

      case "DISTRIBUTION": {
        if (amt === 0) break;
        entries.push({
          date: t.trade_date,
          txnId: t.id,
          description: desc,
          debitAccount: 3501,
          creditAccount: 1000,
          amount: amt,
          action: t.action,
        });
        break;
      }

      case "FEE": {
        if (amt === 0) break;
        entries.push({
          date: t.trade_date,
          txnId: t.id,
          description: desc,
          debitAccount: 5100,
          creditAccount: 1000,
          amount: amt,
          action: t.action,
          symbol: sym,
        });
        break;
      }

      case "SPLIT":
      default:
        // No monetary entry for splits
        break;
    }
  }

  // Sort: date asc, txnId asc, debitAccount asc (keeps SELL's two rows adjacent)
  entries.sort((a, b) => {
    const byDate = a.date.localeCompare(b.date);
    if (byDate !== 0) return byDate;
    const byTxn = a.txnId.localeCompare(b.txnId);
    if (byTxn !== 0) return byTxn;
    return a.debitAccount - b.debitAccount;
  });

  return entries;
}
