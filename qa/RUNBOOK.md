# SIMPLIFY Billing SaaS — Pilot Operations Runbook
### Environment: Local Pilot / Staging & Production Readiness

This runbook documents operational procedures, incident response protocols, disaster recovery, and change management guidelines for SIMPLIFY Billing SaaS during pilot and production phases.

---

## 1. System Architecture Quick Reference
- **Backend**: PostgreSQL (Supabase) + Row Level Security (RLS) on all public tables + PL/pgSQL RPCs for business transactions.
- **Frontend**: React 18 PWA + TypeScript + Tailwind CSS + TanStack Query.
- **Security Boundary**: The client is completely untrusted. Hard isolation is enforced in PostgreSQL via `app.current_business_id()` and role checks. Direct table writes are blocked on ledger-critical tables.

---

## 2. Incident Classification & Response SLA

| Severity | Definition | Target SLA | Action Plan |
|---|---|---|---|
| **P1 - Critical** | Money discrepancy, ledger drift, tenant isolation breach, or data loss | < 1 hour | 1. Freeze new transactions if necessary.<br>2. Identify affected business/tenant.<br>3. Inspect `/qa/reports/ACCURACY.md` and database audit trails.<br>4. Deploy fix migration or restore from point-in-time backup. |
| **P2 - High** | Staff privilege escalation, broken receipt/bill print, wrong dashboard number | < 4 hours | 1. Patch RLS policy or RPC check via migration.<br>2. Run `npm run qa:pilot` to ensure zero regression.<br>3. Deploy hotfix. |
| **P3 - Medium** | Validation edge-case, minor UI misalignment, non-blocking bug | < 24 hours | Standard issue tracking in `/qa/ISSUES.md` and normal deployment cycle. |

---

## 3. Daily Pilot Reconciliation Procedure
At the end of every business day during the pilot:
1. Open `/qa/RECONCILIATION.csv`.
2. Reconcile **Physical Cash in Drawer** against in-app `cash_bank_summary -> cash.balance`.
3. Reconcile **Bank NetBanking closing balance** against `bank_ledger(bank_id)`.
4. Check that **Customer Dues** in system match customer bill book (`customer_ledger`).
5. Ensure **Workshop In-Progress Jobs** match physical rack job status.
6. Record any variance in `/qa/RECONCILIATION.csv`. Variance must strictly be **₹0.00**.

---

## 4. Automated Audit Execution
Before any deployment or after any bug fix, execute the comprehensive pilot audit:
```bash
npm run qa:pilot
```
This single command automatically executes:
1. **Database Test Suite**: 14 pgTAP suites verifying RLS completeness, money math, roles, and migration integrity.
2. **Access Matrix Catalog**: Generates `/qa/access-matrix.csv`.
3. **Phase B (Access Control Audit)**: Table sweep, RPC sweep, IDOR, parameter tampering, and deactivated token rejection.
4. **Phase C (Accounting Accuracy Audit)**: Golden Scenarios G1–G15, 10 Core Invariants, and 5,100 fuzz operations.

---

## 5. Backup & Restore Procedures

### Automated Database Backup
Run the backup script to create an encrypted, timestamped SQL dump:
- **Windows / PowerShell**:
  ```powershell
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  pg_dump -h 127.0.0.1 -p 5432 -U postgres -d simplify_dev -F c -b -v -f "backups/simplify_backup_$ts.dump"
  ```
- **Linux / Bash**:
  ```bash
  bash scripts/backup.sh
  ```

### Database Restore Procedure
In the event of data corruption or disaster recovery:
1. Stop the application server / dev bridge:
   ```bash
   # Terminate running app / node processes
   ```
2. Restore database from target dump:
   ```bash
   pg_restore -h 127.0.0.1 -p 5432 -U postgres -d simplify_dev --clean --if-exists -v "backups/simplify_backup_YYYYMMDD_HHMMSS.dump"
   ```
3. Run verification tests:
   ```bash
   npm run test:db
   npm run qa:pilot
   ```

---

## 6. Hotfix & Migration Guidelines
1. **Never edit an applied migration**:
   - Always create a new sequential migration file in `supabase/migrations/YYYYMMDDHHMMSS_description.sql`.
2. **Enforce Security Definer Best Practices**:
   - Every `SECURITY DEFINER` function in `public` must lock its search path: `SET search_path = ''`.
   - Explicitly enforce role authorization:
     ```sql
     IF (SELECT app.current_role()) NOT IN ('OWNER', 'ACCOUNTANT') THEN
       RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
     END IF;
     ```
   - Explicitly filter by `(SELECT app.current_business_id())`.
   - Revoke execution from `anon, public` and grant only to `authenticated`.
3. **Verify Zero Regressions**:
   - Run `npm run qa:pilot` and inspect generated reports in `/qa/reports/`.

