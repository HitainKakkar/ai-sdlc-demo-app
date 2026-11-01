---
name: review-pr
description: Our own structured code-review prompt for the approval-limits PR — three lenses (rule correctness, test quality, layering/API/security/docs), findings cited to diff lines in a fixed table, plus the verdict table the human fills in. Use it whenever you review the feature diff or a pr-reviewer agent is asked for findings.
---

# Review the PR (approval limits by role)

**Provenance:** the workshop review prompt was not provided (DECISIONS D-16, D-29: the upstream `demo/*` branches contain none). This prompt is ours and `ASSIGNMENT.md` says so.

## Inputs
- The diff: `git diff main...HEAD` (the main agent saves it, e.g. `_plan/pr.diff`; reviewers do not run git).
- The spec: `openspec/changes/add-approval-limits-by-role/**`.
- `AGENTS.md` and the `approval-rules` skill (rules, check order, canonical messages D-31).
- The assigned lens: **A**, **B**, **C**, or all three.

## Procedure
1. Read the whole diff once. For every changed production line, open the full file to see context.
2. Apply only the assigned lens checklist below. Each finding must quote or point to a concrete changed line (`path:line` in the new file).
3. For rule questions, try the boundary and identity inputs from `approval-rules` in your head against the code path.
4. Drop duplicates (same root cause = one finding; list all locations in File:line).
5. Output the tables exactly as in "Output format". No summary paragraphs, no praise.

## Lens A — rule correctness (R1–R5)
- Limits: Manager 50,000.00 and Director 500,000.00 inclusive; `>` threshold for two approvers; 500,000.01 never approved by one Director.
- Admin / unknown / empty role has no authority; `null` limit is not "unlimited".
- Order: exists → pending → authority → two-approver vs limit; **all checks before any assignment and before `Update`**.
- Two-approver flow: first approval keeps `PendingApproval`, sets `FirstApprovedBy/At`, leaves `DecidedBy/At` null; second must be a different user (`Trim` + `OrdinalIgnoreCase`) **and** a Director; `DecidedBy` = second; first kept.
- Denials throw `ApprovalDeniedException`; messages match D-31 (limit, invoice id, user/role; `N2` + `InvariantCulture`).
- Reject unaffected by limits; reject after a first approval keeps `FirstApprovedBy`.
- Edge cases: whitespace/case usernames, repeated first approval, approval of non-pending, concurrent double approval (note only).

## Lens B — test quality
- For each new/changed test: which production mutation would make it fail? If none → finding.
- Every denial test asserts: exact exception type, message parts, **all** fields unchanged (Status, DecidedBy, DecidedAt, DecisionNote, FirstApprovedBy, FirstApprovedAt) from a value snapshot, `UpdateCalls == 0`.
- Success tests assert `UpdateCalls == 1` and the fields that must change.
- Boundary coverage 49,999.99 / 50,000.00 / 50,000.01 / 500,000.00 / 500,000.01; R4 case-variant and whitespace variant; Manager as second approver; Admin/unknown role; reject paths.
- Decimal literals with `m`; no `double` in `InlineData` for money; no logic in tests.
- E2E: page objects, role-based locators only, unique data, asserts alert text and unchanged status.

## Lens C — layering, API, security, naming, docs
- Business rules only in `InvoiceApp.Domain`; controllers only pass `session.Username` / `session.Role` through `Handle(...)`.
- `[RequireRole("Manager","Director","Admin")]` on `ApprovalsController`; role comes from the server session, never from the request body/query (role spoofing).
- HTTP: denial 409 `{error}`, not found 404, validation 400; no new status codes without reason.
- UI shows `error` verbatim in `#decision-error`; second-approval hint in `app.js` escapes nothing unsafe (uses `textContent`/`el`, not `innerHTML`).
- `appsettings.json` users per D-04, no real secrets; seed invoices INV-1006/1007.
- Naming per AGENTS.md (no one-letter names, no flag params); README, AGENTS.md, spec and code agree.

## Severity
- **high** — a rule R1–R5 can be violated or a denial changes data.
- **medium** — a realistic bug would pass the tests, or API/security contract weakened.
- **low** — maintainability, missing doc, unclear message.
- **nit** — style only.

## Output format (exactly this)
```markdown
### Lens <A|B|C> findings
| ID | Lens | Severity (high/medium/low/nit) | File:line | Finding | Suggested fix |
|---|---|---|---|---|---|
| R-01 | A | high | backend/src/InvoiceApp.Domain/ApprovalService.cs:58 | `Status` is set before the Director check throws, so a denied second approval leaves the invoice Approved in memory. | Move all checks above the first assignment. |
```
If a lens has nothing: one row `| — | <lens> | — | — | no findings | — |`.
IDs are `R-01`, `R-02`, … in order; when several reviewers run in parallel, the main agent renumbers after merging.

Then the verdict template (the human fills it; reviewers leave Verdict empty):
```markdown
### Verdicts
| ID | Verdict (fixed / dismissed / deferred) | Reason / commit |
|---|---|---|
| R-01 |  |  |
```
Every finding gets exactly one verdict: **fixed** (commit sha), **dismissed** (why it is not a problem), **deferred** (why, and where it is tracked). Verdicts go to `docs/review/REVIEW_FINDINGS.md`, the PR description and `node .claude/hooks/ai-log.js human "<verdict>" --status accepted|rejected|modified --related R-xx`.

## Rules
- Cite concrete lines from the diff; a finding without a location is not allowed.
- No praise, no restating what the code does, no duplicates.
- Do not invent requirements beyond R1–R5, DECISIONS and AGENTS.md; if something is ambiguous, file it as low with the question.
