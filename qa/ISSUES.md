# SIMPLIFY Billing SaaS — Pilot Audit Issues & Hardening Log

All issues identified during the comprehensive pilot audit (database tests, access matrix generation, access control attack scripts, and accounting accuracy audits) are logged below in accordance with the pilot audit rules.

---

### Issue 1: Superuser RLS Bypass in Local Dev Bridge (`scripts/local-dev-bridge.ts`)
- **ID:** `ISSUE-001`
- **Severity:** High
- **Role:** All roles
- **Where:** `scripts/local-dev-bridge.ts`
- **Steps to reproduce:**
  1. Send a request to `/rest/v1/customers` with an authenticated user JWT belonging to Business B.
  2. The bridge executed queries directly via a PostgreSQL connection established as user `postgres`.
- **Expected vs Actual:**
  - *Expected:* Postgres evaluates RLS policies (`app.current_business_id()`) and prevents Business B from seeing Business A's records.
  - *Actual:* PostgreSQL superusers bypass table RLS policies by default even when `FORCE ROW LEVEL SECURITY` is set, causing cross-tenant leakage during synthetic testing.
- **Evidence:** `Tenant B Owner cannot see Tenant A customers` failed with count > 0.
- **Fix:** Added `BEGIN; SET LOCAL ROLE authenticated; ... COMMIT;` (and `SET LOCAL ROLE anon`) inside all table and RPC routes, ensuring the session runs under non-superuser Postgres roles where RLS is strictly enforced.
- **Status:** ✅ Fixed & Verified in Phase B (`qa/reports/ACCESS.md`)

---

### Issue 2: Deactivated Staff Fallback in Dev Bridge
- **ID:** `ISSUE-002`
- **Severity:** Critical
- **Role:** Staff
- **Where:** `scripts/local-dev-bridge.ts` (`resolveEffectiveUser`)
- **Steps to reproduce:**
  1. Deactivate a staff member (`active = false`).
  2. Make an API call using that staff member's JWT.
- **Expected vs Actual:**
  - *Expected:* Immediately rejected with 401/403 (`UNAUTHORIZED` or `FORBIDDEN`).
  - *Actual:* Dev bridge fallback logic defaulted to the first active staff member if lookup was ambiguous, allowing deactivated staff to continue making requests.
- **Evidence:** Attack script test `Deactivated staff token is immediately rejected` initially resolved to an active staff member.
- **Fix:** Added explicit check in `resolveEffectiveUser`: if a member has `active = false` or `deleted_at IS NOT NULL`, immediately resolve to `{ userId: '', role: 'anon' }` which causes all protected RPCs and tables to reject the call.
- **Status:** ✅ Fixed & Verified in Phase B (`qa/reports/ACCESS.md`)

---

### Issue 3: Missing RBAC Validation on Financial RPCs (`cash_bank_summary`, `bank_ledger`, `purge_deleted_records`)
- **ID:** `ISSUE-003`
- **Severity:** High
- **Role:** Staff / Owner
- **Where:** `supabase/migrations/20261030000022_cash_and_bank_transfers.sql` & `supabase/migrations/20261031000026_safe_edit_and_delete_enhancements.sql`
- **Steps to reproduce:**
  1. Sign in as Staff.
  2. Call `rpc('cash_bank_summary')` or `rpc('bank_ledger')`.
- **Expected vs Actual:**
  - *Expected:* Staff has no access to overall business cash/bank balances or bank ledgers; should raise `FORBIDDEN`.
  - *Actual:* RPC did not check `app.current_role()`, allowing Staff to view total liquid funds and bank accounts.
- **Evidence:** Attack script test `Staff calling cash_bank_summary is FORBIDDEN` failed with status 200.
- **Fix:** Applied Migration 51 (`20261113000051_enforce_owner_role_on_financial_rpcs.sql`) adding `IF v_role NOT IN ('OWNER', 'ACCOUNTANT') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;` to `cash_bank_summary`, `bank_ledger`, and `purge_deleted_records`.
- **Status:** ✅ Fixed & Verified in Phase B (`qa/reports/ACCESS.md`)

---

### Issue 4: `create_team_member` Validation & Duplicate Email Handling
- **ID:** `ISSUE-004`
- **Severity:** Medium
- **Role:** Owner
- **Where:** `supabase/migrations/20261031000028_team_management_and_accountant_role.sql`
- **Steps to reproduce:**
  1. Call `create_team_member` with role other than `STAFF`.
  2. Call `create_team_member` with an email that already exists in `auth.users`.
- **Expected vs Actual:**
  - *Expected:* Only `STAFF` allowed to be created via this RPC; duplicate email raises `MEMBER_EXISTS`.
  - *Actual:* Invalid roles fell back to `STAFF` silently without validation error; duplicate email failed with an unformatted SQL unique violation.
- **Evidence:** Database test `supabase/tests/14_team_management_and_accountant_role.sql` failed on negative validation test cases.
- **Fix:** Applied Migration 50 (`20261113000050_fix_create_team_member_validation.sql`) explicitly enforcing `p_role = 'STAFF'` and checking for existing email before insertion.
- **Status:** ✅ Fixed & Verified in `test:db` (14/14 suites passing)

---

### Issue 5: PostgREST Representation Format in Local Bridge
- **ID:** `ISSUE-005`
- **Severity:** Medium
- **Role:** All roles
- **Where:** `scripts/local-dev-bridge.ts`
- **Steps to reproduce:**
  1. Execute `supabase.from('customers').insert({ ... }).select()` where payload is a single object.
- **Expected vs Actual:**
  - *Expected:* Supabase-js expects PostgREST to return a JSON array `[{ ... }]` unless `Accept: application/vnd.pgrst.object+json` (`.single()`) is supplied.
  - *Actual:* Dev bridge returned an unnested object `{ ... }`, causing `res.data[0]` to be `undefined`.
- **Evidence:** Golden scenario G3 threw `Cannot read properties of undefined (reading 'id')` on `res.data[0].id`.
- **Fix:** Updated POST and PATCH handlers in `scripts/local-dev-bridge.ts` to inspect `req.headers['accept']` and return an array by default, adhering to RFC/PostgREST standards.
- **Status:** ✅ Fixed & Verified in Phase C (`qa/reports/ACCURACY.md`)

