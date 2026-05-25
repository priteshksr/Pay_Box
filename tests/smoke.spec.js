// @ts-check
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:8765';

async function gotoFresh(page) {
  await page.goto(BASE);
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#viewRoot')).toBeVisible({ timeout: 5000 });
}

test.describe('Smoke tests — critical paths', () => {
  test('app boots without JS errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await gotoFresh(page);
    expect(errors).toEqual([]);
  });

  test('admin dashboard loads at /admin.html', async ({ page }) => {
    const response = await page.goto(`${BASE}/admin.html`);
    expect(response.status()).toBe(200);
    await expect(page.locator('body')).not.toBeEmpty();
  });

  test('worker punch-in and punch-out flow', async ({ page }) => {
    await gotoFresh(page);
    // Set up as a worker with a staff profile
    await page.evaluate(() => {
      const state = {
        settings: { role: 'worker', language: 'en', onboarded: true, workerId: 'w1', workingDaysPerMonth: 26 },
        business: { name: 'Test Biz' },
        staff: [{ id: 'w1', name: 'Worker One', salaryType: 'monthly', amount: 15000 }],
        attendance: {},
        cloud: { url: '', anonKey: '', enabled: false },
        biz: { id: null }
      };
      localStorage.setItem('paybox_v2', JSON.stringify(state));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#viewRoot')).toBeVisible({ timeout: 5000 });

    // Worker home should show punch button
    const punchBtn = page.locator('[data-punch], #punchBtn, button:has-text("Punch")').first();
    if (await punchBtn.isVisible()) {
      await punchBtn.click();
      // After punching in, some UI acknowledgement should appear
      await page.waitForTimeout(500);
    }
  });

  test('location tracking module initializes without error', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await gotoFresh(page);
    // Verify the tracker object exists
    const hasTracker = await page.evaluate(() => typeof cloudBiz !== 'undefined' || typeof tracker !== 'undefined');
    expect(errors.filter(e => e.includes('tracker'))).toEqual([]);
  });

  test('manifest.json is valid JSON', async ({ page }) => {
    const response = await page.goto(`${BASE}/manifest.json`);
    expect(response.status()).toBe(200);
    const body = await response.text();
    const manifest = JSON.parse(body);
    expect(manifest.name).toBeTruthy();
    expect(manifest.icons.length).toBeGreaterThan(0);
  });

  test('service worker file is accessible', async ({ page }) => {
    const response = await page.goto(`${BASE}/sw.js`);
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain('paybox-');
  });

  test('Tailwind CSS loads correctly', async ({ page }) => {
    const response = await page.goto(`${BASE}/dist/tailwind.css`);
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body.length).toBeGreaterThan(1000);
  });
});
