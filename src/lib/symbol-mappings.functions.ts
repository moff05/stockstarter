import { z } from "zod";

// NOTE: same as transactions.functions.ts — these are plain client-side
// functions backed by localStorage, not server RPCs. Filename kept so the
// files that only need the Mapping type didn't need touching.

export type Mapping = {
  id: string;
  cusip: string;
  ticker: string | null;
  name: string | null;
  asset_class: string | null;
};

const STORAGE_KEY = "ss_symbol_mappings";

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readAll(): Mapping[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Mapping[]) : [];
  } catch {
    return [];
  }
}

function writeAll(rows: Mapping[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
}

export async function listMappings(): Promise<Mapping[]> {
  return readAll().slice().sort((a, b) => a.cusip.localeCompare(b.cusip));
}

const upsertSchema = z.object({
  cusip: z.string().min(1),
  ticker: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  asset_class: z.string().nullable().optional(),
});

function upsertOne(rows: Mapping[], data: z.infer<typeof upsertSchema>): Mapping[] {
  const cusip = data.cusip.toUpperCase();
  const ticker = data.ticker ? data.ticker.toUpperCase() : null;
  const idx = rows.findIndex((r) => r.cusip === cusip);
  const next: Mapping = {
    id: idx >= 0 ? rows[idx].id : newId(),
    cusip,
    ticker,
    name: data.name ?? null,
    asset_class: data.asset_class ?? null,
  };
  if (idx >= 0) {
    const copy = rows.slice();
    copy[idx] = next;
    return copy;
  }
  return [...rows, next];
}

export async function upsertMapping(opts: { data: z.infer<typeof upsertSchema> }): Promise<{ ok: true }> {
  const data = upsertSchema.parse(opts.data);
  writeAll(upsertOne(readAll(), data));
  return { ok: true };
}

export async function bulkUpsertMappings(
  opts: { data: { rows: z.infer<typeof upsertSchema>[] } },
): Promise<{ inserted: number }> {
  const parsed = z.array(upsertSchema).max(2000).parse(opts.data.rows);
  if (!parsed.length) return { inserted: 0 };
  let rows = readAll();
  for (const r of parsed) rows = upsertOne(rows, r);
  writeAll(rows);
  return { inserted: parsed.length };
}

export async function deleteMapping(opts: { data: { id: string } }): Promise<{ ok: true }> {
  writeAll(readAll().filter((r) => r.id !== opts.data.id));
  return { ok: true };
}
