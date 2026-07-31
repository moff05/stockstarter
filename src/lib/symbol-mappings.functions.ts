import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { randomUUID } from "node:crypto";

export type Mapping = {
  id: string;
  cusip: string;
  ticker: string | null;
  name: string | null;
  asset_class: string | null;
};

export const listMappings = createServerFn({ method: "GET" })
  .handler(async () => {
    const { getDb } = await import("@/lib/db.server");
    return getDb()
      .prepare("SELECT id, cusip, ticker, name, asset_class FROM symbol_mappings ORDER BY cusip")
      .all() as Mapping[];
  });

const upsertSchema = z.object({
  cusip: z.string().min(1),
  ticker: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  asset_class: z.string().nullable().optional(),
});

export const upsertMapping = createServerFn({ method: "POST" })
  .inputValidator((d: z.infer<typeof upsertSchema>) => upsertSchema.parse(d))
  .handler(async ({ data }) => {
    const { getDb } = await import("@/lib/db.server");
    const db = getDb();
    const cusip = data.cusip.toUpperCase();
    const ticker = data.ticker ? data.ticker.toUpperCase() : null;
    db.prepare(`
      INSERT INTO symbol_mappings (id, cusip, ticker, name, asset_class)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(cusip) DO UPDATE SET
        ticker = excluded.ticker,
        name = excluded.name,
        asset_class = excluded.asset_class,
        updated_at = datetime('now')
    `).run(randomUUID(), cusip, ticker, data.name ?? null, data.asset_class ?? null);
    return { ok: true };
  });

export const bulkUpsertMappings = createServerFn({ method: "POST" })
  .inputValidator((d: { rows: z.infer<typeof upsertSchema>[] }) =>
    z.object({ rows: z.array(upsertSchema).max(2000) }).parse(d),
  )
  .handler(async ({ data }) => {
    if (!data.rows.length) return { inserted: 0 };
    const { getDb } = await import("@/lib/db.server");
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO symbol_mappings (id, cusip, ticker, name, asset_class)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(cusip) DO UPDATE SET
        ticker = excluded.ticker,
        name = excluded.name,
        asset_class = excluded.asset_class,
        updated_at = datetime('now')
    `);
    db.exec("BEGIN");
    try {
      for (const r of data.rows) {
        stmt.run(
          randomUUID(),
          r.cusip.toUpperCase(),
          r.ticker ? r.ticker.toUpperCase() : null,
          r.name ?? null,
          r.asset_class ?? null,
        );
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return { inserted: data.rows.length };
  });

export const deleteMapping = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string }) => z.object({ id: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const { getDb } = await import("@/lib/db.server");
    getDb().prepare("DELETE FROM symbol_mappings WHERE id = ?").run(data.id);
    return { ok: true };
  });
