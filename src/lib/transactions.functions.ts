import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { randomUUID } from "node:crypto";

export const ACTIONS = [
  "BUY",
  "SELL",
  "DIVIDEND",
  "INTEREST",
  "CONTRIBUTION",
  "DISTRIBUTION",
  "FEE",
  "SPLIT",
] as const;

const txnSchema = z.object({
  trade_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  symbol: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  action: z.enum(ACTIONS),
  quantity: z.number().default(0),
  price: z.number().default(0),
  amount: z.number(),
  fees: z.number().default(0),
  account: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
});

export type TxnInput = z.infer<typeof txnSchema>;

export const listTransactions = createServerFn({ method: "GET" })
  .inputValidator((d: { account?: string | null }) =>
    z.object({ account: z.string().nullable().optional() }).parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const { getDb } = await import("@/lib/db.server");
    const db = getDb();
    if (data?.account) {
      return db.prepare("SELECT * FROM transactions WHERE account = ? ORDER BY trade_date DESC").all(data.account);
    }
    return db.prepare("SELECT * FROM transactions ORDER BY trade_date DESC").all();
  });

export const listAccounts = createServerFn({ method: "GET" }).handler(async () => {
  const { getDb } = await import("@/lib/db.server");
  const rows = getDb()
    .prepare("SELECT DISTINCT account FROM transactions WHERE account IS NOT NULL ORDER BY account")
    .all() as { account: string }[];
  return rows.map((r) => r.account);
});

export const addTransaction = createServerFn({ method: "POST" })
  .inputValidator((d: TxnInput) => txnSchema.parse(d))
  .handler(async ({ data }) => {
    const { getDb } = await import("@/lib/db.server");
    const db = getDb();
    db.prepare(`
      INSERT INTO transactions (id, trade_date, symbol, description, action, quantity, price, amount, fees, account, notes, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(), data.trade_date, data.symbol ?? null, data.description ?? null,
      data.action, data.quantity ?? 0, data.price ?? 0, data.amount,
      data.fees ?? 0, data.account ?? null, data.notes ?? null, data.source ?? null,
    );
    return { ok: true };
  });

export const bulkInsertTransactions = createServerFn({ method: "POST" })
  .inputValidator((d: { rows: TxnInput[] }) =>
    z.object({ rows: z.array(txnSchema).max(5000) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { getDb } = await import("@/lib/db.server");
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO transactions (id, trade_date, symbol, description, action, quantity, price, amount, fees, account, notes, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    db.exec("BEGIN");
    try {
      for (const r of data.rows) {
        stmt.run(
          randomUUID(), r.trade_date, r.symbol ?? null, r.description ?? null,
          r.action, r.quantity ?? 0, r.price ?? 0, r.amount,
          r.fees ?? 0, r.account ?? null, r.notes ?? null, r.source ?? null,
        );
      }
      db.exec("COMMIT");
    } catch (e) {
      try { db.exec("ROLLBACK"); } catch { /* ignore */ }
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[bulkInsert] DB error:", e);
      throw new Error(`Database error: ${msg}`);
    }
    return { inserted: data.rows.length };
  });

export const deleteTransaction = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string }) => z.object({ id: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const { getDb } = await import("@/lib/db.server");
    getDb().prepare("DELETE FROM transactions WHERE id = ?").run(data.id);
    return { ok: true };
  });

export const deleteAllTransactions = createServerFn({ method: "POST" })
  .handler(async () => {
    const { getDb } = await import("@/lib/db.server");
    getDb().exec("DELETE FROM transactions");
    return { ok: true };
  });
