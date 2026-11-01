---
name: approval-rules
description: Single source of truth for the invoice approval-limit rules R1–R5 as implemented in this repo (roles, limits, two-approver flow, check order, canonical denial messages, boundaries, known wrong implementations). Use it whenever you write, test, review, specify or explain anything about who may approve which invoice amount.
---

# Approval rules (R1–R5) — as implemented

Binding sources: `docs/decisions/DECISIONS.md` D-04..D-10, D-31. If code and this file disagree, stop and report; do not silently pick one.

## Rules (verbatim from the brief)
- **R1** A Manager may approve invoices up to 50,000.
- **R2** A Director may approve invoices up to 500,000.
- **R3** Anything above 500,000 needs two distinct approvers, and the second approver must be a Director.
- **R4** (negative) The same user may never count as both approvers on one invoice.
- **R5** (negative) A rejected attempt returns a clear reason, and nothing about the invoice changes.

## Roles and limits (`InvoiceApp.Domain.ApprovalLimits`)
| Role | `LimitFor(role)` | May approve alone | Notes |
|---|---|---|---|
| `Manager` | `50_000m` (`ManagerLimit`) | amount ≤ 50,000.00 | may give the *first* approval above 500,000 |
| `Director` | `500_000m` (`DirectorLimit`) | amount ≤ 500,000.00 | the only role that may give the *second* approval |
| `Admin`, `Approver`, empty, null, anything else | `null` | never | Admin keeps delete rights and may still **reject** |

- Limits are **inclusive** ("up to"). `TwoApproverThreshold = 500_000m`; two approvers are needed when `amount > 500_000m`.
- Role names are matched exactly as configured in `appsettings.json` (`"Manager"`, `"Director"`), like `RequireRoleAttribute` does. (Decision D-36; pinned by tests, including lower-case and padded role names.)
- Demo users (from C3 on): `demo.manager` (Manager), `demo.director` / `demo.director2` (Director), `demo.admin` (Admin); password `ChangeMe123!`. `demo.approver` is removed.
- Limits apply to **approve only**. `Reject` works for Manager/Director/Admin at any amount and keeps `FirstApprovedBy`.

## Signature and check order (`ApprovalService.Approve(string invoiceId, string approver, string approverRole)`)
Every check runs **before any field is changed and before `_repository.Update`**:
0. `approver` null/empty/whitespace → `ArgumentException` (400) before anything else (D-40).
1. `Find(invoiceId)` → `KeyNotFoundException` (404) if missing.
2. `EnsurePending` → `InvalidOperationException` (409) if not `PendingApproval` (existing message, unchanged).
3. `ApprovalLimits.LimitFor(approverRole)` is `null` → deny with message (a).
4. `invoice.Amount > TwoApproverThreshold`?
   - *(Historical — commit C3 only, retired in C4: deny with message (c). Must not come back.)*
   - **Step 2 (commit C4):**
     - `FirstApprovedBy` is null, empty or whitespace (D-40) → record first approval: `FirstApprovedBy = approver`, `FirstApprovedAt = UtcNow`, status stays `PendingApproval`, `DecidedBy/DecidedAt` stay null, call `Update`, return (HTTP 200).
     - `FirstApprovedBy` set and equal to `approver` (both `Trim()`ed, `StringComparison.OrdinalIgnoreCase`) → deny with (d).
     - role is not `Director` → deny with (e).
     - otherwise → `Status = Approved`, `DecidedBy = approver` (second), `DecidedAt = UtcNow`, keep `FirstApprovedBy/At`, `Update`.
   - else `invoice.Amount > limit` → deny with (b) (only a Manager can hit this).
5. Approve: `Status = Approved`, `DecidedBy`, `DecidedAt`, `Update`, return.

Same-user (d) is checked before the Director check (e), so a Manager who repeats their own first approval gets the R4 message (order inside step 2 is our choice; D-31 does not fix it).

## Errors → HTTP → UI
`ApprovalDeniedException : InvalidOperationException` (Domain). `ApiControllerBase.Handle` maps it to **409** `{ "error": "<message>" }`; `app.js` shows `error` verbatim in `#decision-error` (`role="alert"`). No controller logic: `ApprovalsController` only passes `HttpContext.GetSession().Username` and `.Role`; its attribute is `[RequireRole(ApprovalLimits.ManagerRole, ApprovalLimits.DirectorRole, "Admin")]`; any other signed-in role gets a bare 403 before the Domain runs.

## Canonical messages (D-31, verbatim; amounts `ToString("N2", CultureInfo.InvariantCulture)`)
- (a) `Role 'Admin' cannot approve invoices. Only a Manager or a Director can approve.`
- (b) `A Manager may approve invoices up to 50,000.00; invoice INV-1006 is 75,000.00. A Director must approve it.`
- (c) *retired in C4 — must not appear in code or tests:* `Invoice INV-1007 is 750,000.00, above 500,000.00, and needs two approvers; two-approver approval is not available yet.`
- (d) `demo.director already gave the first approval for invoice INV-1007; the second approval must come from a different person.`
- (e) `The second approval for invoice INV-1007 (above 500,000.00) must come from a Director; demo.manager is a Manager.`

## Boundary table
| Amount | Manager | Director | Admin |
|---|---|---|---|
| 49,999.99 / 50,000.00 | Approved | Approved | (a) |
| 50,000.01 | (b) | Approved | (a) |
| 500,000.00 | (b) | Approved alone | (a) |
| 500,000.01 | first approval (records `FirstApprovedBy`) | first approval only, never alone | (a) |
| second approval > 500,000 | (e) (or (d) if same user) | Approved if different user, else (d) | (a) |

## Wrong implementations to avoid (look right, are not)
- **Mutate-then-throw:** setting `Status`/`DecidedBy`/`FirstApprovedBy` and then throwing. With the in-memory repository the object is shared, so the change "sticks" even without `Update`. All checks first.
- Calling `Update` before a later check fails, or on a denial path.
- **Case-sensitive or untrimmed identity:** `first == approver`, so `Demo.Director` or `"demo.director "` passes as a second person.
- Comparing the approver with `DecidedBy` instead of `FirstApprovedBy`.
- **Checking only the second approver's role** but not that the users differ — or vice versa.
- Letting a Director approve `500,000.01` alone (`>=`/`>` mix-up, or `amount <= DirectorLimit` check before the threshold branch).
- Using `>=` for the threshold, so 500,000.00 needs two approvers (violates inclusive R2).
- Giving Admin (or unknown roles) unlimited authority; treating `null` limit as "no limit".
- Applying limits to `Reject`, or clearing `FirstApprovedBy` on reject.
- Culture-dependent formatting (`50.000,00`) or messages missing the invoice id / limit / user.
- Business rules in `ApprovalsController` or `RequireRole` instead of the Domain.
