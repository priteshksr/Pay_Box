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
  // Each test gets an isolated browser context (localStorage-only state; cloud
  // is mocked), so specs are safe to run in parallel. This is the biggest
  // wall-time win on multi-core CI runners.
  fullyParallel: true,
  // One retry on CI as light insurance against transient CPU contention under
  // parallel execution. (The main flakiness source — the service worker update
  // toast/reload — is now disabled under automation in index.html.)
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 4 : undefined,
  timeout: 30_000,
  // Small cushion over the 5s default for async-rendered UI under parallel load.
  expect: { timeout: 7_000 },
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
