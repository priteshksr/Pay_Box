// @ts-check
const { defineConfig, devices } = require('@playwright/test');

// Playwright 1.49+ ships both `chrome-headless-shell` and the full
// chromium binary. In some sandboxed environments only the full
// chromium is installed, so we force-launch that one explicitly.
let chromiumExecutablePath;
try {
  const { chromium } = require('playwright');
  chromiumExecutablePath = chromium.executablePath();
} catch (_) { /* fall back to default */ }

module.exports = defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.js$/,
  fullyParallel: false,
  // The legacy UI suite has some timing-sensitive specs; retry on CI to absorb
  // flakiness so deploys aren't blocked by non-deterministic failures.
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 45_000,
  // Some specs assert on async-rendered UI (charts, worker home, payroll
  // re-renders); a 5s expect timeout is too tight under CI load and causes
  // non-deterministic failures. Give the renders more headroom.
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: 'http://localhost:8765',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: chromiumExecutablePath ? { executablePath: chromiumExecutablePath } : {},
  },

  webServer: {
    command: 'python3 -m http.server 8765',
    cwd: '..',
    url: 'http://localhost:8765',
    reuseExistingServer: true,
    timeout: 20_000,
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
