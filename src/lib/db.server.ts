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
db.exec("PRAGMA foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS transactions (
    id         TEXT PRIMARY KEY,
    trade_date TEXT NOT NULL,
    symbol     TEXT,
    description TEXT,
    action     TEXT NOT NULL,
    quantity   REAL DEFAULT 0,
    price      REAL DEFAULT 0,
    amount     REAL NOT NULL DEFAULT 0,
    fees       REAL DEFAULT 0,
    account    TEXT,
    notes      TEXT,
    source     TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_txn_date   ON transactions(trade_date);
  CREATE INDEX IF NOT EXISTS idx_txn_symbol ON transactions(symbol);

  CREATE TABLE IF NOT EXISTS symbol_mappings (
    id         TEXT PRIMARY KEY,
    cusip      TEXT NOT NULL UNIQUE,
    ticker     TEXT,
    name       TEXT,
    asset_class TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS price_cache (
    symbol     TEXT NOT NULL,
    as_of_date TEXT NOT NULL,
    close      REAL NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (symbol, as_of_date)
  );
`);

// Add account column if this is an existing database without it
try { db.exec("ALTER TABLE transactions ADD COLUMN account TEXT"); } catch { /* already exists */ }

db.exec(`
  UPDATE transactions
  SET symbol = NULL
  WHERE action IN ('DIVIDEND', 'INTEREST', 'FEE', 'CONTRIBUTION')
  AND symbol GLOB '[0-9A-Z][0-9A-Z][0-9A-Z][0-9A-Z][0-9A-Z][0-9A-Z][0-9A-Z][0-9A-Z][0-9A-Z]';

  DELETE FROM symbol_mappings
  WHERE cusip NOT IN (
    SELECT DISTINCT symbol FROM transactions WHERE symbol IS NOT NULL
  );
`);

export function getDb(): any {
  return db;
}
