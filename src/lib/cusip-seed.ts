/**
 * Built-in CUSIP → ticker seed.
 * Curated from public SEC/SPY/fund-family disclosures for the top US equities and the most
 * common mutual funds held in Fifth Third Securities accounts.
 * Users can always override on the /mappings page.
 */
export type SeedMap = { cusip: string; ticker: string; name: string; asset_class: string };

export const CUSIP_SEED: SeedMap[] = [
  // Mega-cap equities (top of SPY)
  { cusip: "037833100", ticker: "AAPL",  name: "Apple Inc.",                 asset_class: "EQUITY" },
  { cusip: "594918104", ticker: "MSFT",  name: "Microsoft Corp.",            asset_class: "EQUITY" },
  { cusip: "67066G104", ticker: "NVDA",  name: "NVIDIA Corp.",               asset_class: "EQUITY" },
  { cusip: "023135106", ticker: "AMZN",  name: "Amazon.com Inc.",            asset_class: "EQUITY" },
  { cusip: "30303M102", ticker: "META",  name: "Meta Platforms Inc.",        asset_class: "EQUITY" },
  { cusip: "02079K305", ticker: "GOOGL", name: "Alphabet Inc. Class A",      asset_class: "EQUITY" },
  { cusip: "02079K107", ticker: "GOOG",  name: "Alphabet Inc. Class C",      asset_class: "EQUITY" },
  { cusip: "88160R101", ticker: "TSLA",  name: "Tesla Inc.",                 asset_class: "EQUITY" },
  { cusip: "084670702", ticker: "BRK.B", name: "Berkshire Hathaway B",       asset_class: "EQUITY" },
  { cusip: "532457108", ticker: "LLY",   name: "Eli Lilly & Co.",            asset_class: "EQUITY" },
  { cusip: "46625H100", ticker: "JPM",   name: "JPMorgan Chase & Co.",       asset_class: "EQUITY" },
  { cusip: "92826C839", ticker: "V",     name: "Visa Inc.",                  asset_class: "EQUITY" },
  { cusip: "57636Q104", ticker: "MA",    name: "Mastercard Inc.",            asset_class: "EQUITY" },
  { cusip: "30231G102", ticker: "XOM",   name: "Exxon Mobil Corp.",          asset_class: "EQUITY" },
  { cusip: "478160104", ticker: "JNJ",   name: "Johnson & Johnson",          asset_class: "EQUITY" },
  { cusip: "931142103", ticker: "WMT",   name: "Walmart Inc.",               asset_class: "EQUITY" },
  { cusip: "742718109", ticker: "PG",    name: "Procter & Gamble Co.",       asset_class: "EQUITY" },
  { cusip: "166764100", ticker: "CVX",   name: "Chevron Corp.",              asset_class: "EQUITY" },
  { cusip: "00287Y109", ticker: "ABBV",  name: "AbbVie Inc.",                asset_class: "EQUITY" },
  { cusip: "92343V104", ticker: "VZ",    name: "Verizon Communications",     asset_class: "EQUITY" },
  { cusip: "17275R102", ticker: "CSCO",  name: "Cisco Systems",              asset_class: "EQUITY" },
  { cusip: "06051GFN4", ticker: "BAC",   name: "Bank of America Corp.",      asset_class: "EQUITY" },
  { cusip: "060505104", ticker: "BAC",   name: "Bank of America Corp.",      asset_class: "EQUITY" },
  { cusip: "00206R102", ticker: "T",     name: "AT&T Inc.",                  asset_class: "EQUITY" },
  { cusip: "437076102", ticker: "HD",    name: "Home Depot Inc.",            asset_class: "EQUITY" },
  { cusip: "58155Q103", ticker: "MCD",   name: "McDonald's Corp.",           asset_class: "EQUITY" },
  { cusip: "191216100", ticker: "KO",    name: "Coca-Cola Co.",              asset_class: "EQUITY" },
  { cusip: "713448108", ticker: "PEP",   name: "PepsiCo Inc.",               asset_class: "EQUITY" },
  { cusip: "149123101", ticker: "CAT",   name: "Caterpillar Inc.",           asset_class: "EQUITY" },
  { cusip: "12572Q105", ticker: "CMCSA", name: "Comcast Corp.",              asset_class: "EQUITY" },
  { cusip: "20030N101", ticker: "CMCSA", name: "Comcast Corp. Class A",      asset_class: "EQUITY" },
  { cusip: "91324P102", ticker: "UNH",   name: "UnitedHealth Group Inc.",    asset_class: "EQUITY" },
  { cusip: "254687106", ticker: "DIS",   name: "Walt Disney Co.",            asset_class: "EQUITY" },
  { cusip: "747525103", ticker: "QCOM",  name: "Qualcomm Inc.",              asset_class: "EQUITY" },
  { cusip: "458140100", ticker: "INTC",  name: "Intel Corp.",                asset_class: "EQUITY" },
  { cusip: "035710409", ticker: "AMD",   name: "Advanced Micro Devices",     asset_class: "EQUITY" },
  { cusip: "65339F101", ticker: "NFLX",  name: "Netflix Inc.",               asset_class: "EQUITY" },
  { cusip: "172967424", ticker: "C",     name: "Citigroup Inc.",             asset_class: "EQUITY" },
  { cusip: "949746101", ticker: "WFC",   name: "Wells Fargo & Co.",          asset_class: "EQUITY" },
  { cusip: "693475105", ticker: "PFE",   name: "Pfizer Inc.",                asset_class: "EQUITY" },
  { cusip: "58933Y105", ticker: "MRK",   name: "Merck & Co.",                asset_class: "EQUITY" },
  { cusip: "00724F101", ticker: "ADBE",  name: "Adobe Inc.",                 asset_class: "EQUITY" },
  { cusip: "68389X105", ticker: "ORCL",  name: "Oracle Corp.",               asset_class: "EQUITY" },
  { cusip: "92556H206", ticker: "VIPSX", name: "Vanguard Inflation-Protected", asset_class: "BOND_FUND" },

  // ETFs
  { cusip: "78462F103", ticker: "SPY",   name: "SPDR S&P 500 ETF",           asset_class: "ETF" },
  { cusip: "922908363", ticker: "VOO",   name: "Vanguard S&P 500 ETF",       asset_class: "ETF" },
  { cusip: "922908769", ticker: "VTI",   name: "Vanguard Total Stock Market", asset_class: "ETF" },
  { cusip: "46090E103", ticker: "QQQ",   name: "Invesco QQQ Trust",          asset_class: "ETF" },
  { cusip: "464287200", ticker: "IVV",   name: "iShares Core S&P 500",       asset_class: "ETF" },
  { cusip: "464287622", ticker: "AGG",   name: "iShares Core US Aggregate",  asset_class: "BOND_ETF" },

  // Common mutual funds seen in Fifth Third trust statements
  { cusip: "04314H568", ticker: "APHFX", name: "Artisan High Income Inst",   asset_class: "BOND_FUND" },
  { cusip: "277911491", ticker: "EIBLX", name: "Eaton Vance Floating-Rate I", asset_class: "BOND_FUND" },
  { cusip: "31761R393", ticker: "SMTHX", name: "ALPS/Smith Total Return Bond I", asset_class: "BOND_FUND" },
  { cusip: "74440B884", ticker: "PTRQX", name: "PIMCO Total Return Inst",    asset_class: "BOND_FUND" },
  { cusip: "89155T656", ticker: "TPINX", name: "Templeton Global Bond Adv",  asset_class: "BOND_FUND" },
];

export function seedLookup(cusip: string): SeedMap | undefined {
  return CUSIP_SEED.find((m) => m.cusip === cusip);
}