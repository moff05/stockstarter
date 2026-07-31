// Sector weights using exact names from getSector() (sector.ts).
// Source: SPDR (SPY) and Invesco (QQQ) factsheets, approximately June 2025.
// Each index sums to 100%. Update when sector drift becomes material (typically quarterly).

export const SPY_SECTOR_WEIGHTS: Record<string, number> = {
  "Technology":      30.5,
  "Financials":      14.5,
  "Healthcare":      11.5,
  "Cons. Disc.":     10.0,
  "Comm. Services":   9.2,
  "Industrials":      8.2,
  "Cons. Staples":    5.8,
  "Energy":           3.7,
  "Utilities":        2.7,
  "Materials":        2.1,
  "Real Estate":      1.8,
};

export const QQQ_SECTOR_WEIGHTS: Record<string, number> = {
  "Technology":      49.5,
  "Comm. Services":  15.5,
  "Cons. Disc.":     13.5,
  "Healthcare":       6.5,
  "Industrials":      5.0,
  "Cons. Staples":    4.5,
  "Financials":       4.0,
  "Utilities":        0.6,
  "Materials":        0.5,
  "Energy":           0.4,
};
