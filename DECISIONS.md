# DECISIONS.md — Architecture & Implementation Decisions

This file tracks all assumptions, design decisions, and trade-offs made during the implementation of Phase 1, per §0.2 of AGENTS.md.

| Date | Milestone | Decision | Reason |
|---|---|---|---|
| 2026-10-27 | M0 | Execution policy workaround using `npm.cmd` and `npx.cmd` | PowerShell execution policy restricts `.ps1` wrapper scripts on this Windows system. |
