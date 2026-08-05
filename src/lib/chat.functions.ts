import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { buildSnapshot, formatMoney } from "./portfolio";
import { buildResolver } from "./symbol-resolver";
import { yahooChart } from "./prices.functions";
import type { Transaction } from "./portfolio";

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

async function fetchLivePrices(symbols: string[]): Promise<Record<string, number>> {
  const now = Math.floor(Date.now() / 1000);
  const wkAgo = now - 60 * 60 * 24 * 7;
  const out: Record<string, number> = {};

  await Promise.all(
    symbols.map(async (sym) => {
      const yhSym = sym.replace(".", "-");
      try {
        const r = await yahooChart(yhSym, wkAgo, now);
        const price = Number(r.meta?.regularMarketPrice ?? 0);
        if (price > 0) out[sym.toUpperCase()] = price;
      } catch {
        // non-fatal — snapshot will show $0 for this symbol
      }
    }),
  );
  return out;
}

function buildContext(
  txns: Transaction[],
  mappings: any[],
  prices: Record<string, number>,
): string {
  const today = new Date().toISOString().slice(0, 10);
  const resolve = buildResolver(mappings);
  const resolvedTxns = txns.map((t: any) => ({
    ...t,
    symbol: t.symbol ? (resolve(t.symbol).ticker ?? t.symbol) : null,
  }));

  const snapshot = buildSnapshot(resolvedTxns, today, prices);
  const pct = (n: number, base: number) =>
    base > 0 ? ((n / base) * 100).toFixed(2) + "%" : "n/a";

  const lines: string[] = [
    "=== PORTFOLIO SUMMARY ===",
    `As of: ${today} (live market prices)`,
    "",
    "PORTFOLIO SUMMARY",
    `Total Market Value:   ${formatMoney(snapshot.totalMarketValue)}`,
    `Total Cost Basis:     ${formatMoney(snapshot.totalCostBasis)}`,
    `Unrealized P&L:       ${formatMoney(snapshot.unrealizedGain)} (${pct(snapshot.unrealizedGain, snapshot.totalCostBasis)})`,
    `Realized Gains:       ${formatMoney(snapshot.realizedGain)}`,
    `Dividend Income:      ${formatMoney(snapshot.dividendIncome)}`,
    `Interest Income:      ${formatMoney(snapshot.interestIncome)}`,
    `Total Contributions:  ${formatMoney(snapshot.contributions)}`,
    `Total Distributions:  ${formatMoney(snapshot.distributions)}`,
    `Total Fees:           ${formatMoney(snapshot.fees)}`,
    "",
    `CURRENT HOLDINGS (${snapshot.holdings.length} positions)`,
    "Symbol | Quantity | Avg Cost | Price | Market Value | Unrealized P&L | P&L% | Weight",
  ];

  for (const h of snapshot.holdings) {
    lines.push(
      `${h.symbol} | ${h.quantity.toLocaleString("en-US", { maximumFractionDigits: 4 })} | ${formatMoney(h.avgCost)} | ${formatMoney(h.marketPrice)} | ${formatMoney(h.marketValue)} | ${formatMoney(h.unrealizedPL)} | ${h.unrealizedPLPct.toFixed(2)}% | ${h.weightPct.toFixed(2)}%`,
    );
  }

  // Recent transactions — last 90 days, max 60
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const recent = resolvedTxns
    .filter((t: any) => t.trade_date >= cutoffStr)
    .sort((a: any, b: any) => b.trade_date.localeCompare(a.trade_date))
    .slice(0, 60);

  if (recent.length > 0) {
    lines.push(
      "",
      "RECENT TRANSACTIONS (last 90 days)",
      "Date | Action | Symbol | Quantity | Amount | Account",
    );
    for (const t of recent) {
      lines.push(
        `${t.trade_date} | ${t.action} | ${t.symbol ?? "—"} | ${Number(t.quantity || 0).toFixed(4)} | ${formatMoney(Number(t.amount || 0))} | ${t.account ?? "(unassigned)"}`,
      );
    }
  }

  // Per-account breakdown — each account is one uploaded Excel/CSV file.
  // Lets the assistant answer questions about a specific account by name.
  const accountNames = Array.from(
    new Set(resolvedTxns.map((t: any) => (t.account ?? "(unassigned)"))),
  ).sort();
  const hasRealAccounts =
    accountNames.length > 1 || (accountNames.length === 1 && accountNames[0] !== "(unassigned)");
  if (hasRealAccounts) {
    lines.push(
      "",
      "=== BY ACCOUNT ===",
      `The portfolio holds ${accountNames.length} account(s). Each is a separate account. Use this section when the user asks about a specific account by name; use the overall totals above when they ask about the whole portfolio.`,
    );
    for (const acct of accountNames) {
      const acctTxns = resolvedTxns.filter((t: any) => (t.account ?? "(unassigned)") === acct);
      const s = buildSnapshot(acctTxns, today, prices);
      lines.push(
        "",
        `ACCOUNT: ${acct}`,
        `  Market Value: ${formatMoney(s.totalMarketValue)} | Cost Basis: ${formatMoney(s.totalCostBasis)} | Unrealized P&L: ${formatMoney(s.unrealizedGain)} (${pct(s.unrealizedGain, s.totalCostBasis)})`,
        `  Dividends: ${formatMoney(s.dividendIncome)} | Interest: ${formatMoney(s.interestIncome)} | Positions: ${s.holdings.length}`,
      );
      if (s.holdings.length > 0) {
        const holdingList = s.holdings
          .slice()
          .sort((a, b) => b.marketValue - a.marketValue)
          .map((h) => `${h.symbol} ${formatMoney(h.marketValue)} (${h.unrealizedPLPct.toFixed(1)}%)`)
          .join(", ");
        lines.push(`  Holdings: ${holdingList}`);
      }
    }
  }

  return lines.join("\n");
}

export const askPortfolio = createServerFn({ method: "POST" })
  .inputValidator(
    (d: { messages: { role: "user" | "assistant"; content: string }[]; account?: string | null }) =>
      z
        .object({
          messages: z.array(messageSchema).min(1).max(40),
          account: z.string().nullable().optional(),
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    // Falls back to a build-time key (inlined from VITE_ANTHROPIC_API_KEY at
    // `bun run build` / `electron:build`) so installed copies work without
    // each user setting their own OS-level env var.
    const apiKey = process.env.ANTHROPIC_API_KEY || import.meta.env.VITE_ANTHROPIC_API_KEY;
    if (!apiKey) {
      return {
        content:
          "No ANTHROPIC_API_KEY found. Add it to your .env file and restart the server.",
      };
    }

    const { getDb } = await import("@/lib/db.server");
    const db = getDb();

    const txns = db
      .prepare("SELECT * FROM transactions ORDER BY trade_date")
      .all() as Transaction[];
    const mappings = db.prepare("SELECT * FROM symbol_mappings").all() as any[];

    // Resolve symbols to get the list we need prices for
    const resolve = buildResolver(mappings);
    const today = new Date().toISOString().slice(0, 10);
    const symbolSet = new Set<string>();
    for (const t of txns) {
      if (t.symbol && (t.action === "BUY" || t.action === "SELL")) {
        const ticker = resolve(t.symbol).ticker ?? t.symbol;
        if (ticker) symbolSet.add(ticker.toUpperCase());
      }
    }

    // Fetch live prices, fall back to cache if Yahoo fails
    let prices: Record<string, number> = {};
    try {
      prices = await fetchLivePrices(Array.from(symbolSet));
    } catch {
      // fall back to latest cache
    }

    // Fill any missing symbols from price_cache
    const missing = Array.from(symbolSet).filter((s) => !prices[s] && !prices[s.replace(".", "-")]);
    if (missing.length > 0) {
      const latestRows = db
        .prepare(
          `SELECT p.symbol, p.close
           FROM price_cache p
           INNER JOIN (
             SELECT symbol, MAX(as_of_date) AS max_date FROM price_cache GROUP BY symbol
           ) l ON p.symbol = l.symbol AND p.as_of_date = l.max_date`,
        )
        .all() as { symbol: string; close: number }[];
      for (const r of latestRows) {
        if (!prices[r.symbol]) prices[r.symbol] = Number(r.close);
      }
    }

    const context = buildContext(txns, mappings, prices);

    const viewNote =
      data.account && data.account.trim()
        ? `\n\nThe user is currently viewing the "${data.account}" account. If a question doesn't name an account, assume they mean this one; if they ask about "the portfolio" overall or name a different account, use the matching data.`
        : "";

    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: `You are a portfolio analyst assistant. Answer questions concisely and accurately using the portfolio data below. The portfolio may be split across multiple accounts — when the user names a specific account, answer from the "BY ACCOUNT" section; when they ask about the whole portfolio, use the overall totals. Format dollar amounts with $ and commas. Use markdown for formatting: **bold** for emphasis, tables for comparisons, bullet lists where appropriate. Be direct and professional.${viewNote}\n\n${context}`,
      messages: data.messages,
    });

    const block = response.content[0];
    return { content: block.type === "text" ? block.text : "" };
  });
