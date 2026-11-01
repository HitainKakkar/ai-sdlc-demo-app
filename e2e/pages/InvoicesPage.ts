import { type Locator, type Page } from '@playwright/test';

/**
 * Invoices tab: new-invoice form and the "All invoices" table.
 * Locators are role/label based (tab, tabpanel, table, row, cell, columnheader, button,
 * labelled inputs). Cells are picked by position (ID = first, Status = 4th); that column
 * order is pinned by the spec asserting `columnHeaders()` before any cell is read.
 */
export class InvoicesPage {
  private readonly tab: Locator;
  private readonly panel: Locator;
  private readonly table: Locator;

  constructor(private readonly page: Page) {
    this.tab = page.getByRole('tab', { name: 'Invoices', exact: true });
    this.panel = page.getByRole('tabpanel', { name: 'Invoices', exact: true });
    this.table = this.panel.getByRole('table', { name: 'All invoices' });
  }

  async open(): Promise<void> {
    await this.tab.click();
    await this.table.waitFor();
  }

  /** Column headers of the table; the spec asserts ['ID', 'Customer', 'Amount', 'Status', 'Actions']. */
  columnHeaders(): Locator {
    return this.table.getByRole('columnheader');
  }

  /** Creates a Draft invoice and waits until its row is in the table. */
  async createInvoice(customer: string, amount: number): Promise<void> {
    await this.panel.getByLabel('Customer name', { exact: true }).fill(customer);
    await this.panel.getByLabel('Amount', { exact: true }).fill(String(amount));
    await this.panel.getByRole('button', { name: 'Create invoice', exact: true }).click();
    await this.rowFor(customer).waitFor();
  }

  /**
   * Clicks "Submit for approval" in the customer's row and returns the invoice id
   * (e.g. "INV-1010") read from the row's ID cell. Waits until the Submit button is
   * gone, i.e. the table was refreshed after the submit.
   */
  async submitForApproval(customer: string): Promise<string> {
    const row = this.rowFor(customer);
    const id = (await row.getByRole('cell').first().innerText()).trim();
    const submit = row.getByRole('button', { name: `Submit invoice ${id} for approval`, exact: true });
    await submit.click();
    await submit.waitFor({ state: 'detached' });
    return id;
  }

  /** The Status cell (4th column, order pinned via `columnHeaders()`) of the customer's row. */
  statusOf(customer: string): Locator {
    return this.rowFor(customer).getByRole('cell').nth(3);
  }

  private rowFor(customer: string): Locator {
    return this.table.getByRole('row').filter({ hasText: customer });
  }
}
