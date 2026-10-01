import { defineConfig, devices } from '@playwright/test';
import qa from './qa.config';

// Targeting the bundled demo app → start it automatically.
const DEMO_URL = 'http://localhost:4321';
const useDemo = new URL(qa.baseURL).origin === DEMO_URL;
const executablePath = process.env.PW_CHROMIUM_PATH;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 45_000,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'qa-report/html' }],
    ['./src/report/reporter.ts'],
  ],
  use: {
    baseURL: qa.baseURL,
    trace: 'retain-on-failure',
    // QaSession attaches its own evidence screenshot; the built-in failure screenshot misbehaves
    // when a failure is raised from fixture teardown (which is how findings fail a test).
    screenshot: 'off',
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    { name: 'unit', testDir: './tests/unit' },
    { name: 'acceptance', testMatch: 'acceptance.spec.ts', use: { ...devices['Desktop Chrome'] } },
    { name: 'exploratory', testDir: './tests/exploratory', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: useDemo
    ? { command: 'npm run demo', url: `${DEMO_URL}/health`, reuseExistingServer: !process.env.CI, stdout: 'ignore' }
    : undefined,
});
