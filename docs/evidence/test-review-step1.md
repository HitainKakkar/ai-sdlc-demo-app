# Test review — Step 1 (single-approver limits)

Reviewer: `test-reviewer` sub-agent (adversarial, read-only), 2026-11-01. Judged by the main agent before commit C3.
Suite under review: `ApprovalServiceTests.cs`, `ApprovalLimitsTests.cs`, `FakeInvoiceRepository.cs` (written by the `test-author` sub-agent).
Run at review time: `Passed!  - Failed: 0, Passed: 50, Skipped: 0, Total: 50`.

## Mutations the suite already caught (reviewer's check)
`>`→`>=` on the limit or threshold; `<`/`<=` at 50,000.00 / 500,000.00; status set before a throw; `Update` removed from a success path or called on a denial path; messages replaced by `""`, generic text, `N0`/`F2` or current-culture formatting; wrong exception type; case-insensitive role matching; Admin or unknown role getting a limit; `limit ?? decimal.MaxValue`; reject applying limits; check-order swaps role↔threshold, pending↔role, find↔role.

## Findings and verdicts

| ID | Gap | Bug it would miss | Verdict |
|---|---|---|---|
| T-01 | No test pins that `ApprovalDeniedException` derives from `InvalidOperationException`. | Base class changed to `Exception`: all tests green, but `ApiControllerBase.Handle` stops mapping denials, so every denial becomes HTTP 500 instead of 409. | **Fixed** — `ApprovalDeniedExceptionTests` asserts the base type and message. |
| T-02 | Denial snapshots start from null `DecidedBy` / `DecidedAt` / `DecisionNote`. | A "clear old decision first" step (setting them to null before throwing) is a mutate-then-throw bug the snapshot cannot see. | **Fixed** — denial tests for messages (a), (b) and (c) now seed non-null prior values before the snapshot. |
| T-03 | No not-pending invoice above 500,000. | Moving the two-approver check above `EnsurePending` returns "needs two approvers" for an already-approved 750,000 invoice. | **Fixed** — `Approve_NotPendingInvoiceAboveTwoApproverThreshold_ThrowsNotPendingErrorNotDenial`. |
| T-04 | No role names with surrounding spaces. | `role.Trim()` in `LimitFor` would grant authority to `" Manager"` / `"Director "`, against "role names MUST match exactly". | **Fixed** — whitespace roles added to both role theories. |
| T-05 | `Assert.InRange` ignores `DateTimeKind`. | `DecidedAt = DateTime.Now` passes on any UTC-zone machine (e.g. CI). | **Fixed** — both timestamp tests assert `DateTimeKind.Utc`. |

Not counted as a gap (reviewer, accepted): moving `_repository.Update` above the field assignments — both repositories keep the same instance, so behaviour is identical.
The four-field snapshot (not six) is correct for step 1: `FirstApprovedBy` / `FirstApprovedAt` arrive in step 2, where the snapshot helper is widened.

## Proof that the fixes bite (main agent, hand-applied mutants, originals restored byte-for-byte)

| Mutant applied to production code | Result |
|---|---|
| T-02: `invoice.DecisionNote = null; invoice.DecidedBy = null; invoice.DecidedAt = null;` inserted right after each `EnsurePending(invoice);` (in `Approve` and in `Reject`) | `Failed! - Failed: 3, Passed: 57, Total: 60` (the three prior-decision-data denial tests) |
| T-01: `ApprovalDeniedException : Exception` instead of `: InvalidOperationException` | `Failed! - Failed: 1, Passed: 59, Total: 60` (`ApprovalDeniedException_DerivesFromInvalidOperationException`) |
| Originals restored (`cmp` identical to backup) | `Passed! - Failed: 0, Passed: 60, Total: 60` |
