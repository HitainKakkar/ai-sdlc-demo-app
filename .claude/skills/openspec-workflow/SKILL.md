---
name: openspec-workflow
description: How to create and validate the OpenSpec change add-approval-limits-by-role in this repo with npx @fission-ai/openspec@1.15.0 — init, folder layout, requirement/scenario syntax, strict validation and the tasks.md structure. Use it whenever you write or change anything under openspec/.
---

# OpenSpec workflow (`@fission-ai/openspec@1.15.0`)

Spec-driven tool per DECISIONS D-02. Always pin the version: `npx @fission-ai/openspec@1.15.0 <command>`. Content of the spec comes from `approval-rules` (load it).

## 1. Init (once, from repo root)
```
npx @fission-ai/openspec@1.15.0 --version
npx @fission-ai/openspec@1.15.0 init --help      # check flags first; init may prompt for the AI tool
npx @fission-ai/openspec@1.15.0 init             # choose Claude Code when asked
```
Keep every generated file. **Read what init generated** (`openspec/` README/AGENTS/project or config files, any example) and treat it as the authority on format — formats change between versions, and the syntax below is what we expect for 1.15.0, not a guarantee.

## 2. Change layout
```
openspec/changes/add-approval-limits-by-role/
  proposal.md                      # Why, What changes, Impact (files, API, UI, tests)
  design.md                        # decisions D-04..D-10, D-31: roles, limits, check order, messages, data model
  tasks.md                         # checklist, see §4
  specs/invoice-approval/spec.md   # delta spec: ADDED requirements + scenarios
```

## 3. Delta-spec syntax
```markdown
## ADDED Requirements

### Requirement: Manager approval limit
A Manager SHALL be able to approve an invoice whose amount is at most 50,000.00 and MUST be denied above it.

#### Scenario: Manager approves at the limit
- **GIVEN** a pending invoice of 50,000.00
- **WHEN** a Manager approves it
- **THEN** the invoice status is Approved

#### Scenario: Manager is denied just above the limit
- **WHEN** a Manager approves a pending invoice of 50,000.01
- **THEN** the request fails with HTTP 409 and an error containing "50,000.00" and the invoice id
- **AND** the invoice is unchanged
```
- Headers exactly: `## ADDED Requirements` (also `MODIFIED`/`REMOVED` if needed), `### Requirement: <name>`, `#### Scenario: <name>` (four `#`).
- Each requirement text contains **SHALL** or **MUST** and has **at least one scenario**.
- Scenario bullets use bold `**WHEN**` / `**THEN**` (`**GIVEN**`, `**AND**` optional).
- Quote canonical messages from D-31 verbatim; numbers as `50,000.00`.

Requirements to cover: R1, R2, R3 (first approval keeps pending; second Director approves), R4 (same user incl. case variant), R5 (409 + `{error}`, nothing changes, nothing saved), no authority for Admin/unknown roles, inclusive boundaries 49,999.99 / 50,000.00 / 50,000.01 / 500,000.00 / 500,000.01, reject is unaffected by limits, UI shows the reason in the Approvals alert, demo users (D-04).

## 4. tasks.md structure
```markdown
## 1. Step 1 — single-approver limits (commit C3)
- [ ] 1.1 Add ApprovalLimits and ApprovalDeniedException ...
## 2. Step 2 — two-approver rule (commit C4)
## 3. End-to-end test (commit C5)
## 4. Mutation testing (commit C6)
## 5. Agent review and verdicts (commit C7)
```
Tick tasks (`- [x]`) only when the work is verified, in the commit that does it.

## 5. Validate (must pass before commit C2)
```
npx @fission-ai/openspec@1.15.0 list
npx @fission-ai/openspec@1.15.0 show add-approval-limits-by-role
npx @fission-ai/openspec@1.15.0 validate add-approval-limits-by-role --strict
```
Paste the real validate output. If it fails, fix the file it names — never loosen the requirement text to get green.

## Pitfalls
- Running a different version via `npx @fission-ai/openspec` without `@1.15.0`.
- Scenario headers with three `#` (parsed as text) or requirements without SHALL/MUST.
- Spec drifting from D-31 wording or from the code; the spec, tests and UI share one message set.
- Do not `archive` the change in this assignment; it stays under `changes/` for the reviewer.
