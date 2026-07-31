import { CUSIP_SEED, seedLookup } from "./cusip-seed";
import type { Mapping } from "./symbol-mappings.functions";

/** A CUSIP is exactly 9 alphanumeric chars; a ticker is typically 1–5 letters. */
export function isCusip(s: string | null | undefined): boolean {
  if (!s) return false;
  return /^[0-9A-Z]{9}$/.test(s.toUpperCase());
}

export type ResolvedSymbol = {
  original: string;       // CUSIP or ticker exactly as stored on the transaction
  ticker: string | null;  // resolved ticker for pricing (null when unmappable)
  name: string | null;
  isMapped: boolean;
  source: "user" | "seed" | "passthrough" | "unmapped";
};

/** Build a fast lookup that prefers user mapping, then built-in seed, then passthrough. */
export function buildResolver(userMappings: Mapping[]) {
  const userMap = new Map<string, Mapping>();
  for (const m of userMappings) userMap.set(m.cusip.toUpperCase(), m);

  return function resolve(raw: string | null | undefined): ResolvedSymbol {
    const original = (raw ?? "").toUpperCase();
    if (!original) {
      return { original: "", ticker: null, name: null, isMapped: false, source: "unmapped" };
    }
    // If it's a regular ticker, just pass it through.
    if (!isCusip(original)) {
      return { original, ticker: original, name: null, isMapped: true, source: "passthrough" };
    }
    const u = userMap.get(original);
    if (u && u.ticker) {
      return { original, ticker: u.ticker.toUpperCase(), name: u.name, isMapped: true, source: "user" };
    }
    const s = seedLookup(original);
    if (s) {
      return { original, ticker: s.ticker, name: s.name, isMapped: true, source: "seed" };
    }
    return {
      original,
      ticker: null,
      name: u?.name ?? null,
      isMapped: false,
      source: "unmapped",
    };
  };
}

export { CUSIP_SEED };