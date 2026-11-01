# Stryker mutation score — AFTER (final)

- Date: 2026-11-01 23:44 (local) · Stryker.NET 4.13.0 · `stryker-config.json` identical to the BEFORE run (verified with `git diff`) · 114 unit tests · 32 s
- Command: `cd backend/tests/InvoiceApp.Tests && dotnet tool restore && dotnet stryker`

## Before vs after

| File | BEFORE (main @ `66cb3f9`) | AFTER run 1 (invalid, Safe Mode) | AFTER run 2 (refactor) | **AFTER final** |
|---|---|---|---|---|
| ApprovalService.cs | 60.00 % (12 killed / 8 survived) | "100.00 %" — all 39 `Approve` mutants dropped as CompileError | 100.00 % (52 / 0) | **100.00 % (52 / 0)** |
| ApprovalLimits.cs | — (did not exist) | N/A (0 mutants: switch over const patterns) | 100.00 % (4 / 0) | **100.00 % (4 / 0)** |
| DiscountCalculator.cs (outside the feature) | 0.00 % (17 no coverage) | 0.00 % | 0.00 % | **100.00 % (17 / 0)** |
| Invoice.cs | 0.00 % (2 survived) | 0.00 % | 0.00 % | **100.00 % (2 / 0)** |
| **Overall** | **30.77 %** | 50.00 % | 74.67 % | **100.00 %** |

## Final run — Stryker markdown reporter (verbatim)

| File                       | Score   | Killed | Survived | Timeout | No Coverage | Ignored | Compile Errors | Total Detected | Total Undetected | Total Mutants |
| -------------------------- | ------- | ------ | -------- | ------- | ----------- | ------- | -------------- | -------------- | ---------------- | ------------- |
| ApprovalDeniedException.cs | N\/A    | 0      | 0        | 0       | 0           | 0       | 0              | 0              | 0                | 0             |
| ApprovalLimits.cs          | 100.00% | 4      | 0        | 0       | 0           | 1       | 0              | 4              | 0                | 5             |
| ApprovalService.cs         | 100.00% | 52     | 0        | 0       | 0           | 14      | 0              | 52             | 0                | 66            |
| DiscountCalculator.cs      | 100.00% | 17     | 0        | 0       | 0           | 5       | 0              | 17             | 0                | 22            |
| IInvoiceRepository.cs      | N\/A    | 0      | 0        | 0       | 0           | 0       | 0              | 0              | 0                | 0             |
| Invoice.cs                 | 100.00% | 2      | 0        | 0       | 0           | 0       | 0              | 2              | 0                | 2             |
| InvoiceStatus.cs           | N\/A    | 0      | 0        | 0       | 0           | 0       | 0              | 0              | 0                | 0             |

## The final mutation score is 100.00%

### *Coverage Thresholds: high:80 low:60 break:0*

Console: `95 mutants created` · `20 mutants got status Ignored (Removed by block already covered filter)` · `Killed: 75 · Survived: 0 · Timeout: 0` · `The final mutation score is 100.00 %`.

## What changed between the runs

1. **Run 1 → run 2: behaviour-identical refactor, so the rules could be mutated at all.** Removing the right side of `LimitFor(role) ?? throw ...` made `limit` a `decimal?` that no longer compiled, and Stryker's Safe Mode silently removed every mutant in `Approve`. `limit` is now checked with an explicit `if (limit is null) throw ...` and used as `limit.Value`; `LimitFor` uses two plain comparisons instead of a `switch` over `const` patterns. All tests stayed green (93/93) before and after the refactor.
2. **Run 2 → final: tests for the two remaining files.** `DiscountCalculatorTests.cs` (labelled as outside the feature, decision D-42) and `InvoiceTests.cs` (empty-string defaults). No production code changed in this step.

## Killed mutants on the rule lines (examples, from the mutation-analyst agent)

| Rule | Mutant | Killed by (examples) |
|---|---|---|
| Two-approver threshold `>` | `invoice.Amount >= TwoApproverThreshold` | `Approve_DirectorAtOrBelowLimit_ApprovesAlone`, `Approve_ManagerAboveLimit_DeniesAndLeavesInvoiceUnchanged` |
| Role limit `>` | `invoice.Amount >= limit.Value` | `Approve_ManagerAtOrBelowLimit_Approves`, `Approve_DirectorAtOrBelowLimit_ApprovesAlone` |
| Same user (R4) | negated `string.Equals(FirstApprovedBy.Trim(), approver.Trim(), OrdinalIgnoreCase)` | 11 tests, e.g. `Approve_SecondApprovalBySameDirector_...`, `Approve_SameUserDifferentCaseUnderTurkishCulture_...` |
| Second approver must be a Director | `approverRole == DirectorRole` | `Approve_SecondApprovalByDifferentManager_...`, `Approve_SecondApprovalByDifferentDirector_...` |
| No authority | `limit is not null` | `Approve_RoleWithoutAuthorityOnFirstApprovedInvoice_...` and others |

All 8 BEFORE survivors in `ApprovalService.cs` (three removed `Update` calls, `EnsurePending` in `Reject`, four message strings) are now killed.

## What 100 % does not prove (stated on purpose)

Stryker generates no mutants for some details that matter to R4 and R5: the `StringComparison.OrdinalIgnoreCase` argument, the two `.Trim()` calls, and the field assignments in `Approve` / `Reject`. Those are covered by named tests and by **hand-applied mutants** recorded in `docs/evidence/test-review-step1.md` and `test-review-step2.md` (e.g. `CurrentCultureIgnoreCase` → 1 failing test, clearing decision fields before a throw → 3 failing tests, `Contains` instead of equality → 2 failing tests).
