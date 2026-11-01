import { type Locator, type Page } from '@playwright/test';

/** Approvals tab: pending list with Approve/Reject per invoice and the decision alert. */
export class ApprovalsPage {
  private readonly tab: Locator;
  private readonly panel: Locator;

  constructor(private readonly page: Page) {
    this.tab = page.getByRole('tab', { name: 'Approvals', exact: true });
    this.panel = page.getByRole('tabpanel', { name: 'Approvals', exact: true });
  }

  async open(): Promise<void> {
    await this.tab.click();
    await this.panel.waitFor();
  }

  async approve(id: string): Promise<void> {
    await this.approveButton(id).click();
  }

  /** The "Approve invoice <id>" button; present while the invoice is pending. */
  approveButton(id: string): Locator {
    return this.panel.getByRole('button', { name: `Approve invoice ${id}`, exact: true });
  }

  /** The decision alert inside the Approvals tabpanel (shows the API's denial reason). */
  decisionError(): Locator {
    return this.panel.getByRole('alert');
  }
}
