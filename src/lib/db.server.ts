import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

const DB_PATH = process.env.DB_PATH ?? resolve(process.cwd(), "data/portfolio.db");
mkdirSync(dirname(DB_PATH), { recursive: true });

// Pick the SQLite driver at runtime:
//   node:sqlite  → Node.js 22+ / Electron (production)
//   bun:sqlite   → Bun dev server (Vite module runner doesn't expose node:sqlite)
let db: any;
try {
  const { DatabaseSync } = await import("node:sqlite");
  db = new DatabaseSync(DB_PATH);
} catch {
  const { Database } = await import("bun:sqlite");
  db = new Database(DB_PATH);
}

db.exec("PRAGMA journal_mode = WAL");

// The only server-side table left: a shared cache of daily closing prices.
// Transactions and symbol mappings moved to the browser's localStorage —
// this cache holds public market data, not user data, so there's nothing
// here worth gating or scoping per-visitor.
db.exec(`
  CREATE TABLE IF NOT EXISTS price_cache (
    symbol     TEXT NOT NULL,
    as_of_date TEXT NOT NULL,
    close      REAL NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (symbol, as_of_date)
  );
`);

export function getDb(): any {
  return db;
}
