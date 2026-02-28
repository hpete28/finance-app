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
- Advanced rule engine with transaction-context conditions:
  - description contains/equals/starts-with/regex,
  - merchant match,
  - amount exact/range,
  - amount sign (income/expense),
  - optional account/date filters.
- Rule actions:
  - assign category,
  - append/replace/remove tags,
  - set merchant name,
  - set income override / exclude-from-totals flags.
- Behavior controls: priority, enable/disable, stop-processing.
- Rule preview before save (match count estimate + sample transactions).
- Re-apply rules to existing transactions with overwrite controls.
- Auto-learn suggestion workflow (review + accept, confidence scored).

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

### AI Suggestions (Optional)
- Provider-aware AI suggestions with configurable providers.
- Gemini (API key) can be primary with Ollama fallback.
- AI health endpoint for availability/model checks.
- Transactions page AI suggestions for category/tag/merchant normalization.
- Suggestions are review-only and manually applied (never auto-mutates data).
- Graceful fallback when primary provider is down or AI is disabled.

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

### 2.1) Access from LAN or Tailscale

By default, Vite already listens on all interfaces, and the API now binds to `HOST=0.0.0.0`.

1. In `server/.env`, set CORS for every frontend origin you will use:

```bash
CORS_ORIGINS=http://192.168.68.61:5173,http://100.100.159.67:5173
```

2. Start the app:

```bash
npm run dev
```

3. Open from another device:
- LAN: `http://192.168.68.61:5173`
- Tailscale: `http://100.100.159.67:5173`

4. If it does not load, allow inbound TCP on Windows firewall for dev ports:

```powershell
netsh advfirewall firewall add rule name="Finance App 5173" dir=in action=allow protocol=TCP localport=5173
netsh advfirewall firewall add rule name="Finance API 3001" dir=in action=allow protocol=TCP localport=3001
```

### 2.2) Public internet access with Tailscale Funnel (authenticated)

This app has no built-in user accounts, so do not expose it publicly without auth.

1. Set in `server/.env`:

```bash
PUBLIC_BASIC_AUTH_USER=your_user
PUBLIC_BASIC_AUTH_PASS=your_strong_password
HOST=0.0.0.0
PORT=3001
```

2. Build client and run server in production mode:

```bash
npm run build
npm run start
```

3. Publish via Tailscale Funnel (HTTPS 443 -> local 3001):

```bash
tailscale funnel --bg --https=443 http://127.0.0.1:3001
tailscale funnel status
```

### 2.5) Optional AI provider setup

Create `server/.env` (or copy from `server/.env.example`). The server auto-loads this file on startup:

```bash
AI_FEATURES_ENABLED=true
AI_PRIMARY_PROVIDER=gemini
AI_FALLBACK_PROVIDER=ollama
AI_SHARE_AMOUNT=false
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-2.5-flash
GEMINI_TIMEOUT_MS=30000
OLLAMA_MAX_BATCH=80
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.1:8b
OLLAMA_TIMEOUT_MS=45000
OLLAMA_KEEP_ALIVE=15m
OLLAMA_MIN_CATEGORY_CONFIDENCE=0.72
```

Then verify:

```bash
curl http://localhost:3001/api/ai/status
```

If `available` is `false`, confirm your primary/fallback provider settings and model availability.

Note: the UI AI toggle is stored in browser localStorage and now defaults to enabled for first-time users.

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
- `PATCH /api/transactions/:id/lock`
- `POST /api/transactions/bulk`
- `POST /api/transactions/:id/split`
- `GET /api/transactions/summary/monthly`

### Categorization
- `GET/POST/PATCH/DELETE /api/categories`
- `GET/POST/PATCH/DELETE /api/rules`
- `POST /api/rules/preview`
- `POST /api/rules/apply`
- `POST /api/rules/learn`
- `POST /api/rules/learn/apply`
- `GET/POST /api/rulesets`
- `POST /api/rulesets/:id/activate`
- `POST /api/rulesets/:id/shadow-compare`
- `POST /api/rulesets/:id/extract-protected`
- `POST /api/rulesets/:id/cleanup/preview`
- `POST /api/rulesets/:id/cleanup/apply`

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
- `GET /api/ai/status`
- `POST /api/ai/suggestions/transactions`
- `POST /api/ai/rules/suggest` (scaffold)
- `POST /api/pdf-import/*` (PDF import utilities)

---

## Rules Engine Notes

### Evaluation order
- Rules are evaluated in deterministic order:
  1. tier rank (`manual_fix` -> `protected_core` -> `generated_curated` -> `legacy_archived` -> legacy tag compatibility)
  2. `priority DESC`
  3. `specificity_score DESC`
  4. source rank (`manual` before `learned` before legacy tag compatibility)
  5. `id ASC`
- Category assignment uses first-match-wins.
- Merchant, income-override, and exclude-from-totals use first-write-wins.
- Tag actions execute sequentially across matched rules.
- If a rule has `stop_processing = true`, evaluation stops after that match.
- Active rules are selected from the active `rule_set` (`rule_sets.is_active=1`), enabling shadow rollout and reversible cutover.

### Rule payload shape (API)
- `conditions`:
  - `description`: `{ operator, value, case_sensitive, match_semantics }`
  - `merchant`: `{ operator, value, case_sensitive, match_semantics }`
  - `amount`: `{ exact }` or `{ min, max }`
  - `amount_sign`: `any | income | expense`
  - `account_ids`: `number[]`
  - `date_range`: `{ from, to }`
- `actions`:
  - `set_category_id`
  - `tags`: `{ mode: append|replace|remove, values: string[] }`
  - `set_merchant_name`
  - `set_is_income_override`
  - `set_exclude_from_totals`
- `behavior`:
  - `priority`, `is_enabled`, `stop_processing`, `source`, `confidence`
  - `rule_set_id`, `rule_tier`, `origin`, `match_semantics`, `specificity_score`

### Backward compatibility
- Existing legacy `rules` rows still work (keyword + match type + category).
- Existing legacy `tag_rules` are still evaluated as compatibility tag append rules.
- Legacy data is auto-mapped into a default ruleset (`legacy_default`) during v3 migration.

### Manual recategorization modes
- `create_winning_rule` (default): updates the transaction and creates a high-priority tier-A (`manual_fix`) rule in the active ruleset.
- `one_off_only`: updates only that transaction and locks it without creating a global rule.
- Transaction locks (`lock_category`, `lock_tags`, `lock_merchant`) are respected by rule reapply/import categorization.

---

## ⚙️ Dev Notes

- Default CORS origins are `http://localhost:5173` and `http://127.0.0.1:5173` (`server/index.js`).
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

- Ledger is local-first by default, with optional cloud AI providers when configured.
- No telemetry/auth built in.
- Data remains in your local SQLite database unless you back it up/export it.
- You can enforce `AI_SHARE_AMOUNT=false` so amount fields are not sent to cloud providers.
