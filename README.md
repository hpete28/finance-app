# 💰 Ledger — Self-Hosted Personal Finance Dashboard

Ledger is a self-hosted personal finance app (Mint-style) built with **React + Vite**, **Node.js + Express**, and **SQLite**.

It focuses on practical day-to-day workflows:
- import bank exports,
- auto-categorize with a rules engine,
- budget and analyze spending,
- track income patterns,
- and keep all data local.

---

## ✨ Current Feature Set

### Transactions
- CSV import with account auto-detection and deduplication.
- Powerful filtering (date range, account, category, type, amount text search, uncategorized).
- Inline edit (category, notes, tags, merchant/vendor).
- Split transactions across multiple categories.
- Bulk tools:
  - assign category,
  - append/replace tags,
  - bulk merchant tagging,
  - bulk income tagging,
  - bulk include/exclude from totals.
- Positive/negative amount color-coding.

### Categorization + Rules
- Category management (system + custom categories, colors, income flag).
- Rule engine (keyword + match type + priority).
- Re-apply rules to existing transactions.
- Auto-learn rules from consistent categorized history (with safety caps).

### Income Modeling
- Income sources tab (keyword match rules for incoming transactions).
- Income analytics include:
  - income-source matches,
  - transactions manually tagged as income,
  - transactions assigned to income categories.

### Analytics
- Category drill-down with chart + monthly table + transaction panel.
- Monthly spending breakdown (bar/pie) with drill-through.
- Year summary (income vs expense, monthly trend, category ranking).
- Cash flow (daily income/expense/net + running balance).
- Top merchants (uses vendor tag when present).
- Quick range date picker presets (this month, last month, 3/6 months, year, all time).

### Budgeting
- Envelope budgets per category/month.
- Optional rollover into next month.
- Budget calculations and summaries respect excluded transactions.

### Bills + Net Worth
- Bills/subscriptions tracker with upcoming due warning.
- Net worth module (accounts + manual assets/liabilities + snapshots/history).

### UX + State
- Dark/light theme.
- URL-synced filters/tabs for better Back/Forward behavior on key pages.
- Shared UI system (cards, modal, badges, toasts, empty states, spinners).

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- npm 9+

### 1) Install dependencies

```bash
npm run install:all
```

### 2) Start the app

```bash
npm run dev
```

- API: `http://localhost:3001`
- Client: `http://localhost:5173`

### 3) Import data

Use **Import Data** page in the UI, or call upload endpoints.

Supported starter filenames (auto-mapped):
- `BMO_CAD_CC_MASTER_TRANSACTIONS.csv`
- `BMO_US_CC_MASTER_TRANSACTIONS.csv`
- `TD_CAD_CC_MASTER_TRANSACTIONS.csv`
- `TD_CAD_Checking_MASTER_TRANSACTIONS.csv`

> You can re-import files safely; duplicates are skipped by `(account_id, date, description, amount)`.

---

## 🧱 Project Structure

```text
finance-app/
├── client/
│   ├── src/
│   │   ├── pages/          # Dashboard, Transactions, Budgets, Analytics, Bills, NetWorth, Settings, Import
│   │   ├── components/     # Sidebar + shared UI primitives
│   │   ├── stores/         # Zustand global app state
│   │   └── utils/          # api client + format helpers
│   └── vite.config.js
├── server/
│   ├── routes/             # transactions, categories, rules, analytics, budgets, bills, networth, income_sources, pdf_import
│   ├── services/           # csv parser + categorizer
│   ├── database.js         # schema + migrations + seed data
│   ├── setup.js            # initial setup helper
│   └── index.js            # API bootstrap
└── README.md
```

---

## 🗄 Database Overview

Core tables:
- `accounts`
- `transactions` (includes tags, income override, exclude flag, merchant/vendor)
- `transaction_splits`
- `categories` (including income category flag)
- `rules`
- `income_sources`
- `budgets`
- `bills`
- `recurring_patterns`
- `manual_assets`
- `net_worth_snapshots`

---

## 🔌 API Overview

### Transactions
- `GET /api/transactions`
- `GET /api/transactions/export.csv`
- `GET /api/transactions/:id`
- `PATCH /api/transactions/:id`
- `POST /api/transactions/bulk`
- `POST /api/transactions/:id/split`
- `GET /api/transactions/summary/monthly`

### Categorization
- `GET/POST/PATCH/DELETE /api/categories`
- `GET/POST/PATCH/DELETE /api/rules`
- `POST /api/rules/apply`
- `POST /api/rules/learn`

### Income sources
- `GET/POST/DELETE /api/income-sources`
- `GET /api/income-sources/preview`

### Analytics
- `GET /api/analytics/spending-by-category`
- `GET /api/analytics/monthly-trend`
- `GET /api/analytics/category-breakdown`
- `GET /api/analytics/month-transactions`
- `GET /api/analytics/merchant-search`
- `GET /api/analytics/top-merchants`
- `GET /api/analytics/cashflow`
- `GET /api/analytics/accounts-summary`
- `GET /api/analytics/year-summary`
- `GET /api/analytics/dashboard-summary`

### Budgets / Bills / Net Worth
- `GET/PUT /api/budgets`
- `POST /api/budgets/rollover`
- `GET/POST/PATCH/DELETE /api/bills`
- `GET /api/bills/recurring`
- `GET /api/networth/current`
- `POST /api/networth/snapshot`
- `GET /api/networth/history`
- `GET/POST/PATCH/DELETE /api/networth/assets`

### Import + health
- `POST /api/upload/transactions`
- `POST /api/upload/rules`
- `POST /api/setup/seed-rules`
- `GET /api/health`
- `POST /api/pdf-import/*` (PDF import utilities)

---

## ⚙️ Dev Notes

- Default CORS origin is `http://localhost:5173` (`server/index.js`).
- SQLite DB file is `server/finance.db`.
- Build client:

```bash
npm run build
```

- Start production server:

```bash
npm run start
```

---

## 🔒 Privacy

- Ledger is local-first: no cloud dependency by default.
- No telemetry/auth built in.
- Data remains in your local SQLite database unless you back it up/export it.
