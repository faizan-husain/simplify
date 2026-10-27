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

Reset local database and apply all migrations:
```bash
npm run db:reset
```

Run seed script (creates demo business, services, jobs, customers, invoices):
```bash
npm run seed
```

---

## 4. Running the App

Start the Vite development server:
```bash
npm run dev
# App will run at http://localhost:5173
```

Build for production:
```bash
npm run build
```

---

## 5. Automated Tests

Run the full automated test suite (database pgTAP/SQL tests + frontend Vitest):
```bash
npm test
```

Or run individually:
- **Database tests:** `npm run test:db`
- **Frontend tests:** `npm run test:fe`
- **Secret leak check:** `npm run secret-leak-check`

---

## 6. Backups

For production Supabase deployments, enable **Daily Backups / PITR**.
For off-platform backups, use `scripts/backup.sh`:
```bash
chmod +x scripts/backup.sh
./scripts/backup.sh
```
Or run directly via `pg_dump`:
```bash
pg_dump -Fc "$DATABASE_URL" > simplify_backup_$(date +%Y%m%d_%H%M%S).dump
```

---

## 7. Architecture & Principles

- **Backend:** Supabase / PostgreSQL only. No custom backend server.
- **Tenant Isolation:** Enforced via PostgreSQL Row Level Security (RLS) on every table in `public`.
- **Money Correctness:** All money arithmetic computed in SQL (`numeric(14,2)` half-up). Client uses `decimal.js` for live preview only.
- **Roles:** Owner, Accountant, Staff.
