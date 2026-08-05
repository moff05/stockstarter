# StockStarter

A beginner-friendly, self-hosted stock portfolio tracker. Upload a broker export and get real holdings, performance, income, and tax-loss insight — without needing to understand a brokerage statement to read it.

Reads broker export files (Excel or CSV), resolves holdings, fetches live prices from Yahoo Finance, and delivers analytics across performance, income, risk, and taxes. Runs as a **hosted web app** behind a shared-password gate. Accessible on web and mobile.

---

## Features

### Accounts
- One account per uploaded file — filename becomes the account name
- Sidebar account switcher: per-account views plus a consolidated "All accounts" view

### Dashboard
- Portfolio value over time (hybrid monthly/daily NAV chart)
- Holdings treemap with unrealized P&L coloring
- Allocation donut and sector breakdown
- Asset class bar chart
- Stat strip: total value, day change, portfolio beta, expected annual income

### Holdings
- Position table with avg cost, market value, unrealized P&L, beta, yield, and annual income
- Expandable tax lot rows (FIFO / HIFO toggle)

### Performance
- Time-weighted return (TWR) — removes distortion from contributions/withdrawals
- IRR (dollar-weighted, annualized)
- Benchmark overlay: S&P 500 or NASDAQ 100
- Sub-period breakdown table (one row per cash flow event)
- Performance attribution: $ gain/loss and contribution per position
- Risk metrics: annualized volatility, max drawdown, Sharpe ratio

### Income
- Dividend history per position pulled from Yahoo Finance
- TTM income, ex-dates, per-share amounts, shares held at record date

### Tax Loss Harvesting
- Full table sorted by largest unrealized loss
- Estimated tax savings at LT (20%) and ST (37%) rates
- Wash sale risk flag (buys within 30 days)

### Index Comparison
- Portfolio weight vs. S&P 500 or NASDAQ 100 weight, side by side

### Account Statement
- Period statement view with a date-range selector
- One-click PDF export

### AI Chat
- Ask questions about the portfolio in plain English
- Answers grounded in live holdings, prices, and transaction history
- Account-aware: ask about a specific account by name, or the whole portfolio

### Upload
- Drag-and-drop Excel or CSV import
- Auto-seeds CUSIP → ticker mappings; manual override via `/mappings`

---

## Access

Open the hosted URL in any browser (desktop or mobile) and sign in with the shared access password. There is nothing to install. The UI is responsive — on phones the nav collapses into a drawer, and "Add to Home Screen" makes it behave like an app.

New account data: upload an `.xlsx`/`.csv` file directly from `/upload`. Overwrite a file with the same name to update that account. Failed logins are rate-limited (5 attempts per IP → 15-minute lockout).

---

## Stack

| Layer | Choice |
|---|---|
| Runtime | Bun v1.3.14 |
| Framework | TanStack Start v1.167 (Vite-native) + React 19 |
| Router | TanStack Router (file-based) |
| Database | SQLite (`bun:sqlite`) — local cache, rebuilt from your uploads |
| Styling | Tailwind v4 + shadcn/ui |
| Charts | Recharts |
| Excel parsing | SheetJS (client-side) |
| PDF export | jsPDF + jspdf-autotable |
| Prices | Yahoo Finance (no API key required) |
| AI | Anthropic Claude (Haiku) |
| Hosting | Any Bun-capable host — Dockerfile included, Railway-tested |

---

## Running locally (dev)

Requires [Bun](https://bun.sh) v1.3+.

```bash
git clone https://github.com/moff05/stockstarter.git
cd stockstarter
bun install
bun dev
```

Opens at `http://localhost:5173`. The SQLite database is created automatically at `data/portfolio.db` on first run.

**AI chat (dev mode):** Create a `.env` file in the project root:
```
ANTHROPIC_API_KEY=sk-ant-...
```
Bun loads this automatically. Get a key at [console.anthropic.com](https://console.anthropic.com).

---

## Deployment

The production build is a standalone Bun server (`server/server.mjs`) that serves the built client and SSR handler behind a shared-password gate. Build with `bun run build` (outputs `dist/client` + `dist/server`), then `bun run start` to serve it. A `Dockerfile` is included for any container host; `railway.json` is there if you deploy to Railway specifically.

**Environment variables:**

| Variable | Purpose |
|---|---|
| `APP_PASSWORD` | Shared access-gate password (required; server refuses to start without it) |
| `ANTHROPIC_API_KEY` | AI chat |
| `DB_PATH` | SQLite path — point this at a persistent volume in production |

The gate rate-limits failed logins (5 attempts per IP → 15-min lockout). Mount a persistent volume for `DB_PATH` in production so the cache survives redeploys.

---

## Data & privacy

- Your broker export files are the source of truth. The server keeps a derived SQLite cache (`DB_PATH`), rebuilt from your uploads.
- The whole app sits behind a shared-password gate over HTTPS; only `/healthz` is public.
- Prices are fetched from Yahoo Finance on demand and cached in the database.
- No third-party telemetry. The `.env` file (dev API key) is gitignored.

---

## Architecture

```
src/
├── routes/_authenticated/
│   ├── dashboard.tsx       # NAV chart, treemap, allocation
│   ├── holdings.tsx        # Position table + tax lot rows
│   ├── performance.tsx     # TWR, IRR, attribution, risk
│   ├── income.tsx          # Dividend history
│   ├── tax-loss.tsx        # Harvesting list
│   ├── sp500.tsx           # Index comparison
│   ├── statement.tsx       # Account statement + PDF
│   ├── transactions.tsx    # Raw transaction list
│   ├── mappings.tsx        # CUSIP → ticker editor
│   └── upload.tsx          # File import
│
├── lib/
│   ├── portfolio.ts        # buildSnapshot() — average-cost holdings
│   ├── twr.ts              # TWR + IRR computation
│   ├── risk.ts             # Volatility, drawdown, Sharpe
│   ├── tax-lots.ts         # FIFO / HIFO lot tracking
│   ├── excel-import.ts     # Excel parser
│   ├── csv-import.ts       # Generic broker CSV parser
│   ├── prices.functions.ts # Yahoo Finance quotes + history
│   ├── performance.functions.ts # TWR server fn + NAV history
│   ├── db.server.ts        # SQLite schema + WAL setup
│   ├── chat.functions.ts   # AI chat context (account-aware) + Anthropic call
│   ├── account-filter.tsx  # Selected-account context (sidebar switcher)
│   └── cusip-seed.ts       # Built-in CUSIP → ticker seed
│
server/
└── server.mjs              # Standalone Bun server + shared-password gate, login
                            # rate-limiting, /healthz
```

---

## Accounting notes

- **Average-cost basis** across all lots (not lot-by-lot)
- BUY cost uses the statement's total cost figure, not `qty × price` (price can be $0 for funds)
- Statement formula: Ending Balance = Beginning Balance + Contributions − Distributions + Net Income
