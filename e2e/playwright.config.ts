import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'dotnet run --project ../backend/src/InvoiceApp.Api',
    url: 'http://localhost:5000',
    // Locally reuse a running API for speed; on CI always start a fresh one so no stale build/data is tested.
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
