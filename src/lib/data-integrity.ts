import type { Transaction } from "./portfolio";

export type UnmatchedSell = {
  symbol: string;
  date: string;
  requestedQty: number;
  availableQty: number;
  shortfallQty: number;
};

/**
 * Replays BUY/SELL/SPLIT transactions in chronological order (same ordering
 * buildSnapshot and buildLots use) and flags any SELL that asks for more
 * shares than the app has a BUY on record for.
 *
 * This happens almost entirely for one reason: the uploaded transaction
 * history doesn't go back to when the position was first acquired (e.g. an
 * existing brokerage account was uploaded starting from "last year" instead
 * of full history). buildSnapshot/buildLots both degrade gracefully in that
 * case (clamp or skip) rather than crashing or going negative — but
 * gracefully is not the same as correctly: cost basis and realized/unrealized
 * gain for that symbol are understated from the shortfall point forward.
 * This function exists so that degradation can be surfaced to the user
 * instead of happening silently.
 */
export function findUnmatchedSells(txns: Transaction[]): UnmatchedSell[] {
  const relevant = txns
    .filter((t) => t.action === "BUY" || t.action === "SELL" || t.action === "SPLIT")
    .slice()
    .sort((a, b) => a.trade_date.localeCompare(b.trade_date) || (a.id ?? "").localeCompare(b.id ?? ""));

  const qtyBySymbol: Record<string, number> = {};
  const issues: UnmatchedSell[] = [];

  for (const t of relevant) {
    const sym = (t.symbol ?? "").toUpperCase();
    if (!sym) continue;
    const qty = Math.abs(Number(t.quantity ?? 0));

    if (t.action === "BUY") {
      qtyBySymbol[sym] = (qtyBySymbol[sym] ?? 0) + qty;
    } else if (t.action === "SPLIT") {
      if (qty > 0) qtyBySymbol[sym] = (qtyBySymbol[sym] ?? 0) * qty;
    } else if (t.action === "SELL") {
      const available = qtyBySymbol[sym] ?? 0;
      if (qty > available + 1e-6) {
        issues.push({
          symbol: sym,
          date: t.trade_date,
          requestedQty: qty,
          availableQty: available,
          shortfallQty: qty - available,
        });
      }
      qtyBySymbol[sym] = Math.max(0, available - qty);
    }
  }

  return issues;
}

/** Distinct symbols affected, in first-occurrence order — for compact display. */
export function affectedSymbols(issues: UnmatchedSell[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const i of issues) {
    if (!seen.has(i.symbol)) {
      seen.add(i.symbol);
      out.push(i.symbol);
    }
  }
  return out;
}
