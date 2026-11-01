import { expect, test } from '@playwright/test';
import { ApprovalsPage } from '../pages/ApprovalsPage';
import { InvoicesPage } from '../pages/InvoicesPage';
import { LoginPage } from '../pages/LoginPage';

// R1 + R5 through the UI (spec: "Approvals view shows the denial reason").
// Uses a fresh, uniquely named invoice so it does not depend on seed data or
// earlier runs against a reused server.
test('Manager cannot approve an invoice above 50,000', async ({ page }) => {
  const customer = `Over-limit e2e ${Date.now()}`;
  const login = new LoginPage(page);
  const invoices = new InvoicesPage(page);
  const approvals = new ApprovalsPage(page);

  await login.open();
  await login.signIn('demo.manager', 'ChangeMe123!');
  await expect(login.signedInAs('demo.manager (Manager)')).toBeVisible();

  // Pin the column order that statusOf()/submitForApproval() rely on.
  await invoices.open();
  await expect(invoices.columnHeaders()).toHaveText(['ID', 'Customer', 'Amount', 'Status', 'Actions']);

  await invoices.createInvoice(customer, 60000);
  await expect(invoices.statusOf(customer)).toHaveText('Draft');

  const id = await invoices.submitForApproval(customer);
  expect(id).toMatch(/^INV-\d+$/);
  await expect(invoices.statusOf(customer)).toHaveText('Pending Approval');

  await approvals.open();
  await approvals.approve(id);

  const alert = approvals.decisionError();
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('50,000');
  await expect(alert).toHaveText(
    `A Manager may approve invoices up to 50,000.00; invoice ${id} is 60,000.00. A Director must approve it.`,
  );

  // Nothing changed (R5). The app does not refetch after a denial, so reload to read
  // fresh data from the server (the session survives in sessionStorage).
  await page.reload();
  await invoices.open();
  await expect(invoices.statusOf(customer)).toHaveText('Pending Approval');
  await approvals.open();
  await expect(approvals.approveButton(id)).toBeVisible();

  // And straight from the API: no decision and no first approval were recorded.
  const token = await page.evaluate(() => JSON.parse(sessionStorage.getItem('session')!).token as string);
  const response = await page.request.get(`/api/invoices/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.status()).toBe(200);
  const invoice = await response.json();
  expect(invoice.status).toBe('PendingApproval');
  expect(invoice.decidedBy).toBeNull();
  expect(invoice.firstApprovedBy).toBeNull();
});
