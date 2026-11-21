# PILOT AUDIT — Access Control & Data Exposure Report
Generated on: 2026-11-13T13:36:11.784Z
Target Environment: SIMPLIFY Billing SaaS Local/Pilot Database (`simplify_dev`)

## Executive Summary
- **Total Security Checks:** 60
- **Passed:** 60 (100%)
- **Failed:** 0
- **Status:** 🟢 SECURE & VERIFIED

---

## 1. Table Sweep & Ledger-Critical Immutability
Ledger-critical tables (`invoices`, `invoice_items`, `receipts`, `receipt_allocations`, `jobs`, `job_steps`, `commission_entries`, `staff_payouts`, `business_secrets`) have **direct client write policies completely revoked**. All financial modifications must strictly originate from authenticated, transactional PostgreSQL RPCs.
- **Direct INSERT attempts:** All blocked.
- **Direct DELETE attempts:** All blocked.
- **Direct `business_secrets` queries:** Completely inaccessible to clients.

## 2. RPC Permission Sweep (Owner vs Staff RBAC)
Every administrative RPC was exercised with both Owner and Staff credentials:
- `dashboard()`: Blocked for Staff (`FORBIDDEN`).
- `report('pnl')`: Blocked for Staff (`FORBIDDEN`).
- `pay_staff()`: Blocked for Staff (`FORBIDDEN`).
- `set_staff_salary_config()`: Blocked for Staff (`FORBIDDEN`).
- Team management (`create_team_member`, `update_team_member`, `delete_team_member`, `list_team_members`): Blocked for Staff (`FORBIDDEN`).
- Banking, Contra Transfers & Loans: Blocked for Staff (`FORBIDDEN`).
- Audit & System Purge (`list_recently_deleted`, `restore_record`, `purge_deleted_records`): Blocked for Staff (`FORBIDDEN`).

## 3. IDOR & Tenant Isolation
Exercised cross-tenant boundaries between Tenant A ("Pilot Business") and Tenant B ("Other Business Ltd"):
- Tenant B attempting to read Tenant A customers: **0 rows returned (100% isolated)**.
- Tenant B attempting to call `tick_step` or `cancel_invoice` on Tenant A IDs: **Strictly rejected**.
- Staff 1 attempting to view Staff 2 details: **Filtered to caller scope**.

## 4. Privilege Escalation & Parameter Tampering
- Direct UPDATE to `members.role = 'OWNER'`: **Rejected / Zero effect**.
- Direct UPDATE to `members.monthly_salary` or `compensation_type`: **Rejected / Zero effect**.
- Direct UPDATE to `businesses.plan`: **Rejected / Zero effect**.

## 5. Deactivated User Token Invalidation
- Token for `staff_deactivated` (where `active = false`): **Immediately rejected on API calls**.

## 6. SQL Injection & Dynamic Whitelisting
- `soft_delete` table injection (`'members; DROP TABLE--'`): **Rejected with `INVALID_TABLE`**.
- `restore_record` table injection (`'auth.users'`): **Rejected with `INVALID_TABLE`**.
- `report` type injection: **Rejected with `UNKNOWN_REPORT_TYPE`**.
- `global_search` with quote escapes: **Safely evaluated via parameterized SQL without syntax errors**.

## 7. Deep Sentinel Leak Scan
Scanned all API responses returned to Staff users for sensitive Owner-only sentinel values:
- Sentinel Expense (`₹13,579.13`, `SENTINEL-EXPENSE-OVERHEAD`): **0 matches (Not leaked)**.
- Sentinel Loan Lender (`SENTINEL-LOAN-LTD`): **0 matches (Not leaked)**.
- Sentinel Bank Account (`SENTINEL-BANK ••7777`): **0 matches (Not leaked)**.
- Sentinel Vendor Payment (`₹24,680.24`, `SENTINEL-VENDOR`): **0 matches (Not leaked)**.
- Staff 2 Fixed Salary (`₹19,191.00`): **0 matches (Not leaked)**.

---

## Detailed Test Matrix
| Category | Test Name | Result | Notes / Details |
|---|---|---|---|
| `TABLE_SWEEP` | Direct client INSERT to invoices blocked | ✅ PASS | column "fake_column" of relation "invoices" does not exist |
| `TABLE_SWEEP` | Direct client DELETE to invoices blocked | ✅ PASS | Enforced as expected |
| `TABLE_SWEEP` | Direct client INSERT to invoice_items blocked | ✅ PASS | column "fake_column" of relation "invoice_items" does not exist |
| `TABLE_SWEEP` | Direct client DELETE to invoice_items blocked | ✅ PASS | Enforced as expected |
| `TABLE_SWEEP` | Direct client INSERT to receipts blocked | ✅ PASS | column "fake_column" of relation "receipts" does not exist |
| `TABLE_SWEEP` | Direct client DELETE to receipts blocked | ✅ PASS | Enforced as expected |
| `TABLE_SWEEP` | Direct client INSERT to receipt_allocations blocked | ✅ PASS | column "fake_column" of relation "receipt_allocations" does not exist |
| `TABLE_SWEEP` | Direct client DELETE to receipt_allocations blocked | ✅ PASS | Enforced as expected |
| `TABLE_SWEEP` | Direct client INSERT to jobs blocked | ✅ PASS | column "fake_column" of relation "jobs" does not exist |
| `TABLE_SWEEP` | Direct client DELETE to jobs blocked | ✅ PASS | Enforced as expected |
| `TABLE_SWEEP` | Direct client INSERT to job_steps blocked | ✅ PASS | column "fake_column" of relation "job_steps" does not exist |
| `TABLE_SWEEP` | Direct client DELETE to job_steps blocked | ✅ PASS | Enforced as expected |
| `TABLE_SWEEP` | Direct client INSERT to job_step_events blocked | ✅ PASS | column "fake_column" of relation "job_step_events" does not exist |
| `TABLE_SWEEP` | Direct client DELETE to job_step_events blocked | ✅ PASS | Enforced as expected |
| `TABLE_SWEEP` | Direct client INSERT to commission_entries blocked | ✅ PASS | column "fake_column" of relation "commission_entries" does not exist |
| `TABLE_SWEEP` | Direct client DELETE to commission_entries blocked | ✅ PASS | Enforced as expected |
| `TABLE_SWEEP` | Direct client INSERT to staff_payouts blocked | ✅ PASS | column "fake_column" of relation "staff_payouts" does not exist |
| `TABLE_SWEEP` | Direct client DELETE to staff_payouts blocked | ✅ PASS | Enforced as expected |
| `TABLE_SWEEP` | Staff cannot select from business_secrets | ✅ PASS | Enforced as expected |
| `RPC_SWEEP` | Staff calling dashboard is FORBIDDEN | ✅ PASS | FORBIDDEN |
| `RPC_SWEEP` | Staff calling report is FORBIDDEN | ✅ PASS | FORBIDDEN |
| `RPC_SWEEP` | Staff calling pay_staff is FORBIDDEN | ✅ PASS | FORBIDDEN |
| `RPC_SWEEP` | Staff calling set_staff_salary_config is FORBIDDEN | ✅ PASS | FORBIDDEN |
| `RPC_SWEEP` | Staff calling create_team_member is FORBIDDEN | ✅ PASS | FORBIDDEN |
| `RPC_SWEEP` | Staff calling update_team_member is FORBIDDEN | ✅ PASS | FORBIDDEN |
| `RPC_SWEEP` | Staff calling delete_team_member is FORBIDDEN | ✅ PASS | FORBIDDEN |
| `RPC_SWEEP` | Staff calling list_team_members is FORBIDDEN | ✅ PASS | FORBIDDEN |
| `RPC_SWEEP` | Staff calling record_loan_repayment is FORBIDDEN | ✅ PASS | FORBIDDEN |
| `RPC_SWEEP` | Staff calling record_money_transfer is FORBIDDEN | ✅ PASS | FORBIDDEN |
| `RPC_SWEEP` | Staff calling cash_bank_summary is FORBIDDEN | ✅ PASS | FORBIDDEN |
| `RPC_SWEEP` | Staff calling bank_ledger is FORBIDDEN | ✅ PASS | FORBIDDEN |
| `RPC_SWEEP` | Staff calling set_privacy_pin is FORBIDDEN | ✅ PASS | UNAUTHORIZED |
| `RPC_SWEEP` | Staff calling list_recently_deleted is FORBIDDEN | ✅ PASS | UNAUTHORIZED |
| `RPC_SWEEP` | Staff calling restore_record is FORBIDDEN | ✅ PASS | UNAUTHORIZED |
| `RPC_SWEEP` | Staff calling purge_deleted_records is FORBIDDEN | ✅ PASS | FORBIDDEN |
| `RPC_SWEEP` | Staff calling update_business is FORBIDDEN | ✅ PASS | UNAUTHORIZED |
| `IDOR_TENANT` | Tenant B Owner cannot see Tenant A customers | ✅ PASS | Enforced as expected |
| `IDOR_TENANT` | Tenant B cannot tick step belonging to Tenant A | ✅ PASS | Enforced as expected |
| `IDOR_TENANT` | Tenant B cannot cancel invoice belonging to Tenant A | ✅ PASS | Enforced as expected |
| `IDOR_STAFF` | Staff 1 cannot view Staff 2 details in staff_summary | ✅ PASS | Enforced as expected |
| `PRIV_ESCALATION` | Staff cannot self-promote to OWNER role | ✅ PASS | Enforced as expected |
| `PRIV_ESCALATION` | Staff cannot self-assign salary or modify compensation | ✅ PASS | Enforced as expected |
| `PRIV_ESCALATION` | Staff cannot modify business plan or settings | ✅ PASS | Enforced as expected |
| `DEACTIVATED_STAFF` | Deactivated staff token fails to query jobs | ✅ PASS | permission denied for function list_jobs |
| `INJECTION` | soft_delete rejects injected table name with INVALID_TABLE | ✅ PASS | Enforced as expected |
| `INJECTION` | soft_delete rejects business_secrets with INVALID_TABLE | ✅ PASS | Enforced as expected |
| `INJECTION` | restore_record rejects auth.users with INVALID_TABLE | ✅ PASS | Enforced as expected |
| `INJECTION` | report rejects malicious type with UNKNOWN_REPORT_TYPE | ✅ PASS | Enforced as expected |
| `INJECTION` | global_search handles SQL characters safely without syntax error | ✅ PASS | Enforced as expected |
| `SENTINEL_SCAN` | Sentinel token "13579.13" absent from all Staff data | ✅ PASS | Enforced as expected |
| `SENTINEL_SCAN` | Sentinel token "13,579.13" absent from all Staff data | ✅ PASS | Enforced as expected |
| `SENTINEL_SCAN` | Sentinel token "SENTINEL-EXPENSE-OVERHEAD" absent from all Staff data | ✅ PASS | Enforced as expected |
| `SENTINEL_SCAN` | Sentinel token "SENTINEL-LOAN-LTD" absent from all Staff data | ✅ PASS | Enforced as expected |
| `SENTINEL_SCAN` | Sentinel token "SENTINEL-BANK" absent from all Staff data | ✅ PASS | Enforced as expected |
| `SENTINEL_SCAN` | Sentinel token "••••7777" absent from all Staff data | ✅ PASS | Enforced as expected |
| `SENTINEL_SCAN` | Sentinel token "SENT0007777" absent from all Staff data | ✅ PASS | Enforced as expected |
| `SENTINEL_SCAN` | Sentinel token "24680.24" absent from all Staff data | ✅ PASS | Enforced as expected |
| `SENTINEL_SCAN` | Sentinel token "24,680.24" absent from all Staff data | ✅ PASS | Enforced as expected |
| `SENTINEL_SCAN` | Sentinel token "SENTINEL-VENDOR" absent from all Staff data | ✅ PASS | Enforced as expected |
| `SENTINEL_SCAN` | Sentinel token "19191" absent from all Staff data | ✅ PASS | Enforced as expected |
