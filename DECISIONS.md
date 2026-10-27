# DECISIONS.md — Architecture & Implementation Decisions

This file tracks all assumptions, design decisions, and trade-offs made during the implementation of Phase 1, per §0.2 of AGENTS.md.

| Date | Milestone | Decision | Reason |
|---|---|---|---|
| 2026-10-27 | M0 | Execution policy workaround using `npm.cmd` and `npx.cmd` | PowerShell execution policy restricts `.ps1` wrapper scripts on this Windows system. |
| 2026-10-27 | M3 | `SELECT ... FOR UPDATE` on `invoice_counters` with fallback upsert | Guarantees race-free, gap-free invoice & receipt numbering across concurrent transactions. |
| 2026-10-27 | M3 | Client-side draft persistence in `localStorage` | Preserves in-progress bill in `NewBillPage` across reloads or accidental navigation. |
| 2026-10-27 | M4 | Strict BR-7 `ALLOCATION_INCOMPLETE` check & customer advance rollover | Prevents dangling unallocated payments while dues exist; safely holds advance when all bills are cleared. |
| 2026-10-27 | M4 | Atomic reversal in `delete_receipt` (reopening bill balances) | Guarantees ledger integrity when deleting receipts, preserving historical audit while resetting open balances. |
| 2026-10-27 | M5 | Auto-creation of "Loan Interest" expense inside `record_loan_repayment` | Enforces BR-1 & BR-11: principal is excluded from P&L, while interest is captured atomically as an operating expense. |
| 2026-10-27 | M5 | RLS restriction on `expenses` with `staff_id` / `loan_repayment_id` | Prevents clients from manually mutating or tampering with automated payout and repayment expenses. |
| 2026-10-27 | M5 | Dedicated DB triggers for `payments.fy_label` and `expenses.fy_label` | Guarantees financial year consistency from document date regardless of client or server write path. |
