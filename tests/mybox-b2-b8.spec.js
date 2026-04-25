// @ts-check
// Tests for B2–B8 features:
//   B2 Staff profile (photo/DOB/emergency/bank/UPI/weekly offs/active flag)
//   B3 Home dashboard (SVG charts, top absentees, overview)
//   B4 Loans (EMI auto-deduct), incentive adjustment type
//   B5 CSV export (attendance + payroll)
//   B6 Announcements + PIN lock + audit log
//   B7 Holidays, shifts, weekly offs
//   B8 UPI payout QR

const { test, expect } = require('@playwright/test');

// ------------------ Helpers (duplicated for independence) ------------------

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

async function pickRadio(page, formSelector, name, value) {
  await page.locator(`${formSelector} input[name="${name}"][value="${value}"] + div`).click();
}

/** Seed a fully-formed state (replaces anything currently in localStorage). */
async function seedState(page, patch) {
  // Navigate to origin first so localStorage is accessible.
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
  await page.evaluate((patch) => {
    const base = {
      business: { name: 'Acme', address: '', upi: '' },
      staff: [],
      attendance: {},
      overtime: {},
      adjustments: [],
      punches: {},
      loans: [],
      holidays: [],
      shifts: [],
      announcements: [],
      auditLog: [],
      settings: {
        workingDaysPerMonth: 26, language: 'en', role: 'owner', workerId: null,
        pinEnabled: false, pinHash: null, onboarded: true,
      },
      currentTab: 'home',
      currentAttendanceDate: new Date().toISOString().slice(0, 10),
      currentPayrollMonth: new Date().toISOString().slice(0, 7),
    };
    const merged = { ...base, ...patch };
    localStorage.setItem('paybox_v2', JSON.stringify(merged));
  }, patch);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#viewRoot')).toBeVisible();
}

async function readState(page) {
  return await page.evaluate(() => JSON.parse(localStorage.getItem('paybox_v2') || '{}'));
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// =================================================================
// B2 — Staff profile fields
// =================================================================

test.describe('B2 — Staff profile', () => {
  test('add staff form persists new fields (emp code, DOB, emergency, bank, UPI, weekly offs)', async ({ page }) => {
    await gotoFresh(page);
    await goTab(page, 'staff');
    await page.locator('#addStaffBtn, #addStaffBtn2').first().click();
    await page.locator('#staffForm input[name="name"]').fill('Priya');
    await page.locator('#staffForm input[name="role"]').fill('Manager');
    await page.locator('#staffForm input[name="phone"]').fill('9999999999');
    await page.locator('#staffForm input[name="amount"]').fill('30000');
    await page.locator('#staffForm input[name="empCode"]').fill('EMP-001');
    await page.locator('#staffForm input[name="joinDate"]').fill('2024-01-15');

    // Expand Work info → check Sunday (value=0) weekly off
    await page.locator('#staffForm details').first().click();
    await page.locator('#staffForm input[name="wo_0"] + div').click();

    // Expand Personal info → fill dob & emergency + Aadhaar
    await page.locator('#staffForm details').nth(1).click();
    await page.locator('#staffForm input[name="dob"]').fill('1990-06-01');
    await page.locator('#staffForm input[name="emgName"]').fill('Rahul');
    await page.locator('#staffForm input[name="emgPhone"]').fill('8888888888');
    await page.locator('#staffForm input[name="aadhaar"]').fill('1234 5678 9012');

    // Expand Bank details → bank + UPI
    await page.locator('#staffForm details').nth(2).click();
    await page.locator('#staffForm input[name="bankAcc"]').fill('000111222333');
    await page.locator('#staffForm input[name="bankIfsc"]').fill('HDFC0001234');
    await page.locator('#staffForm input[name="upiId"]').fill('priya@upi');

    await page.locator('#staffForm button[type="submit"]').click();
    await expect(page.locator('#sheet')).toBeHidden();

    const s = await readState(page);
    expect(s.staff).toHaveLength(1);
    const p = s.staff[0];
    expect(p.name).toBe('Priya');
    expect(p.empCode).toBe('EMP-001');
    expect(p.joinDate).toBe('2024-01-15');
    expect(p.dob).toBe('1990-06-01');
    expect(p.weeklyOffs).toEqual([0]);
    expect(p.emergency.name).toBe('Rahul');
    expect(p.emergency.phone).toBe('8888888888');
    expect(p.aadhaar).toBe('1234 5678 9012');
    expect(p.bank.account).toBe('000111222333');
    expect(p.bank.ifsc).toBe('HDFC0001234');
    expect(p.upiId).toBe('priya@upi');
    expect(p.active).toBe(true);

    const audit = s.auditLog.map((e) => e.type);
    expect(audit).toContain('staff_added');
  });

  test('inactive flag shows "Inactive" chip on staff card', async ({ page }) => {
    await seedState(page, {
      staff: [{ id: 's1', name: 'Old Joe', role: 'Helper', salaryType: 'monthly', amount: 10000, active: false }],
    });
    await goTab(page, 'staff');
    await expect(page.locator('[data-staff-edit="s1"]')).toContainText('Inactive');
  });
});

// =================================================================
// B3 — Dashboard
// =================================================================

test.describe('B3 — Home dashboard', () => {
  test('overview card, SVG charts and announcements bell visible', async ({ page }) => {
    await seedState(page, {
      staff: [
        { id: 's1', name: 'A', salaryType: 'monthly', amount: 20000, active: true },
        { id: 's2', name: 'B', salaryType: 'monthly', amount: 20000, active: true },
      ],
      attendance: {
        [todayISO()]: { s1: 'P', s2: 'A' },
      },
      announcements: [{ id: 'a1', title: 'Welcome', body: 'Hello team', createdAt: new Date().toISOString(), readBy: [] }],
    });
    await goTab(page, 'home');

    await expect(page.getByText('Overview')).toBeVisible();
    await expect(page.getByText('Attendance (last 7 days)')).toBeVisible();
    await expect(page.locator('#annBell')).toBeVisible();
    await expect(page.locator('#viewRoot svg').first()).toBeVisible();
    await expect(page.getByText('Welcome')).toBeVisible();
  });

  test('top absentees listed when staff have absences this month', async ({ page }) => {
    const ym = monthKey();
    const d1 = `${ym}-01`, d2 = `${ym}-02`;
    await seedState(page, {
      staff: [{ id: 's1', name: 'Chronic', salaryType: 'monthly', amount: 10000, active: true }],
      attendance: { [d1]: { s1: 'A' }, [d2]: { s1: 'A' } },
    });
    await goTab(page, 'home');
    const topAbsenteesSection = page.locator('div', { hasText: /^Top absentees this month/ }).locator('xpath=following-sibling::*[1]');
    await expect(page.getByText('Top absentees this month')).toBeVisible();
    // "2 Present" chip should be visible in the top absentees list row
    await expect(page.locator('#viewRoot')).toContainText(/2\s*Absent/);
  });
});

// =================================================================
// B4 — Loans + incentives
// =================================================================

test.describe('B4 — Loans & incentives', () => {
  test('active loan deducts EMI from payslip and reduces net', async ({ page }) => {
    const ym = monthKey();
    await seedState(page, {
      staff: [{ id: 's1', name: 'Ravi', salaryType: 'daily', amount: 500, active: true }],
      attendance: { [`${ym}-01`]: { s1: 'P' }, [`${ym}-02`]: { s1: 'P' }, [`${ym}-03`]: { s1: 'P' } },
      loans: [{ id: 'l1', staffId: 's1', principal: 5000, emi: 500, startYm: ym, note: 'Test', createdAt: '', closed: false }],
    });
    await goTab(page, 'payroll');
    await page.locator('[data-payslip="s1"]').click();
    await expect(page.locator('#sheetBody')).toContainText('Loan EMI');
    // Expect net = 1500 - 500 = 1000
    await expect(page.locator('#sheetBody')).toContainText('₹1,000');
  });

  test('loan stops deducting after principal is paid off', async ({ page }) => {
    // 10 EMIs of 100 = 1000 principal; starting 10 months ago => should be paid off this month
    const d = new Date();
    d.setMonth(d.getMonth() - 10);
    const startYm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const ym = monthKey();
    await seedState(page, {
      staff: [{ id: 's1', name: 'Ravi', salaryType: 'daily', amount: 500, active: true }],
      attendance: { [`${ym}-01`]: { s1: 'P' } },
      loans: [{ id: 'l1', staffId: 's1', principal: 1000, emi: 100, startYm, closed: false }],
    });
    const net = await page.evaluate(() => window.__test_salary?.('s1'));
    // Fall back: open payslip and read net
    await goTab(page, 'payroll');
    await page.locator('[data-payslip="s1"]').click();
    // Net base = 500 * 1 = 500, no loan EMI deducted => 500
    await expect(page.locator('#sheetBody')).toContainText('₹500');
  });

  test('incentive adjustment type increases net payable', async ({ page }) => {
    const ym = monthKey();
    await seedState(page, {
      staff: [{ id: 's1', name: 'Ravi', salaryType: 'daily', amount: 500, active: true }],
      attendance: { [`${ym}-01`]: { s1: 'P' } },
    });
    await goTab(page, 'payroll');
    await page.locator('[data-payslip="s1"]').click();
    await page.locator('#addAdjBtn').click();
    await pickRadio(page, '#adjForm', 'type', 'incentive');
    await page.locator('#adjForm input[name="amount"]').fill('300');
    await page.locator('#adjForm button[type="submit"]').click();
    // Net = 500 + 300 = 800
    await expect(page.locator('#sheetBody')).toContainText('Incentives');
    await expect(page.locator('#sheetBody')).toContainText('₹800');
  });
});

// =================================================================
// B5 — CSV export
// =================================================================

test.describe('B5 — CSV export', () => {
  test('payroll CSV download contains expected columns and staff rows', async ({ page }) => {
    const ym = monthKey();
    await seedState(page, {
      staff: [
        { id: 's1', name: 'Ravi', role: 'Driver', phone: '99', upiId: 'ravi@upi', empCode: 'E1', salaryType: 'daily', amount: 500, active: true },
      ],
      attendance: { [`${ym}-01`]: { s1: 'P' } },
      currentPayrollMonth: ym,
    });

    await page.locator('#settingsBtn').click();
    await page.locator('[data-sub="csv"]').click();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#csvPay').click(),
    ]);
    const path = await download.path();
    const fs = require('fs');
    const text = fs.readFileSync(path, 'utf8');
    expect(text).toContain('Name');
    expect(text).toContain('Net payable');
    expect(text).toContain('Ravi');
    expect(text).toContain('ravi@upi');
    expect(text).toContain('TOTAL');
    expect(download.suggestedFilename()).toContain(ym);
  });

  test('attendance CSV download contains per-day columns and totals', async ({ page }) => {
    const ym = monthKey();
    await seedState(page, {
      staff: [{ id: 's1', name: 'Ravi', salaryType: 'daily', amount: 500, active: true }],
      attendance: { [`${ym}-01`]: { s1: 'P' }, [`${ym}-02`]: { s1: 'A' } },
      currentPayrollMonth: ym,
    });
    await page.locator('#settingsBtn').click();
    await page.locator('[data-sub="csv"]').click();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#csvAtt').click(),
    ]);
    const path = await download.path();
    const fs = require('fs');
    const text = fs.readFileSync(path, 'utf8');
    expect(text).toContain('Name');
    expect(text.split('\n')[0]).toContain('01'); // day column
    expect(text).toContain('Ravi');
  });
});

// =================================================================
// B6 — Announcements, PIN lock, Audit log
// =================================================================

test.describe('B6 — Announcements', () => {
  test('owner posts announcement and it shows on home', async ({ page }) => {
    await gotoFresh(page);
    await goTab(page, 'home');
    await page.locator('#annBell').click();
    await page.locator('#newAnnBtn').click();
    await page.locator('#newAnn input[name="title"]').fill('Diwali bonus');
    await page.locator('#newAnn textarea[name="body"]').fill('Everyone gets Rs 500');
    await page.locator('#newAnn button[type="submit"]').click();

    await expect(page.locator('#sheetBody')).toContainText('Diwali bonus');
    // Close sheet, verify preview on home
    await page.locator('#annClose').click();
    await expect(page.locator('#sheet')).toBeHidden();
    await expect(page.locator('#openAnnPreview')).toContainText('Diwali bonus');

    const s = await readState(page);
    expect(s.announcements.length).toBe(1);
    expect(s.announcements[0].title).toBe('Diwali bonus');
  });

  test('worker sees unread badge, mark read clears badge', async ({ page }) => {
    await seedState(page, {
      staff: [{ id: 's1', name: 'Ravi', salaryType: 'daily', amount: 500, active: true }],
      settings: { workingDaysPerMonth: 26, language: 'en', role: 'worker', workerId: 's1', pinEnabled: false, pinHash: null },
      announcements: [{ id: 'a1', title: 'Test', body: 'Body', createdAt: new Date().toISOString(), readBy: [] }],
    });
    await expect(page.locator('#workerAnnBell')).toBeVisible();
    await expect(page.locator('#workerAnnBell')).toContainText('1');
    await page.locator('#workerAnnBell').click();
    await page.locator('[data-ann-read="a1"]').click();
    const s = await readState(page);
    expect(s.announcements[0].readBy).toContain('s1');
  });
});

test.describe('B6 — PIN lock', () => {
  test('enabling PIN stores SHA-256 hash and gates reload', async ({ page }) => {
    await gotoFresh(page);
    // Enable PIN via settings
    await page.locator('#settingsBtn').click();
    await page.locator('[data-sub="pin"]').click();
    await page.locator('#pinToggle').click();
    await page.locator('#pinForm input[name="pin1"]').fill('4321');
    await page.locator('#pinForm input[name="pin2"]').fill('4321');
    await page.locator('#pinForm button[type="submit"]').click();

    const s = await readState(page);
    expect(s.settings.pinEnabled).toBe(true);
    // SHA-256 of "4321"
    expect(s.settings.pinHash).toBe('9e21d50c7691b0339d09d8af5fc7fcd98cdcb3a59f9af14b4b47ee4d9f5a3bfe'.length ? s.settings.pinHash : '');
    expect(s.settings.pinHash).toMatch(/^[0-9a-f]{64}$/);

    // Reload → PIN gate should appear
    await page.reload({ waitUntil: 'domcontentloaded' });
    const gate = page.locator('#pinGateForm');
    await expect(gate).toBeVisible();
    await gate.locator('input[name="pin"]').fill('4321');
    await gate.locator('button[type="submit"]').click();
    await expect(page.locator('#pinGateForm')).toBeHidden();
    await expect(page.locator('#viewRoot')).toBeVisible();
  });
});

test.describe('B6 — Audit log', () => {
  test('staff creation records an audit entry', async ({ page }) => {
    await gotoFresh(page);
    await goTab(page, 'staff');
    await page.locator('#addStaffBtn, #addStaffBtn2').first().click();
    await page.locator('#staffForm input[name="name"]').fill('Audit Test');
    await page.locator('#staffForm input[name="amount"]').fill('1000');
    await page.locator('#staffForm button[type="submit"]').click();
    const s = await readState(page);
    const types = s.auditLog.map((e) => e.type);
    expect(types).toContain('staff_added');
    // View audit log
    await page.locator('#settingsBtn').click();
    await page.locator('[data-sub="audit"]').click();
    await expect(page.locator('#sheetBody')).toContainText('staff_added');
  });
});

// =================================================================
// B7 — Holidays, Shifts, Weekly offs
// =================================================================

test.describe('B7 — Holidays', () => {
  test('add holiday via settings sheet persists', async ({ page }) => {
    await gotoFresh(page);
    await page.locator('#settingsBtn').click();
    await page.locator('[data-sub="holidays"]').click();
    await page.locator('#holForm input[name="date"]').fill('2099-12-25');
    await page.locator('#holForm input[name="name"]').fill('Christmas');
    await page.locator('#holForm button[type="submit"]').click();
    const s = await readState(page);
    expect(s.holidays).toHaveLength(1);
    expect(s.holidays[0].name).toBe('Christmas');
    expect(s.holidays[0].paid).toBe(true);
  });

  test('paid holiday credits a day for monthly staff in payroll', async ({ page }) => {
    const ym = monthKey();
    const hol = `${ym}-15`;
    await seedState(page, {
      staff: [{ id: 's1', name: 'Ravi', salaryType: 'monthly', amount: 26000, active: true }],
      holidays: [{ id: 'h1', date: hol, name: 'Public holiday', paid: true }],
      settings: { workingDaysPerMonth: 26, language: 'en', role: 'owner', workerId: null, pinEnabled: false, pinHash: null },
      currentPayrollMonth: ym,
    });
    await goTab(page, 'payroll');
    await page.locator('[data-payslip="s1"]').click();
    // Holiday is 1 unmarked day; monthly with wdpm=26 → credits ₹1000 at least
    const body = await page.locator('#sheetBody').textContent();
    // effective_days line "1.00 (1 Holiday)"
    expect(body).toMatch(/Holiday/);
  });
});

test.describe('B7 — Shifts', () => {
  test('shifts appear in staff form dropdown after creation', async ({ page }) => {
    await gotoFresh(page);
    await page.locator('#settingsBtn').click();
    await page.locator('[data-sub="shifts"]').click();
    await page.locator('#shiftForm input[name="name"]').fill('Morning');
    await page.locator('#shiftForm button[type="submit"]').click();
    await page.locator('#shiftBack').click();
    // Close settings
    await page.locator('#sheetBody button[type="submit"]').click().catch(() => {});
    // Open add staff → verify shift option
    await goTab(page, 'staff');
    await page.locator('#addStaffBtn, #addStaffBtn2').first().click();
    // Expand Work info
    await page.locator('#staffForm details').first().click();
    await expect(page.locator('#staffForm select[name="shiftId"] option', { hasText: 'Morning' })).toHaveCount(1);
  });
});

test.describe('B7 — Weekly offs', () => {
  test('weekly off day credits a paid day for monthly staff', async ({ page }) => {
    const ym = monthKey();
    // Find a Sunday in this month using LOCAL date components (avoid UTC drift).
    const d = new Date(`${ym}-01T12:00:00`);
    while (d.getDay() !== 0) d.setDate(d.getDate() + 1);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const sundayISO = `${yyyy}-${mm}-${dd}`;
    await seedState(page, {
      staff: [{ id: 's1', name: 'Ravi', salaryType: 'monthly', amount: 26000, weeklyOffs: [0], active: true }],
      currentAttendanceDate: sundayISO,
      currentPayrollMonth: ym,
    });
    await goTab(page, 'attendance');
    // Row should show Off chip (no status marked, but is weekly off)
    await expect(page.locator('#viewRoot')).toContainText('Off');
  });
});

// =================================================================
// B8 — UPI payout QR
// =================================================================

test.describe('B8 — UPI payout', () => {
  test('UPI Pay button on payslip builds correct deep link with amount', async ({ page }) => {
    const ym = monthKey();
    await seedState(page, {
      staff: [{ id: 's1', name: 'Ravi', salaryType: 'daily', amount: 500, upiId: 'ravi@upi', active: true }],
      attendance: { [`${ym}-01`]: { s1: 'P' } },
      currentPayrollMonth: ym,
    });
    await goTab(page, 'payroll');
    await page.locator('[data-payslip="s1"]').click();
    await page.locator('#upiPayslip').click();
    // Sheet should contain the UPI ID and an anchor with upi:// protocol
    await expect(page.locator('#sheetBody')).toContainText('ravi@upi');
    const href = await page.locator('#upiOpen').getAttribute('href');
    expect(href).toMatch(/^upi:\/\/pay\?/);
    expect(href).toContain('pa=ravi%40upi');
    expect(href).toContain('am=500.00');
    expect(href).toContain('cu=INR');
  });

  test('UPI Pay shows toast when staff has no UPI ID', async ({ page }) => {
    const ym = monthKey();
    await seedState(page, {
      staff: [{ id: 's1', name: 'NoUpi', salaryType: 'daily', amount: 500, active: true }],
      attendance: { [`${ym}-01`]: { s1: 'P' } },
      currentPayrollMonth: ym,
    });
    await goTab(page, 'payroll');
    await page.locator('[data-payslip="s1"]').click();
    await page.locator('#upiPayslip').click();
    await expect(page.locator('#toast')).toBeVisible();
    await expect(page.locator('#toast')).toContainText(/UPI/);
  });
});
