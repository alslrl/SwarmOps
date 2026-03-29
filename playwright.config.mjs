// playwright.config.mjs — Playwright configuration for dashboard screenshot tests
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/playwright-*.spec.mjs', '**/dashboard-e2e.spec.mjs', '**/dashboard-e2e.test.mjs'],
  timeout: 60_000,
  use: {
    headless: true,
    viewport: { width: 1440, height: 900 },
    screenshot: 'off', // We take screenshots manually
  },
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/playwright-report.json' }],
    ['html', { outputFolder: 'test-results/playwright-html-report', open: 'never' }],
  ],
});
