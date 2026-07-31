// GICS sector classification for common US equities + fund detection
// If a symbol isn't here, falls back to pattern matching then "Other"

const SECTOR_MAP: Record<string, string> = {
  // Communication Services
  GOOGL: "Comm. Services", GOOG: "Comm. Services", META: "Comm. Services",
  NFLX: "Comm. Services", DIS: "Comm. Services", CMCSA: "Comm. Services",
  VZ: "Comm. Services", T: "Comm. Services", CHTR: "Comm. Services",
  ATVI: "Comm. Services", EA: "Comm. Services", TTWO: "Comm. Services",

  // Consumer Discretionary
  AMZN: "Cons. Disc.", TSLA: "Cons. Disc.", HD: "Cons. Disc.",
  MCD: "Cons. Disc.", NKE: "Cons. Disc.", SBUX: "Cons. Disc.",
  TGT: "Cons. Disc.", LOW: "Cons. Disc.", BKNG: "Cons. Disc.",
  EBAY: "Cons. Disc.", APTV: "Cons. Disc.", F: "Cons. Disc.", GM: "Cons. Disc.",
  RCL: "Cons. Disc.", CCL: "Cons. Disc.", MAR: "Cons. Disc.", HLT: "Cons. Disc.",
  ORLY: "Cons. Disc.", AZO: "Cons. Disc.", DHI: "Cons. Disc.", LEN: "Cons. Disc.",

  // Consumer Staples
  WMT: "Cons. Staples", KO: "Cons. Staples", PG: "Cons. Staples",
  COST: "Cons. Staples", PEP: "Cons. Staples", PM: "Cons. Staples",
  MDLZ: "Cons. Staples", CL: "Cons. Staples", STZ: "Cons. Staples",
  MO: "Cons. Staples", EL: "Cons. Staples", KHC: "Cons. Staples",
  GIS: "Cons. Staples", HSY: "Cons. Staples", K: "Cons. Staples",

  // Energy
  XOM: "Energy", CVX: "Energy", COP: "Energy", SLB: "Energy",
  EOG: "Energy", PSX: "Energy", MPC: "Energy", VLO: "Energy",
  PXD: "Energy", DVN: "Energy", HAL: "Energy", BKR: "Energy",
  OXY: "Energy", FANG: "Energy", HES: "Energy", KMI: "Energy",

  // Financials
  JPM: "Financials", BAC: "Financials", WFC: "Financials", GS: "Financials",
  MS: "Financials", BLK: "Financials", C: "Financials", AXP: "Financials",
  "BRK.B": "Financials", "BRK.A": "Financials", V: "Financials", MA: "Financials",
  PFF: "Financials", RKT: "Financials", USB: "Financials", PNC: "Financials",
  SCHW: "Financials", COF: "Financials", TFC: "Financials", SPGI: "Financials",
  CME: "Financials", ICE: "Financials", CB: "Financials", MMC: "Financials",
  AON: "Financials", MET: "Financials", PRU: "Financials", ALL: "Financials",

  // Healthcare
  JNJ: "Healthcare", UNH: "Healthcare", PFE: "Healthcare", ABBV: "Healthcare",
  MRK: "Healthcare", LLY: "Healthcare", TMO: "Healthcare", ABT: "Healthcare",
  DHR: "Healthcare", BMY: "Healthcare", AMGN: "Healthcare", ISRG: "Healthcare",
  CVS: "Healthcare", CI: "Healthcare", HCA: "Healthcare", ELV: "Healthcare",
  GILD: "Healthcare", REGN: "Healthcare", VRTX: "Healthcare", ZTS: "Healthcare",
  BSX: "Healthcare", SYK: "Healthcare", BDX: "Healthcare", EW: "Healthcare",
  DXCM: "Healthcare", IDXX: "Healthcare", IQV: "Healthcare", A: "Healthcare",

  // Industrials
  CAT: "Industrials", GE: "Industrials", HON: "Industrials", MMM: "Industrials",
  BA: "Industrials", LMT: "Industrials", RTX: "Industrials", DE: "Industrials",
  UPS: "Industrials", FDX: "Industrials", PH: "Industrials", EMR: "Industrials",
  ITW: "Industrials", GD: "Industrials", NOC: "Industrials", ETN: "Industrials",
  CSX: "Industrials", NSC: "Industrials", UNP: "Industrials", WM: "Industrials",
  RSG: "Industrials", CTAS: "Industrials", FAST: "Industrials", PCAR: "Industrials",
  LIN: "Materials", // Linde — Materials not Industrials

  // Information Technology
  AAPL: "Technology", MSFT: "Technology", NVDA: "Technology", AMD: "Technology",
  AVGO: "Technology", ORCL: "Technology", CRM: "Technology", ADBE: "Technology",
  INTC: "Technology", QCOM: "Technology", TXN: "Technology", IBM: "Technology",
  ACN: "Technology", AMAT: "Technology", MU: "Technology", KLAC: "Technology",
  LRCX: "Technology", ADI: "Technology", MRVL: "Technology", CDNS: "Technology",
  SNPS: "Technology", FTNT: "Technology", PANW: "Technology", CRWD: "Technology",
  NOW: "Technology", SNOW: "Technology", PLTR: "Technology", DDOG: "Technology",
  NET: "Technology", ZS: "Technology", OKTA: "Technology", WDAY: "Technology",
  SMTHX: "Bond Funds",

  // Materials
  APD: "Materials", NEM: "Materials", FCX: "Materials",
  SHW: "Materials", ECL: "Materials", DD: "Materials", PPG: "Materials",
  NUE: "Materials", STLD: "Materials", ALB: "Materials",

  // Real Estate
  AMT: "Real Estate", PLD: "Real Estate", EQIX: "Real Estate",
  CCI: "Real Estate", SPG: "Real Estate", O: "Real Estate",
  WELL: "Real Estate", DLR: "Real Estate", PSA: "Real Estate",

  // Utilities
  NEE: "Utilities", DUK: "Utilities", SO: "Utilities", VST: "Utilities",
  AEP: "Utilities", SRE: "Utilities", D: "Utilities", EXC: "Utilities",
  XEL: "Utilities", ED: "Utilities", PCG: "Utilities", AWK: "Utilities",
};

// Mutual fund tickers are 5 chars total, last char X (e.g. PTRQX, APHFX)
const FUND_REGEX = /^[A-Z]{4}X$/;

// Bond/fixed-income mutual funds — show as "Bond Funds" instead of generic "Funds"
const BOND_FUNDS = new Set([
  "APHFX", "EIBLX", "PTRQX", "TPINX", "VIPSX",
  "PTTRX", "MWTRX", "DODIX", "LSBRX", "OSTIX",
  "FAGIX", "FBNDX", "FTBFX", "VBTLX", "VBLTX",
  "VBIRX", "VBIIX", "VBMFX", "VFIDX", "VWESX",
]);

const KNOWN_ETFS = new Set([
  "SPY", "QQQ", "IVV", "VOO", "VTI", "GLD", "SLV", "PFF",
  "TLT", "HYG", "LQD", "AGG", "BND", "VNQ", "XLE", "XLF",
  "XLK", "XLV", "XLI", "XLP", "XLU", "XLB", "XLRE", "XLC",
  "VIG", "SDY", "DVY", "VYM", "SCHD", "JEPI", "JEPQ",
]);

// Bond-oriented ETFs — classify as "Bond Fund" rather than "Equity Fund"
const BOND_ETFS = new Set([
  "TLT", "HYG", "LQD", "AGG", "BND", "BIL", "SHY", "IEF",
  "VCIT", "VCSH", "VMBS", "VGIT", "VGLT", "VGSH", "BNDX",
  "EMB", "IGIB", "IGHG", "MUB", "SJNK", "JNK",
]);

export function getSector(symbol: string): string {
  // Normalize BRK-B → BRK.B so Yahoo-hyphenated tickers hit the map
  const normalized = symbol.replace(/-/g, ".");
  const match = SECTOR_MAP[symbol] ?? SECTOR_MAP[normalized];
  if (match) return match;
  if (BOND_FUNDS.has(symbol)) return "Bond Funds";
  if (KNOWN_ETFS.has(symbol)) return "Funds";
  // 5-char tickers ending in X are mutual funds (e.g. APHFX, PTRQX)
  if (FUND_REGEX.test(symbol)) return "Bond Funds";
  return "Other";
}

export function getAssetClass(symbol: string): string {
  if (BOND_FUNDS.has(symbol) || FUND_REGEX.test(symbol)) return "Mutual Funds";
  if (KNOWN_ETFS.has(symbol)) return "ETFs";
  const normalized = symbol.replace(/-/g, ".");
  const match = SECTOR_MAP[symbol] ?? SECTOR_MAP[normalized];
  if (match && match !== "Funds" && match !== "Bond Funds") return "Equities";
  return "Other";
}

/**
 * 5-category allocation classification used on the dashboard allocation pie.
 * Equity Direct = individual stock
 * Equity Fund   = equity ETF or index fund
 * Bond Direct   = individual bond (rare in this setup)
 * Bond Fund     = bond ETF or bond mutual fund
 * Cash          = handled separately by the caller
 */
export function getAllocClass(symbol: string): "Equity Direct" | "Equity Fund" | "Bond Direct" | "Bond Fund" | "Other" {
  if (BOND_FUNDS.has(symbol) || FUND_REGEX.test(symbol)) return "Bond Fund";
  if (BOND_ETFS.has(symbol)) return "Bond Fund";
  if (KNOWN_ETFS.has(symbol)) return "Equity Fund";
  const normalized = symbol.replace(/-/g, ".");
  const match = SECTOR_MAP[symbol] ?? SECTOR_MAP[normalized];
  if (match) return "Equity Direct";
  return "Other";
}
