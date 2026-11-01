# Proposal

## Why

Today any user with the `Approver` or `Admin` role can approve an invoice of any amount on their own (`ApprovalService.Approve(invoiceId, approver)` has no limits). Finance needs approval authority tied to role and amount, plus a second, independent approver for large invoices (business rules R1 to R5 below). This is the assignment feature. It is delivered spec-first, and every rule gets test evidence: unit tests, one end-to-end test and mutation testing.

Business rules, verbatim:

- R1 A Manager may approve invoices up to 50,000.
- R2 A Director may approve invoices up to 500,000.
- R3 Anything above 500,000 needs two distinct approvers, and the second approver must be a director.
- R4 The same user may never count as both approvers on one invoice.
- R5 A rejected attempt returns a clear reason, and nothing about the invoice changes.

## What Changes

- **BREAKING** New roles `Manager` and `Director` replace `Approver`. Demo users become `demo.manager` (Manager), `demo.director` (Director), `demo.director2` (Director) and `demo.admin` (Admin), all with the demo password `ChangeMe123!`. `demo.approver` is removed. `Admin` keeps the right to reject and delete but has no approval authority.
- New Domain type `ApprovalLimits`: Manager 50,000.00, Director 500,000.00, any other role has no authority. Limits are inclusive ("up to").
- **BREAKING (internal API)** `ApprovalService.Approve(invoiceId, approver)` becomes `Approve(invoiceId, approver, approverRole)`. `ApprovalsController` passes the session role and is gated by `[RequireRole("Manager", "Director", "Admin")]`.
- New Domain exception `ApprovalDeniedException : InvalidOperationException`. A denied approval returns HTTP 409 `{ "error": "<reason>" }` through the existing `ApiControllerBase.Handle`. The reason is one of the canonical messages (D-31). Every check runs before the invoice changes and before the repository `Update` call.
- Two-approver flow for amounts above 500,000.00. `Invoice` gets `FirstApprovedBy` and `FirstApprovedAt`. The first approval (by a Manager or a Director) is recorded, and the status stays `PendingApproval`. The second approval must come from a different user who is a Director. No new status.
- New seeded pending invoices `INV-1006` (75,000.00) and `INV-1007` (750,000.00). The next generated number becomes 1008. Seeded `INV-1003.DecidedBy` changes from the removed `demo.approver` to `demo.director`.
- UI: the Approvals tab already shows the API `error` text in the `#decision-error` alert. A pending invoice with a first approval also shows `Awaiting second approval (first: <user>)`.
- Delivery in two commits:
  - Step 1 (commit C3): single-approver limits R1, R2 and R5. Amounts above 500,000.00 are denied with a temporary "not available yet" reason.
  - Step 2 (commit C4): the two-approver rule R3 and R4, which replaces the temporary reason.

## Capabilities

### New Capabilities

- `invoice-approval`: who may approve a pending invoice, depending on role and amount. Covers the single-approver limits, the two-approver rule above 500,000.00, distinct approvers, denial reasons and the guarantee that a denial changes nothing. Rejection stays unaffected.

### Modified Capabilities

(none: `openspec/specs/` holds no existing capability)

## Impact

- **Domain** (`backend/src/InvoiceApp.Domain`): new `ApprovalLimits.cs` and `ApprovalDeniedException.cs`. `ApprovalService.Approve` gets the new signature and the check order. `Invoice.cs` gets `FirstApprovedBy` and `FirstApprovedAt` (Step 2).
- **Api** (`backend/src/InvoiceApp.Api`): `ApprovalsController` (role gate, passes `session.Role`). `appsettings.json` (demo users). `InMemoryInvoiceRepository` (seeds, `_nextNumber`). `ApiControllerBase` is unchanged because the 409 mapping already exists.
- **UI** (`wwwroot/app.js`): adds the second-approval hint only. It contains no limit logic.
- **Tests** (`backend/tests/InvoiceApp.Tests`):
  - Rewrite `ApprovalServiceTests` for the new signature and the full rule matrix.
  - Add `ApprovalLimitsTests`.
  - `FakeInvoiceRepository` gets an `UpdateCalls` counter so tests can prove that nothing was saved.
- **E2E** (`e2e/`): page objects and one Playwright test. A Manager creates a 60,000 invoice and tries to approve it. The alert shows a reason containing `50,000`, and the invoice stays Pending Approval.
- **Docs**: `AGENTS.md` and `README.md` demo accounts and the `[RequireRole]` note change in Step 1. Mutation evidence goes in `docs/evidence/`, and review verdicts go in `docs/review/`.
- **Out of scope**:
  - Bulk approval (`docs/use-cases/UC-1-bulk-approval.md`).
  - Partial approval (`docs/use-cases/UC-2-partial-approval.md`).
  - Persistent storage: the repository stays in-memory.
  - Concurrency control for two simultaneous approvals of the same invoice. This is noted as a risk in design.md and not solved.
