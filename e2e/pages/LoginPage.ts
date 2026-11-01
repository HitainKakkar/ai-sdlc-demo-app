import { type Locator, type Page } from '@playwright/test';

/** Sign-in form on the start page. Role-based locators only. */
export class LoginPage {
  private readonly username: Locator;
  private readonly password: Locator;
  private readonly signInButton: Locator;

  constructor(private readonly page: Page) {
    this.username = page.getByLabel('Username', { exact: true });
    this.password = page.getByLabel('Password', { exact: true });
    this.signInButton = page.getByRole('button', { name: 'Sign in', exact: true });
  }

  async open(): Promise<void> {
    await this.page.goto('/');
  }

  /** Signs in and waits until the app view (tab list) is shown. */
  async signIn(user: string, password: string): Promise<void> {
    await this.username.fill(user);
    await this.password.fill(password);
    await this.signInButton.click();
    await this.page.getByRole('tab', { name: 'Invoices', exact: true }).waitFor();
  }

  /** The signed-in banner text, e.g. "demo.manager (Manager)". */
  signedInAs(userAndRole: string): Locator {
    return this.page.getByText(userAndRole, { exact: true });
  }
}
