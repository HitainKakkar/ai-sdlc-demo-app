---
name: playwright-e2e
description: How to write, run and manually verify the Playwright end-to-end test for a rejected over-limit approval in this repo — scenario, page objects in e2e/pages, role-based locators matching index.html/app.js, commands and port-5000 pitfalls, plus manual checks with the Playwright MCP tools. Use it whenever you touch e2e/ or need to show the approval UI working.
---

# Playwright e2e — rejected over-limit approval

Deliverable D5 (DECISIONS D-15): `e2e/tests/approval-limits.spec.ts` + page objects `e2e/pages/LoginPage.ts`, `InvoicesPage.ts`, `ApprovalsPage.ts`.

## Scenario (one test)
1. Go to `/`, sign in as `demo.manager` / `ChangeMe123!`.
2. Invoices tab: create an invoice for a **unique** customer, e.g. `` `Over-limit e2e ${Date.now()}` ``, amount `60000`.
3. In that invoice's row, click "Submit for approval"; read the invoice id (`INV-xxxx`) from the row's first cell.
4. Click tab "Approvals", click "Approve invoice INV-xxxx".
5. `expect(alert).toContainText('50,000')` (full text: message (b) from `approval-rules`).
6. Back on the Invoices tab, the row still shows status "Pending Approval".

Unique names matter: `reuseExistingServer: true` keeps the in-memory data of a running server across runs.

## Accessible names that exist today (`backend/src/InvoiceApp.Api/wwwroot`)
| Element | Locator |
|---|---|
| Username / Password inputs | `getByLabel('Username')`, `getByLabel('Password')` |
| Sign in | `getByRole('button', { name: 'Sign in' })` |
| Tabs | `getByRole('tab', { name: 'Invoices' })`, `getByRole('tab', { name: 'Approvals' })` |
| New invoice form | `getByLabel('Customer name')`, `getByLabel('Amount')`, `getByRole('button', { name: 'Create invoice' })` |
| Invoices table | `getByRole('table', { name: 'All invoices' })` (caption) |
| Row for a customer | `table.getByRole('row').filter({ hasText: customer })` |
| Submit | `row.getByRole('button', { name: /^Submit invoice INV-\d+ for approval$/ })` |
| Approve / Reject | `getByRole('button', { name: \`Approve invoice ${id}\` })`, `Reject invoice ${id}` |
| Rejection reason | `getByLabel(\`Rejection reason for ${id}\`)` |
| Approvals panel | `getByRole('tabpanel', { name: 'Approvals' })` |
| Decision error | `approvalsPanel.getByRole('alert')` (`#decision-error`) |
| Signed-in banner | text `demo.manager (Manager)` |

Status cell text is `PendingApproval` with a space inserted → `Pending Approval`. Scope alerts to the panel: the page has three `role="alert"` elements (hidden ones are ignored by `getByRole`, but scoping is clearer).

## Page-object rules (AGENTS.md)
- Only `getByRole` / `getByLabel` / `getByText` scoped to a role container. **No CSS, no XPath, no `#ids`, no `nth-child`.**
- Each page object takes `Page` in the constructor, exposes intention methods (`signIn(user, password)`, `createInvoice(customer, amount)`, `submitForApproval(customer): Promise<string>` returning the id, `statusOf(customer)`, `open()`, `approve(id)`, `decisionError()`), and returns locators for assertions; assertions stay in the spec.
- No `waitForTimeout`; rely on web-first `expect(...)` auto-waiting.
- If a locator needs a name the UI does not have, report it to the main agent; do not edit `wwwroot` from `e2e-author`.

## Commands (PowerShell or Git Bash, from repo root)
```
cd e2e
npm install
npx playwright install chromium
npm test                 # headless, list + html reporter
npm run test:headed      # for the video
npm run report           # open last HTML report
```
`playwright.config.ts` starts `dotnet run --project ../backend/src/InvoiceApp.Api` on http://localhost:5000 (timeout 120 s) and **reuses** anything already on port 5000. Before running: make sure no stale API from older code holds :5000 (`netstat -ano | findstr :5000` → stop that PID), or the test runs against old code. `dotnet` must be on PATH for the webServer (else run `_plan/setup-dotnet-path.ps1` or start the API yourself first).

## Manual verification with the Playwright MCP
With the API running (`dotnet run --project backend/src/InvoiceApp.Api`):
1. `mcp__playwright__browser_navigate` → `http://localhost:5000`
2. `browser_fill_form` / `browser_type` Username + Password, `browser_click` "Sign in"
3. `browser_click` tab "Approvals" → `browser_click` "Approve invoice INV-1006" (seeded 75,000)
4. `browser_snapshot` → the alert text must be message (b); copy it into the evidence
5. `browser_take_screenshot` → `docs/evidence/step1-manager-denied.png`

## Done when
`npm test` prints `1 passed` (paste the real output), headed run works, no CSS/XPath in `e2e/**`, and the summary is saved by the main agent to `docs/evidence/e2e-run.txt`.
