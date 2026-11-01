# Invoice Approval Demo App

A small invoice approval app used for live AI-in-SDLC demos. It is deliberately simple: a .NET 8 API, a plain web UI, and an in-memory store, so it runs with one command and no database.

## Run it

```
dotnet run --project backend/src/InvoiceApp.Api
```

Open http://localhost:5000 and sign in:

| User | Password | Role |
| --- | --- | --- |
| `demo.manager` | `ChangeMe123!` | Manager |
| `demo.director` | `ChangeMe123!` | Director |
| `demo.director2` | `ChangeMe123!` | Director |
| `demo.admin` | `ChangeMe123!` | Admin |

These are demo accounts for a local, in-memory app. They are not real credentials.

## What it does

1. Create an invoice (it starts as a draft).
2. Submit it for approval.
3. A Manager or Director approves it within their limit, or anyone with access rejects it with a reason.

Approval limits by role:

| Role | May approve alone |
| --- | --- |
| Manager | up to 50,000.00 |
| Director | up to 500,000.00 |
| Admin | cannot approve (may reject and delete) |

Invoices above 500,000.00 need two different approvers: the first approval (Manager or Director) keeps the invoice pending and shows "Awaiting second approval (first: ...)"; the second must come from a Director who is not the first approver. A denied approval returns HTTP 409 with the reason, the UI shows it, and the invoice does not change.

Try it with the seeded invoices: `INV-1006` (75,000.00) is denied for `demo.manager` and approved by `demo.director`; `INV-1007` (750,000.00) needs `demo.manager` or `demo.director` first, then a different Director (`demo.director2`).

Invoices move through Draft, Pending Approval, then Approved or Rejected.

## Tests

```
dotnet test backend/InvoiceApp.sln
```

## Project layout

```
backend/
  src/InvoiceApp.Domain   business rules
  src/InvoiceApp.Api      controllers, sign-in, web UI (wwwroot)
  tests/InvoiceApp.Tests  xUnit tests
docs/use-cases            short feature briefs
openspec/                 OpenSpec specification (change add-approval-limits-by-role)
AGENTS.md                 conventions for AI coding agents
```

## Use cases

- [UC-1 Bulk invoice approval](docs/use-cases/UC-1-bulk-approval.md)
- [UC-2 Partial approval](docs/use-cases/UC-2-partial-approval.md)
