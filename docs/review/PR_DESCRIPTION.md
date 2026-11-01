# Approval limits by role

Adds role-based approval limits to the invoice approval service, specified with OpenSpec and delivered in two steps with an AI agent doing the work under review.

- **R1** Manager approves alone up to 50,000.00 · **R2** Director up to 500,000.00 (both inclusive)
- **R3** Above 500,000.00 two distinct approvers; the first may be a Manager or Director, the second must be a Director
- **R4** The same user never counts as both approvers (trimmed, case-insensitive, culture-independent)
- **R5** A denied attempt returns HTTP 409 with a clear reason, shown in the UI, and changes nothing on the invoice

Full write-up: `ASSIGNMENT.md` · Decisions and test matrix: `docs/decisions/DECISIONS.md` · Spec: `openspec/changes/add-approval-limits-by-role/`

## Commits

| # | Commit | What |
|---|---|---|
| C1 | `8779fd0` | Agent context: AGENTS.md rules, skills, sub-agents, logging hooks, Stryker tooling, mutation score before |
| C2 | `e3fc02e` | OpenSpec specification and task breakdown |
| C3 | `43f8a0b` | Step 1: single-approver limits (Manager 50,000, Director 500,000), with tests |
| C4 | `c8ce500` | Step 2: two-approver rule above 500,000, with tests |
| C5 | `2873b43` | Playwright e2e test for a rejected over-limit approval |
| C6 | `e142495` | Approval rules made mutation-testable; 100 % Stryker score |
| C7 | `6584157` | PR review findings addressed; verdicts recorded |
| C8 | — | Write-up (`ASSIGNMENT.md`), AI interaction log, this description |

## How to test

```
dotnet test backend/InvoiceApp.sln                                            # 114 tests
cd e2e && npm install && npx playwright install chromium && npm test          # 1 passed (port 5000 free)
cd backend/tests/InvoiceApp.Tests && dotnet tool restore && dotnet stryker    # 100.00 %
npx @fission-ai/openspec@1.15.0 validate add-approval-limits-by-role --strict # valid
```

Manual: sign in as `demo.manager` / `ChangeMe123!` and approve `INV-1006` (75,000) → reason shown, invoice unchanged; approve `INV-1007` (750,000) → "Awaiting second approval"; the same user again → same-user reason; `demo.director` → Approved.

## Mutation score (Stryker.NET 4.13.0, same config before and after)

| File | Before | After |
|---|---|---|
| ApprovalService.cs | 60.00 % | **100.00 %** (52/52) |
| ApprovalLimits.cs | — | **100.00 %** (4/4) |
| DiscountCalculator.cs (outside the feature) | 0.00 % | **100.00 %** (17/17) |
| Invoice.cs | 0.00 % | **100.00 %** (2/2) |
| **Overall** | **30.77 %** | **100.00 %** |

The first after-run's 100 % for `ApprovalService` was rejected: Stryker's Safe Mode had dropped every mutant in `Approve`. A behaviour-identical refactor made the method mutable; the real run killed all 52. Evidence: `docs/evidence/stryker-*.md`.

## Agent review of this PR — every finding with a verdict

Review prompt: our own structured prompt (`.claude/skills/review-pr/SKILL.md`; the workshop prompt was not available), run by three `pr-reviewer` sub-agents in parallel on the full diff — lens A rules, lens B tests, lens C layering / API / security / docs.

| ID | Severity | Finding | Verdict |
|---|---|---|---|
| RA-01 | low | Approve's read-check-write is not atomic; two simultaneous approvals on the shared in-memory object could interleave. | **Deferred** — concurrency is a stated non-goal of this in-memory demo; a lock without a reliable concurrency test would be "looks right" code. Follow-up: optimistic concurrency (version + 409) with real persistence. |
| RB-01 | medium | e2e "nothing changed" check read a stale page (no refresh after a denial). | **Fixed** — reload, re-check both tabs, assert the server record via the API; proven to fail on a wrong expectation. |
| RB-02 | low | Cells located by column position; comments said "role-based only". | **Fixed** — column headers asserted before any cell is read; comments corrected. |
| RB-03 | low | `reuseExistingServer: true` could test a stale server. | **Fixed** — `!process.env.CI`. |
| RB-04 | low | Three not-pending unit tests skipped parts of the denial checklist. | **Fixed** — full snapshot, exact type, id in message, `UpdateCalls == 0`. |
| RC-01 | low | Spec implied an HTTP contract the app does not meet (other roles get 403). | **Fixed** — rule scoped to the Domain; new requirement with an HTTP 403 scenario. |
| RC-02 | low | Documented check order missed the blank-approver guard. | **Fixed** — AGENTS.md, skill, design and spec updated. |
| RC-03 | low | Retired step-1 message still prescribed in skills/agents. | **Fixed** — marked historical. |
| RC-04 | low | Docs pointed at planning files outside the repo. | **Fixed** — `docs/decisions/DECISIONS.md` committed; references repointed. |
| RC-05 | low | Failed tool calls not logged live. | **Fixed** — `PostToolUseFailure` wired. |
| RC-06 | low | Guard bypassable (`git -c alias…`); no permission rules. | **Fixed in part** — alias bypass closed and documented as best effort. **Deferred:** permission deny rules are a repository-owner decision. |
| RC-07 | low | CI runs only build and unit tests. | **Deferred** — e2e and mutation documented as local gates; CI jobs need push iterations. |
| RC-08 | nit | README missing commands and folders. | **Fixed** |
| RC-09 | nit | Role literals in the controller gate. | **Fixed** — Domain constants. |
| RC-10 | nit | One-letter names in hook scripts vs. naming rule. | **Dismissed** — rule targets product and test code; scope clarified in AGENTS.md. |

Earlier rounds on the AI-written tests (`test-reviewer`, adversarial): **T-01..T-08 all fixed**, each proven by applying the bug by hand and watching the new test fail — `docs/evidence/test-review-step1.md`, `test-review-step2.md`.

## AI usage

Claude Code with custom skills, hooks and sub-agents (`spec-author`, `domain-implementer`, `test-author`, `test-reviewer`, `e2e-author`, `pr-reviewer`, `mutation-analyst`), run in parallel on disjoint files; every output re-read and re-verified by the main agent. All interactions are logged automatically: `logs/ai-interactions.jsonl` and `logs/AI_INTERACTION_LOG.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
