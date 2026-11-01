# Project conventions for AI agents

Invoice approval demo app: ASP.NET Core 8 Web API with a small static web UI.

## Layout

- `backend/src/InvoiceApp.Domain`: business rules, no web or storage code. `ApprovalService` owns the invoice lifecycle (Draft, PendingApproval, Approved, Rejected); `ApprovalLimits` owns the per-role limits.
- `backend/src/InvoiceApp.Api`: controllers, sign-in (`Auth/`), in-memory repository, and the web UI under `wwwroot/`.
- `backend/tests/InvoiceApp.Tests`: xUnit tests, one test class per class under test, named `<ClassUnderTest>Tests`.
- `e2e`: Playwright end-to-end tests (`tests/`) and page objects (`pages/`).
- `openspec/changes/add-approval-limits-by-role/`: the OpenSpec specification for the approval-limits feature.
- `docs/use-cases`: short briefs for features we may build. `docs/evidence`: mutation and run evidence. `docs/review`: review findings and verdicts.
- `.claude/`: skills, agents, hooks and settings for AI agents. `logs/`: AI interaction logs.

## Approval rules (approval limits by role)

Business rules, verbatim: R1 A Manager may approve invoices up to 50,000. R2 A Director may approve invoices up to 500,000. R3 Anything above 500,000 needs two distinct approvers, and the second approver must be a director. R4 The same user may never count as both approvers on one invoice. R5 A rejected attempt returns a clear reason, and nothing about the invoice changes.

| Rule | Precise meaning in this codebase |
| --- | --- |
| Authority | Only roles `Manager` and `Director` can approve. `Admin` has no approval authority (Admin may reject and delete). Any other or empty role cannot approve. `ApprovalLimits.LimitFor(role)` returns 50,000 / 500,000 / `null`. |
| R1 | Manager approves alone when amount <= 50,000.00 (inclusive). 50,000.01 is denied. |
| R2 | Director approves alone when amount <= 500,000.00 (inclusive). 500,000.01 needs two approvers. |
| R3 | Amount > 500,000.00: the first approval may come from a Manager or a Director. It succeeds (HTTP 200), leaves status `PendingApproval` and sets `FirstApprovedBy` / `FirstApprovedAt`. The second approval must be a Director; it sets `Approved`, `DecidedBy` = second approver, `DecidedAt`, and keeps `FirstApprovedBy` for audit. No new status. |
| R4 | The second approver must be a different user than `FirstApprovedBy`. Compare trimmed, case-insensitive (`OrdinalIgnoreCase`): `demo.director` and `Demo.Director ` are the same person. |
| R5 | A denial throws `ApprovalDeniedException` (derives from `InvalidOperationException`). `ApiControllerBase.Handle` maps it to HTTP 409 `{ "error": "<reason>" }`; the UI shows the text verbatim in the `#decision-error` alert. **All checks run before any field is changed and before `IInvoiceRepository.Update` is called.** |
| Reject | Limits apply to approve only, never to reject. A Manager may reject a 1,000,000 invoice; rejecting after a first approval keeps `FirstApprovedBy`. |

Check order in `Approve(invoiceId, approver, approverRole)`: approver not blank (else `ArgumentException`, HTTP 400) -> invoice exists -> invoice is pending -> role has authority -> (amount > 500,000 ? two-approver checks : limit check) -> only then mutate and `Update`.

Boundary values that must be tested on both sides: 49,999.99 / 50,000.00 / 50,000.01 / 500,000.00 / 500,000.01.

Canonical denial messages (amounts formatted `N2` with `CultureInfo.InvariantCulture`). Tests assert the key parts (limit, invoice id, user, role), not punctuation:

| | Case | Message |
| --- | --- | --- |
| a | No authority | `Role 'Admin' cannot approve invoices. Only a Manager or a Director can approve.` |
| b | Over Manager limit | `A Manager may approve invoices up to 50,000.00; invoice INV-1006 is 75,000.00. A Director must approve it.` |
| c | *(retired)* Step-1 placeholder above 500,000, removed when the two-approver rule landed | `Invoice INV-1007 is 750,000.00, above 500,000.00, and needs two approvers; two-approver approval is not available yet.` — must no longer appear in code or tests |
| d | Same user twice | `demo.director already gave the first approval for invoice INV-1007; the second approval must come from a different person.` |
| e | Second approver not a Director | `The second approval for invoice INV-1007 (above 500,000.00) must come from a Director; demo.manager is a Manager.` |

### Where agents usually get R4 and R5 wrong

Code that looks right but is not, and what a test must assert to catch it:

| Mistake | Catch it with |
| --- | --- |
| Sets `Status`, `DecidedBy` or `FirstApprovedBy` first, then throws (the in-memory object is already changed even if `Update` is skipped). | After the denial, assert every field is unchanged on the same instance and `UpdateCalls == 0`. |
| Calls `Update` before the last check, or in a `finally`. | `UpdateCalls == 0` on every denial test. |
| Compares user names with `==` or `Equals` without `OrdinalIgnoreCase`, or without trimming. | A same-user test with different letter case (and surrounding spaces) must be denied. |
| Checks only that the second approver is a Director, not that it is a different user. | A Director giving both approvals on a > 500,000 invoice must be denied with message (d). |
| Checks only identity, not the second approver's role. | A different-user Manager as second approver must be denied with message (e). |
| Uses `<` instead of `<=` (or the reverse) at a limit. | Boundary tests at exactly 50,000.00 and 500,000.00 (approved) and +0.01 (denied / two approvers). |

## Layering

| Layer | Responsibility | Must not |
| --- | --- | --- |
| Domain (`InvoiceApp.Domain`) | Decides. `ApprovalService` + `ApprovalLimits` hold every rule. `IInvoiceRepository` is declared here. | Reference web, session or storage code. |
| Api (`InvoiceApp.Api`) | Maps. Controllers pass `session.Username` and `session.Role` to the service and return `Handle(...)`. `InMemoryInvoiceRepository` implements the repository. | Contain business rules, in controllers or `Program.cs`. |
| UI (`wwwroot/app.js`) | Shows. Renders the `error` text from the API. | Duplicate approval rules or limits in JavaScript. |
| Tests | Use `FakeInvoiceRepository`; its `Update` counts calls in `UpdateCalls` so tests prove nothing was saved. | Hit the real API from unit tests. |

## Conventions

- Controllers live in `Controllers/`, one per resource, route `api/[controller]`. Request bodies are `record` types declared inside the controller.
- Controllers inherit `ApiControllerBase` and use `Handle(...)` so service errors map to 404 (`KeyNotFoundException`), 409 (`InvalidOperationException`, incl. `ApprovalDeniedException`) and 400 (`ArgumentException`).
- Every endpoint is behind sign-in. Restrict actions with `[RequireRole("...")]`: destructive actions are Admin only. The approvals endpoint is gated to `Manager`, `Director` and `Admin`; the attribute only gates the endpoint, the Domain decides who may approve what (Admin may reject but gets the no-authority reason on approve).
- Business rules go in the Domain project, never in controllers.
- Register services in `Program.cs`. Repositories are interfaces in Domain with an in-memory implementation in Api.
- Every new rule or endpoint needs tests. Use `FakeInvoiceRepository` in tests.
- Use clear names; no one-letter variables or `flag` parameters (product and test code; the tooling scripts in `.claude/hooks/` are exempt).
- End-to-end tests use page objects and role-based locators (`getByRole`, `getByLabel`), never CSS or XPath selectors.

## Commands

Plain `dotnet` / `npm`, run from the repo root unless stated.

| Task | Command |
| --- | --- |
| Build | `dotnet build backend/InvoiceApp.sln` |
| Unit tests | `dotnet test backend/InvoiceApp.sln` |
| Run the app | `dotnet run --project backend/src/InvoiceApp.Api` then open http://localhost:5000 |
| End-to-end tests | `cd e2e && npm install && npx playwright install chromium && npm test` (headed: `npm run test:headed`). The Playwright config starts the API itself; make sure nothing else is on port 5000. |
| Mutation testing | `cd backend/tests/InvoiceApp.Tests && dotnet tool restore && dotnet stryker` (Stryker.NET 4.13.0 pinned in `.config/dotnet-tools.json`; mutates `InvoiceApp.Domain`; reports in `StrykerOutput/`, git-ignored; evidence in `docs/evidence/`) |
| Spec validation | `npx @fission-ai/openspec@1.15.0 validate add-approval-limits-by-role --strict` |

CI (`.github/workflows/ci.yml`) runs build and unit tests in Release on every PR to `main`. The Playwright e2e test and the Stryker run are local gates for now (commands above); adding them to CI is a deferred review item.

## Testing expectations

- One test class per class under test, named `<ClassUnderTest>Tests`. New test names follow `Method_Condition_ExpectedResult`.
- Every rule has a positive and a negative test. Boundaries are tested on both sides.
- Every denial test asserts:
  1. the exception type (`ApprovalDeniedException`);
  2. the message contains the specific limit, user or role, and the invoice id;
  3. `Status`, `DecidedBy`, `DecidedAt`, `DecisionNote`, `FirstApprovedBy`, `FirstApprovedAt` are unchanged;
  4. `UpdateCalls == 0`.
- E2E tests use page objects in `e2e/pages/` and role-based locators only (`getByRole`, `getByLabel`), never CSS or XPath.
- The mutation score must not go down. Surviving mutants in approval code must be killed or explained in `docs/evidence/`.

## Review expectations

- Every change is reviewed with the `review-pr` skill (our own structured review prompt; the workshop prompt was not available).
- Every finding gets exactly one verdict: **fixed** (with commit), **dismissed** (with reason) or **deferred** (with reason and follow-up). Verdicts are recorded in the PR description and in `docs/review/REVIEW_FINDINGS.md`.
- Never silently ignore a finding.
- AI-generated tests are reviewed by the `test-reviewer` agent and by a human before they count.

## Commits

- Small; each commit builds and passes tests on its own.
- Subject in imperative mood, at most 72 characters. Body says what changed and why.
- The feature is delivered in at least two steps: single-approver limits first, then the two-approver rule.

## AI usage and logging

- Hooks log every AI interaction automatically to `logs/ai-interactions.jsonl` (structured, one JSON object per line), summarised in `logs/AI_INTERACTION_LOG.md`.
- Record human decisions in `logs/HUMAN_OVERSIGHT.md`: `node .claude/hooks/ai-log.js human "<decision>" --status accepted|rejected|modified`.
- Set the current stage: `node .claude/hooks/ai-log.js stage <name>`.
- Never write secrets or tokens into logs, code or commits.

## Skills and agents

Skills live in `.claude/skills/<name>/SKILL.md`:

| Skill | Use when |
| --- | --- |
| `approval-rules` | Implementing or reasoning about R1-R5, limits, check order and messages. |
| `writing-approval-tests` | Writing xUnit tests for approval rules (denial assertions, boundaries). |
| `playwright-e2e` | Writing e2e tests with page objects and role-based locators. |
| `openspec-workflow` | Creating, updating or validating the OpenSpec change. |
| `mutation-testing` | Running Stryker and analysing surviving mutants. |
| `review-pr` | Reviewing a diff and producing the findings-and-verdicts table. |
| `ai-log` | Setting the stage or recording a human decision in the logs. |

Agents live in `.claude/agents/<name>.md`:

| Agent | Use when |
| --- | --- |
| `spec-author` | Writing the OpenSpec proposal, specs and tasks. |
| `domain-implementer` | Changing Domain/Api code to implement a rule. |
| `test-author` | Writing unit tests for a rule. |
| `test-reviewer` | Reviewing AI-written tests before they count. |
| `e2e-author` | Writing Playwright tests and page objects. |
| `pr-reviewer` | Reviewing the PR diff with `review-pr`. |
| `mutation-analyst` | Reading a Stryker report: explaining each surviving mutant and proposing the test that kills it (read-only). |

Hooks (wired in `.claude/settings.json`): `ai-log.js` (logging), `guard.js` (best-effort guard that blocks `git push`, remote changes, `gh`, `aws` by parsing Bash/PowerShell commands; defence in depth, not a security boundary), `format.js` (formats edited C# files).

## Demo accounts (not real credentials)

- `demo.manager` / `ChangeMe123!` (role Manager, approves up to 50,000.00)
- `demo.director` / `ChangeMe123!` (role Director, approves up to 500,000.00; second approver above that)
- `demo.director2` / `ChangeMe123!` (role Director, a second, different Director for invoices above 500,000.00)
- `demo.admin` / `ChangeMe123!` (role Admin: may reject and delete, cannot approve)

Seeded pending invoices for demos: `INV-1006` (75,000.00, above the Manager limit) and `INV-1007` (750,000.00, needs two approvers).

## Never

- Commit real credentials, tokens or customer data.
- Add business logic to `Program.cs` or controllers.
- Change invoice state before all checks pass.
- Duplicate approval rules in controllers or JavaScript.
- Weaken or delete a failing test to make it pass.
- Push or change git remotes from an agent session.
- Log secrets.
