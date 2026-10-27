# Supabase Backend Architecture & Stored Functions

This document serves as the single source of truth for the database schema, stored procedures, RPCs, Row Level Security (RLS) policies, and maintenance routines for SIMPLIFY.

---

## 1. Core Principles & Isolation

1. **No Custom Backend Server:** Supabase (PostgreSQL + RLS + Functions + Edge Functions + Storage) is the sole backend.
2. **Hard Multi-Tenant Isolation:** Enforced via Postgres Row Level Security on **every table** in `public`:
   ```sql
   business_id = (SELECT app.current_business_id())
   ```
3. **Money Integrity:** All calculations use `numeric(14,2)` half-up rounding. All ledger tables (`invoices`, `invoice_items`, `receipts`, `receipt_allocations`, `jobs`, `job_steps`, `commission_entries`, `staff_payouts`, `loan_repayments`) are **READ-ONLY** for clients. All writes execute through transactional `SECURITY DEFINER` functions.
4. **Audit Columns:** Shared trigger `set_audit_fields()` automatically populates `created_at, created_by, updated_at, updated_by, deleted_at, deleted_by`.

---

## 2. Private Schema `app` Helpers

These functions are strictly private (`REVOKE ALL FROM anon, public; GRANT TO authenticated;`) and locked with `search_path = ''`:

- `app.current_member_id()` -> `uuid`: Resolves current member from `members` matching `auth.uid()`.
- `app.current_business_id()` -> `uuid`: Resolves current business tenant ID.
- `app.current_role()` -> `text`: Resolves user role (`OWNER`, `ACCOUNTANT`, `STAFF`).
- `app.today()` -> `date`: Returns today's date in the business's configured timezone (defaults to `Asia/Kolkata`).

---

## 3. Stored Postgres RPCs (Callable via `supabase.rpc()`)

### 3.1 Business & Profile
- `register_business(payload jsonb)`: Idempotently creates a new tenant, owner member, counters, default expense categories, and WhatsApp templates.
- `update_business(payload jsonb)`: Owner-only update of business profile, invoice configs, UPI ID, thermal print width, and job settings.
- `set_privacy_pin(pin text)`: Sets or changes the 4-digit bcrypt-hashed PIN in `business_secrets`.
- `verify_privacy_pin(pin text)` -> `boolean`: Validates a 4-digit PIN against `business_secrets`.
- `has_privacy_pin()` -> `boolean`: Checks if the business has configured a privacy PIN.

### 3.2 Customers & Services
- `create_customer(payload jsonb)` -> `uuid`: Creates regular or walk-in customer.
- `update_customer(id uuid, payload jsonb)`: Updates customer details.
- `check_customer_mobile(mobile text)` -> `jsonb`: Duplicate detection (BR-6) returning existing customer name and current outstanding.
- `customer_ledger(customer_id uuid)` -> `jsonb`: Chronological ledger of invoices, receipts, and running balance.
- `create_service(payload jsonb)` -> `uuid`: Creates standard service or job type with step snapshots.
- `update_service(id uuid, payload jsonb)`: Updates service details.
- `frequent_services()` -> `jsonb`: Returns most frequently billed services.

### 3.3 Invoicing & Billing (BR-2, BR-3, BR-4, BR-5, BR-8)
- `create_invoice(payload jsonb)` -> `jsonb`: Race-free, atomic invoice creation with row-locked counter, walk-in customer creation, line items, and optional immediate receipt allocation.
- `update_invoice(id uuid, payload jsonb)`: Updates an unpaid invoice. Raises `INVOICE_LOCKED` if allocations exist.
- `cancel_invoice(id uuid, reason text)`: Cancels invoice, unlocks allocations, and rolls payments over to customer advance. Linked jobs and commissions are marked `CANCELLED`.
- `list_invoices(filters jsonb)` -> `jsonb`: Paginated bills list with status dots and balance calculations.
- `invoice_detail(id uuid)` -> `jsonb`: Full invoice data, line items, receipts, and job links.

### 3.4 Receipts, Advances & Dues (BR-7)
- `create_receipt(payload jsonb)` -> `jsonb`: Records money IN with manual invoice allocation. Unallocated amount becomes customer advance.
- `delete_receipt(id uuid)`: Soft-deletes receipt and reverses all invoice allocations atomically.
- `apply_advance(customer_id uuid, invoice_id uuid, amount numeric)`: Allocates existing customer advance to open bill.
- `outstanding_invoices(customer_id uuid)` -> `jsonb`: Open unpaid/partial invoices ordered oldest first.
- `dues_list(search text)` -> `jsonb`: Active accounts receivable grouped by customer.

### 3.5 Expenses, Vendors & Capital Ledger (BR-10, BR-11)
- `record_vendor_payment(payload jsonb)` -> `uuid`: Money OUT to vendor for job supplies.
- `vendor_detail(vendor_id uuid)` -> `jsonb`: Total paid and payment history.
- `record_expense(payload jsonb)` -> `uuid`: Operating expense in non-system category.
- `record_loan(payload jsonb)` -> `uuid`: Capital borrowed (excluded from P&L).
- `record_loan_repayment(payload jsonb)` -> `jsonb`: Principal repayment (excluded from P&L) + interest payment (automatically creates linked "Loan Interest" expense).
- `loans_summary()` -> `jsonb`: Outstanding principal per lender and total interest paid.

### 3.6 Job Tracking & Commission (BR-12, BR-13, BR-14, BR-15, BR-16)
- `list_jobs(tab text, job_type_id uuid, search text)` -> `jsonb`: Current, Yellow (<5d), Red (<3d), and Completed tabs. Sorted by progress % descending, deadline ascending.
- `job_detail(job_id uuid)` -> `jsonb`: Job info, step statuses, and step event history.
- `tick_step(job_step_id uuid)`: Toggles step to ticked, records event, and auto-completes job if all steps are ticked.
- `untick_step(job_step_id uuid)`: Reopens completed job, reverts commission to `UPCOMING`.
- `update_job(job_id uuid, payload jsonb)`: Owner-only update of deadline and staff assignment.
- `staff_summary()` -> `jsonb`: Team commission balances (upcoming, earned, paid, balance payable).
- `staff_commission(staff_id uuid, period text)` -> `jsonb`: Commission breakdown. Staff can only access own entries.
- `pay_staff(staff_id uuid, amount numeric, mode text, notes text)`: Atomic payout recording and operating expense generation under "Salary / Commission".

### 3.7 Dashboard, Reports & Global Search (BR-1, BR-17)
- `dashboard()` -> `jsonb`: Today's cash receipts, active job alerts, and month cash-basis profit.
- `report(type text, params jsonb)` -> `jsonb`: Cash-basis P&L (`Income - Outgoing`), Invoices, Receipts, Dues, and Loan movements.
- `global_search(q text)` -> `jsonb`: Unified search across customers, bills, jobs, and services.

### 3.8 Documents & Deep Links (BR-19, BR-20)
- `upi_qr_url(invoice_id uuid)` -> `text`: Generates compliant `upi://pay` deep link for open balance.
- `render_whatsapp_template(type text, context jsonb)` -> `text`: Replaces variables in template with real values.

### 3.9 Safety & Retention (BR-18)
- `soft_delete(table text, id uuid)`: Sets `deleted_at = now()`.
- `restore_record(table text, id uuid)`: Clears `deleted_at`.
- `list_recently_deleted()` -> `jsonb`: Lists all soft-deleted records.
- `purge_deleted_records()` -> `jsonb`: Permanently removes records soft-deleted > 30 days ago in foreign-key order. Registered with `pg_cron` for nightly execution at 03:00.

---

## 4. Edge Functions

Located in `/supabase/functions/`:
- `create-staff-user`: Uses service role to create an auth user for staff with email `91<mobile>@<DOMAIN>`, inserting member record. Caller must be an Owner.
- `reset-staff-password`: Uses service role to set a new password for staff. Caller must be an Owner.

---

## 5. Running Migrations & Tests

- **Run all migrations:** `npm run db:reset`
- **Run all 11 pgTAP test suites:** `npm run test:db`
- **Audit secret leaks:** `npm run secret-leak-check`
