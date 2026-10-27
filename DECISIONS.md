# DECISIONS.md — Architecture & Implementation Decisions

This file tracks all assumptions, design decisions, and trade-offs made during the implementation of Phase 1, per §0.2 of AGENTS.md.

| Date | Milestone | Decision | Reason |
|---|---|---|---|
| 2026-10-27 | M0 | Execution policy workaround using `npm.cmd` and `npx.cmd` | PowerShell execution policy restricts `.ps1` wrapper scripts on this Windows system. |
| 2026-10-27 | M3 | `SELECT ... FOR UPDATE` on `invoice_counters` with fallback upsert | Guarantees race-free, gap-free invoice & receipt numbering across concurrent transactions. |
| 2026-10-27 | M3 | Client-side draft persistence in `localStorage` | Preserves in-progress bill in `NewBillPage` across reloads or accidental navigation. |
