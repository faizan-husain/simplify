# SIMPLIFY — Billing, Income & Expense SaaS (with Job Tracking)

A fast, simple billing + income + expense web application and PWA tailored for small Indian businesses that do not use GST (shops, service providers, document/government-service centres).

---

## 1. Prerequisites

- **Node.js**: v20+ (tested on Node v24)
- **PostgreSQL**: v15+ (local instance or Supabase project)
- **Supabase CLI** (optional for local Docker development)

---

## 2. Getting Started

### Clone & Install
```bash
git clone <repo-url>
cd Simplify

# Install root & frontend dependencies
npm install
npm --prefix frontend install
```

### Environment Configuration
Copy `.env.example` to `.env` in repo root and in `frontend/.env`:
```bash
cp .env.example .env
cp .env.example frontend/.env
```

Set the database connection string and Supabase credentials in `.env`:
```env
DATABASE_URL=postgresql://postgres:admin@localhost:5432/simplify_dev
VITE_SUPABASE_URL=http://localhost:54321
VITE_SUPABASE_ANON_KEY=your_anon_key
VITE_LOGIN_EMAIL_DOMAIN=simplify.local
```

---

## 3. Database Setup & Reset

Reset local database and apply all 10 migrations:
```bash
npm run db:reset
```

Run seed script (creates demo business, 8 services with Passport job type, 30 customers, 150 invoices, jobs, expenses, loans, staff payouts):
```bash
npm run seed
```

### Seed Demo Logins
| Role | Email ID | Mobile | Password | Privacy PIN | Notes |
|---|---|---|---|---|---|
| **Owner** | `owner@simplify.com` | `9876543210` | `password123` | `1234` | Full access to all modules, settings & reports |
| **Staff** | `staff@simplify.com` | `9876543211` | `password123` | — | Create bills, tick job steps, view own commission |
| **Staff (Offline)** | — | `9876543212` | — | — | Offline helper without app login, assigned jobs |

---

## 4. Running the App

### Start Full Project (Frontend + Backend Bridge)
With a single command, start both the Supabase API bridge (port 54321) and the frontend Vite PWA (port 5173):
```bash
npm run dev
# Backend running at:  http://localhost:54321
# Frontend running at: http://localhost:5173
```

Or run them individually in separate terminals:
- **Backend API bridge only:** `npm run bridge`
- **Frontend only:** `npm run dev:fe`

Build for production (generates PWA bundle in `frontend/dist`):
```bash
npm run build
```

---

## 5. Automated Tests

Run the full automated test suite (11 DB test suites + frontend unit tests):
```bash
npm test
```

Or run individually:
- **Database tests (pgTAP):** `npm run test:db`
- **Frontend unit tests:** `npm run test:fe`
- **Secret leak security audit:** `npm run secret-leak-check`

### Database Test Suites
1. `01_rls_completeness.sql` — Verifies RLS is enabled on 100% of tables in `public`.
2. `02_auth_business_rls.sql` — Tests multi-tenant isolation across businesses.
3. `03_customers_services_rls.sql` — Customer duplicate detection and soft-delete.
4. `04_billing_core.sql` — Cash-basis bill creation, invoice numbering lock, and cancellation.
5. `05_receipts_allocation.sql` — BR-7 allocation rules, customer advances, and ledger consistency.
6. `06_expenses_loans.sql` — Capital ledger exclusion from P&L and auto-creation of loan interest expense.
7. `07_job_tracking.sql` — Multi-step service tracking, step events, auto-completion, and reopening.
8. `08_staff_commission.sql` — Commission lifecycle (`UPCOMING` -> `EARNED`) and atomic `pay_staff`.
9. `09_dashboard_reports.sql` — Cash-basis P&L, global search, and Privacy PIN gating.
10. `10_print_pdf_templates.sql` — UPI QR deep-link URL and WhatsApp variable template rendering.
11. `11_safety_purge_restore.sql` — Soft-delete restoration and 30-day automated purge.

---

## 6. Backups & Disaster Recovery

- **Production Supabase:** Use a Supabase plan with **Daily Backups / Point-in-Time Recovery (PITR)**.
- **Off-platform backup script:** `scripts/backup.sh` creates compressed PostgreSQL dumps with a 7-day retention policy:
  ```bash
  chmod +x scripts/backup.sh
  ./scripts/backup.sh /path/to/backups
  ```
- **Nightly Cron Example:**
  ```cron
  0 2 * * * DATABASE_URL="postgresql://postgres:admin@localhost:5432/simplify_dev" /path/to/Simplify/scripts/backup.sh /var/backups/simplify >> /var/log/simplify_backup.log 2>&1
  ```

---

## 7. Architecture & Principles

- **Backend:** Supabase / PostgreSQL only. Strict prohibition on custom backend servers.
- **Tenant Isolation:** Enforced via PostgreSQL Row Level Security (RLS) on every table in `public`.
- **Money Correctness:** All financial arithmetic computed in PostgreSQL (`numeric(14,2)` half-up). Client uses `decimal.js` for live preview only.
- **Ledger Immutability:** Invoices, receipts, allocations, and jobs are read-only for clients via direct table access; changes must go through `supabase.rpc()`.
- **UI Design System:** Mobile-first PWA, modern premium `#FFFFFF` & `#F8FAFC` surfaces, `#0D2256` deep luxury navy accent, minimal clutter.
