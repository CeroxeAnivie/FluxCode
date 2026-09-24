import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:1420',
    viewport: { width: 1440, height: 940 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: process.env.CI ? {} : { proxy: { server: 'http://127.0.0.1:14455/' } },
  },
  webServer: {
    command: 'pnpm dev --mode test',
    url: 'http://127.0.0.1:1420',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
