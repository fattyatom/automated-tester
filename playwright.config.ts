import { defineConfig, devices } from '@playwright/test';
import qa from './qa.config';

// No QA_BASE_URL → test the bundled demo app (started automatically).
const useDemo = !process.env.QA_BASE_URL;
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
    ? { command: 'npm run demo', url: 'http://localhost:4321/health', reuseExistingServer: !process.env.CI, stdout: 'ignore' }
    : undefined,
});
