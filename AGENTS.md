# PHASE 1 BUILD PROMPT — SIMPLIFY Billing, Income & Expense SaaS (with Job Tracking)
### Backend: Supabase · Frontend: React PWA · UI language: English

> Usage: save this file in the repo root as `AGENTS.md` / `CLAUDE.md` (or paste it as the first message to your coding agent). It is the single source of truth for Phase 1. Everything the agent needs is here.

---

## 0. HOW YOU MUST WORK

You are a senior full-stack engineer building **Phase 1** of a multi-tenant SaaS from scratch. Read this entire document before writing code.

1. **Plan first.** Output a short plan (milestones from §16), then execute milestone by milestone.
2. **Do not ask questions** unless you are blocked by something impossible to infer (missing credentials, broken tooling). If the spec is silent, choose the **simplest option that fits the principles in §2**, and append one line to `DECISIONS.md` (decision + reason). Then continue.
3. **No scope creep.** Anything in §15 is out of scope. Do not add features that are not in this document.
4. **Rules in §7 are authoritative.** When a screen description and a business rule conflict, §7 wins.
5. **Commit after every milestone** with a clear message. Before each commit run `supabase db reset`, the full DB test suite (pgTAP) and the frontend tests. Never leave the build broken.
6. **Write tests for all money logic, tenant isolation (RLS) and permissions** (details in §17). These are the places bugs hurt most.
7. At the end of each milestone, print a 5-line summary: what works, what was simplified, what is next.
8. Keep the UI **minimal**: no unnecessary text, badges or detail on any screen.
9. **There is NO custom backend server.** Supabase is the backend (Postgres + Auth + RLS + SQL functions + Edge Functions + Storage). Do not create Express/Nest/Spring/any API server.

---

## 1. PRODUCT IN ONE PARAGRAPH

A fast, simple billing + income + expense app for **small Indian businesses that do NOT use GST** (shops, service providers, document/government-service centres). Main goal: **save the owner's time** — a bill must be creatable in seconds, even when 100+ bills are made in a day. Optional **Job Management** lets service businesses track multi-step work per bill (e.g. Passport), send WhatsApp updates per step, watch deadlines, and calculate staff commission. It is a **PWA** used mostly on phones, with a white premium, consistent UI. **UI language is English only** for now (Hindi may be added later — see §4.8).

Money-flow vocabulary (use these exact module names in UI and code):

| Module | Direction | Meaning |
|---|---|---|
| **Receipt** | Money IN | Customer payment against bills, or any other income |
| **Payment** | Money OUT | Paid to a vendor/worker/subcontractor to get a job done |
| **Expense** | Money OUT | Business overhead not tied to a bill (rent, electricity, salary…) |
| **Capital Ledger (Loans)** | In & Out, non-operating | Loan/udhar taken from outside and repaid. NOT income, NOT expense |

---

## 2. NON-NEGOTIABLE PRINCIPLES

1. **Speed over completeness.** Fewest taps/fields. Smart defaults everywhere.
2. **Simple.** No GST, no inventory, no accounting jargon. Plain words.
3. **Mobile-first PWA**, fully responsive, touch-friendly.
4. **Multi-tenant with hard isolation** — enforced by Postgres Row Level Security, so one business can never see another's data even if the frontend has a bug.
5. **Money correctness** — no floating point arithmetic, no silent rounding, every balance reproducible from records. All money maths happens **in the database**, never trusted from the client.
6. **Consistent UI** — one design system, reused everywhere (§10).

---

## 3. TECH STACK & REPO LAYOUT

Use this stack. Log any deviation in `DECISIONS.md`.

### Backend = Supabase only
- **Postgres** (Supabase). Schema is changed **only** through **Supabase CLI migrations** in `/supabase/migrations` (never edit an applied migration; add a new one).
- **Auth:** Supabase Auth, email+password under the hood (login identifier is the mobile number, see §8.1).
- **Authorization:** **Row Level Security (RLS) enabled on EVERY table** in `public`.
- **Business logic:** **Postgres functions (plpgsql) called with `supabase.rpc()`** for every multi-step / transactional operation (invoices, receipts, allocation, jobs, commission, payouts…). Plain PostgREST access (`supabase.from(...)`) only for simple CRUD (§9).
- **Edge Functions** (Deno + TypeScript): only for tasks needing the service-role key — create a staff login, reset a staff password.
- **Storage:** private bucket `logos`, object path `{business_id}/logo.*`, policy restricted to that business.
- **Extensions:** `pgcrypto` (PIN hashing), `pg_cron` (nightly purge), `pgTAP` (DB tests).
- **Local dev:** `supabase start` (Docker). **Production:** a Supabase project.
- The **service-role key must never appear in frontend code or the bundle.** Frontend uses only the anon key + the logged-in user's JWT.

### Frontend
- React 18 + TypeScript + Vite
- `@supabase/supabase-js` v2; generate types with `supabase gen types typescript` (script: `npm run gen:types`) and use them everywhere
- Tailwind CSS + Radix primitives (shadcn/ui style components), lucide-react icons
- TanStack Query (server state), TanStack Virtual (long lists), React Router
- react-hook-form + zod (forms/validation)
- `vite-plugin-pwa` (Workbox), `@fontsource/inter` (self-hosted font)
- `qrcode.react` (UPI QR), `html2pdf.js` (client-side PDF from the same React invoice component), `date-fns`, `decimal.js` for money display/preview maths
- Vitest + React Testing Library; Playwright for 3–4 end-to-end flows
- Hosting suggestion: any static host (Cloudflare Pages / Vercel / Netlify). Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_LOGIN_EMAIL_DOMAIN`.

### Repo layout
```
/supabase
  /migrations      schema, RLS policies, SQL functions, cron
  /functions       create-staff-user, reset-staff-password (Edge Functions)
  /tests           pgTAP tests
  config.toml
/frontend          React PWA
/scripts           seed-dev.ts (creates demo auth users + data, uses service role, dev only), backup.sh
/DECISIONS.md      running log of your assumptions
/README.md         how to run, test, seed, deploy, back up
/.env.example
```

---

## 4. GLOBAL CONVENTIONS

4.1 **Tenancy & RLS.**
- Every business table has `business_id uuid NOT NULL DEFAULT app.current_business_id()` (indexed, FK to `businesses`). **The client never sends `business_id`.** RLS `WITH CHECK` also enforces it.
- Create helper functions in a private schema `app` (not exposed via the API): `app.current_member_id()`, `app.current_business_id()`, `app.current_role()`, `app.today()`. They are `SECURITY DEFINER`, `STABLE`, with `search_path` locked, and resolve the caller from `members` using `auth.uid()`.
- In policies write `(select app.current_business_id())` (wrapped in `select`) so Postgres evaluates it once per query (performance).
- **Every `SECURITY DEFINER` function in `public`** must: set `search_path = ''`, check the caller's role, and filter by `app.current_business_id()` explicitly (it bypasses RLS). `REVOKE EXECUTE … FROM anon, public`; grant to `authenticated` only.
- A CI/DB test must fail if any table in `public` has RLS disabled.

4.2 **IDs.** UUID primary keys (`gen_random_uuid()`).

4.3 **Money.** `numeric(14,2)` in DB. INR. All calculation (totals, discounts, balances, commission, reports) is done **in SQL**; rounding `ROUND(x, 2)` half-up. On the client convert values with `new Decimal(String(value))` and use `decimal.js` for any preview maths (e.g. live bill total) — the server **recomputes and is the source of truth**. Display with Indian grouping (`₹1,23,456`), hide `.00` when whole. Paise allowed.

4.4 **Dates/time.** Business timezone default `Asia/Kolkata` (`businesses.timezone`). Document dates are `date`; timestamps are `timestamptz` (UTC). "Today" is always `app.today()` (current date in the business timezone) — never the client's clock. Display format: `27 Oct 2026`.

4.5 **Financial Year (FY).** India FY = 1 Apr → 31 Mar, label `2026-27`. Immutable SQL function `fy_label(date)`. Every dated financial record stores `fy_label`.

4.6 **Audit fields** on every business table, filled by a shared trigger: `created_at, created_by (→ members.id), updated_at, updated_by, deleted_at, deleted_by`.

4.7 **Errors.** SQL functions raise exceptions like `RAISE EXCEPTION 'INVOICE_LOCKED' USING ERRCODE = 'P0001', DETAIL = '{"invoice_id":"…"}'`. The frontend maps `error.message` (the code) to a friendly English string from `en.json`. Unknown errors → one generic message.

4.8 **Language / i18n.** UI is **English only**. But **no hard-coded UI strings in components**: put every user-visible string in a central dictionary (`src/i18n/en.json`, accessed via a `t('key')` helper; `react-i18next` is fine). Format numbers/dates via `Intl` with `en-IN`. This makes adding Hindi later a translation-file task, not a refactor. Do NOT build a language switcher now.

4.9 **Pagination.** Default page size 30 via `.range()` (or limit/offset RPC params); search + filters server-side; infinite scroll on the client.

4.10 **Mobile numbers.** Indian 10-digit (`^[6-9]\d{9}$`). Accept input with `+91`/`0` prefix and normalise before saving. WhatsApp links use `91` + number.

---

## 5. ROLES & PERMISSIONS (hard-coded matrix in Phase 1)

Roles: **Owner** (also called Admin), **Accountant**, **Staff**. Enforce in **RLS policies and inside every SQL function**, and hide in the UI.

| Module | Owner | Accountant | Staff |
|---|---|---|---|
| Customers | Full | Full | Create + View |
| Services | Full | View | View |
| Invoices (Billing) | Full | Full | Create; view/print/share **own** invoices |
| Receipts | Full | Full | Create; view **own** |
| Payments (vendor) | Full | Full | — |
| Expenses | Full | Full | — |
| Capital Ledger (Loans) | Full | Full | — |
| Outstanding / Dues | Full | Full | View |
| Reports | Full | Full | — |
| Jobs | Full | View | View + tick steps |
| Job Types | Full (CRUD) | View | — |
| Staff Commission | Full | View all | View **own** |
| Settings, Members, Recently Deleted, Privacy PIN | Full | — | — |

"Own" = `created_by = app.current_member_id()`. A Staff member can exist **without login** (`can_login = false`, no auth user) so helpers who never use the app can still be assigned jobs and paid commission.

---

## 6. DATA MODEL

Every business table also has: `id uuid PK`, `business_id` (§4.1) and the audit fields (§4.6), unless noted. Create via migrations.

**businesses** — `name, owner_name, mobile, whatsapp, email, address, logo_path, business_type, upi_id, invoice_prefix (default 'INV-'), invoice_start_number (default 1), numbering_mode (CONTINUOUS|FY_RESET), default_terms_days (default 0), default_notes, footer_text, thermal_width (58|80), receipt_header, receipt_footer, job_management_enabled (default false), yellow_days (default 5), red_days (default 3), commission_trigger (default 'ON_COMPLETION' — only this value is implemented), timezone, plan (default 'FREE')`. (`businesses` has no `business_id` column; its `id` is the tenant id.)
**business_secrets** — `business_id PK, privacy_pin_hash` — **no client access at all** (no RLS policies for clients; only SECURITY DEFINER functions touch it).

**members** — `business_id, auth_user_id (nullable, unique), name, mobile, role (OWNER|ACCOUNTANT|STAFF), can_login, active`. Unique `(business_id, mobile)`. Staff/other creations go through Edge Functions (§8.1).

**customers** — `type (REGULAR|WALK_IN), name, mobile, whatsapp, email, address, notes, possible_duplicate (bool)`. Index `(business_id, mobile)` — **non-unique**.

**services** — `name, default_rate (nullable), category (nullable), active, is_job_type (bool), deadline_days (nullable), commission_percent (nullable)`.
**job_type_steps** — `service_id, position, name, whatsapp_message (nullable)`.

**invoice_counters** — `business_id, fy_label (or 'ALL'), last_number` — incremented with a row lock inside `create_invoice`/`create_receipt` (gap-free, race-free).

**invoices** — `number, fy_label, invoice_date, due_date, customer_id (nullable), party_name (snapshot, default 'Walk-in'), party_mobile (snapshot), subtotal, discount_type (NONE|FLAT|PERCENT), discount_value, discount_amount, total, paid_amount (denormalised, maintained in the same transaction), status (ACTIVE|CANCELLED), cancel_reason, notes`.
**invoice_items** — `invoice_id, service_id (nullable), description, quantity, rate, amount, is_job (bool), applicant_name`.

**receipts** — `number, fy_label, receipt_date, customer_id (nullable), amount, mode (CASH|UPI|CARD|BANK|CHEQUE), reference, kind (INVOICE_PAYMENT|OTHER_INCOME), income_category (nullable), unallocated_amount, notes`.
**receipt_allocations** — `receipt_id, invoice_id, amount`.

**vendors** — `name, mobile`.
**payments** (money out to vendors) — `fy_label, payment_date, vendor_id, description, invoice_id (nullable), amount, mode, notes`.

**expense_categories** — `name, system (bool — undeletable: 'Salary / Commission', 'Loan Interest')`.
**expenses** — `fy_label, expense_date, category_id, description, amount, mode, payee (text, nullable), staff_id (nullable), loan_repayment_id (nullable), notes`.

**loans** — `lender_name, amount, loan_date, interest_rate (nullable), notes`.
**loan_repayments** — `loan_id, repayment_date, principal, interest, mode, notes`.

**jobs** — `invoice_id, invoice_item_id, service_id (job type), job_type_name (snapshot), party_name, party_mobile (snapshots), applicant_name, amount, deadline_date, assigned_staff_id (nullable → members), commission_percent (snapshot), status (IN_PROGRESS|COMPLETED|CANCELLED), completed_at`.
**job_steps** — `job_id, position, name, whatsapp_message (snapshot), ticked (bool), ticked_at, ticked_by`.
**job_step_events** — `job_step_id, action (TICK|UNTICK), member_id, at`.

**commission_entries** — `job_id (unique), staff_id, base_amount, percent, amount, status (UPCOMING|EARNED|CANCELLED), earned_at`.
**staff_payouts** — `staff_id, amount, payout_date, mode, notes, expense_id`.

**whatsapp_templates** — `type (INVOICE|RECEIPT|REMINDER), body`.

Indexes: every foreign key plus list filters (`business_id + invoice_date`, `business_id + status`, `business_id + customer_id`, `business_id + deadline_date`, `business_id + mobile`).

### 6.1 RLS pattern (apply to every table)
- **SELECT:** `business_id = (select app.current_business_id()) AND deleted_at IS NULL` + role predicate from §5.
- **Ledger-critical tables are READ-ONLY for clients** — **no INSERT/UPDATE/DELETE policies**; they change only through SQL functions: `invoices, invoice_items, receipts, receipt_allocations, invoice_counters, jobs, job_steps, job_step_events, commission_entries, staff_payouts, loan_repayments`, and expenses that come from payouts/repayments. This guarantees a client can never tamper with totals, balances or numbering.
- **Direct client CRUD (RLS-guarded, role-checked)** only for: `customers, services, job_type_steps, vendors, payments, expense_categories (non-system), expenses (only rows with `staff_id IS NULL AND loan_repayment_id IS NULL`), loans, whatsapp_templates`, and Owner-only updates of `members` (non-auth fields) and `businesses` (via `update_business` RPC so `plan` and other protected columns cannot be changed by the client).
- Deletes on directly-writable tables are **soft deletes** (BR-18): the client sets `deleted_at` through the `soft_delete(table, id)` RPC (not a hard `DELETE`).

---

## 7. BUSINESS RULES (AUTHORITATIVE — implement in SQL functions)

**BR-1 Money flow & Profit.** Reports are **cash-basis**.
`Income = sum(all receipts)`. `Outgoing = sum(vendor payments) + sum(expenses)`. `Net Profit = Income − Outgoing`.
Loans and loan principal repayments are **excluded** from income, outgoing and profit. Loan **interest** paid is a normal expense (category "Loan Interest").

**BR-2 Invoice maths.** `amount = quantity × rate` per line; `subtotal = Σ amounts`; discount is FLAT ₹ or PERCENT of subtotal (never above subtotal); `total = subtotal − discount_amount`. No tax. "Round off" is NOT in Phase 1. The server recomputes everything; ignore any totals sent by the client.

**BR-3 Invoice status (derived).** `CANCELLED` if cancelled; else `PAID` if `paid_amount ≥ total`; `PARTIAL` if `0 < paid < total`; else `UNPAID`. **OVERDUE** is a flag: `balance > 0 AND due_date < app.today()`. `balance = total − paid_amount`. `paid_amount` must always equal the sum of its allocations (add a test that recomputes it).

**BR-4 Numbering & FY.** Invoice number = `prefix + [fy_label + '-' if FY_RESET] + zero-padded counter` (e.g. `INV-1001` or `INV-2026-27-0001`). Counter is per business (CONTINUOUS) or per business+FY (FY_RESET), incremented under a row lock inside the creating function. Receipts use the same FY logic with prefix `RC-`. `fy_label` derives from the document date. Outstanding is **derived across all FYs** — no carry-forward rows; FY reports show "opening outstanding" computed from earlier FYs.

**BR-5 Customers on a bill.**
- Customer is chosen by search, or **Walk-in**.
- Walk-in + **fully paid**: name/mobile **optional**. If both blank → `customer_id = NULL`, `party_name = 'Walk-in'`, no customer record is created.
- Walk-in with **balance > 0** (partial/unpaid): **name AND mobile are mandatory** → function raises `CUSTOMER_REQUIRED_FOR_DUE`.
- If the user fills name and/or mobile on a walk-in (optional or mandatory), create a customer record `type = WALK_IN` (searchable, has ledger). It can later be completed and switched to `REGULAR`.
- Invoice stores `party_name`/`party_mobile` snapshots.
- There is **no "Quick Customer"** type. Only REGULAR and WALK_IN.

**BR-6 Duplicate detection.** When creating/editing a customer (including via walk-in), look for an existing customer in the same business with the same normalised mobile (`check_customer_mobile`). If found, the UI shows a modal: existing name + current outstanding, buttons **Use existing** / **Create new anyway**. "Create new anyway" is allowed (families share numbers) and sets `possible_duplicate = true`. Never a hard block. (`create_invoice` accepts `force_new_customer`.)

**BR-7 Receipts & allocation (MANUAL).**
- A receipt has `amount`. Allocations to invoices are **entered manually by the user** (which invoices + how much each). Never auto-allocate or pre-tick invoices. The outstanding list is only **sorted oldest first**.
- `Σ allocations ≤ amount`, each allocation `≤` that invoice's balance, invoices must belong to the same customer.
- Save is allowed only if `unallocated = 0`, **or** all of that customer's outstanding balance is fully allocated and the remainder (>0) becomes **customer advance** (`unallocated_amount`). Otherwise raise `ALLOCATION_INCOMPLETE`.
- Shortcut: "Receive payment" opened **from an invoice** prefills that invoice with its full balance (the user can edit).
- Payment entered during bill creation creates a receipt + allocation in the **same transaction** as the invoice.
- **Advance**: customer advance = `Σ receipts.unallocated_amount` for that customer. On an invoice detail with a balance, if the customer has advance, show **Apply advance** (user chooses amount) → `apply_advance` creates an allocation from that receipt's unallocated amount.
- **OTHER_INCOME** receipts have `income_category` (defaults: Other Income, Interest Received, Refund Received, Commission Received, Other), optional customer, no allocations.
- Every receipt counts as income in reports (cash-basis), including advances.

**BR-8 Invoice edit / cancel.**
- No allocations yet → fully editable (`update_invoice`).
- Any allocation exists → invoice is **locked** (items, amounts, customer): raise `INVOICE_LOCKED`; only **Cancel** is allowed. Credit notes are **Phase 2**.
- **Cancel** (`cancel_invoice`): reason mandatory, status `CANCELLED`, record kept. Allocations are released: each affected receipt's `unallocated_amount` increases (becomes customer advance). The UI tells the user "₹X moved to customer advance". If the invoice has no customer record but had payments, require name + mobile first so an advance can be held. Cancelled invoices disappear from outstanding and active totals. Linked jobs → `CANCELLED`, commission → `CANCELLED`. (Refund-out flow is Phase 2.)
- Cancelled invoices cannot be deleted.

**BR-9 Deleting.** Customers (with no invoices), services, expenses, vendor payments, standalone receipts, loans, vendors can be **soft-deleted** (BR-18). Deleting a receipt that has allocations (`delete_receipt`) reverses them (invoice balance reopens) after a confirm dialog. Invoices are never deleted, only cancelled.

**BR-10 Vendor Payments.** Money out to a vendor for work. Optional link to an invoice (for job profitability). Vendor is picked by type-ahead; typing a new name creates the vendor inline. Vendor detail shows total paid + list. No vendor dues in Phase 1.

**BR-11 Loans (Capital Ledger).**
- *Loan received*: lender, amount, date, optional interest rate, notes. Does NOT touch receipts/income/profit.
- *Repayment* (`record_loan_repayment`): linked loan, date, `principal`, `interest`, mode. Principal is not an expense. If `interest > 0`, the function automatically creates an **Expense** in system category "Loan Interest" (linked via `loan_repayment_id`) in the same transaction.
- Per-lender ledger: Total Taken, Total Principal Repaid, **Outstanding = taken − principal repaid**. Dashboard shows "Loan Outstanding" as a separate line, never inside profit. (No cash-book in Phase 1.)

**BR-12 Job creation.** Job Management is a Settings toggle. A **Job Type is a service with `is_job_type = true`** (steps, `deadline_days`, `commission_percent`, per-step WhatsApp message). Job types appear in the invoice item picker together with normal services (small job icon). **One job-type line = one job**; quantity is fixed to 1 on such lines; the line has an optional **Applicant** field. Inside `create_invoice`, for each job-type line create a `job` plus **snapshot copies** of the steps (all unticked), `commission_percent`, `deadline_date = invoice_date + deadline_days`, `job_type_name`, party snapshots, `amount = line amount`. `assigned_staff_id` defaults to the creating member **if that member is STAFF**, else NULL; Owner can change it (`update_job`) and can edit the deadline per job. Editing the job type later **never** changes existing jobs.
- Editing an unpaid invoice: new job lines create jobs; a job line with any ticked step cannot be removed or have its type changed (`JOB_HAS_PROGRESS`); a COMPLETED job's line is locked.
- Cancelling an invoice cancels its jobs (BR-8).

**BR-13 Steps, completion, list order.**
- `tick_step` / `untick_step` toggle a step, recording member + time in `job_step_events`.
- When all steps are ticked → job `COMPLETED` (`completed_at` set) and leaves the Current list for the Completed tab. Unticking any step on a completed job reopens it.
- **Current Jobs sort order:** progress % (`ticked/total`) **descending**, then `deadline_date` ascending, then creation time. The list refreshes immediately after each tick.
- Completed tab: filter by **job type**, search by party / bill no / date range.
- **Step WhatsApp icon** appears next to a **ticked** step only if that step has a message AND the job has a party mobile. Clicking opens `https://wa.me/91<mobile>?text=<message>` with variables filled: `{party_name}, {job_name}, {applicant}, {bill_no}, {step_name}, {business_name}`. The user may edit text in WhatsApp before sending. No automatic sending.

**BR-14 Deadlines.** `days_left = deadline_date − app.today()`, for non-completed, non-cancelled jobs only.
- **Due Jobs tab:** all pending jobs, overdue first, then nearest deadline; with a clear alert style.
- **Red tab:** `days_left ≤ red_days` (default 3), **including overdue** (show "N days late").
- **Yellow tab:** `red_days < days_left ≤ yellow_days` (default 5).
- Red and Yellow are mutually exclusive. Limits are Settings values. Tabs show counts; Dashboard shows Red/Yellow counts that deep-link to the tab.

**BR-15 Commission.** On job creation, if `assigned_staff_id` is set and percent > 0, create a `commission_entries` row: `base_amount = job line amount` (bill-level discount ignored in Phase 1), `percent` snapshot, `amount = ROUND(base × percent / 100, 2)`, status `UPCOMING`. When the job becomes COMPLETED → `EARNED` (`earned_at`). If reopened → back to `UPCOMING`. On cancel → `CANCELLED`. Reassigning staff before completion moves the entry.

**BR-16 Staff views & payout.**
- Views (`staff_commission`): **Day-wise, Monthly, Yearly (by FY)**, per staff or all, based on `earned_at`. Drill-down lists every contributing bill/job: Bill No, Date, Party, Job Type, Amount, %, Commission, Status (Earned/Upcoming).
- Staff summary: **Total Earned, Total Paid, Balance Payable** (`Earned − Paid`). "Upcoming" is shown separately.
- **Pay Staff** (`pay_staff`): amount, date, mode → creates a `staff_payouts` row and an Expense in system category "Salary / Commission" (linked by `staff_id`/`expense_id`) in one transaction. No double entry.
- A Staff-role member sees only their own commission.

**BR-17 FY views & privacy PIN.** Dashboard and all reports default to the **current FY**. A "View previous years" control opens FY selection; if the Owner has set a 4-digit **Privacy PIN** (`set_privacy_pin`, stored with pgcrypto bcrypt in `business_secrets`), it must be entered (`verify_privacy_pin` returns true/false); the unlock lives in client memory for the session / 10 min idle. It is a **visible, standard UI privacy gate** — not hidden, and no data is removed or concealed from authorised users, exports or the API. If no PIN is set, there is no gate.

**BR-18 Soft delete & Recently Deleted.** Deleting sets `deleted_at` (via `soft_delete`). RLS SELECT policies exclude deleted rows. Owner-only **Recently Deleted** screen (`list_recently_deleted`) lists deletable types with **Restore** (`restore_record`). A `pg_cron` job runs nightly and permanently purges rows deleted > 30 days ago (respecting foreign keys).

**BR-19 UPI QR.** If the business has a `upi_id` and the invoice `balance > 0`, show a QR encoding
`upi://pay?pa=<upi_id>&pn=<business name>&am=<balance>&cu=INR&tn=<invoice number>` on the invoice view, A4 print, thermal print and PDF. Amount = **current balance**, regenerated on every render. QR only initiates payment; staff still records the receipt manually (no gateway in Phase 1).

**BR-20 WhatsApp.** Deep links only (`wa.me`). Templates for Invoice, Receipt, Reminder (editable in Settings, defaults seeded for every new business) with variables `{customer_name}, {invoice_no}, {amount}, {balance}, {due_date}, {business_name}`. On mobile, "Share PDF" uses the Web Share API with the generated PDF file when supported; otherwise download + open the WhatsApp text link. **Remind All** (Outstanding screen) is a queue: shows one customer at a time with prefilled reminder and **Send / Skip**.

---

## 8. MODULES — FUNCTIONAL SPEC & SCREENS

### 8.1 Auth, onboarding, members
- **Login identifier is the mobile number.** Internally map it to a synthetic email `91<mobile>@<VITE_LOGIN_EMAIL_DOMAIN>` in ONE helper (`mobileToEmail`) and use Supabase email+password. **Disable email confirmation** in Supabase Auth settings (no SMS/email cost). The real email (optional) is only profile data.
- **Register:** form (business name, owner name, mobile, password min 8) → `auth.signUp` → RPC `register_business` (creates business, Owner member, default expense/income categories, default WhatsApp templates, counters). If a signed-in auth user has no member row (interrupted signup) show a "Finish setup" screen that calls `register_business` again (idempotent).
- **Login:** mobile + password via `signInWithPassword`; supabase-js handles session/refresh. Rely on Supabase Auth built-in rate limits.
- **Staff/Accountant logins:** Owner adds a member in the UI → Edge Function `create-staff-user` (verifies the caller is an Owner from their JWT, creates the auth user with the service role, inserts the `members` row). A member with `can_login = false` gets no auth user. `reset-staff-password` lets the Owner set a new password for a member. Owner's own "forgot password" is Phase 2.
- Optional **setup wizard** (skippable, 3 screens): business info + logo, UPI ID, invoice prefix/starting number. All editable later in Settings.

### 8.2 Dashboard (Home) — one RPC `dashboard()` call
- **Today:** bills count, collection (receipts), vendor payments, expenses.
- **This month** (within current FY): income, outgoing (payments + expenses), net profit, total outstanding (receivable), **loan outstanding** (separate line).
- **Quick actions** (big buttons): + Bill, + Receipt, + Payment, + Expense, + Customer.
- **Job alerts** (only if Job Management on): Red count, Yellow count, pending jobs, completed today.
- **Alerts:** overdue payments count, due today count.

### 8.3 Customers
- List: search (name/mobile), filter Regular / Walk-in / Has dues; shows name and dues.
- Create/Edit form: name, mobile, WhatsApp (defaults to mobile), email, address, notes. Duplicate-mobile modal per BR-6.
- Profile tabs: **Overview** (billed, received, outstanding, advance), **Bills**, **Receipts**, **Ledger** (`customer_ledger`: invoices as debit, receipts as credit, running balance), **Notes**. Action: complete profile → Regular.

### 8.4 Services & Job Types
- **Services:** name, default rate (optional), category (optional), active. Billing allows free custom items too, so services are optional.
- **Job Types** (Owner; Settings → Job Management): name, default rate, deadline days (chips 8 / 10 / 15 / 20 + custom number), commission %, ordered **steps** (add / edit / delete / drag-reorder), per-step optional WhatsApp message with variable chips, active toggle. Deleting a type that has jobs → deactivate instead.

### 8.5 Billing — create bill (**most important screen; optimise ruthlessly**)
Single screen, top to bottom:
1. **Customer**: type-ahead (name/mobile) · "Walk-in" chip (default selected) · inline "+ New". For Walk-in, collapsed optional "Name / Mobile" inputs that auto-expand and become required when balance > 0 (BR-5).
2. **Items**: rows of *item (type-ahead of services + job types; typing free text makes a custom item) · qty · rate · amount*. Recent/frequent items (`frequent_services`, last 30 days) shown as one-tap chips. Job-type rows: qty locked to 1 and an optional Applicant field. Adding a row is one tap; the new row auto-focuses.
3. **Discount** (₹ or %), **Total** (live preview with decimal.js; server is final).
4. **Paid now** amount + mode chips (Cash, UPI, Card, Bank, Cheque; default = last used) and a **"Paid in full"** one-tap button. **Balance** shown live.
5. **Date** (today), **Due date** (date + business default terms), **Notes** (collapsed).
6. Buttons: **Save** (opens success sheet: View · Print · Share PDF · WhatsApp · New bill) and **Save & New** (saves and instantly resets the form with a non-blocking toast linking to the saved bill).
- One RPC call `create_invoice(payload)` does everything atomically (customer, invoice, items, number, receipt+allocation, jobs, commission) and returns the full invoice JSON.
- Extras: **Same as previous bill** (copies items of the selected customer's last bill, or last bill overall); draft **auto-saved locally** and restored after reload/crash; `Enter` moves to next field, `Ctrl/Cmd+Enter` saves; number keypad on amount fields; inline validation; optimistic UI so Save feels instant.
- Duplicate-customer warning is inline and never blocks entry.

### 8.6 Bills list & detail
- **List:** defaults to today; search by bill no / party; filters Paid · Partial · Unpaid · Overdue · Cancelled · date range / FY; virtualized infinite scroll; row = bill no, party, total, status dot (no big badges).
- **Detail:** header, items, totals, allocations (receipts applied), QR (if balance). Actions: **Receive payment**, Print, Share PDF, WhatsApp, **Edit** (only if no allocations), **Cancel**, **Apply advance**, and related **Jobs**.

### 8.7 Receipts (Money IN)
- **Receive payment**: choose customer → `outstanding_invoices` (oldest first, **nothing pre-ticked**) → type allocation per invoice → live "Unallocated" → amount, mode, reference/transaction id, date → `create_receipt` (rules BR-7). Success sheet: Print receipt · WhatsApp receipt.
- **Other income**: category, description, amount, date, mode, optional customer.
- List with search/filters; detail view; print/share.

### 8.8 Payments (Money OUT to vendors)
Form: vendor (type-ahead / inline create), description, optional linked invoice, amount, date, mode, notes. List + vendor detail (total paid + history).

### 8.9 Expenses (Money OUT)
Form: category (defaults seeded: Rent, Electricity, Internet, Salary, Travel, Marketing, Software/Subscriptions, Maintenance, Office Supplies, Other; add custom), description, amount, date, mode, payee (optional), notes. List with category/date filters. System categories "Salary / Commission" and "Loan Interest" cannot be deleted; expenses generated by payouts/repayments are read-only.

### 8.10 Capital Ledger (Loans)
Screens: **Loans** list with per-lender Taken / Repaid / Outstanding; add loan; add repayment (principal + interest split). Detail shows timeline.

### 8.11 Outstanding / Dues
Receivable list per customer (`dues_list`): total due, overdue amount, oldest due date; filters All · Due today · Due soon · Overdue · Regular · Walk-in. Tap → customer's unpaid invoices. Per-customer **Remind** (WhatsApp) and **Remind All** queue (BR-20).

### 8.12 Jobs (when enabled)
- **Tabs:** Current · Completed · Due · Yellow · Red (with counts) — all from `list_jobs`.
- **Current row:** party, job type, progress `3/7` with a thin progress line, small deadline colour dot. Search + job-type filter.
- **Job detail:** bill info at top (bill no, date, party, particular, applicant, amount, deadline, assigned staff), then the **steps checklist** (tap to tick; WhatsApp icon on ticked steps per BR-13).
- Owner can edit deadline and assigned staff on a job.

### 8.13 Staff & Commission
- **Staff list** (Owner): add/edit/deactivate (name, mobile, role, can_login/password).
- **Commission screen:** period switch Day / Month / Year(FY), staff filter, totals + drill-down (BR-16), **Pay Staff**, print / PDF / WhatsApp a staff statement.

### 8.14 Reports (RPC `report(type, params)`; each with FY selector, custom date range, print, CSV export)
Invoices (status wise) · Receipts (date/category/customer) · Vendor Payments (vendor/date, linked vs unlinked) · Expenses (category/date) · Outstanding (customer-wise, overdue) · Loans (lender-wise) · **Profit & Loss** (BR-1, with monthly trend) · Jobs (pending vs completed by type, overdue, average completion time) · Staff Commission (by staff/bill/period, Earned vs Paid vs Balance). Desktop = tables, mobile = cards. Excel (.xlsx) export is Phase 2; CSV now.

### 8.15 Search
Global header search via `global_search(q)`: customers (name/mobile), invoices (number/party), receipts (number). Debounced; grouped results.

### 8.16 Print
Same React components power screen, print and PDF. A4 invoice, 58/80 mm thermal invoice/receipt (CSS `@page`, width from settings). Includes logo (from Storage), business details, bill-to, items, totals, paid, balance, UPI QR (BR-19), footer notes. Print opens the browser print dialog.

### 8.17 Settings (Owner)
Business profile · Invoice (prefix, start number, numbering mode, default terms days, default notes, footer) · UPI ID · Receipt format (thermal width, header/footer) · WhatsApp templates · Members & Staff · Expense/Income categories · **Job Management** (on/off, job types, yellow days, red days) · **Privacy PIN** · Recently Deleted.

### 8.18 Backup & safety (Phase 1 scope)
- Soft delete + **Recently Deleted** + 30-day purge (BR-18).
- README section on backups: for production use a Supabase plan that includes **daily backups / PITR** (free projects do not give production-grade backups). Also provide `scripts/backup.sh` (`pg_dump` using the DB connection string) + cron example for an extra off-platform copy. No in-app "download my data" yet (Phase 2).

---

## 9. BACKEND SURFACE

### 9.1 Direct table access (supabase-js `.from()`, RLS-guarded)
Read: `customers, services, job_type_steps, vendors, payments, expense_categories, expenses, loans, whatsapp_templates, members, invoices (+ invoice_items), receipts (+ receipt_allocations), jobs (+ job_steps)`.
Write: only the tables listed in §6.1 as directly writable. **Everything else is read-only for clients.**

### 9.2 SQL functions (`supabase.rpc()`; all return `jsonb` unless noted)
```
register_business(business_name, owner_name, mobile)
update_business(payload)                       -- Owner; protected columns excluded
soft_delete(table, id)   restore_record(table, id)   list_recently_deleted()
check_customer_mobile(mobile, exclude_customer_id?)   -> matches with outstanding
create_invoice(payload)  update_invoice(id, payload)  cancel_invoice(id, reason)
   payload: { customer_id?, walk_in:{name?,mobile?}, force_new_customer?, invoice_date, due_date,
              discount_type, discount_value, notes,
              items:[{service_id?, description, quantity, rate, applicant_name?}],
              paid?:{amount, mode} }
create_receipt(payload)  delete_receipt(id)  apply_advance(invoice_id, receipt_id, amount)
   payload: { kind, customer_id?, amount, mode, reference?, receipt_date, income_category?,
              notes?, allocations:[{invoice_id, amount}] }
outstanding_invoices(customer_id)   customer_summary(customer_id)   customer_ledger(customer_id)
dues_list(filter, limit, offset)
record_loan_repayment(payload)      loans_summary()
list_jobs(tab, search, service_id, limit, offset)   job_detail(id)
update_job(id, deadline_date?, assigned_staff_id?)
tick_step(step_id)   untick_step(step_id)           -- return the updated job
staff_commission(staff_id?, period, from, to)   staff_summary(staff_id?, from, to)
pay_staff(payload)
dashboard()   report(type, params)   global_search(q)   frequent_services()
set_privacy_pin(pin)   verify_privacy_pin(pin) -> boolean
```
Return the full updated resource so the client can update its cache optimistically.

### 9.3 Edge Functions
`create-staff-user`, `reset-staff-password` (Owner-only; verify JWT; service-role key only in function secrets).

Document every function (purpose, params, errors) in `/supabase/README.md`.

---

## 10. DESIGN SYSTEM & UI RULES

- **Look:** white premium. Page background `#FFFFFF`, surfaces `#F7F8FA`, borders `#E5E7EB`, text `#111827`, muted `#6B7280`. **One accent** `#0F766E` (teal). Semantic: success `#16A34A`, warning/Yellow `#D97706`, danger/Red `#DC2626`. Cards radius 12px, soft shadow, 4px spacing scale.
- **Font:** Inter only. Body 15–16px, headings 18–24px, never below 13px.
- **Components:** build a small shared library first (Button, Input, Select, Combobox/type-ahead, Sheet/BottomSheet, Dialog, Tabs, ListRow, Card, EmptyState, Toast, Skeleton, AmountInput, StatusDot). All screens use only these. No one-off styles.
- **Minimal UI:** show only what the task needs; details on tap. Use small colour dots/icons for status, not large badges. No filler text, no decorative illustrations. Empty states = one line + one button.
- **Navigation:** mobile bottom nav `Home · Bills · Jobs* · Money · More` (*only if Job Management is on) with a prominent **+ Bill** floating button. `Money` = tabs Receipts · Payments · Expenses · Dues · Loans. `More` = Customers, Services, Staff, Reports, Settings, Recently Deleted. Desktop/tablet = left sidebar with the same items.
- **Mobile rules:** touch targets ≥ 44px, lists as cards on mobile / tables on desktop, forms use bottom sheets, numeric keypad for amounts, no horizontal scrolling.
- **Feedback:** skeleton loaders, optimistic updates, non-blocking toasts, inline validation. Destructive actions confirm once.
- **Accessibility:** labels on inputs, visible focus, colour never the only signal (pair dots with text/icon).

---

## 11. PWA & PERFORMANCE

- Installable: manifest (name, short name, icons 192/512 + maskable, theme colour), standalone display, splash, `vite-plugin-pwa` with an app-shell precache and stale-while-revalidate for static assets. **Online-first**: Supabase API calls are not cached by the service worker; when offline show a clear banner and keep unsent **drafts** locally. (Offline bill queue = Phase 2.)
- Targets: first load < 3 s on throttled 4G; interaction response < 100 ms perceived; bill list of 500+ rows scrolls smoothly (virtualization); search debounced 250 ms; Lighthouse PWA + Performance ≥ 90 on mobile.
- Code-split by route; lazy-load reports, print and PDF libraries.
- Backend: indexes per §6; one round-trip per screen where possible (embed related rows in `.select()`, or return a single `jsonb` from an RPC); no per-row queries inside SQL functions when a set-based query works.

---

## 12. PRINT / PDF / QR / WHATSAPP (implementation notes)

- One `InvoiceDocument` and one `ReceiptDocument` React component = single source for screen, print CSS and PDF (`html2pdf.js`).
- Thermal CSS: `@page { size: 58mm|80mm auto; margin: 0 }`, monospace-friendly layout, QR scaled to fit.
- QR via `qrcode.react` (SVG for crisp print).
- WhatsApp numbers → `wa.me/91XXXXXXXXXX`. URL-encode text. If a mobile number is missing, hide/disable WhatsApp actions.

---

## 13. SECURITY

- RLS on every `public` table; ledger-critical tables client-read-only (§6.1); `SECURITY DEFINER` functions follow §4.1 (locked `search_path`, explicit role + tenant checks, execute granted to `authenticated` only).
- Frontend holds only the anon key. **Service-role key only in Edge Function secrets / seed script.** Add a check (script or test) that the built frontend bundle does not contain the service-role key.
- Never trust client totals, dates ("today") or `business_id`; recompute/derive in SQL.
- Storage policies restrict `logos` objects to the owner's business folder.
- `.env.example` for all env vars; no secrets in the repo.
- Validate every function input (types, ranges, enums) and raise coded errors.

---

## 14. SEED DATA (dev only, `npm run seed` → `scripts/seed-dev.ts`, uses the service role + the SQL functions)

- Demo business with an Owner, an Accountant and two Staff users (with logins) plus one Staff without login.
- 8 sample services; **one job type "Passport"** with 7 example steps (Documents Received → Form Filled → Appointment Booked → Biometric Done → Police Verification → Passport Dispatched → Delivered), `deadline_days = 15`, `commission_percent = 10`, and short WhatsApp messages on a few steps; one more job type "PAN Card" (`deadline_days = 8`, 20%).
- ~30 customers, ~150 invoices across two FYs (mixed paid/partial/unpaid/overdue), receipts, vendor payments, expenses, one loan with a repayment, and jobs at different progress levels (including Red/Yellow ones).
- Default expense categories, income categories and WhatsApp templates are created by `register_business` for **every** new business (not only dev).

---

## 15. OUT OF SCOPE FOR PHASE 1 (DO NOT BUILD)

Any custom backend server (Express/Nest/Spring…) · Supabase Realtime subscriptions · GST/tax fields · inventory/stock · multiple businesses per login · payment gateway / auto payment confirmation · WhatsApp Business API / automatic sending · push notifications · offline bill queue/background sync · Hindi/any language switcher · subscription billing, plan limits or pricing tiers · recurring invoices · credit notes and refund-out flow · vendor payable dues · customer statement export · Excel (.xlsx) export · "Download my data" · attachments/photos on records · fully customisable permission matrix · full audit-log screen (only the job step event log) · fixed salary / advance adjustment for staff · per-staff commission overrides · owner forgot-password / OTP login · server-side PDF · cash book.
Keep the schema compatible with these (e.g. `plan` column exists) but build none of them.

---

## 16. BUILD ORDER (milestones) & ACCEPTANCE

**M0 — Scaffold.** `supabase init` + `supabase start`, Vite app, design tokens + shared component library, i18n dictionary, PWA shell, `gen:types` script, pgTAP set-up with the "every public table has RLS" test, README. *Accept:* fresh clone → `supabase start` + `npm run dev` shows an installable empty app.

**M1 — Auth, business, members, RLS.** `app.*` helper functions, `businesses/members`, `register_business`, login/register UI with the mobile→email helper, Edge Functions for staff, role-based RLS, `business_secrets`. *Accept:* pgTAP tenant-isolation and role tests pass for every existing table.

**M2 — Customers & Services.** CRUD with RLS, mobile normalisation, `check_customer_mobile` (BR-6), `soft_delete`, service type-ahead + `frequent_services`. *Accept:* duplicate modal flow works.

**M3 — Billing core.** `create_invoice/update_invoice/cancel_invoice` (BR-2/3/4/5/8), counters under concurrency, bills list/detail, the fast create-bill screen (§8.5) with local drafts. *Accept:* a full-paid walk-in bill takes ≤ 5 taps after opening the screen; 100 parallel creations produce unique gap-free numbers.

**M4 — Receipts, allocation, outstanding.** `create_receipt/delete_receipt/apply_advance`, `outstanding_invoices`, `dues_list`, `customer_ledger`. *Accept:* all allocation tests in §17.

**M5 — Payments, Expenses, Loans.** BR-9/10/11, categories incl. system ones, `record_loan_repayment` → interest expense. *Accept:* P&L excludes loan principal, includes loan interest.

**M6 — Job Management.** Job types + steps, job creation inside `create_invoice`, `list_jobs/job_detail/update_job/tick_step/untick_step`, tabs, deadline buckets, step WhatsApp links (BR-12/13/14). *Accept:* §17 job scenarios.

**M7 — Staff & Commission.** BR-15/16, `staff_commission/staff_summary/pay_staff`, commission screens. *Accept:* commission scenarios.

**M8 — Dashboard, Reports, Search, FY & PIN.** `dashboard`, `report`, `global_search`, BR-1/17. *Accept:* report totals match seed data computed independently in tests.

**M9 — Print, PDF, QR, WhatsApp.** A4 + thermal, QR (BR-19), Share PDF, templates, Remind All. *Accept:* QR amount equals the current balance after a partial payment.

**M10 — Safety & polish.** Soft delete + Recently Deleted + pg_cron purge, backup docs/script, empty/error/loading states, Lighthouse pass, Playwright flows, README, secret-leak check. *Accept:* §17 Definition of Done fully ticked.

---

## 17. TEST PLAN & DEFINITION OF DONE

**Must-have automated tests (pgTAP unless stated)**
1. *Tenant isolation:* a member of business A can neither read nor write business B's rows in any table, nor execute functions against B's ids (parametrised over all tables/functions).
2. *RLS completeness:* every table in `public` has RLS enabled; ledger-critical tables reject direct client INSERT/UPDATE/DELETE.
3. *Permissions:* each role's allowed/denied actions per §5, including Staff "own" rows.
4. *Invoice maths & status:* discount FLAT/PERCENT, rounding half-up, PAID/PARTIAL/UNPAID/OVERDUE, `paid_amount` always equals Σ allocations.
5. *Numbering:* CONTINUOUS vs FY_RESET, FY boundary (31 Mar → 1 Apr); **concurrency test** (Node script/Vitest firing parallel `create_invoice` calls) → no duplicates/gaps.
6. *Walk-in rules:* full-paid blank → no customer; partial blank → `CUSTOMER_REQUIRED_FOR_DUE`; name/mobile given → WALK_IN customer created.
7. *Allocation:* manual only; over-allocation rejected; `ALLOCATION_INCOMPLETE`; excess becomes advance; apply-advance; delete receipt reverses; cancel invoice releases to advance.
8. *Loans/P&L:* principal excluded; interest becomes expense.
9. *Jobs:* snapshot steps unaffected by later job-type edits; sort order by progress %; auto-complete/reopen; Red/Yellow bucket boundaries (`days_left` = 5, 4, 3, 0, −2); invoice-cancel cancels jobs.
10. *Commission:* UPCOMING → EARNED → UPCOMING on reopen; CANCELLED on cancel; payout creates expense; Balance = Earned − Paid; day/month/FY aggregation.
11. *Soft delete:* excluded from queries, restorable, purged after 30 days.
12. *Frontend unit tests (Vitest):* QR UPI URI string, `wa.me` URL + variable substitution, money formatting (`en-IN`), `mobileToEmail`.

**E2E (Playwright, against local Supabase):** (a) register → create bill (walk-in, full paid) → print preview; (b) partial bill → receive payment with manual allocation; (c) job bill → tick steps → job moves to Completed → commission shows; (d) mobile viewport run of (a).

**Definition of Done (Phase 1)**
- All milestones accepted; all tests green; `supabase db reset` + `npm run seed` work from a clean clone; README complete.
- Every screen works at 360 px width; no horizontal scroll; touch targets ≥ 44 px.
- No hard-coded UI strings outside `en.json`.
- No client-side money arithmetic with raw JS numbers; no table without RLS; no service-role key in the frontend bundle.
- `DECISIONS.md` lists every assumption you made.

---

## 18. FINAL DELIVERABLES

Working repo (`/supabase` migrations + functions + tests, `/frontend`, `/scripts`), seed script, function documentation (`/supabase/README.md`), README (run/test/seed/deploy/backup), `DECISIONS.md`, `.env.example`. When finished, print a checklist mapping each section of this document to done / simplified / skipped with reasons.
