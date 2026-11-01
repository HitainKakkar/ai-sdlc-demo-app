# Stryker mutation score — AFTER, run 1 (feature code at C5 `2873b43`)

- Date: 2026-11-01 23:24 (local) · Stryker.NET 4.13.0 · same `stryker-config.json` as the BEFORE run · 93 unit tests · 24 s
- Command: `cd backend/tests/InvoiceApp.Tests && dotnet tool restore && dotnet stryker`

## Summary (Stryker markdown reporter, verbatim)

| File                       | Score   | Killed | Survived | Timeout | No Coverage | Ignored | Compile Errors | Total Detected | Total Undetected | Total Mutants |
| -------------------------- | ------- | ------ | -------- | ------- | ----------- | ------- | -------------- | -------------- | ---------------- | ------------- |
| ApprovalDeniedException.cs | N\/A    | 0      | 0        | 0       | 0           | 0       | 0              | 0              | 0                | 0             |
| ApprovalLimits.cs          | N\/A    | 0      | 0        | 0       | 0           | 0       | 0              | 0              | 0                | 0             |
| ApprovalService.cs         | 100.00% | 19     | 0        | 0       | 0           | 6       | 39             | 19             | 0                | 64            |
| DiscountCalculator.cs      | 0.00%   | 0      | 0        | 0       | 17          | 5       | 0              | 0              | 17               | 22            |
| IInvoiceRepository.cs      | N\/A    | 0      | 0        | 0       | 0           | 0       | 0              | 0              | 0                | 0             |
| Invoice.cs                 | 0.00%   | 0      | 2        | 0       | 0           | 0       | 0              | 0              | 2                | 2             |
| InvoiceStatus.cs           | N\/A    | 0      | 0        | 0       | 0           | 0       | 0              | 0              | 0                | 0             |

## The final mutation score is 50.00%

### *Coverage Thresholds: high:80 low:60 break:0*

## Why this run is NOT the real "after" score

The log shows what happened (verbatim):

```
[23:25:03 WRN] An unidentified mutation in ...\ApprovalService.cs resulted in a compile error (at 84:76) with id: CS1503, message: Argument 1: cannot convert from 'decimal?' to 'decimal' (Source code: limit)
[23:25:03 INF] Safe Mode! Stryker will remove all mutations in Approve and mark them as 'compile error'.
[23:25:04 INF] 39    mutants got status CompileError. Reason: Mutant caused compile errors
```

- Removing the right side of `ApprovalLimits.LimitFor(approverRole) ?? throw ...` turns `limit` into `decimal?`, which no longer compiles where it is passed to `FormatAmount(decimal)`.
- Stryker's Safe Mode then drops **every** mutant in `Approve` — the method that holds R1–R5. The 100.00 % for `ApprovalService.cs` therefore only covers `Submit`, `Reject`, `Find` and `EnsurePending`.
- `ApprovalLimits.LimitFor` is a `switch` expression over `const` patterns; Stryker generates no mutants for it (`N/A`).

**Action (C6):** two behaviour-identical refactors so the rules can actually be mutated — `limit` checked with an explicit `if (limit is null) throw ...` and used as `limit.Value`; `LimitFor` written as two `if` comparisons. All 93 tests must stay green; then Stryker is re-run (`stryker-after-final.md`).
