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
  retries: 0,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
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
