import { z } from "zod";

// NOTE: despite the filename, these are plain client-side functions, not
// server RPCs — transaction data lives in the browser's localStorage, not a
// server database. The name stayed as-is so the many files that only import
// the TxnInput type didn't need touching when the server-side password gate
// and SQLite store were removed in favor of local-only storage.

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
type StoredTxn = TxnInput & { id: string; created_at: string };

const STORAGE_KEY = "ss_transactions";

// Reserved account name for the one-click sample portfolio (src/lib/demo-data.ts).
// Chosen to be unmistakably not a real filename-derived account name, so it's
// self-explanatory even before the UI banner renders.
export const DEMO_ACCOUNT = "Demo Portfolio (Sample Data)";

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readAll(): StoredTxn[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredTxn[]) : [];
  } catch {
    return [];
  }
}

function writeAll(rows: StoredTxn[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
}

export async function listTransactions(opts?: { data?: { account?: string | null } }): Promise<StoredTxn[]> {
  const account = opts?.data?.account;
  const rows = readAll();
  const filtered = account ? rows.filter((r) => r.account === account) : rows;
  return filtered.slice().sort((a, b) => b.trade_date.localeCompare(a.trade_date));
}

export async function listAccounts(): Promise<string[]> {
  const set = new Set<string>();
  for (const r of readAll()) if (r.account) set.add(r.account);
  return Array.from(set).sort();
}

export async function addTransaction(opts: { data: TxnInput }): Promise<{ ok: true }> {
  const data = txnSchema.parse(opts.data);
  const rows = readAll();
  rows.push({ ...data, id: newId(), created_at: new Date().toISOString() });
  writeAll(rows);
  return { ok: true };
}

export async function bulkInsertTransactions(opts: { data: { rows: TxnInput[] } }): Promise<{ inserted: number }> {
  const parsed = z.array(txnSchema).max(5000).parse(opts.data.rows);
  const rows = readAll();
  const now = new Date().toISOString();
  for (const r of parsed) rows.push({ ...r, id: newId(), created_at: now });
  writeAll(rows);
  return { inserted: parsed.length };
}

export async function deleteTransaction(opts: { data: { id: string } }): Promise<{ ok: true }> {
  writeAll(readAll().filter((r) => r.id !== opts.data.id));
  return { ok: true };
}

export async function deleteAllTransactions(): Promise<{ ok: true }> {
  writeAll([]);
  return { ok: true };
}

export async function deleteAccount(opts: { data: { account: string } }): Promise<{ ok: true }> {
  writeAll(readAll().filter((r) => r.account !== opts.data.account));
  return { ok: true };
}
