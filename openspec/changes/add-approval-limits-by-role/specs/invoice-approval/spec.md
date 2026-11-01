# Spec Delta

## Purpose

Decides who may approve a pending invoice based on the approver's role and the invoice amount, requires two distinct approvers (the second a Director) above 500,000.00, and guarantees that a denied approval returns a clear reason and leaves the invoice unchanged.

## ADDED Requirements

### Requirement: Approval authority by role
Only the roles `Manager` and `Director` SHALL have approval authority. Role names MUST match exactly as configured. An approval attempt by any other role, including `Admin`, an unknown role or an empty role, MUST be denied with the no-authority reason, regardless of the invoice amount.

#### Scenario: Admin cannot approve
- **GIVEN** a pending invoice INV-1001 of 4,250.00
- **WHEN** `demo.admin` (role `Admin`) approves it
- **THEN** the approval is denied with the reason `Role 'Admin' cannot approve invoices. Only a Manager or a Director can approve.`
- **AND** the invoice is unchanged

#### Scenario: Unknown role cannot approve
- **GIVEN** a pending invoice of 100.00
- **WHEN** a user whose role is `Approver` approves it
- **THEN** the approval is denied with a reason that names the role `Approver` and states `Only a Manager or a Director can approve.`
- **AND** the invoice is unchanged

#### Scenario: Empty role cannot approve
- **GIVEN** a pending invoice of 100.00
- **WHEN** a user with an empty role approves it
- **THEN** the approval is denied with a reason that states `Only a Manager or a Director can approve.`
- **AND** the invoice is unchanged

#### Scenario: Role names are not matched loosely
- **GIVEN** a pending invoice of 100.00
- **WHEN** a user whose role is `manager` (lower case) approves it
- **THEN** the approval is denied with a reason that names the role `manager` and states `Only a Manager or a Director can approve.`

### Requirement: Manager approval limit
A Manager SHALL be able to approve, alone, a pending invoice whose amount is at most 50,000.00 (the limit is inclusive). A Manager MUST be denied for any amount above 50,000.00 up to and including 500,000.00, with a reason that names the limit, the invoice id and the amount.

#### Scenario: Manager approves just below the limit
- **GIVEN** a pending invoice of 49,999.99
- **WHEN** `demo.manager` approves it
- **THEN** the invoice status is `Approved`
- **AND** `DecidedBy` is `demo.manager` and `DecidedAt` is set

#### Scenario: Manager approves exactly at the limit
- **GIVEN** a pending invoice of 50,000.00
- **WHEN** `demo.manager` approves it
- **THEN** the invoice status is `Approved`
- **AND** `DecidedBy` is `demo.manager` and `DecidedAt` is set

#### Scenario: Manager is denied one cent above the limit
- **GIVEN** a pending invoice INV-2001 of 50,000.01
- **WHEN** `demo.manager` approves it
- **THEN** the approval is denied with the reason `A Manager may approve invoices up to 50,000.00; invoice INV-2001 is 50,000.01. A Director must approve it.`
- **AND** the invoice is unchanged

#### Scenario: Manager is denied on the seeded 75,000 invoice
- **GIVEN** the seeded pending invoice INV-1006 of 75,000.00
- **WHEN** `demo.manager` approves it
- **THEN** the approval is denied with the reason `A Manager may approve invoices up to 50,000.00; invoice INV-1006 is 75,000.00. A Director must approve it.`
- **AND** the invoice is unchanged

#### Scenario: Manager is denied at the Director limit
- **GIVEN** a pending invoice INV-2002 of 500,000.00
- **WHEN** `demo.manager` approves it
- **THEN** the approval is denied with the reason `A Manager may approve invoices up to 50,000.00; invoice INV-2002 is 500,000.00. A Director must approve it.`
- **AND** the invoice is unchanged

### Requirement: Director approval limit
A Director SHALL be able to approve, alone, a pending invoice whose amount is at most 500,000.00 (the limit is inclusive). A Director MUST NOT be able to approve, alone, an invoice whose amount is above 500,000.00.

#### Scenario: Director approves above the Manager limit
- **GIVEN** a pending invoice of 50,000.01
- **WHEN** `demo.director` approves it
- **THEN** the invoice status is `Approved` and `DecidedBy` is `demo.director`

#### Scenario: Director approves the seeded 75,000 invoice
- **GIVEN** the seeded pending invoice INV-1006 of 75,000.00
- **WHEN** `demo.director` approves it
- **THEN** the invoice status is `Approved` and `DecidedBy` is `demo.director`

#### Scenario: Director approves alone exactly at the limit
- **GIVEN** a pending invoice of 500,000.00
- **WHEN** `demo.director` approves it
- **THEN** the invoice status is `Approved`
- **AND** `DecidedBy` is `demo.director`, `DecidedAt` is set and `FirstApprovedBy` stays empty

#### Scenario: Director cannot approve alone one cent above the limit
- **GIVEN** a pending invoice of 500,000.01 with no first approval
- **WHEN** `demo.director` approves it
- **THEN** the invoice status stays `PendingApproval`
- **AND** `DecidedBy` and `DecidedAt` stay empty
- **AND** the approval is recorded only as the first approval (`FirstApprovedBy` is `demo.director`)

### Requirement: Two approvers above 500,000
An invoice whose amount is above 500,000.00 SHALL need two approvals. The first approval MUST come from a Manager or a Director: it succeeds, records `FirstApprovedBy` and `FirstApprovedAt` and leaves the invoice `PendingApproval`. A valid second approval SHALL approve the invoice: `DecidedBy` and `DecidedAt` are set and the first approver is kept.

#### Scenario: First approval by a Manager keeps the invoice pending
- **GIVEN** the seeded pending invoice INV-1007 of 750,000.00 with no first approval
- **WHEN** `demo.manager` approves it
- **THEN** the request succeeds with HTTP 200
- **AND** the invoice status stays `PendingApproval`
- **AND** `FirstApprovedBy` is `demo.manager` and `FirstApprovedAt` is set
- **AND** `DecidedBy` and `DecidedAt` stay empty

#### Scenario: First approval by a Director keeps the invoice pending
- **GIVEN** the seeded pending invoice INV-1007 of 750,000.00 with no first approval
- **WHEN** `demo.director` approves it
- **THEN** the request succeeds with HTTP 200
- **AND** the invoice status stays `PendingApproval`
- **AND** `FirstApprovedBy` is `demo.director` and `FirstApprovedAt` is set

#### Scenario: Second approval by a different Director approves the invoice
- **GIVEN** invoice INV-1007 of 750,000.00 whose first approval was given by `demo.director`
- **WHEN** `demo.director2` approves it
- **THEN** the invoice status is `Approved`
- **AND** `DecidedBy` is `demo.director2` and `DecidedAt` is set
- **AND** `FirstApprovedBy` is still `demo.director` and `FirstApprovedAt` is unchanged

#### Scenario: Manager first, Director second approves the invoice
- **GIVEN** invoice INV-1007 of 750,000.00 whose first approval was given by `demo.manager`
- **WHEN** `demo.director` approves it
- **THEN** the invoice status is `Approved`
- **AND** `DecidedBy` is `demo.director` and `FirstApprovedBy` is still `demo.manager`

#### Scenario: Two approvals are needed one cent above the threshold
- **GIVEN** a pending invoice of 500,000.01 whose first approval was given by `demo.manager`
- **WHEN** `demo.director` approves it
- **THEN** the invoice status is `Approved` and `DecidedBy` is `demo.director`

#### Scenario: A blank recorded first approver is not a first approval
- **GIVEN** a pending invoice of 750,000.00 whose recorded first approver is empty or only spaces
- **WHEN** `demo.director` approves it
- **THEN** the approval is recorded as the first approval (`FirstApprovedBy` is `demo.director`)
- **AND** the invoice status stays `PendingApproval` and `DecidedBy` stays empty

### Requirement: Same user never counts as both approvers
On an invoice above 500,000.00 that already has a first approval, a second approval by the same user MUST be denied. User names SHALL be compared after trimming surrounding spaces and ignoring letter case. This check MUST run before the check that the second approver is a Director.

#### Scenario: Same Director approves twice
- **GIVEN** invoice INV-1007 of 750,000.00 whose first approval was given by `demo.director`
- **WHEN** `demo.director` approves it again
- **THEN** the approval is denied with the reason `demo.director already gave the first approval for invoice INV-1007; the second approval must come from a different person.`
- **AND** the invoice is unchanged

#### Scenario: Same user with different letter case
- **GIVEN** invoice INV-1007 of 750,000.00 whose first approval was given by `demo.director`
- **WHEN** a Director identified as `Demo.Director` approves it
- **THEN** the approval is denied with the reason `demo.director already gave the first approval for invoice INV-1007; the second approval must come from a different person.`
- **AND** the invoice is unchanged

#### Scenario: Same user with surrounding spaces
- **GIVEN** invoice INV-1007 of 750,000.00 whose first approval was given by `demo.director`
- **WHEN** a Director identified as ` demo.director ` (with leading and trailing spaces) approves it
- **THEN** the approval is denied with the reason `demo.director already gave the first approval for invoice INV-1007; the second approval must come from a different person.`
- **AND** the invoice is unchanged

#### Scenario: Manager repeating their own first approval gets the same-user reason
- **GIVEN** invoice INV-1007 of 750,000.00 whose first approval was given by `demo.manager`
- **WHEN** `demo.manager` approves it again
- **THEN** the approval is denied with the reason `demo.manager already gave the first approval for invoice INV-1007; the second approval must come from a different person.`
- **AND** the invoice is unchanged

### Requirement: Second approver must be a Director
On an invoice above 500,000.00 that already has a first approval, a second approval by a different user who is not a Director MUST be denied with a reason that names the invoice, the threshold, the user and the user's role.

#### Scenario: Different-user Manager as second approver
- **GIVEN** invoice INV-1007 of 750,000.00 whose first approval was given by `demo.director`
- **WHEN** `demo.manager` approves it
- **THEN** the approval is denied with the reason `The second approval for invoice INV-1007 (above 500,000.00) must come from a Director; demo.manager is a Manager.`
- **AND** the invoice is unchanged and `FirstApprovedBy` is still `demo.director`

### Requirement: Denied approval changes nothing
A denied approval MUST NOT change any field of the invoice and MUST NOT save the invoice. Over HTTP, a denied approval SHALL return status 409 with the body `{ "error": "<reason>" }`. Amounts in reasons MUST be formatted with a comma thousands separator and two decimals (`50,000.00`), whatever the server culture.

#### Scenario: Denial leaves every decision field unchanged
- **GIVEN** a pending invoice of 75,000.00 with `Status`, `DecidedBy`, `DecidedAt`, `DecisionNote`, `FirstApprovedBy` and `FirstApprovedAt` recorded before the attempt
- **WHEN** `demo.manager` approves it and is denied
- **THEN** `Status` is still `PendingApproval`
- **AND** `DecidedBy`, `DecidedAt`, `DecisionNote`, `FirstApprovedBy` and `FirstApprovedAt` are equal to their values before the attempt
- **AND** the invoice is not saved to the repository

#### Scenario: Denial after a first approval keeps the first approval
- **GIVEN** invoice INV-1007 of 750,000.00 whose first approval was given by `demo.director`
- **WHEN** `demo.director` approves it again and is denied
- **THEN** `FirstApprovedBy` is still `demo.director` and `FirstApprovedAt` is unchanged
- **AND** `Status` is still `PendingApproval` and `DecidedBy` and `DecidedAt` stay empty
- **AND** the invoice is not saved to the repository

#### Scenario: Denied approval over HTTP returns 409 with the reason
- **GIVEN** `demo.manager` is signed in and invoice INV-1006 of 75,000.00 is pending
- **WHEN** they send `POST /api/approvals/INV-1006/approve`
- **THEN** the response status is 409
- **AND** the body is `{ "error": "A Manager may approve invoices up to 50,000.00; invoice INV-1006 is 75,000.00. A Director must approve it." }`
- **AND** a following `GET /api/invoices/INV-1006` shows status `PendingApproval` with `decidedBy` empty

#### Scenario: Reason format does not depend on server culture
- **GIVEN** the server runs under a culture that writes numbers as `50.000,00`
- **WHEN** `demo.manager` is denied on invoice INV-1006 of 75,000.00
- **THEN** the reason contains `50,000.00` and `75,000.00`

### Requirement: Rejection is not limited by amount
Approval limits SHALL apply to approving only. A Manager, a Director or an Admin MUST be able to reject a pending invoice of any amount with a reason. Rejecting an invoice that has a first approval MUST keep `FirstApprovedBy` and `FirstApprovedAt`.

#### Scenario: Manager rejects a 1,000,000 invoice
- **GIVEN** a pending invoice of 1,000,000.00
- **WHEN** `demo.manager` rejects it with the reason "Duplicate"
- **THEN** the invoice status is `Rejected`
- **AND** `DecidedBy` is `demo.manager` and `DecisionNote` is "Duplicate"

#### Scenario: Admin rejects an invoice above the Manager limit
- **GIVEN** the seeded pending invoice INV-1006 of 75,000.00
- **WHEN** `demo.admin` rejects it with the reason "Wrong customer"
- **THEN** the invoice status is `Rejected` and `DecidedBy` is `demo.admin`

#### Scenario: Reject after a first approval keeps the first approver
- **GIVEN** invoice INV-1007 of 750,000.00 whose first approval was given by `demo.manager`
- **WHEN** `demo.director` rejects it with the reason "Budget exceeded"
- **THEN** the invoice status is `Rejected` and `DecidedBy` is `demo.director`
- **AND** `FirstApprovedBy` is still `demo.manager` and `FirstApprovedAt` is unchanged

### Requirement: Approvals view shows the denial reason
When an approval is denied, the Approvals tab of the web UI SHALL show the reason returned by the API verbatim in its alert. The invoice MUST stay in the pending list. The UI MUST NOT apply approval limits itself.

#### Scenario: Manager sees why an over-limit approval was denied
- **GIVEN** `demo.manager` is signed in and has created and submitted an invoice of 60,000.00
- **WHEN** they click Approve for that invoice on the Approvals tab
- **THEN** the alert shows `A Manager may approve invoices up to 50,000.00; invoice <new invoice id> is 60,000.00. A Director must approve it.`
- **AND** the invoice still shows status "Pending Approval"

### Requirement: Approvals view shows a pending second approval
For a pending invoice above 500,000.00 that has a first approval, the Approvals tab SHALL show `Awaiting second approval (first: <user>)`, where `<user>` is the first approver.

#### Scenario: Hint after a Manager's first approval
- **GIVEN** `demo.manager` has given the first approval for INV-1007 of 750,000.00
- **WHEN** a signed-in user opens the Approvals tab
- **THEN** the INV-1007 entry shows `Awaiting second approval (first: demo.manager)`
- **AND** it still offers Approve and Reject

### Requirement: Demo accounts for each approval role
The demo configuration SHALL provide the accounts `demo.manager` (Manager), `demo.director` (Director), `demo.director2` (Director) and `demo.admin` (Admin), all with the demo password `ChangeMe123!`. The former `demo.approver` account MUST NOT exist.

#### Scenario: Demo users sign in with their roles
- **WHEN** `demo.manager`, `demo.director`, `demo.director2` and `demo.admin` each sign in with `ChangeMe123!`
- **THEN** each session reports the role Manager, Director, Director and Admin respectively

#### Scenario: Removed approver account
- **WHEN** `demo.approver` tries to sign in with `ChangeMe123!`
- **THEN** sign-in fails
