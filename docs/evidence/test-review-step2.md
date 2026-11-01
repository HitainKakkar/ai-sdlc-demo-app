# Test review — Step 2 (two-approver rule R3, R4, R5)

Reviewer: `test-reviewer` sub-agent (adversarial, read-only), 2026-11-01. Judged by the main agent before commit C4.
Suite under review: `ApprovalServiceTests.cs` after the `test-author` step-2 run (85 tests; snapshot widened to six fields incl. `FirstApprovedBy` / `FirstApprovedAt`).
Run at review time: `Passed!  - Failed: 0, Passed: 85, Skipped: 0, Total: 85`. Step-1 findings T-01..T-05 had not regressed.

## Mutations the suite already caught (reviewer's check)
Comparing with `DecidedBy` instead of `FirstApprovedBy`; `Ordinal`; `Trim` on one side only; Director check (e) before same-user check (d); first approval setting `Status` or `DecidedBy`; `FirstApproved*` overwritten on the second approval; `Update` on a denial path or missing on the first or second approval; a Director approving 500,000.01 alone; threshold `>=`; `Reject` touching `FirstApproved*`; authority check after the two-approver checks; mutate-then-throw before (d) or (e); message (d) naming the approver instead of the stored first approver; `Trim(' ')` instead of `Trim()`.

## Findings and verdicts

| ID | Gap | Bug it would miss | Verdict |
|---|---|---|---|
| T-06 | R4 only ran under the machine culture. | `CurrentCultureIgnoreCase` / `ToLower()` passes here but under `tr-TR` (dotless i) `DEMO.DIRECTOR` ≠ `demo.director`, so one person gives both approvals. | **Fixed** — `Approve_SameUserDifferentCaseUnderTurkishCulture_DeniesWithSameUserReason`. |
| T-07 | Blank values were never tested: a whitespace `FirstApprovedBy` counted as a real first approval (`IsNullOrEmpty`), and the Domain accepted a blank approver. | One Director approves 750,000 alone after a blank first approval; a blank name is recorded as an approver. | **Fixed with a rule change (decision D-40)** — production: blank approver → `ArgumentException` before anything else; first-approval detection uses `IsNullOrWhiteSpace`. Spec scenario "A blank recorded first approver is not a first approval" added; design.md D6 updated. Tests: `Approve_AboveTwoApproverThresholdWithBlankRecordedFirstApprover_RecordsNewFirstApprovalAndStaysPending`, `Approve_BlankApprover_ThrowsArgumentExceptionAndLeavesInvoiceUnchanged`, `Approve_BlankApproverAboveTwoApproverThreshold_ThrowsAndDoesNotRecordFirstApproval`. |
| T-08 | No second Director whose name contains the first approver's name. | A `Contains`/`StartsWith` comparison wrongly blocks `demo.director` after `demo.director2`. | **Fixed** — row `demo.director2 → demo.director` in `Approve_SecondApprovalByDifferentDirector_ApprovesAndKeepsFirstApproval`. |

Result after the fixes: `Passed! - Failed: 0, Passed: 93, Total: 93`.

## Proof that the fixes bite (main agent, hand-applied mutants on a backup, original restored byte-for-byte)

| Mutant applied to `ApprovalService.cs` | Result |
|---|---|
| T-06: `OrdinalIgnoreCase` → `CurrentCultureIgnoreCase` | `Failed! - Failed: 1, Passed: 92, Total: 93` |
| T-07a: `IsNullOrWhiteSpace(invoice.FirstApprovedBy)` → `IsNullOrEmpty(...)` | `Failed! - Failed: 1, Passed: 92, Total: 93` |
| T-07b: approver guard `IsNullOrWhiteSpace(approver)` → `approver == null` | `Failed! - Failed: 3, Passed: 90, Total: 93` |
| T-08: equality → `FirstApprovedBy.Trim().Contains(approver.Trim(), OrdinalIgnoreCase)` | `Failed! - Failed: 2, Passed: 91, Total: 93` |
| Original restored (`cmp` identical to backup) | `Passed! - Failed: 0, Passed: 93, Total: 93` |

## Points raised by the test-author, not turned into tests (main-agent verdicts)
- **Message (d) prints the stored first-approver name as stored (untrimmed).** Deferred: stored names come from the signed-in session username, which is configured without spaces; the identity *comparison* trims both sides, which is what R4 needs. Listed for the PR review.
- **Order of the blank-approver guard vs. "not found".** Dismissed as a test gap: D-40 places the guard first on purpose (input validation before lookup, same as `Reject` validates its reason first); behaviour for a blank approver on a missing invoice is an `ArgumentException`, which is the more specific error.
