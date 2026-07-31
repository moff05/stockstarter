// Shared types for the Dropbox sync — safe to import from client or server
// (no server-only dependencies).

export type AccountSyncResult = {
  account: string;
  file: string;
  status: "imported" | "unchanged" | "unsupported" | "error";
  count?: number;
  // Rows the parser recognized but had to skip (missing date, zero amount, etc.).
  // Non-zero on a partially-incomplete file — surfaced so it isn't silently truncated.
  skipped?: number;
  error?: string;
};

export type SyncSummary = {
  configured: boolean;
  folder: string;
  syncedAt: string | null;
  accounts: AccountSyncResult[];
  removed: string[];
  error?: string;
};
