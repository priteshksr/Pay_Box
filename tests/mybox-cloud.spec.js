// @ts-check
// Cloud sync tests — Supabase SDK is stubbed so nothing leaves the browser.
const { test, expect } = require('@playwright/test');

// The stub is installed BEFORE navigation via addInitScript so the app's
// `cloudSync.loadSdk()` resolves instantly from `window.supabase`.
async function installSupabaseStub(page, opts = {}) {
  const persistedSession = opts.persistedSession || null;
  const seedRemote = opts.seedRemote || null; // { userId, data, updatedAt }
  await page.addInitScript(({ persistedSession, seedRemote }) => {
    // In-memory "remote table" keyed by user_id. Shared across all clients
    // on this page via closure. Because addInitScript re-runs on every
    // navigation/reload, we use `seedRemote` so tests can preload a row
    // that survives reloads without needing any in-browser persistence.
    const remote = new Map();
    if (seedRemote) {
      remote.set(seedRemote.userId, { data: seedRemote.data, updated_at: seedRemote.updatedAt });
    }
    let currentSession = persistedSession;
    const authListeners = new Set();
    // Realtime: map of user_id -> Set<callback>
    const realtimeSubs = new Map();
    function fireAuth(ev) {
      authListeners.forEach((fn) => { try { fn(ev, currentSession); } catch (_) {} });
    }
    function fireRealtime(userId, newRow) {
      const subs = realtimeSubs.get(userId); if (!subs) return;
      subs.forEach((cb) => { try { cb({ new: newRow }); } catch (_) {} });
    }

    function makeClient(url, anonKey) {
      const auth = {
        async signUp({ email }) {
          currentSession = { user: { id: 'u-' + email, email } };
          fireAuth('SIGNED_IN');
          return { data: { user: currentSession.user, session: currentSession }, error: null };
        },
        async signInWithPassword({ email, password }) {
          if (password === 'wrong') return { data: null, error: { message: 'invalid credentials' } };
          currentSession = { user: { id: 'u-' + email, email } };
          fireAuth('SIGNED_IN');
          return { data: { user: currentSession.user, session: currentSession }, error: null };
        },
        async signInWithOtp({ email }) {
          window.__magicSentTo = email;
          return { data: {}, error: null };
        },
        async signOut() {
          currentSession = null;
          fireAuth('SIGNED_OUT');
          return { error: null };
        },
        async getSession() { return { data: { session: currentSession } }; },
        onAuthStateChange(cb) {
          authListeners.add(cb);
          return { data: { subscription: { unsubscribe() { authListeners.delete(cb); } } } };
        },
      };

      function from(table) {
        if (table !== 'mybox_state') throw new Error('unexpected table ' + table);
        const api = {
          _filters: {},
          _single: false,
          select() { return this; },
          eq(col, val) { this._filters[col] = val; return this; },
          maybeSingle() { this._single = true; return this.runRead(); },
          runRead() {
            const uid = this._filters.user_id;
            return Promise.resolve({ data: remote.get(uid) || null, error: null });
          },
          upsert(row) {
            remote.set(row.user_id, { data: row.data, updated_at: row.updated_at });
            // Fire realtime AFTER the write so listeners see the new row.
            fireRealtime(row.user_id, row);
            return Promise.resolve({ data: row, error: null });
          },
        };
        return api;
      }

      function channel(name) {
        let userId = null;
        const handlers = [];
        const ch = {
          on(event, filter, cb) {
            if (event === 'postgres_changes' && filter && filter.filter) {
              const m = /user_id=eq\.(.+)$/.exec(filter.filter);
              if (m) userId = m[1];
            }
            handlers.push(cb);
            return ch;
          },
          subscribe(cb) {
            if (userId) {
              const set = realtimeSubs.get(userId) || new Set();
              handlers.forEach((h) => set.add(h));
              realtimeSubs.set(userId, set);
            }
            // async callback to mimic real SDK.
            setTimeout(() => cb && cb('SUBSCRIBED'), 0);
            return ch;
          },
          _userId() { return userId; },
          _handlers: handlers,
          unsubscribe() {
            if (userId && realtimeSubs.has(userId)) {
              const set = realtimeSubs.get(userId);
              handlers.forEach((h) => set.delete(h));
              if (set.size === 0) realtimeSubs.delete(userId);
            }
            return Promise.resolve('ok');
          },
        };
        return ch;
      }
      function removeChannel(ch) { return ch ? ch.unsubscribe() : Promise.resolve('ok'); }

      return { auth, from, channel, removeChannel, __remote: remote, __url: url, __anonKey: anonKey };
    }

    window.supabase = {
      createClient: (url, anonKey) => makeClient(url, anonKey),
      __remote: remote,
      __realtime: realtimeSubs,
      // Test helper: simulates an external device pushing a new version.
      __simulateRemoteWrite(userId, data, updatedAt) {
        const row = { user_id: userId, data, updated_at: updatedAt };
        remote.set(userId, { data, updated_at: updatedAt });
        fireRealtime(userId, row);
      },
      __setSession(session) { currentSession = session; },
    };
  }, { persistedSession, seedRemote });
}

async function gotoFresh(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if (window.caches) { const keys = await caches.keys(); await Promise.all(keys.map((k) => caches.delete(k))); }
    } catch (_) {}
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  // Ensure a persisted state exists in localStorage (the app loads lazily
  // from defaultState, so first render doesn't write anything). Also force
  // onboarded=true to bypass the first-run welcome/login gate.
  await page.evaluate(() => {
    if (!localStorage.getItem('paybox_v2')) {
      const base = {
        business: { name: 'Acme', address: '', upi: '' },
        staff: [], attendance: {}, overtime: {}, adjustments: [], punches: {},
        loans: [], holidays: [], shifts: [], announcements: [], auditLog: [],
        settings: { workingDaysPerMonth: 26, language: 'en', role: 'owner', workerId: null, pinEnabled: false, pinHash: null, onboarded: true },
        cloud: { url: '', anonKey: '', enabled: false, email: '', userId: null, session: null, lastPullAt: 0, lastPushAt: 0 },
        updatedAt: 0,
        currentTab: 'home',
        currentAttendanceDate: new Date().toISOString().slice(0, 10),
        currentPayrollMonth: new Date().toISOString().slice(0, 7),
      };
      localStorage.setItem('paybox_v2', JSON.stringify(base));
    } else {
      const s = JSON.parse(localStorage.getItem('paybox_v2'));
      s.settings = { ...(s.settings || {}), onboarded: true };
      localStorage.setItem('paybox_v2', JSON.stringify(s));
    }
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#viewRoot')).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#viewRoot')).toBeVisible();
}

async function openSettings(page) {
  await page.locator('#settingsBtn').click();
  await expect(page.locator('#settingsForm')).toBeVisible();
}

async function openCloud(page) {
  await openSettings(page);
  await page.locator('[data-sub="cloud"]').click();
  await expect(page.locator('#cloudCfgForm')).toBeVisible();
}

async function enableCloud(page, url = 'https://example.supabase.co', anon = 'anon-key-xxx') {
  await openCloud(page);
  await page.locator('#cloudCfgForm input[name="enabled"]').check();
  await page.locator('#cloudCfgForm input[name="url"]').fill(url);
  await page.locator('#cloudCfgForm input[name="anonKey"]').fill(anon);
  await page.locator('#cloudCfgForm button[type="submit"]').click();
  await expect(page.locator('#cloudAuthBlock')).toBeVisible();
}

async function signIn(page, email = 'owner@example.com', pwd = 'secret123') {
  const form = page.locator('#cloudAuthForm');
  await form.locator('input[name="email"]').fill(email);
  await form.locator('input[name="password"]').fill(pwd);
  await form.locator('button[type="submit"]').click();
  await expect(page.locator('#cloudSignOut')).toBeVisible({ timeout: 5000 });
}

// =================================================================

test.describe('Cloud sync — configuration gate', () => {
  test.beforeEach(async ({ page }) => { await installSupabaseStub(page); });

  test('cloud sheet refuses to enable without URL + key when DEFAULT_CLOUD is cleared', async ({ page }) => {
    await gotoFresh(page);
    // Clear the pre-filled DEFAULT_CLOUD values to simulate BYO-backend mode.
    // Use non-empty placeholders so the hydrator doesn't refill from DEFAULT_CLOUD.
    await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('paybox_v2') || '{}');
      raw.cloud = { ...raw.cloud, url: 'x', anonKey: 'x', enabled: false };
      localStorage.setItem('paybox_v2', JSON.stringify(raw));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openCloud(page);
    await page.locator('#cloudCfgForm input[name="enabled"]').check();
    // Clear the inputs to test validation
    await page.locator('#cloudCfgForm input[name="url"]').fill('');
    await page.locator('#cloudCfgForm input[name="anonKey"]').fill('');
    await page.locator('#cloudCfgForm button[type="submit"]').click();
    await expect(page.locator('#toast')).toContainText(/Enter Supabase URL/i);
  });

  test('configuration is persisted and reveals auth block', async ({ page }) => {
    await gotoFresh(page);
    await enableCloud(page, 'https://abcd.supabase.co', 'anon-123');
    const s = await page.evaluate(() => JSON.parse(localStorage.getItem('paybox_v2')));
    expect(s.cloud.enabled).toBe(true);
    expect(s.cloud.url).toBe('https://abcd.supabase.co');
    expect(s.cloud.anonKey).toBe('anon-123');
  });
});

test.describe('Cloud sync — auth + push/pull', () => {
  // Legacy single-blob sync (v1) is disabled when DEFAULT_CLOUD is present
  // because v2Mode() returns true. These tests cover the v1 path which is
  // no longer active. Skip until migrated to test cloudBiz (v2) flows.
  test.skip();
  test.beforeEach(async ({ page }) => { await installSupabaseStub(page); });

  test('sign-in + Sync now uploads local data to remote', async ({ page }) => {
    await gotoFresh(page);
    // Seed local staff directly so the push has real data to serialize.
    await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('paybox_v2'));
      raw.staff.push({ id: 's-cloud', name: 'Cloud Tester', salaryType: 'monthly', amount: 12000, active: true });
      raw.updatedAt = Date.now();
      localStorage.setItem('paybox_v2', JSON.stringify(raw));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });

    await enableCloud(page);
    await signIn(page);
    await page.locator('#cloudSyncNow').click();
    await expect(page.locator('#cloudStatusRow')).toContainText(/Synced/i, { timeout: 5000 });

    const remoteRow = await page.evaluate(() => {
      const [entry] = Array.from(window.supabase.__remote.entries());
      return entry ? { key: entry[0], data: entry[1] } : null;
    });
    expect(remoteRow).not.toBeNull();
    expect(remoteRow.data.data.staff.some((s) => s.name === 'Cloud Tester')).toBe(true);
    expect(remoteRow.data.updated_at).toBeGreaterThan(0);
    // Local cloud config should not leak into the pushed payload.
    expect(remoteRow.data.data.cloud).toBeUndefined();
  });

  test('second device pulls remote data when remote is newer', async ({ page }) => {
    await gotoFresh(page);
    await enableCloud(page);
    await signIn(page, 'dev2@example.com', 'pw12345');

    // Place a newer remote payload for this user.
    await page.evaluate(() => {
      window.supabase.__remote.set('u-dev2@example.com', {
        data: {
          business: { name: 'Acme Cloud', address: '', upi: '' },
          staff: [{ id: 's-remote', name: 'From Cloud', salaryType: 'monthly', amount: 20000, active: true }],
          attendance: {}, overtime: {}, adjustments: [], punches: {},
          loans: [], holidays: [], shifts: [], announcements: [], auditLog: [],
          settings: { workingDaysPerMonth: 26, language: 'en', role: 'owner', workerId: null, pinEnabled: false, pinHash: null },
          updatedAt: Number.MAX_SAFE_INTEGER,
        },
        updated_at: Number.MAX_SAFE_INTEGER,
      });
    });

    await page.locator('#cloudPullOnly').click();
    await expect(page.locator('#cloudSignOut')).toBeVisible();
    const pulled = await page.evaluate(() => JSON.parse(localStorage.getItem('paybox_v2')));
    expect(pulled.business.name).toBe('Acme Cloud');
    expect(pulled.staff.some((s) => s.name === 'From Cloud')).toBe(true);
    // Cloud config must be preserved even though the pulled payload had none.
    expect(pulled.cloud.enabled).toBe(true);
  });

  test('sign out clears session and hides sync buttons', async ({ page }) => {
    await gotoFresh(page);
    await enableCloud(page);
    await signIn(page);
    await page.locator('#cloudSignOut').click();
    await expect(page.locator('#cloudAuthForm')).toBeVisible();
    const s = await page.evaluate(() => JSON.parse(localStorage.getItem('paybox_v2')));
    expect(s.cloud.userId).toBeNull();
  });

  test('magic link flow surfaces confirmation message', async ({ page }) => {
    await gotoFresh(page);
    await enableCloud(page);
    await page.locator('#cloudAuthForm input[name="email"]').fill('owner@example.com');
    await page.locator('#cloudMagicBtn').click();
    await expect(page.locator('#cloudStatusRow')).toContainText(/Check your email/i);
    const sent = await page.evaluate(() => window.__magicSentTo);
    expect(sent).toBe('owner@example.com');
  });

  test('invalid password surfaces error message', async ({ page }) => {
    await gotoFresh(page);
    await enableCloud(page);
    await page.locator('#cloudAuthForm input[name="email"]').fill('owner@example.com');
    await page.locator('#cloudAuthForm input[name="password"]').fill('wrong');
    await page.locator('#cloudAuthForm button[type="submit"]').click();
    await expect(page.locator('#cloudStatusRow')).toContainText(/invalid/i);
    await expect(page.locator('#cloudAuthForm')).toBeVisible();
  });
});

test.describe('Cloud sync — last-write-wins', () => {
  test.skip(); // Legacy v1 path disabled by DEFAULT_CLOUD — see v2Mode()
  test.beforeEach(async ({ page }) => { await installSupabaseStub(page); });

  test('newer remote overrides older local on pull', async ({ page }) => {
    await gotoFresh(page);
    // Local has older "Alice".
    await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('paybox_v2'));
      raw.staff = [{ id: 's-alice', name: 'Alice', salaryType: 'monthly', amount: 10000, active: true }];
      raw.updatedAt = 1000;
      localStorage.setItem('paybox_v2', JSON.stringify(raw));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await enableCloud(page);
    await signIn(page, 'lww@example.com', 'pw123456');

    // Manually seed remote with a newer payload containing "Bob".
    await page.evaluate(() => {
      window.supabase.__remote.set('u-lww@example.com', {
        data: {
          business: { name: 'Acme', address: '', upi: '' },
          staff: [{ id: 's-bob', name: 'Bob', salaryType: 'monthly', amount: 15000, active: true }],
          attendance: {}, overtime: {}, adjustments: [], punches: {},
          loans: [], holidays: [], shifts: [], announcements: [], auditLog: [],
          settings: { workingDaysPerMonth: 26, language: 'en', role: 'owner', workerId: null, pinEnabled: false, pinHash: null },
          updatedAt: 9_999_999_999_999,
        },
        updated_at: 9_999_999_999_999,
      });
    });

    await page.locator('#cloudPullOnly').click();
    await expect(page.locator('#cloudSignOut')).toBeVisible();
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('paybox_v2')));
    expect(after.staff.some((s) => s.name === 'Bob')).toBe(true);
    expect(after.staff.some((s) => s.name === 'Alice')).toBe(false);
  });

  test('older remote is ignored when local is newer', async ({ page }) => {
    await gotoFresh(page);
    await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('paybox_v2'));
      raw.staff = [{ id: 's-local', name: 'LocalOnly', salaryType: 'monthly', amount: 9000, active: true }];
      raw.updatedAt = Date.now() + 100000;
      localStorage.setItem('paybox_v2', JSON.stringify(raw));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await enableCloud(page);
    await signIn(page, 'stale@example.com', 'pw');
    await page.evaluate(() => {
      window.supabase.__remote.set('u-stale@example.com', {
        data: { staff: [{ id: 's-old', name: 'Stale', salaryType: 'monthly', amount: 100, active: true }] },
        updated_at: 1,
      });
    });
    await page.locator('#cloudPullOnly').click();
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('paybox_v2')));
    expect(after.staff.some((s) => s.name === 'LocalOnly')).toBe(true);
    expect(after.staff.some((s) => s.name === 'Stale')).toBe(false);
  });
});

// =================================================================
// Boot pull + realtime
// =================================================================

test.describe('Cloud sync — boot hydrate', () => {
  test.skip(); // Legacy v1 path disabled by DEFAULT_CLOUD — see v2Mode()
  test('on reload with active session + newer remote, app auto-pulls', async ({ page }) => {
    // Seed the stub via init args so the data survives the reload.
    const remoteData = {
      business: { name: 'FreshCloud', address: '', upi: '' },
      staff: [{ id: 's-new', name: 'FreshFromCloud', salaryType: 'monthly', amount: 20000, active: true }],
      attendance: {}, overtime: {}, adjustments: [], punches: {},
      loans: [], holidays: [], shifts: [], announcements: [], auditLog: [],
      settings: { workingDaysPerMonth: 26, language: 'en', role: 'owner', workerId: null, pinEnabled: false, pinHash: null },
      updatedAt: 9_999_999_999_999,
    };
    await installSupabaseStub(page, {
      persistedSession: { user: { id: 'u-boot@example.com', email: 'boot@example.com' } },
      seedRemote: { userId: 'u-boot@example.com', data: remoteData, updatedAt: 9_999_999_999_999 },
    });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    // Seed cloud config + a stale local state.
    await page.evaluate(() => {
      const base = {
        business: { name: 'Stale', address: '', upi: '' },
        staff: [{ id: 's-old', name: 'OldLocal', salaryType: 'monthly', amount: 1000, active: true }],
        attendance: {}, overtime: {}, adjustments: [], punches: {},
        loans: [], holidays: [], shifts: [], announcements: [], auditLog: [],
        settings: { workingDaysPerMonth: 26, language: 'en', role: 'owner', workerId: null, pinEnabled: false, pinHash: null, onboarded: true },
        cloud: { url: 'https://x.supabase.co', anonKey: 'k', enabled: true, email: 'boot@example.com', userId: 'u-boot@example.com', session: null, lastPullAt: 0, lastPushAt: 0 },
        updatedAt: 1,
        currentTab: 'home',
        currentAttendanceDate: new Date().toISOString().slice(0, 10),
        currentPayrollMonth: new Date().toISOString().slice(0, 7),
      };
      localStorage.setItem('paybox_v2', JSON.stringify(base));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    // Business name lives in the header, staff name in the home view.
    await expect(page.locator('#businessName')).toContainText('FreshCloud', { timeout: 5000 });
    await expect(page.locator('#viewRoot')).toContainText('FreshFromCloud', { timeout: 5000 });
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('paybox_v2')));
    expect(after.staff.some((s) => s.name === 'FreshFromCloud')).toBe(true);
    expect(after.business.name).toBe('FreshCloud');
    expect(after.cloud.enabled).toBe(true);
  });

  test('boot is a no-op when cloud is disabled', async ({ page }) => {
    await installSupabaseStub(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      const base = {
        business: { name: 'Local Only', address: '', upi: '' },
        staff: [], attendance: {}, overtime: {}, adjustments: [], punches: {},
        loans: [], holidays: [], shifts: [], announcements: [], auditLog: [],
        settings: { workingDaysPerMonth: 26, language: 'en', role: 'owner', workerId: null, pinEnabled: false, pinHash: null, onboarded: true },
        cloud: { url: '', anonKey: '', enabled: false, email: '', userId: null, session: null, lastPullAt: 0, lastPushAt: 0 },
        updatedAt: Date.now(),
        currentTab: 'home',
        currentAttendanceDate: new Date().toISOString().slice(0, 10),
        currentPayrollMonth: new Date().toISOString().slice(0, 7),
      };
      localStorage.setItem('paybox_v2', JSON.stringify(base));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#viewRoot')).toBeVisible();
    // After boot, no client should have been created (no session reads).
    const state = await page.evaluate(() => JSON.parse(localStorage.getItem('paybox_v2')));
    expect(state.cloud.enabled).toBe(false);
    expect(state.business.name).toBe('Local Only');
  });
});

test.describe('Cloud sync — realtime', () => {
  test.skip(); // Legacy v1 path disabled by DEFAULT_CLOUD — see v2Mode()
  test.beforeEach(async ({ page }) => { await installSupabaseStub(page); });

  test('incoming postgres change with newer updated_at is applied live', async ({ page }) => {
    await gotoFresh(page);
    await enableCloud(page);
    await signIn(page, 'rt@example.com', 'pw-ok-12345');
    // Subscription is registered synchronously on sign-in; give the
    // async subscribe callback a moment to flip status to "live".
    await expect.poll(async () => {
      return await page.evaluate(() => window.__cloudSync && window.__cloudSync.currentStatus());
    }, { timeout: 5000 }).toBe('live');

    // External device pushes a newer row.
    await page.evaluate(() => {
      window.supabase.__simulateRemoteWrite('u-rt@example.com', {
        business: { name: 'LiveUpdate', address: '', upi: '' },
        staff: [{ id: 's-rt', name: 'RealtimeAlice', salaryType: 'monthly', amount: 11000, active: true }],
        attendance: {}, overtime: {}, adjustments: [], punches: {},
        loans: [], holidays: [], shifts: [], announcements: [], auditLog: [],
        settings: { workingDaysPerMonth: 26, language: 'en', role: 'owner', workerId: null, pinEnabled: false, pinHash: null },
        updatedAt: Date.now() + 1_000_000,
      }, Date.now() + 1_000_000);
    });

    await expect(page.locator('#businessName')).toContainText('LiveUpdate', { timeout: 5000 });
    await expect(page.locator('#viewRoot')).toContainText('RealtimeAlice', { timeout: 5000 });
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('paybox_v2')));
    expect(after.staff.some((s) => s.name === 'RealtimeAlice')).toBe(true);
  });

  test('incoming change equal to our lastPushedAt is ignored (echo guard)', async ({ page }) => {
    await gotoFresh(page);
    await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('paybox_v2'));
      raw.staff = [{ id: 's-me', name: 'MyDevice', salaryType: 'monthly', amount: 5000, active: true }];
      raw.updatedAt = Date.now();
      localStorage.setItem('paybox_v2', JSON.stringify(raw));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await enableCloud(page);
    await signIn(page, 'echo@example.com', 'pw-ok-12345');
    // Push our state to cloud — this also fires a realtime event back to us.
    await page.locator('#cloudSyncNow').click();
    await expect(page.locator('#cloudStatusRow')).toContainText(/Synced|Live/i, { timeout: 5000 });
    // Grab the updated_at we just pushed.
    const pushedAt = await page.evaluate(() => {
      const [, v] = Array.from(window.supabase.__remote.entries())[0];
      return v.updated_at;
    });
    // Now simulate an identical (or older) echo — should be ignored.
    await page.evaluate((pushedAt) => {
      window.supabase.__simulateRemoteWrite('u-echo@example.com', {
        staff: [{ id: 's-wrong', name: 'EchoGhost', salaryType: 'monthly', amount: 0, active: true }],
        updatedAt: pushedAt,
      }, pushedAt);
    }, pushedAt);
    // Wait a beat then confirm the ghost is NOT in local state.
    await page.waitForTimeout(300);
    const state = await page.evaluate(() => JSON.parse(localStorage.getItem('paybox_v2')));
    expect(state.staff.some((s) => s.name === 'EchoGhost')).toBe(false);
    expect(state.staff.some((s) => s.name === 'MyDevice')).toBe(true);
  });

  test('sign out tears down realtime subscription', async ({ page }) => {
    await gotoFresh(page);
    await enableCloud(page);
    await signIn(page, 'teardown@example.com', 'pw-ok-12345');
    await expect.poll(async () => {
      return await page.evaluate(() => window.__cloudSync.currentStatus());
    }, { timeout: 5000 }).toBe('live');
    // Before sign-out: there is a subscriber for this user.
    const before = await page.evaluate(() =>
      (window.supabase.__realtime.get('u-teardown@example.com') || new Set()).size);
    expect(before).toBeGreaterThan(0);
    await page.locator('#cloudSignOut').click();
    await expect(page.locator('#cloudAuthForm')).toBeVisible();
    const after = await page.evaluate(() =>
      (window.supabase.__realtime.get('u-teardown@example.com') || new Set()).size);
    expect(after).toBe(0);
  });
});
