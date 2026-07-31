// Server-only Dropbox → SQLite sync core. The Dropbox folder is the source of
// truth: each Excel file = one account (filename sans extension). This
// reconciles the DB to the folder — new/changed files are re-imported, files
// that disappear have their account deleted. Only rows tagged source='dropbox'
// are ever touched, so a manual /upload is never clobbered.
//
// This module is server-only (imported via dynamic import() from
// sync.functions.ts, never by client code).

import { randomUUID } from "node:crypto";
import type { SyncSummary } from "./sync-types";

const SOURCE = "dropbox";

// In-memory state: last summary (status display) + per-account rev cache (skip
// re-parsing unchanged files on the 15-min poll) + in-flight coalescing.
let lastSummary: SyncSummary | null = null;
let inFlight: Promise<SyncSummary> | null = null;
const revCache = new Map<string, string>(); // account -> last imported Dropbox rev

function accountFromFilename(name: string): string {
  return name.replace(/\.(xlsx|xls)$/i, "").trim();
}

async function doSync(force: boolean): Promise<SyncSummary> {
  const { isDropboxConfigured, dropboxFolder, listFolder, downloadFile } = await import(
    "@/lib/dropbox.server"
  );
  const nowIso = new Date().toISOString();

  if (!isDropboxConfigured()) {
    lastSummary = { configured: false, folder: "", syncedAt: null, accounts: [], removed: [] };
    return lastSummary;
  }

  const folder = dropboxFolder();
  const summary: SyncSummary = {
    configured: true,
    folder,
    syncedAt: nowIso,
    accounts: [],
    removed: [],
  };

  const { getDb } = await import("@/lib/db.server");
  const { parsePortfolioExcel } = await import("@/lib/excel-import");
  const { CUSIP_SEED, isCusip } = await import("@/lib/symbol-resolver");
  const db = getDb();

  let files;
  try {
    files = await listFolder();
  } catch (e) {
    summary.error = e instanceof Error ? e.message : String(e);
    lastSummary = summary;
    return summary;
  }

  // Real account Excels only. A shared folder collects junk the execs never mean
  // as accounts: Office/Dropbox owner-lock files (~$Foo.xlsx), hidden dotfiles,
  // and in-progress uploads (.tmp/.crdownload/.partial). All of these otherwise
  // match the extension test and would surface as spurious failed "accounts".
  const excelFiles = files.filter(
    (f) =>
      /\.(xlsx|xls)$/i.test(f.name) &&
      !f.name.startsWith("~$") &&
      !f.name.startsWith(".") &&
      !/\.(tmp|crdownload|partial)$/i.test(f.name),
  );
  const seenAccounts = new Set<string>();

  const insertTxn = db.prepare(`
    INSERT INTO transactions (id, trade_date, symbol, description, action, quantity, price, amount, fees, account, notes, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const upsertMap = db.prepare(`
    INSERT INTO symbol_mappings (id, cusip, ticker, name, asset_class)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(cusip) DO UPDATE SET
      ticker = excluded.ticker, name = excluded.name,
      asset_class = excluded.asset_class, updated_at = datetime('now')
  `);

  for (const file of excelFiles) {
    const account = accountFromFilename(file.name);
    if (!account) continue;
    seenAccounts.add(account);

    // Skip unchanged files (same Dropbox rev) unless forced.
    if (!force && revCache.get(account) === file.rev) {
      summary.accounts.push({ account, file: file.name, status: "unchanged" });
      continue;
    }

    try {
      const buffer = await downloadFile(file.path);
      const parsed = parsePortfolioExcel(buffer, account);

      if (parsed.rows.length === 0) {
        // Parser produced nothing usable — an unrecognized format (one of the 2
        // TBD), an empty file, or an unreadable/corrupt workbook. Leave any
        // existing data for this account intact and report the first reason.
        summary.accounts.push({
          account,
          file: file.name,
          status: "unsupported",
          skipped: parsed.errors.length || undefined,
          error: parsed.errors[0] ?? "No transactions recognized in this file",
        });
        continue;
      }

      // Replace this account's Dropbox-sourced rows atomically.
      db.exec("BEGIN");
      try {
        db.prepare("DELETE FROM transactions WHERE account = ? AND source = ?").run(account, SOURCE);
        for (const r of parsed.rows) {
          insertTxn.run(
            randomUUID(), r.trade_date, r.symbol ?? null, r.description ?? null,
            r.action, r.quantity ?? 0, r.price ?? 0, r.amount,
            r.fees ?? 0, account, r.notes ?? null, SOURCE,
          );
        }

        // Seed CUSIP→ticker mappings from the built-in seed (same as /upload).
        const cusips = new Map<string, string>();
        for (const r of parsed.rows) {
          if (r.symbol && isCusip(r.symbol)) {
            const c = r.symbol.toUpperCase();
            if (!cusips.has(c)) cusips.set(c, (r.description ?? "").split(/\d/)[0].trim().slice(0, 80));
          }
        }
        for (const [cusip, desc] of cusips) {
          const seed = CUSIP_SEED.find((s) => s.cusip === cusip);
          upsertMap.run(randomUUID(), cusip, seed?.ticker ?? null, seed?.name ?? desc ?? null, seed?.asset_class ?? null);
        }

        db.exec("COMMIT");
      } catch (e) {
        try { db.exec("ROLLBACK"); } catch { /* ignore */ }
        throw e;
      }

      revCache.set(account, file.rev);
      summary.accounts.push({
        account,
        file: file.name,
        status: "imported",
        count: parsed.rows.length,
        // Non-zero => the file was partially incomplete (rows recognized but
        // skipped). Surfaced so a truncated import doesn't look fully clean.
        skipped: parsed.errors.length || undefined,
      });
    } catch (e) {
      summary.accounts.push({
        account,
        file: file.name,
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // Reconcile deletions: Dropbox-sourced accounts whose file is gone.
  const dbAccounts = db
    .prepare("SELECT DISTINCT account FROM transactions WHERE source = ? AND account IS NOT NULL")
    .all(SOURCE) as { account: string }[];
  for (const { account } of dbAccounts) {
    if (!seenAccounts.has(account)) {
      db.prepare("DELETE FROM transactions WHERE account = ? AND source = ?").run(account, SOURCE);
      revCache.delete(account);
      summary.removed.push(account);
    }
  }

  lastSummary = summary;
  return summary;
}

/** Run a sync, coalescing concurrent callers. `force` re-imports even unchanged files. */
export function runSync(force: boolean): Promise<SyncSummary> {
  if (inFlight) return inFlight;
  inFlight = doSync(force).finally(() => { inFlight = null; });
  return inFlight;
}

/** Cheap status read — returns the last summary without triggering a sync. */
export async function getStatus(): Promise<SyncSummary> {
  const { isDropboxConfigured, dropboxFolder } = await import("@/lib/dropbox.server");
  if (!lastSummary) {
    return {
      configured: isDropboxConfigured(),
      folder: dropboxFolder(),
      syncedAt: null,
      accounts: [],
      removed: [],
    };
  }
  return lastSummary;
}
