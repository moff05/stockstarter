import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type { SyncSummary, AccountSyncResult } from "./sync-types";

/** Run a Dropbox → DB sync. `force` re-imports even files whose rev is unchanged. */
export const syncDropbox = createServerFn({ method: "POST" })
  .inputValidator((d: { force?: boolean }) =>
    z.object({ force: z.boolean().optional() }).parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const { runSync } = await import("@/lib/sync.server");
    return runSync(!!data?.force);
  });

/** Read the last sync summary without triggering a new sync. */
export const getSyncStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { getStatus } = await import("@/lib/sync.server");
  return getStatus();
});
