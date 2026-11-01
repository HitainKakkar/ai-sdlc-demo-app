---
name: writing-approval-tests
description: How to write xUnit tests for the approval-limit rules in this repo — naming, FakeInvoiceRepository with UpdateCalls, the full test matrix, the denial assertion checklist for R4/R5, decimal boundary theories and a self-check that each test catches a real bug. Use it whenever you add or change tests in backend/tests/InvoiceApp.Tests.
---

# Writing approval tests (xUnit, `backend/tests/InvoiceApp.Tests`)

Load `approval-rules` too: it holds the rules, check order and canonical messages these tests pin down.

## Conventions
- One test class per class under test: `ApprovalServiceTests`, `ApprovalLimitsTests` (namespace `InvoiceApp.Tests`).
- New test names: `Method_Condition_ExpectedResult`, e.g. `Approve_ManagerAboveLimit_DeniesAndLeavesInvoiceUnchanged`. Keep existing names.
- Arrange / Act / Assert separated by blank lines; no logic (loops, ifs) in tests.
- Decimal literals always with `m` and `_`: `50_000.01m`. Never `double`.
- Existing exception types stay: not found → `KeyNotFoundException`, not pending → `InvalidOperationException`, empty reject reason → `ArgumentException`. Rule denials → `ApprovalDeniedException`.
- `Assert.Throws<T>` matches the **exact** type: use `Assert.Throws<ApprovalDeniedException>` for denials (not `ThrowsAny`, not the base type).

## Fake repository
`FakeInvoiceRepository` stores the **same object instances** you seed. Add (step 1):
```csharp
public int UpdateCalls { get; private set; }
public void Update(Invoice invoice) => UpdateCalls++;
```
Keep the repository in a variable so the test can read `UpdateCalls`:
```csharp
var invoice = PendingInvoice("INV-1", 50_000.01m);
var repository = new FakeInvoiceRepository(invoice);
var service = new ApprovalService(repository);
```
Because the instance is shared, a mutate-then-throw bug changes `invoice` even without `Update` — so assert on field values, not just on `UpdateCalls`.

## Denial assertion checklist (every R1/R3/R4/R5/no-authority denial)
1. Snapshot **values** before the call (not a reference):
   `var before = (invoice.Status, invoice.DecidedBy, invoice.DecidedAt, invoice.DecisionNote, invoice.FirstApprovedBy, invoice.FirstApprovedAt);`
2. `var ex = Assert.Throws<ApprovalDeniedException>(() => service.Approve("INV-1", "demo.manager", "Manager"));`
3. Message contains the specific parts: limit (`"50,000.00"` / `"500,000.00"`), invoice id (`"INV-1"`), and the user or role where the message has one (`"demo.director"`, `"Admin"`, `"Director"`).
4. Compare after: `Assert.Equal(before, (invoice.Status, invoice.DecidedBy, ...));` — `Status` still `PendingApproval`.
5. `Assert.Equal(0, repository.UpdateCalls);`
For a second-approval denial, seed `FirstApprovedBy`/`FirstApprovedAt` first and prove both are unchanged.

## Boundaries with `[Theory]`
`[InlineData]` cannot hold `decimal`. Use `TheoryData<decimal>`:
```csharp
public static TheoryData<decimal> ManagerAllowed => new() { 49_999.99m, 50_000.00m };
[Theory, MemberData(nameof(ManagerAllowed))]
public void Approve_ManagerAtOrBelowLimit_Approves(decimal amount) { ... }
```
(or `[InlineData("50000.01")]` + `decimal.Parse(value, CultureInfo.InvariantCulture)`).

## Test matrix (PLAN §5 — each row is a named test or theory row)
| Rule | Case | Expected |
|---|---|---|
| R1 | Manager 49,999.99 / 50,000.00 | Approved, `DecidedBy`, `DecidedAt` set, `UpdateCalls == 1` |
| R1 | Manager 50,000.01 | Denied (b); checklist |
| R2 | Director 500,000.00 | Approved alone |
| R2 | Director 500,000.01 | first approval only, still pending (the step-1 message (c) is retired) |
| R3 | >500k first by Manager / by Director | `PendingApproval`, `FirstApprovedBy` = approver, `FirstApprovedAt` set, `DecidedBy` null, `UpdateCalls == 1` |
| R3 | >500k second by different Director | Approved, `DecidedBy` = second, `FirstApprovedBy` kept |
| R3 | >500k second by a different Manager | Denied (e); checklist |
| R4 | >500k second by same user | Denied (d); checklist |
| R4 | same user, different case / extra spaces (`"Demo.Director"`, `" demo.director "`) | Denied (d); checklist |
| R5 | every denial above | checklist items 1–5 |
| — | Admin / `"Approver"` / `""` / unknown role approve | Denied (a); checklist |
| — | Reject by Manager on 1,000,000 | Rejected, reason stored |
| — | Reject after first approval | Rejected, `FirstApprovedBy` kept |
| — | `ApprovalLimitsTests`: `LimitFor` Manager 50,000; Director 500,000; Admin/unknown/empty → null; constants | values exact |
| — | existing lifecycle tests | still pass with the new signature |

## Run
```
dotnet test backend/InvoiceApp.sln
dotnet test backend/InvoiceApp.sln --filter "FullyQualifiedName~ApprovalServiceTests"
```
If `dotnet` is not on PATH: `"$LOCALAPPDATA/Microsoft/dotnet/dotnet.exe" test backend/InvoiceApp.sln`. Paste the real `Passed!/Failed!` summary line.

## Self-check: would this test catch a real mistake?
For each test, name the production bug it kills. If you cannot, the test is weak.
- `<=` changed to `<` at 50,000.00 or 500,000.00 → boundary "approved" rows fail?
- Threshold `>` changed to `>=` → Director 500,000.00 alone fails?
- Status set before the throw → field snapshot comparison fails?
- `_repository.Update` removed from a success path → `UpdateCalls == 1` fails?
- `Update` called on a denial path → `UpdateCalls == 0` fails?
- `OrdinalIgnoreCase` → `Ordinal`, or `Trim()` dropped → case/space R4 row fails?
- Director check on the second approver removed → R3 Manager-second row fails?
- `LimitFor("Admin")` returns a number → no-authority row fails?
- Message reduced to `""` or a generic text → `Assert.Contains` on limit/id fails?
- Reject starts enforcing limits → Manager-rejects-1,000,000 row fails?
