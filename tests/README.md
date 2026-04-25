# PayBox — Automated Tests

End-to-end browser tests for PayBox, written with [Playwright](https://playwright.dev).
Runs a real Chromium browser against the app and verifies every feature.

## One-time setup

From this folder (`My_Box/tests/`):

```bash
npm install
npx playwright install chromium
```

(First command installs Playwright, second downloads the Chromium browser ~150 MB.)

## Run all tests

```bash
npm test
```

That's it — Playwright will:
1. Auto-start a local Python HTTP server on port `8765` (serving the `My_Box/` folder)
2. Run every test in `mybox.spec.js`
3. Stop the server when done

You'll see output like:

```
Running 28 tests using 1 worker

  ✓  App shell & navigation > app loads and defaults to Home with empty state
  ✓  App shell & navigation > can navigate between all owner tabs
  ✓  Staff CRUD > can add a monthly-salary employee
  ...
  28 passed (45s)
```

## Run with a visible browser

```bash
npm run test:headed
```

Watches the tests execute in a real browser window.

## Interactive UI mode

```bash
npm run test:ui
```

Opens Playwright's UI where you can:
- Run a single test
- Time-travel through each step
- Inspect DOM, console, network
- Re-run on file change

## Show the HTML report

After a run:

```bash
npm run test:report
```

## What's covered

| # | Group | Tests |
|---|---|---|
| 1 | App shell & navigation | load, tab switching |
| 2 | Staff CRUD | add monthly, add daily, edit, delete, FAB |
| 3 | Attendance | mark P/A/H/L, toggle off, bulk-mark, date nav, custom date |
| 4 | Overtime | add OT, clear OT (0 hours) |
| 5 | Payroll calculations | monthly math, daily math, OT with custom rate, month picker |
| 6 | Payslip & Adjustments | open payslip, add advance/bonus/deduction, remove adjustment |
| 7 | Worker mode | switch role, worker tabs, "no worker selected" warning |
| 8 | i18n | Hindi, Tamil translations appear |
| 9 | Settings | business name, workingDaysPerMonth effect on payroll, reset |
| 10 | Persistence | data survives reload |
| 11 | Export | JSON download triggered |
| 12 | PWA assets | manifest.json, sw.js, icon.svg reachable; service worker registers |

## File layout

```
tests/
├── package.json            dependencies + scripts
├── playwright.config.js    runner config (starts local server, Chromium)
├── mybox.spec.js           all test cases
└── README.md               this file
```

## Troubleshooting

**`port 8765 in use`**
Stop any other process on 8765: `lsof -ti:8765 | xargs kill -9`

**Tests time out at page load**
Usually service worker caching. The test `gotoFresh()` helper clears SWs, but if something persists, run:
```bash
npx playwright test --project=chromium --headed --debug
```
and inspect.

**A test fails on `expect(text)`**
Playwright's HTML report (`npm run test:report`) shows the exact DOM at failure with screenshot + video.

**Dialog (confirm alert) hangs**
The test must register `page.once('dialog', d => d.accept())` *before* clicking the button that triggers it. This is already done in delete/reset tests.

## Adding a new test

1. Open `mybox.spec.js`
2. Find an appropriate `test.describe(...)` block (or add one)
3. Pattern:

```js
test('my new feature works', async ({ page }) => {
  await gotoFresh(page);
  // ... do things ...
  await expect(page.getByText('Expected')).toBeVisible();
});
```

Helpers available in the file:
- `gotoFresh(page)` — navigate and clear all storage/SW
- `goTab(page, name)` — switch bottom-nav tab
- `addStaff(page, { name, salaryType, amount, ... })` — full add-staff flow
- `getStaffIds(page)` — read staff IDs from localStorage
- `markAttendance(page, staffId, status)` — tap a status button
- `setDate(page, iso)` — set attendance date

## CI / headless

Playwright runs headless by default. The config already sets `workers: 1` and `fullyParallel: false` because the app uses a single `localStorage` per domain — running tests in parallel would cause cross-test contamination.

If you later split tests into isolated storage contexts (`test.use({ storageState: ... })`), you can bump the worker count.
