# Tasks

Each numbered group maps to one commit. A box is ticked only in the commit that does and verifies the work.

## 1. Step 1: single-approver limits (commit C3)

- [x] 1.1 Add `backend/src/InvoiceApp.Domain/ApprovalLimits.cs`:
  - consts `ManagerLimit = 50_000m`, `DirectorLimit = 500_000m` and `TwoApproverThreshold = 500_000m`;
  - `decimal? LimitFor(string? role)`, which returns 50,000 for `Manager`, 500,000 for `Director` and `null` otherwise, with exact-case matching.

  Verify with `ApprovalLimitsTests` (Manager, Director, Admin, Approver, `""`, `null`, `manager` → `null`).
- [x] 1.2 Add `backend/src/InvoiceApp.Domain/ApprovalDeniedException.cs` (`public class ApprovalDeniedException : InvalidOperationException`). Verify that a test asserts `Assert.Throws<ApprovalDeniedException>` on a denial and that `ApiControllerBase.Handle` needs no change, because the 409 mapping already exists.
- [x] 1.3 Change `ApprovalService.Approve` to `Approve(string invoiceId, string approver, string approverRole)` with this check order: `Find` → `EnsurePending` → `LimitFor` null → deny (a) → amount > `TwoApproverThreshold` → deny (c) → amount > limit → deny (b). Only after all checks: set `Status`, `DecidedBy` and `DecidedAt`, then `Update`. Format amounts with `ToString("N2", CultureInfo.InvariantCulture)`. Verify that `dotnet build backend/InvoiceApp.sln` succeeds and that the code review shows no assignment before the last throw.
- [x] 1.4 Use messages (a), (b) and (c) from design.md D5 verbatim, with the invoice id, amount and role filled in. Verify with unit tests that assert the limit, the invoice id and the role in each message.
- [x] 1.5 Update `ApprovalsController`: change the attribute to `[RequireRole("Manager", "Director", "Admin")]` and pass `HttpContext.GetSession().Role` to `Approve`. Add no rule logic to the controller. Verify that the build passes and that the smoke test in 1.10 returns 409 for Manager on INV-1006.
- [x] 1.6 Update `appsettings.json` users to `demo.manager` (Manager), `demo.director` (Director), `demo.director2` (Director) and `demo.admin` (Admin), all `ChangeMe123!`, and remove `demo.approver`. Verify that each user signs in through `POST /api/auth/login`.
- [x] 1.7 Update `InMemoryInvoiceRepository`:
  - seed `INV-1006` (75,000.00, PendingApproval) and `INV-1007` (750,000.00, PendingApproval);
  - set `_nextNumber = 1008`;
  - set `INV-1003.DecidedBy = "demo.director"`.

  Verify with `GET /api/invoices`, which should list both seeds. A newly created invoice gets `INV-1008`.
- [x] 1.8 Add `public int UpdateCalls` to `FakeInvoiceRepository` and increment it in `Update`. Verify that the existing approve and reject success tests assert `UpdateCalls == 1`.
- [x] 1.9 Update `ApprovalServiceTests` for the new signature and add Step 1 tests:
  - Manager boundaries: 49,999.99 approved, 50,000.00 approved, 50,000.01 denied (b), 500,000.00 denied (b).
  - Director: 50,000.01 approved, 500,000.00 approved alone.
  - Amounts above 500,000.00: Manager and Director both denied with (c).
  - Admin, `Approver`, empty and `manager` roles denied with (a); Admin on 750,000.00 gets (a), not (c).
  - Reject by Manager of 1,000,000.00 succeeds, and Admin may reject.
  - Every denial asserts the type, the message parts, all six fields unchanged on the same instance and `UpdateCalls == 0`.

  Verify that `dotnet test backend/InvoiceApp.sln` is green and record the counts.
- [x] 1.10 Smoke test against the running API (`dotnet run --project backend/src/InvoiceApp.Api`): sign in as `demo.manager`, then `POST /api/approvals/INV-1006/approve`. Expect 409 with `{"error":"A Manager may approve invoices up to 50,000.00; invoice INV-1006 is 75,000.00. A Director must approve it."}`. `GET /api/invoices/INV-1006` should show `PendingApproval` with `decidedBy` null. Take a screenshot of the alert to `docs/evidence/step1-manager-denied.png`.
- [x] 1.11 Update `AGENTS.md`:
  - drop "(today: Approver or Admin)" from the `[RequireRole]` line;
  - change the Demo accounts section to the four new users.

  Update the README demo-accounts table to match (D-33, D-35). Verify that no `demo.approver` remains: `grep -r demo.approver` only finds history and logs.

## 2. Step 2: two-approver rule (commit C4)

- [x] 2.1 Add `string? FirstApprovedBy` and `DateTime? FirstApprovedAt` to `backend/src/InvoiceApp.Domain/Invoice.cs`. Verify that the build passes and that `GET /api/invoices` includes `firstApprovedBy` and `firstApprovedAt`.
- [x] 2.2 Replace the (c) branch in `ApprovalService.Approve` for amounts above `TwoApproverThreshold`:
  - If there is no first approval, set `FirstApprovedBy` and `FirstApprovedAt`, keep `PendingApproval`, call `Update` and return.
  - Otherwise, if it is the same user (trimmed, `OrdinalIgnoreCase`, compared with `FirstApprovedBy`), deny with (d).
  - Otherwise, if the role is not `Director`, deny with (e).
  - Otherwise set `Approved`, `DecidedBy = approver` and `DecidedAt`, keep the `FirstApproved*` values and call `Update`.

  Run all checks before any assignment. Remove message (c). Verify with the tests in 2.4.
- [x] 2.3 Make sure `Reject` leaves `FirstApprovedBy` and `FirstApprovedAt` untouched. Verify with the test `Reject_AfterFirstApproval_KeepsFirstApprover`.
- [x] 2.4 Replace the Step 1 (c) tests in `ApprovalServiceTests` with two-approver tests:
  - first approval by Manager, and by Director, on 750,000.00 and on 500,000.01: stays pending, `FirstApprovedBy` and `FirstApprovedAt` set, `DecidedBy` null, `UpdateCalls == 1`;
  - second approval by a different Director: Approved, `DecidedBy` = second, first approver kept;
  - same Director twice → (d);
  - `Demo.Director` → (d);
  - ` demo.director ` → (d);
  - Manager repeating their own first approval → (d), not (e);
  - different-user Manager as second → (e);
  - reject after a first approval keeps the first approver.

  Each denial asserts all six fields unchanged and `UpdateCalls == 0`. Verify that `dotnet test backend/InvoiceApp.sln` is green and record the counts.
- [x] 2.5 In `wwwroot/app.js` `renderPending`, show `Awaiting second approval (first: <firstApprovedBy>)` when `firstApprovedBy` is set, with no limit logic in JavaScript. Verify manually with the Playwright MCP on INV-1007: `demo.manager` approves and the hint appears. `demo.director` then approves and gets an Approved invoice. Separately, the same director twice shows reason (d) in the alert. Take screenshots to `docs/evidence/step2-*.png`.
- [x] 2.6 API checks with curl for (d) and (e): each gives 409 with the exact `error` text, and a later `GET` shows the invoice unchanged. Verify by pasting the outputs into the WORKLOG.

## 3. Playwright end-to-end test (commit C5)

- [ ] 3.1 Add page objects `e2e/pages/LoginPage.ts`, `e2e/pages/InvoicesPage.ts` and `e2e/pages/ApprovalsPage.ts`, using only `getByRole` and `getByLabel` (no CSS or XPath). Verify that a review of the files finds no `locator('.` or `xpath=` usage.
- [ ] 3.2 Add `e2e/tests/approval-limits.spec.ts`:
  1. Sign in as `demo.manager`.
  2. Create the invoice "Over-limit e2e <timestamp>" for 60,000.
  3. Submit it for approval.
  4. Open the Approvals tab and click Approve.
  5. Expect the alert to contain `50,000`.
  6. Expect the invoice to be "Pending Approval".

  Verify that `cd e2e && npm install && npx playwright install chromium && npm test` passes with nothing else on port 5000.
- [ ] 3.3 Save the run summary to `docs/evidence/e2e-run.txt` and run once with `npm run test:headed`. Verify that the evidence file exists and shows 1 passed.

## 4. Mutation testing (commit C6)

- [ ] 4.1 Run `cd backend/tests/InvoiceApp.Tests && dotnet tool restore && dotnet stryker` on the feature branch and record the score as text in `docs/evidence/stryker-after-1.md`. Verify that the file contains the Stryker summary table and the final score.
- [ ] 4.2 Classify every mutant that survives in `ApprovalService.cs` and `ApprovalLimits.cs` as meaningful or equivalent, with a reason. Add tests that kill the meaningful ones. Verify that `dotnet test` is green.
- [ ] 4.3 Rerun Stryker and record the score in `docs/evidence/stryker-after-final.md`, with the BEFORE score from `docs/evidence/stryker-before.md` next to it. Verify that the score is not lower than BEFORE and that every remaining survivor in approval code is explained.

## 5. Agent review and verdicts (commit C7)

- [ ] 5.1 Produce the diff `main...feature/approval-limits-by-role`. Run the `pr-reviewer` agent with the `review-pr` skill, using three lenses: rule correctness R1 to R5, test quality, and layering/API/security/docs. Verify that each lens returns a findings table with IDs `R-xx` and file:line references.
- [ ] 5.2 Give every finding exactly one verdict (fixed with commit, dismissed with reason, or deferred with reason and follow-up) and apply the fixes. Verify that `dotnet test`, the e2e test and `openspec validate add-approval-limits-by-role --strict` are all green again.
- [ ] 5.3 Write the verdicts to `docs/review/REVIEW_FINDINGS.md` and the PR description, and tick the completed tasks in this file. Verify that no finding is left without a verdict.

## 6. Write-up and AI interaction log (commit C8)

- [ ] 6.1 Write `ASSIGNMENT.md`, covering the rules, design decisions, steps and commits, test matrix, mutation scores before and after, review verdicts, AI tooling and human oversight, and how to run. Verify that every command in it runs as written.
- [ ] 6.2 Rebuild and render the AI interaction log (`node .claude/hooks/ai-log.js rebuild ...` and `render`) into `logs/ai-interactions.jsonl` and `logs/AI_INTERACTION_LOG.md`. Verify that every JSONL line parses and that there are entries for each stage and sub-agent.
- [ ] 6.3 Final check on a clean local clone: build, `dotnet test`, e2e, `openspec validate add-approval-limits-by-role --strict`, and `git log` showing C1 to C8. Verify that all are green and that no secrets or bin/obj/node_modules folders are committed.

## Workflow follow-up

- Do not archive this change in this assignment. It stays under `openspec/changes/` for the reviewer.
