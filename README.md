# 💰 Ledger — Self-Hosted Personal Finance Dashboard

A production-grade Mint replacement built with React + Node.js + SQLite. All data stays on your machine.

---

## ✨ Features

| Feature | Details |
|---------|---------|
| **Transaction Management** | Auto-categorization, split transactions, bulk edits, custom tags, rules engine |
| **Envelope Budgeting** | Category budgets with progress bars, rollover support, income vs expenses |
| **Bill Tracking** | Manual bills, subscription auto-detection (30-day cycle scanner), balance warnings |
| **Analytics** | Monthly trends, spending breakdown, cash flow report, top merchants |
| **Net Worth** | Asset/liability tracking, historical snapshots, manual asset entry |

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- npm 9+

### 1. Clone & Install

```bash
git clone <repo>
cd finance-app
npm run install:all
```

### 2. Set Up Rules & Import Data

Copy your CSV files and rules JSON into `server/data/`:

```
server/
  data/
    BMO_CAD_CC_MASTER_TRANSACTIONS.csv
    BMO_US_CC_MASTER_TRANSACTIONS.csv
    TD_CAD_CC_MASTER_TRANSACTIONS.csv
    TD_CAD_Checking_MASTER_TRANSACTIONS.csv
  default_rules.json   ← copy Transaction_Categorization_Rules.json here
```

Then run the one-time setup:

```bash
cd server
node setup.js ../data
```

This will:
- Initialize the SQLite database (`server/finance.db`)
- Seed all categorization rules
- Import all CSV files
- Auto-categorize all transactions

### 3. Start the App

```bash
# From the root:
npm run dev

# Or start manually:
cd server && npm run dev   # API on http://localhost:3001
cd client && npm run dev   # UI  on http://localhost:5173
```

Open **http://localhost:5173** 🎉

---

## 📁 Project Structure

```
finance-app/
├── server/                     # Express + SQLite backend
│   ├── index.js               # Entry point, routes registration
│   ├── database.js            # SQLite schema & initialization
│   ├── setup.js               # One-time setup script
│   ├── finance.db             # Your database (auto-created)
│   ├── default_rules.json     # ← Put your rules JSON here
│   ├── services/
│   │   ├── categorizer.js     # Auto-categorization engine
│   │   └── csvParser.js       # CSV parsing & deduplication
│   └── routes/
│       ├── transactions.js    # CRUD, bulk, split, summary
│       ├── categories.js      # Category management
│       ├── rules.js           # Rules engine CRUD + apply
│       ├── budgets.js         # Envelope budgets + rollover
│       ├── analytics.js       # Charts data endpoints
│       ├── bills.js           # Bills & subscription detection
│       └── networth.js        # Net worth + manual assets
│
└── client/                    # React + Vite + Tailwind frontend
    └── src/
        ├── App.jsx            # Router + layout
        ├── main.jsx           # Entry point
        ├── index.css          # Global styles + design system
        ├── stores/
        │   └── appStore.js    # Zustand global state
        ├── utils/
        │   ├── api.js         # Axios API client (all endpoints)
        │   └── format.js      # Currency, date formatters
        ├── components/
        │   ├── Sidebar.jsx    # Navigation sidebar
        │   └── ui/index.jsx   # Card, Modal, Badge, Toast, etc.
        └── pages/
            ├── Dashboard.jsx  # Overview with charts
            ├── Transactions.jsx  # Table with filters, split, bulk edit
            ├── Budgets.jsx    # Envelope budgeting UI
            ├── Analytics.jsx  # Charts & reports
            ├── Bills.jsx      # Bills + subscription detection
            ├── NetWorth.jsx   # Net worth tracking
            ├── Settings.jsx   # Categories + rules engine
            └── Import.jsx     # CSV + JSON upload UI
```

---

## 🗄 Database Schema

```
accounts            — BMO/TD account sources
categories          — System + custom categories (with parent/child)
rules               — Keyword → category mapping (editable)
transactions        — All transaction rows (deduplicated on import)
transaction_splits  — Split transaction child rows
budgets             — Monthly envelope budgets with rollover
bills               — Manual recurring bills
recurring_patterns  — Auto-detected subscription patterns
net_worth_snapshots — Historical net worth snapshots
manual_assets       — Home, car, other manual values
```

---

## 🔌 API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/transactions` | List with filter/page/sort |
| PATCH | `/api/transactions/:id` | Edit category, tags, notes |
| POST | `/api/transactions/bulk` | Bulk update multiple rows |
| POST | `/api/transactions/:id/split` | Split transaction across categories |
| GET | `/api/transactions/summary/monthly` | Income/expense by month |
| GET/PUT | `/api/budgets` | Envelope budgets (upsert) |
| POST | `/api/budgets/rollover` | Apply rollover to next month |
| GET | `/api/analytics/spending-by-category` | Pie chart data |
| GET | `/api/analytics/monthly-trend` | Bar chart data (18mo) |
| GET | `/api/analytics/cashflow` | Daily cash flow with running balance |
| GET | `/api/analytics/top-merchants` | Top merchant rankings |
| GET/POST | `/api/bills` | Bill CRUD |
| GET | `/api/bills/recurring` | Detected subscription patterns |
| GET | `/api/networth/current` | Live net worth calculation |
| POST | `/api/networth/snapshot` | Save today's snapshot |
| GET | `/api/networth/history` | Historical snapshots |
| POST/DELETE | `/api/networth/assets` | Manual asset CRUD |
| GET/POST | `/api/rules` | Rules engine CRUD |
| POST | `/api/rules/apply` | Re-run categorization |
| POST | `/api/upload/transactions` | CSV file upload |
| POST | `/api/upload/rules` | Rules JSON upload |

---

## 🎨 Design System

- **Font**: DM Serif Display (headings) + DM Sans (body) + JetBrains Mono (numbers)
- **Theme**: Deep navy dark with indigo accent and semantic color coding
- **Colors**: Green = income/safe, Amber = warning, Red = over/expenses, Indigo = primary
- **Animations**: Slide-up modals, bar-fill progress, fade-in pages

---

## 🔧 Adding More Data

You can re-import CSV files anytime — the importer **deduplicates** by (account, date, description, amount) so re-running is safe.

Via the UI: Navigate to **Import Data** and drag-drop your files.

Via CLI:
```bash
cd server
node setup.js /path/to/your/csv/folder
```

---

## 🛡 Privacy & Security

- All data is stored locally in `server/finance.db` (SQLite)
- No cloud sync, no telemetry, no accounts
- CORS is restricted to `localhost:5173` by default
- For LAN access, update the CORS origin in `server/index.js`
