# Stryker mutation score — BEFORE (untouched `main` domain code)

- Date: 2026-11-01 22:22 (local) · Tool: Stryker.NET 4.13.0 (local tool, `.config/dotnet-tools.json`) · Base commit: `66cb3f9` (upstream main, no feature code)
- Command: `cd backend/tests/InvoiceApp.Tests && dotnet tool restore && dotnet stryker`
- Mutated project: `InvoiceApp.Domain` · Tests: 7 xUnit tests · Elapsed: 22 s

## Summary (Stryker markdown reporter, verbatim)

| File                  | Score  | Killed | Survived | Timeout | No Coverage | Ignored | Compile Errors | Total Detected | Total Undetected | Total Mutants |
| --------------------- | ------ | ------ | -------- | ------- | ----------- | ------- | -------------- | -------------- | ---------------- | ------------- |
| ApprovalService.cs    | 60.00% | 12     | 8        | 0       | 0           | 7       | 0              | 12             | 8                | 27            |
| DiscountCalculator.cs | 0.00%  | 0      | 0        | 0       | 17          | 5       | 0              | 0              | 17               | 22            |
| IInvoiceRepository.cs | N\/A   | 0      | 0        | 0       | 0           | 0       | 0              | 0              | 0                | 0             |
| Invoice.cs            | 0.00%  | 0      | 2        | 0       | 0           | 0       | 0              | 0              | 2                | 2             |
| InvoiceStatus.cs      | N\/A   | 0      | 0        | 0       | 0           | 0       | 0              | 0              | 0                | 0             |

## The final mutation score is 30.77%

### *Coverage Thresholds: high:80 low:60 break:0*

## Non-killed mutants in `ApprovalService.cs` (from the JSON report)

| Line | Mutation | Status | What it means |
|---|---|---|---|
| 23 | error message string → `""` | Survived | no test checks the Submit error text |
| 27 | `_repository.Update(invoice);` removed (Submit) | Survived | fake repository `Update` is a no-op, so persistence is never verified |
| 39 | `_repository.Update(invoice);` removed (Approve) | Survived | same gap: an approval that is never saved passes every test |
| 47 | reject-reason error string → `""` | Survived | message not asserted |
| 51 | `EnsurePending(invoice);` removed (Reject) | Survived | no test rejects an invoice that is not pending |
| 57 | `_repository.Update(invoice);` removed (Reject) | Survived | persistence not verified |
| 63 | not-found message → `""` | Survived | message not asserted |
| 70 | not-pending message → `""` | Survived | message not asserted |

`DiscountCalculator.cs` has no tests at all (17 NoCoverage); it is outside this feature and is kept in the report so the before/after comparison is honest.

**Takeaway for this feature:** rule R5 ("nothing about the invoice changes") cannot be proven with the current fake, because it never records `Update` calls. The feature work adds an `UpdateCalls` counter to `FakeInvoiceRepository` and asserts on it.
