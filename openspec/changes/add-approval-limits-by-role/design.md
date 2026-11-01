# Design

## Context

See proposal.md (Why) for the motivation and specs/invoice-approval/spec.md for the required behaviour. The current code that shapes the approach:

- `ApprovalService.Approve(invoiceId, approver)` runs `Find` (`KeyNotFoundException`), then `EnsurePending` (`InvalidOperationException`), then sets `Status`, `DecidedBy` and `DecidedAt`, then calls `_repository.Update`. It has no role and no amount checks.
- `ApprovalsController` is `[RequireRole("Approver", "Admin")]` and passes only `HttpContext.GetSession().Username`. `RequireRoleAttribute` matches role names exactly (`_roles.Contains(session.Role)`) and returns 403 otherwise.
- `ApiControllerBase.Handle` already maps `KeyNotFoundException` to 404, `InvalidOperationException` to 409 `{ error }` and `ArgumentException` to 400.
- `wwwroot/app.js` `decide()` shows `error.message`, taken from the API `error` field, in `#decision-error` (`role="alert"`). The pending list is `invoices.filter(i => i.status === 'PendingApproval')`.
- `InMemoryInvoiceRepository` returns the same object instances it stores. Any field set on an invoice before a throw is therefore visible to every later reader, even if `Update` is never called.
- `FakeInvoiceRepository.Update` is a no-op today.

Binding decisions: `docs/decisions/DECISIONS.md` D-04 to D-10, D-31, D-33 to D-36.

## Goals / Non-Goals

**Goals:**

- All approval rules in the Domain (`ApprovalService` plus `ApprovalLimits`). The controller and the UI only pass data along and show it.
- Every denial is decided before any state change. This is provable in unit tests by checking the fields on the same instance and an `UpdateCalls` counter.
- One canonical message set, shared by code, unit tests, the e2e test, the spec and the docs.
- Two independently committed steps that each build and pass tests.

**Non-Goals:**

- New invoice statuses or a separate approvals table.
- Configurable limits (they are constants) and currency handling.
- Optimistic concurrency or locking for two approvals that arrive at the same time.
- Changing `Submit`, `Reject` validation or the 404, existing-409 and 400 paths.

## Decisions

### D1 Roles and limits live in `ApprovalLimits` (D-05, D-36)

| Role (exact, case-sensitive) | `LimitFor(role)` | May approve alone | Notes |
| --- | --- | --- | --- |
| `Manager` | `ManagerLimit = 50_000m` | amount <= 50,000.00 | may give the first approval above 500,000.00 |
| `Director` | `DirectorLimit = 500_000m` | amount <= 500,000.00 | the only role that may give the second approval |
| `Admin`, `Approver`, `""`, `null`, anything else | `null` | never | Admin may still reject and delete |

There is also `TwoApproverThreshold = 500_000m`. Two approvers are needed when `amount > TwoApproverThreshold`, so 500,000.00 can still be approved by one Director (D-08, inclusive).

`LimitFor` returns `decimal?`, and `null` means no authority. **Alternative rejected:** `decimal.MaxValue` or `0` for no authority. `MaxValue` turns a missing role into unlimited authority (the worst failure). `0` would make Admin's denial look like an amount problem instead of a role problem.

Role names are matched exactly (`"Manager"`, `"Director"`), the same way `RequireRoleAttribute` matches them. **Alternative rejected:** case-insensitive role matching. It would let the Domain accept roles that the endpoint gate would refuse, so the two layers would disagree.

### D2 Signature `Approve(string invoiceId, string approver, string approverRole)` (D-06)

The controller passes `session.Username` and `session.Role`, so the Domain never sees the session type. The controller attribute becomes `[RequireRole("Manager", "Director", "Admin")]`. The attribute only gates the endpoint. Admin passes the gate so that the Domain can return the clear no-authority reason (a) and not a bare 403. Other roles get 403 from the gate before the Domain runs. The Domain still denies them with (a) when called directly, for example in unit tests.

### D3 Check order, with every check before any mutation (D-10, D-36)

```
approver blank                     -> ArgumentException (400) (D-40, added after the step-2 test review)
Find(invoiceId)                    -> KeyNotFoundException (404), unchanged
EnsurePending(invoice)             -> InvalidOperationException (409), existing message unchanged
limit = LimitFor(approverRole)     -> null: deny (a)
if amount > TwoApproverThreshold:
    Step 1 (C3 only, retired in C4): deny (c)
    Step 2:
        FirstApprovedBy null/blank -> record first approval, Update, return (200)
        SameUser(first, approver)  -> deny (d)          // before the role check
        role != "Director"         -> deny (e)
        else                       -> Approved, DecidedBy = approver, DecidedAt = now, keep FirstApproved*, Update
else if amount > limit             -> deny (b)          // only a Manager can reach this
else                               -> Approved, DecidedBy, DecidedAt, Update
```

A denial branch throws before any assignment, and `_repository.Update` is called only on the two success paths. **Alternative rejected:** mutate, then validate, then roll back. This is the classic mutate-then-throw bug: with the shared in-memory instance, the partial change survives.

The same-user check (d) runs before the Director check (e) (D-36). A Manager who repeats their own first approval is told the more fundamental problem (R4). D-31 does not fix this order. We chose it, and the spec pins it with a scenario.

### D4 `ApprovalDeniedException : InvalidOperationException` mapped to HTTP 409 (D-07)

The new exception type lives in the Domain. Deriving from `InvalidOperationException` means that `ApiControllerBase.Handle` already maps it to 409 `{ "error": message }`, and `app.js` already shows it, with no plumbing changes. Tests can tell a rule denial from the existing not-pending 409 by the exception type. **Alternatives rejected:**

- A new HTTP code such as 403 or 422, which needs changes to `Handle`.
- Result objects instead of exceptions, which would mean a larger refactor of every caller.

### D5 Canonical messages (D-31, verbatim)

Amounts are formatted `amount.ToString("N2", CultureInfo.InvariantCulture)`, so the server culture cannot change the text (invariant N2: `50,000.00`, never `50.000,00`). The examples below use the seeded invoices. The invoice id, the amounts, the user and the role are filled in from the request.

| | Case | Message |
| --- | --- | --- |
| a | No authority | `Role 'Admin' cannot approve invoices. Only a Manager or a Director can approve.` |
| b | Over Manager limit | `A Manager may approve invoices up to 50,000.00; invoice INV-1006 is 75,000.00. A Director must approve it.` |
| c | Above 500,000 (**Step 1 only**, removed in Step 2) | `Invoice INV-1007 is 750,000.00, above 500,000.00, and needs two approvers; two-approver approval is not available yet.` |
| d | Same user twice | `demo.director already gave the first approval for invoice INV-1007; the second approval must come from a different person.` |
| e | Second approver not a Director | `The second approval for invoice INV-1007 (above 500,000.00) must come from a Director; demo.manager is a Manager.` |

In (a), the role is shown as received (an empty role gives `Role ''`). In (d), the name is the stored `FirstApprovedBy` value, not the case or space variant that was just attempted. In (e), the name and role are those of the current approver. Unit tests assert the key parts: the limit, the invoice id, the user and the role.

### D6 Identity comparison for R4 (D-09, D-34)

`string.Equals(first?.Trim(), approver?.Trim(), StringComparison.OrdinalIgnoreCase)`. This treats `demo.director`, `Demo.Director` and ` demo.director ` as the same person. The comparison is against `FirstApprovedBy`, never against `DecidedBy`. **Alternative rejected:** ordinal `==`. Demo user names are lower case today, but a login that preserves case, or a stray space, would let one person give both approvals.

Added after the step-2 test review (finding T-07, decision D-40): a recorded first approver that is empty or whitespace does not count as a first approval (`string.IsNullOrWhiteSpace`), and `Approve` rejects a blank approver name with `ArgumentException` (HTTP 400) before anything else. Through the API the approver is always the session username, so this only hardens the Domain: R3 holds even if a caller passes bad input. The comparison is ordinal on purpose; a test under the `tr-TR` culture (finding T-06) pins that it does not depend on the server's culture.

### D7 Data model: `FirstApprovedBy` and `FirstApprovedAt`, no new status (D-09)

`Invoice` gets `string? FirstApprovedBy` and `DateTime? FirstApprovedAt`, added in Step 2. After the first approval, the invoice stays `PendingApproval`, so the UI pending filter, `Reject` and `EnsurePending` keep working without changes. On the second approval, `DecidedBy` and `DecidedAt` hold the second (final) approver, and the first approver is kept for audit. `Reject` does not touch the `FirstApproved*` fields. **Alternative rejected:** an `AwaitingSecondApproval` status. It has a wider blast radius (UI filter, `EnsurePending`, `Reject`, seeds), and R3 does not need it.

### D8 API and UI impact

- **API:** same routes. The invoice JSON gains `firstApprovedBy` and `firstApprovedAt`. A denial returns 409 `{ "error": "<reason>" }`. A first approval returns 200 with the still-pending invoice.
- **UI (`app.js` `renderPending`):** when `invoice.firstApprovedBy` is set, the entry also shows `Awaiting second approval (first: <firstApprovedBy>)`. There is no limit logic in JavaScript, and denial text comes only from the API.
- **Seeds (`InMemoryInvoiceRepository`):**
  - Add `INV-1006` (75,000.00, `PendingApproval`) and `INV-1007` (750,000.00, `PendingApproval`).
  - Set `_nextNumber = 1008`.
  - Change `INV-1003.DecidedBy` to `demo.director` (D-36).
- **Users (`appsettings.json`):** `demo.manager`, `demo.director`, `demo.director2` and `demo.admin`. Remove `demo.approver` (D-04, D-33: README and AGENTS.md change in the same commit, C3).

### D9 Step 1 compared with Step 2

| | Step 1 (commit C3) | Step 2 (commit C4) |
| --- | --- | --- |
| Rules | authority, R1, R2, R5 | adds R3 and R4 |
| Amount > 500,000.00 | denied for every role with (c) | first or second approval flow, (d) and (e) |
| `Invoice` | unchanged | `FirstApprovedBy` and `FirstApprovedAt` |
| UI | none (the alert already works) | second-approval hint |
| Tests | authority, boundary 49,999.99 to 500,000.00, (b), (c), reject, `UpdateCalls` | R3 and R4 matrix; the (c) tests are replaced by first-approval tests |

Message (c) exists only at commit C3, so it is not a requirement in the spec, which describes the final state. In Step 1, the Admin check (a) still comes before (c), so Admin on INV-1007 gets (a).

## Risks / Trade-offs

- [In-memory repository shares instances, so mutate-then-throw corrupts live state without `Update`] → All checks come before any assignment (D3). Every denial test asserts all six fields on the same instance plus `UpdateCalls == 0`.
- [Two approvals of the same > 500,000 invoice at the same time can both be read as "first"] → Accepted as out of scope. The repository has a lock per call, not per check-and-update. This is recorded here and in the proposal. A real store would need a row version or optimistic concurrency.
- [Exact-case role matching: a misconfigured `"manager"` user has no authority] → Matches `RequireRoleAttribute`, and a scenario pins it. Roles come from `appsettings.json`, which we control.
- [Admin passes the endpoint gate but cannot approve] → Intended, so that Admin gets reason (a) and not a bare 403.
- [Message (c) is temporary] → It is in design.md and tasks.md only. Step 2 removes it, and its tests are replaced in C4.
- [Changing the signature breaks existing tests] → `ApprovalServiceTests` is adapted in C3, and existing lifecycle tests keep their intent.

## Testing strategy

- **Unit tests (xUnit, `backend/tests/InvoiceApp.Tests`):**
  - `ApprovalLimitsTests` for `LimitFor` (Manager, Director, Admin, `Approver`, `""`, `null`, `manager`).
  - `ApprovalServiceTests` covers the the test matrix in `docs/decisions/DECISIONS.md` matrix: boundaries 49,999.99 / 50,000.00 / 50,000.01 / 500,000.00 / 500,000.01, the R3 first and second approvals, R4 exact / case / spaces, (e), Admin / unknown / empty, reject with no limit, and reject after a first approval.
  - Names follow `Method_Condition_ExpectedResult`.
- **Denial assertions:** each denial test checks four things:
  - `ApprovalDeniedException`.
  - The message key parts.
  - `Status`, `DecidedBy`, `DecidedAt`, `DecisionNote`, `FirstApprovedBy` and `FirstApprovedAt` unchanged.
  - `FakeInvoiceRepository.UpdateCalls == 0`. `Update` increments this new counter.
- **E2E (Playwright, one test):** `demo.manager` creates a 60,000 invoice in the UI, submits it and approves it on the Approvals tab. The alert contains `50,000`, and the invoice is still "Pending Approval". The test uses page objects in `e2e/pages/` and role-based locators only.
- **Mutation (Stryker.NET 4.13.0 on `InvoiceApp.Domain`):** the BEFORE score is already recorded in `docs/evidence/stryker-before.md`. AFTER runs go in `docs/evidence/stryker-after-1.md` and `stryker-after-final.md`. Each surviving mutant in approval code is killed or explained. The score must not go down.
