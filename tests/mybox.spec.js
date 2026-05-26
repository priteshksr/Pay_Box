// @ts-check
const { test, expect } = require('@playwright/test');

// Prevent the Supabase CDN from loading during non-cloud tests.
// This avoids network timeouts and ensures deterministic behavior.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const noop = () => {};
    const chainable = () => {
      const self = { select: () => self, eq: () => self, neq: () => self, gt: () => self,
        lt: () => self, gte: () => self, lte: () => self, in: () => self, order: () => self,
        limit: () => self, single: () => self, maybeSingle: () => Promise.resolve({ data: null, error: null }),
        insert: () => Promise.resolve({ data: null, error: null }),
        upsert: () => Promise.resolve({ data: null, error: null }),
        update: () => Promise.resolve({ data: null, error: null }),
        delete: () => Promise.resolve({ data: null, error: null }),
        then: (cb) => Promise.resolve({ data: [], error: null }).then(cb),
      };
      return self;
    };
    window.supabase = {
      createClient: () => ({
        auth: {
          getSession: () => Promise.resolve({ data: { session: null } }),
          onAuthStateChange: (cb) => ({ data: { subscription: { unsubscribe: noop } } }),
          signOut: () => Promise.resolve({ error: null }),
        },
        from: () => chainable(),
        rpc: () => Promise.resolve({ data: null, error: null }),
        channel: () => ({ on: function() { return this; }, subscribe: (cb) => { if (cb) setTimeout(() => cb('SUBSCRIBED'), 0); return this; }, unsubscribe: () => Promise.resolve() }),
        removeChannel: () => Promise.resolve(),
      }),
    };
  });
});

// ------------------ Helpers ------------------

async function gotoFresh(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch (e) { /* ignore */ }
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  // Bypass the first-run welcome/login gate so existing owner-flow tests
  // still exercise the Home/Staff screens directly. Merge into whatever
  // the app's boot() has now written so we don't clobber defaults.
  await page.evaluate(() => {
    try {
      const raw = localStorage.getItem('paybox_v2');
      const state = raw ? JSON.parse(raw) : {};
      state.settings = { ...(state.settings || {}), onboarded: true, role: state.settings?.role || 'owner' };
      localStorage.setItem('paybox_v2', JSON.stringify(state));
    } catch (e) { /* ignore */ }
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#viewRoot')).toBeVisible();
}

async function goTab(page, tab) {
  await page.locator(`[data-tab="${tab}"]`).click();
}

/**
 * Pick a radio option styled as "peer sr-only" inside a form.
 * The labels have a visible <div> directly after the input; clicking that div
 * toggles the hidden radio via the wrapping <label>.
 */
async function pickRadio(page, formSelector, name, value) {
  await page.locator(`${formSelector} input[name="${name}"][value="${value}"] + div`).click();
}

async function addStaff(page, { name, role = '', phone = '', salaryType = 'monthly', amount, otRate = '' }) {
  await goTab(page, 'staff');
  const addBtn = page.locator('#addStaffBtn, #addStaffBtn2').first();
  await addBtn.click();

  await page.locator('#staffForm input[name="name"]').fill(name);
  if (role) await page.locator('#staffForm input[name="role"]').fill(role);
  if (phone) await page.locator('#staffForm input[name="phone"]').fill(phone);
  if (salaryType !== 'monthly') await pickRadio(page, '#staffForm', 'salaryType', salaryType);
  if (salaryType === 'piece') {
    await page.locator('#staffForm input[name="pieceRate"]').fill(String(amount));
  } else {
    await page.locator('#staffForm input[name="amount"]').fill(String(amount));
  }
  if (otRate) await page.locator('#staffForm input[name="otRate"]').fill(String(otRate));

  await page.locator('#staffForm button[type="submit"]').click();
  await expect(page.locator('#sheet')).toBeHidden();
}

async function getStaffIds(page) {
  return await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('paybox_v2') || '{}');
    return (raw.staff || []).map((s) => s.id);
  });
}

/**
 * Patch localStorage and reload the page so the app's in-memory state re-reads.
 * `patch` is a shallow-merge object onto the current persisted state.
 */
async function patchStateAndReload(page, patch) {
  await page.evaluate((patch) => {
    const raw = JSON.parse(localStorage.getItem('paybox_v2') || '{}');
    const merge = (target, src) => {
      for (const k of Object.keys(src)) {
        if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k])) {
          target[k] = target[k] || {};
          merge(target[k], src[k]);
        } else {
          target[k] = src[k];
        }
      }
    };
    merge(raw, patch);
    localStorage.setItem('paybox_v2', JSON.stringify(raw));
  }, patch);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#viewRoot')).toBeVisible();
}

async function markAttendance(page, staffId, status) {
  await goTab(page, 'attendance');
  await page.locator(`[data-mark][data-staff="${staffId}"][data-status="${status}"]`).click();
}

async function setDate(page, iso) {
  await goTab(page, 'attendance');
  await page.locator('#attDate').fill(iso);
}

// ------------------ Tests ------------------

test.describe('App shell & navigation', () => {
  test('app loads and defaults to Home with empty state', async ({ page }) => {
    await gotoFresh(page);
    await expect(page.locator('#businessName')).toHaveText('My Business');
    await expect(page.getByText('Hi there')).toBeVisible();
    await expect(page.getByText('This month payroll', { exact: false })).toBeVisible();
    await expect(page.locator('#bottomNav [data-tab]')).toHaveCount(5);
  });

  test('can navigate between all owner tabs', async ({ page }) => {
    await gotoFresh(page);
    for (const tab of ['attendance', 'staff', 'payroll', 'home']) {
      await goTab(page, tab);
      await expect(page.locator(`[data-tab="${tab}"]`)).toHaveClass(/tab-active/);
    }
  });
});

test.describe('Staff CRUD', () => {
  test('can add a monthly-salary employee', async ({ page }) => {
    await gotoFresh(page);
    await addStaff(page, { name: 'Ramesh Kumar', role: 'Cashier', phone: '9876543210', salaryType: 'monthly', amount: 15000 });

    await expect(page.getByText('Ramesh Kumar')).toBeVisible();
    await expect(page.getByText('Cashier · 9876543210')).toBeVisible();
    await expect(page.getByText('₹15,000/mo')).toBeVisible();
  });

  test('can add a piece-rate employee', async ({ page }) => {
    await gotoFresh(page);
    await addStaff(page, { name: 'Suresh', salaryType: 'piece', amount: 700 });

    const data = await page.evaluate(() => JSON.parse(localStorage.getItem('paybox_v2')));
    expect(data.staff[0].salaryType).toBe('piece');
    expect(data.staff[0].pieceRate).toBe(700);

    await expect(page.getByText('Suresh')).toBeVisible();
    await expect(page.getByText('₹700/per piece')).toBeVisible();
  });

  test('can edit an existing employee', async ({ page }) => {
    await gotoFresh(page);
    await addStaff(page, { name: 'Old Name', salaryType: 'monthly', amount: 10000 });

    await goTab(page, 'staff');
    await page.locator('[data-staff-edit]').first().click();
    await page.locator('#staffForm input[name="name"]').fill('New Name');
    await page.locator('#staffForm input[name="amount"]').fill('20000');
    await page.locator('#staffForm button[type="submit"]').click();
    await expect(page.locator('#sheet')).toBeHidden();

    await expect(page.getByText('New Name')).toBeVisible();
    await expect(page.getByText('Old Name')).toBeHidden();
    await expect(page.getByText('₹20,000/mo')).toBeVisible();
  });

  test('can delete an employee (confirms dialog)', async ({ page }) => {
    await gotoFresh(page);
    await addStaff(page, { name: 'To Delete', salaryType: 'monthly', amount: 5000 });

    await goTab(page, 'staff');
    await page.locator('[data-staff-edit]').first().click();

    page.once('dialog', (d) => d.accept());
    await page.locator('#delStaff').click();
    await expect(page.locator('#sheet')).toBeHidden();

    await goTab(page, 'staff');
    await expect(page.getByText('No staff yet')).toBeVisible();
  });

  test('Add button on Staff tab opens add-staff form', async ({ page }) => {
    await gotoFresh(page);
    await goTab(page, 'staff');
    const addBtn = page.locator('#addStaffBtn, #addStaffBtn2').first();
    await expect(addBtn).toBeVisible();
    await addBtn.click();
    await expect(page.locator('#staffForm')).toBeVisible();
  });
});

test.describe('Attendance', () => {
  test('can mark each status (P/A/H/L) and toggle off', async ({ page }) => {
    await gotoFresh(page);
    await addStaff(page, { name: 'Priya', salaryType: 'monthly', amount: 20000 });
    const [id] = await getStaffIds(page);

    for (const s of ['P', 'A', 'H', 'L']) {
      await markAttendance(page, id, s);
    }
    // Toggle the last (L) off
    await markAttendance(page, id, 'L');
    const data = await page.evaluate(() => JSON.parse(localStorage.getItem('paybox_v2')));
    const today = new Date().toISOString().slice(0, 10);
    expect(data.attendance[today]?.[id]).toBeUndefined();
  });

  test('bulk-mark all present', async ({ page }) => {
    await gotoFresh(page);
    await addStaff(page, { name: 'A', salaryType: 'monthly', amount: 10000 });
    await addStaff(page, { name: 'B', salaryType: 'monthly', amount: 10000 });
    await addStaff(page, { name: 'C', salaryType: 'monthly', amount: 10000 });
    const ids = await getStaffIds(page);

    await goTab(page, 'attendance');
    await page.locator('[data-mark-all="P"]').click();

    const today = new Date().toISOString().slice(0, 10);
    const data = await page.evaluate(() => JSON.parse(localStorage.getItem('paybox_v2')));
    for (const id of ids) {
      expect(data.attendance[today][id]).toBe('P');
    }
  });

  test('date navigation (prev/next) moves the date', async ({ page }) => {
    await gotoFresh(page);
    await addStaff(page, { name: 'X', salaryType: 'monthly', amount: 10000 });
    await goTab(page, 'attendance');
    const initial = await page.locator('#attDate').inputValue();
    await page.locator('#prevDay').click();
    const prev = await page.locator('#attDate').inputValue();
    expect(new Date(prev).getTime()).toBeLessThan(new Date(initial).getTime());
    await page.locator('#nextDay').click();
    await page.locator('#nextDay').click();
    const after = await page.locator('#attDate').inputValue();
    expect(new Date(after).getTime()).toBeGreaterThan(new Date(initial).getTime());
  });

  test('custom date picker sets attendance to chosen date', async ({ page }) => {
    await gotoFresh(page);
    await addStaff(page, { name: 'Y', salaryType: 'monthly', amount: 10000 });
    const [id] = await getStaffIds(page);

    const targetDate = '2025-01-15';
    await setDate(page, targetDate);
    await markAttendance(page, id, 'P');

    const data = await page.evaluate(() => JSON.parse(localStorage.getItem('paybox_v2')));
    expect(data.attendance[targetDate][id]).toBe('P');
  });
});

test.describe('Overtime', () => {
  test('can add OT hours and they appear on row', async ({ page }) => {
    await gotoFresh(page);
    await addStaff(page, { name: 'OT Guy', salaryType: 'monthly', amount: 26000 });
    const [id] = await getStaffIds(page);

    await markAttendance(page, id, 'P');
    await page.locator(`[data-ot="${id}"]`).click();
    await page.locator('#otForm input[name="hours"]').fill('3');
    await page.locator('#otForm button[type="submit"]').click();
    await expect(page.locator('#sheet')).toBeHidden();

    await expect(page.locator('text=3 h').first()).toBeVisible();
  });

  test('entering 0 OT hours removes the OT entry', async ({ page }) => {
    await gotoFresh(page);
    await addStaff(page, { name: 'Z', salaryType: 'monthly', amount: 26000 });
    const [id] = await getStaffIds(page);

    await goTab(page, 'attendance');
    await page.locator(`[data-ot="${id}"]`).click();
    await page.locator('#otForm input[name="hours"]').fill('2');
    await page.locator('#otForm button[type="submit"]').click();
    await expect(page.locator('#sheet')).toBeHidden();

    await page.locator(`[data-ot="${id}"]`).click();
    await page.locator('#otForm input[name="hours"]').fill('0');
    await page.locator('#otForm button[type="submit"]').click();
    await expect(page.locator('#sheet')).toBeHidden();

    const today = new Date().toISOString().slice(0, 10);
    const data = await page.evaluate(() => JSON.parse(localStorage.getItem('paybox_v2')));
    expect(data.overtime?.[today]?.[id]).toBeUndefined();
  });
});

test.describe('Payroll calculations', () => {
  test('monthly staff: base pay = effectiveDays × (amount / workingDays)', async ({ page }) => {
    await gotoFresh(page);
    await addStaff(page, { name: 'Anil', salaryType: 'monthly', amount: 26000 });
    const [id] = await getStaffIds(page);
    // Working days default is 26, so perDay = 1000

    const ym = new Date().toISOString().slice(0, 7);
    const attendance = {};
    for (let d = 1; d <= 10; d++) {
      const iso = `${ym}-${String(d).padStart(2, '0')}`;
      attendance[iso] = { [id]: 'P' };
    }
    await patchStateAndReload(page, { attendance });

    await goTab(page, 'payroll');
    await expect(page.getByText('₹10,000').first()).toBeVisible();
  });

  test('daily staff: base pay = effectiveDays × daily rate', async ({ page }) => {
    await gotoFresh(page);
    // Daily salary type is supported in payroll but not exposed via form radio.
    // Inject a daily staff directly into state.
    const staffId = 'daily1';
    await patchStateAndReload(page, {
      staff: [{ id: staffId, name: 'Shyam', role: '', phone: '', salaryType: 'daily', amount: 500, otRate: 0, joinDate: new Date().toISOString().slice(0, 10) }]
    });
    const id = staffId;

    const ym = new Date().toISOString().slice(0, 7);
    // 5 present, 1 half, 1 leave  =>  5 + 0.5 + 1 = 6.5 days × 500 = 3250
    const schedule = [
      { day: 1, s: 'P' }, { day: 2, s: 'P' }, { day: 3, s: 'P' },
      { day: 4, s: 'P' }, { day: 5, s: 'P' }, { day: 6, s: 'H' }, { day: 7, s: 'L' },
    ];
    const attendance = {};
    for (const { day, s } of schedule) {
      attendance[`${ym}-${String(day).padStart(2, '0')}`] = { [id]: s };
    }
    await patchStateAndReload(page, { attendance });

    await goTab(page, 'payroll');
    await expect(page.getByText('₹3,250').first()).toBeVisible();
  });

  test('overtime adds to payroll (custom OT rate)', async ({ page }) => {
    await gotoFresh(page);
    await addStaff(page, { name: 'Rita', salaryType: 'monthly', amount: 26000, otRate: 200 });
    const [id] = await getStaffIds(page);
    // 2h OT today at ₹200/h = ₹400. Plus 1 day present = ₹1000. Net = ₹1400.
    const today = new Date().toISOString().slice(0, 10);
    await patchStateAndReload(page, {
      attendance: { [today]: { [id]: 'P' } },
      overtime: { [today]: { [id]: 2 } },
    });

    await goTab(page, 'payroll');
    await expect(page.getByText('₹1,400').first()).toBeVisible();
  });

  test('month picker changes the displayed month', async ({ page }) => {
    await gotoFresh(page);
    await addStaff(page, { name: 'M', salaryType: 'monthly', amount: 10000 });
    await goTab(page, 'payroll');

    await page.locator('#monthPick').fill('2025-01');
    await expect(page.getByText(/January 2025/i)).toBeVisible();
  });
});

test.describe('Payslip & Adjustments', () => {
  test('payslip opens with breakdown', async ({ page }) => {
    await gotoFresh(page);
    await addStaff(page, { name: 'Kiran', salaryType: 'monthly', amount: 26000 });
    const [id] = await getStaffIds(page);
    const today = new Date().toISOString().slice(0, 10);
    await patchStateAndReload(page, { attendance: { [today]: { [id]: 'P' } } });

    await goTab(page, 'payroll');
    await page.locator('[data-payslip]').first().click();
    await expect(page.locator('#sheet')).toBeVisible();
    // "Net Payable" appears twice in the payslip — big card + summary line
    await expect(page.getByText('Net Payable').first()).toBeVisible();
    await expect(page.getByText('Base pay')).toBeVisible();
  });

  test('add advance reduces net, add bonus increases net, add deduction reduces net', async ({ page }) => {
    await gotoFresh(page);
    await addStaff(page, { name: 'Divya', salaryType: 'monthly', amount: 26000 });
    const [id] = await getStaffIds(page);
    const today = new Date().toISOString().slice(0, 10);
    await patchStateAndReload(page, { attendance: { [today]: { [id]: 'P' } } });

    await goTab(page, 'payroll');
    await page.locator('[data-payslip]').first().click();
    await expect(page.getByText('₹1,000').first()).toBeVisible();

    // Advance 300 → net = 1000 - 300 = 700
    await page.locator('#addAdjBtn').click();
    await pickRadio(page, '#adjForm', 'type', 'advance');
    await page.locator('#adjForm input[name="amount"]').fill('300');
    await page.locator('#adjForm button[type="submit"]').click();
    await expect(page.getByText('Advances').first()).toBeVisible();
    await expect(page.getByText('₹700').first()).toBeVisible();

    // Bonus 500 → net = 700 + 500 = 1200
    await page.locator('#addAdjBtn').click();
    await pickRadio(page, '#adjForm', 'type', 'bonus');
    await page.locator('#adjForm input[name="amount"]').fill('500');
    await page.locator('#adjForm button[type="submit"]').click();
    await expect(page.getByText('₹1,200').first()).toBeVisible();

    // Deduction 100 → net = 1200 - 100 = 1100
    await page.locator('#addAdjBtn').click();
    await pickRadio(page, '#adjForm', 'type', 'deduction');
    await page.locator('#adjForm input[name="amount"]').fill('100');
    await page.locator('#adjForm button[type="submit"]').click();
    await expect(page.getByText('₹1,100').first()).toBeVisible();
  });

  test('removing an adjustment updates the payslip', async ({ page }) => {
    await gotoFresh(page);
    await addStaff(page, { name: 'E', salaryType: 'monthly', amount: 26000 });
    const [id] = await getStaffIds(page);
    const today = new Date().toISOString().slice(0, 10);
    const ym = today.slice(0, 7);
    await patchStateAndReload(page, {
      attendance: { [today]: { [id]: 'P' } },
      adjustments: [{ id: 'adj1', staffId: id, ym, type: 'advance', amount: 200, note: '', createdAt: new Date().toISOString() }],
    });

    await goTab(page, 'payroll');
    await page.locator('[data-payslip]').first().click();
    await expect(page.getByText('₹800').first()).toBeVisible();

    await page.locator('[data-adj-del="adj1"]').click();
    await expect(page.getByText('₹1,000').first()).toBeVisible();
  });
});

test.describe('Worker mode', () => {
  test('switching to Worker mode hides owner-only UI and shows worker tabs', async ({ page }) => {
    await gotoFresh(page);
    await addStaff(page, { name: 'Worker One', salaryType: 'monthly', amount: 15000 });
    const [id] = await getStaffIds(page);

    await page.locator('#settingsBtn').click();
    await pickRadio(page, '#settingsForm', 'role', 'worker');
    await page.locator('select[name="workerId"]').selectOption(id);
    await page.locator('#settingsForm button[type="submit"]').click();
    await expect(page.locator('#sheet')).toBeHidden();

    await expect(page.locator('#roleChip')).toBeVisible();
    await expect(page.locator('#bottomNav [data-tab]')).toHaveCount(4);
    await expect(page.locator('[data-tab="my_attendance"]')).toBeVisible();
    await expect(page.locator('[data-tab="my_tasks"]')).toBeVisible();
    await expect(page.locator('[data-tab="my_payslip"]')).toBeVisible();

    await expect(page.getByText('Hi, Worker')).toBeVisible();

    await goTab(page, 'my_attendance');
    await expect(page.locator('#viewRoot .grid-cols-7').first()).toBeVisible();
  });

  test('worker mode shows "no worker selected" if no profile picked', async ({ page }) => {
    await gotoFresh(page);
    await page.evaluate(() => {
      const raw = { settings: { role: 'worker', workerId: null, language: 'en', workingDaysPerMonth: 26, onboarded: true } };
      localStorage.setItem('paybox_v2', JSON.stringify(raw));
    });
    await page.reload();
    await expect(page.getByText(/No worker profile selected/i)).toBeVisible();
  });
});

test.describe('i18n', () => {
  test('switching to Hindi changes visible labels', async ({ page }) => {
    await gotoFresh(page);
    await page.locator('#settingsBtn').click();
    await pickRadio(page, '#settingsForm', 'language', 'hi');
    await page.locator('#settingsForm button[type="submit"]').click();
    await expect(page.locator('#sheet')).toBeHidden();

    await expect(page.getByText('होम')).toBeVisible();
    await expect(page.getByText('स्टाफ़').first()).toBeVisible();
    await expect(page.getByText('हाज़िरी').first()).toBeVisible();
    await expect(page.getByText('पेरोल').first()).toBeVisible();
  });

  test('Tamil translations appear', async ({ page }) => {
    await gotoFresh(page);
    await page.locator('#settingsBtn').click();
    await pickRadio(page, '#settingsForm', 'language', 'ta');
    await page.locator('#settingsForm button[type="submit"]').click();
    await expect(page.locator('#sheet')).toBeHidden();
    await expect(page.getByText('முகப்பு')).toBeVisible();
    await expect(page.getByText('ஊழியர்').first()).toBeVisible();
  });
});

test.describe('Settings', () => {
  test('changing business name updates header', async ({ page }) => {
    await gotoFresh(page);
    await page.locator('#settingsBtn').click();
    await page.locator('input[name="businessName"]').fill('Acme Shop');
    await page.locator('#settingsForm button[type="submit"]').click();
    await expect(page.locator('#businessName')).toHaveText('Acme Shop');
  });

  test('changing workingDaysPerMonth affects payroll calc', async ({ page }) => {
    await gotoFresh(page);
    await addStaff(page, { name: 'WD Test', salaryType: 'monthly', amount: 30000 });
    const [id] = await getStaffIds(page);
    const today = new Date().toISOString().slice(0, 10);
    await patchStateAndReload(page, { attendance: { [today]: { [id]: 'P' } } });

    // With 30 working days → perDay = 1000, net for 1 day = ₹1,000
    await page.locator('#settingsBtn').click();
    await page.locator('input[name="wdpm"]').fill('30');
    await page.locator('#settingsForm button[type="submit"]').click();
    await expect(page.locator('#sheet')).toBeHidden();

    await goTab(page, 'payroll');
    await expect(page.getByText('₹1,000').first()).toBeVisible();

    // Change to 20 working days → perDay = 1500, net for 1 day = ₹1,500
    await page.locator('#settingsBtn').click();
    await page.locator('input[name="wdpm"]').fill('20');
    await page.locator('#settingsForm button[type="submit"]').click();
    await expect(page.locator('#sheet')).toBeHidden();

    await goTab(page, 'payroll');
    await expect(page.getByText('₹1,500').first()).toBeVisible();
  });

  test('Clearing localStorage resets app state', async ({ page }) => {
    await gotoFresh(page);
    await addStaff(page, { name: 'WillBeDeleted', salaryType: 'monthly', amount: 10000 });

    await page.evaluate(() => {
      localStorage.removeItem('paybox_v2');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    // Without persisted state, the app shows the onboarding/welcome screen.
    const hasWelcome = await page.locator('#welcomeScreen, #viewRoot').first().isVisible();
    expect(hasWelcome).toBe(true);
    const data = await page.evaluate(() => JSON.parse(localStorage.getItem('paybox_v2') || '{}'));
    expect(data.staff || []).toHaveLength(0);
  });
});

test.describe('Persistence', () => {
  test('data survives a page reload', async ({ page }) => {
    await gotoFresh(page);
    await addStaff(page, { name: 'Persists Kumar', salaryType: 'monthly', amount: 18000 });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await goTab(page, 'staff');
    await expect(page.getByText('Persists Kumar')).toBeVisible();
    await expect(page.getByText('₹18,000/mo')).toBeVisible();
  });
});

test.describe('Export', () => {
  test('Export button triggers an Excel download', async ({ page }) => {
    await gotoFresh(page);
    await addStaff(page, { name: 'Exporter', salaryType: 'monthly', amount: 12000 });
    await goTab(page, 'home');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#exportBtn').click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^paybox-\d{4}-\d{2}\.xlsx$/);
  });
});

test.describe('PWA assets', () => {
  test('manifest.json is reachable and well-formed', async ({ request }) => {
    const res = await request.get('/manifest.json');
    expect(res.ok()).toBeTruthy();
    const json = await res.json();
    expect(json.name).toBe('PayBox — Staff & Payroll');
    expect(json.start_url).toBe('./index.html');
    expect(Array.isArray(json.icons)).toBeTruthy();
  });

  test('service worker file is reachable', async ({ request }) => {
    const res = await request.get('/sw.js');
    expect(res.ok()).toBeTruthy();
    const txt = await res.text();
    expect(txt).toContain('CACHE');
    expect(txt).toContain('install');
  });

  test('icon.svg is reachable', async ({ request }) => {
    const res = await request.get('/icon.svg');
    expect(res.ok()).toBeTruthy();
    expect(res.headers()['content-type']).toContain('svg');
  });

  test('service worker registers after load', async ({ page }) => {
    await gotoFresh(page);
    const registered = await page.evaluate(async () => {
      for (let i = 0; i < 30; i++) {
        const regs = await navigator.serviceWorker.getRegistrations();
        if (regs.length > 0) return true;
        await new Promise((r) => setTimeout(r, 100));
      }
      return false;
    });
    expect(registered).toBeTruthy();
  });
});
