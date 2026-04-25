// =====================================================================
// PayBox live Supabase end-to-end smoke test.
//
// Drives the REAL Supabase project at DEFAULT_CLOUD via the supabase-js
// client to verify every realistic scenario in welcome / login / business
// flow:
//
//   1.  Owner: signUp + create_business
//   2.  Owner: rotate_join_code
//   3.  Owner: signOut + signIn (existing account) → discoverMembership
//       finds the same business
//   4.  Owner: re-signUp same email → "already registered" path; signIn
//       falls back transparently
//   5.  Worker: signUp + join_business with valid code → pending member
//   6.  Worker: join_business with invalid code → expected error
//   7.  Owner: approve_member maps worker to staff_id
//   8.  Worker: refresh membership shows role=worker + staff_id mapping
//   9.  Worker: append punch_in event → owner reads it (RLS allows)
//  10.  Anonymous (no auth): cannot insert into events (RLS blocks)
//  10b. Per-staff invite codes: owner mints, worker claims, RLS,
//       phone seeded as staff_update event
//  10c. Phone-only worker login: signInAnonymously + claim_staff_invite
//       with phone — no email/password ever exchanged
//  11.  Owner: cleanup — delete the business (cascades members + events)
//  12.  Owner + worker: signOut, then attempt to sign in with wrong
//       password → expected error
//
// Run from this folder:
//
//   node ./live-supabase-smoke.mjs
//
// All test users are created with disposable emails of the form
//   paybox-smoke+<scenario>-<timestamp>@<allowed-domain>
// so multiple runs do not collide.
// =====================================================================

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://laifbtwnouavnvhyaihh.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhaWZidHdub3Vhdm52aHlhaWhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY5NDk5MDAsImV4cCI6MjA5MjUyNTkwMH0.OecObEQG2JmCtp8Gs83TVDKzewk-CAdm1RhJNxrSZ7s';

// We share one anon key but each "user" gets its own client so sessions
// don't trample each other. Disable session persistence so re-runs are
// deterministic and don't leak into the local filesystem.
function client() {
  return createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const ts = Date.now();
const stamp = (label) => `paybox-smoke+${label}-${ts}@gmail.com`;
const PASSWORD = 'paybox-smoke-pw-9381';

let pass = 0, fail = 0;
const results = [];

function ok(name) {
  pass++;
  results.push({ name, ok: true });
  console.log(`  PASS  ${name}`);
}
function bad(name, err) {
  fail++;
  results.push({ name, ok: false, err: String(err && err.message || err) });
  console.log(`  FAIL  ${name}`);
  console.log(`        ${err && err.message || err}`);
}
async function step(name, fn) {
  try { await fn(); ok(name); }
  catch (e) { bad(name, e); }
}

// Tracks state across scenarios.
const state = {
  ownerEmail: stamp('owner'),
  workerEmail: stamp('worker'),
  ownerClient: null,
  workerClient: null,
  business: null,
  joinCode: null,
};

console.log('\n=== PayBox live Supabase smoke ===');
console.log(`  url     : ${SUPABASE_URL}`);
console.log(`  owner   : ${state.ownerEmail}`);
console.log(`  worker  : ${state.workerEmail}\n`);

// ---------------------------------------------------------------------
// 1. Owner: signUp + signIn + create_business
// ---------------------------------------------------------------------
await step('owner: signUp', async () => {
  state.ownerClient = client();
  const { error } = await state.ownerClient.auth.signUp({ email: state.ownerEmail, password: PASSWORD });
  if (error) throw error;
});

await step('owner: signIn (post-signup)', async () => {
  const { error } = await state.ownerClient.auth.signInWithPassword({ email: state.ownerEmail, password: PASSWORD });
  if (error) throw error;
});

await step('owner: create_business RPC', async () => {
  const { data, error } = await state.ownerClient.rpc('create_business', { biz_name: 'Smoke Dairy', initial_config: { staff: [{ id: 's1', name: 'Ramesh', salaryType: 'monthly', amount: 12000, active: true }] } });
  if (error) throw error;
  if (!data || !data.id || !data.join_code) throw new Error('create_business returned no row');
  state.business = data;
  state.joinCode = data.join_code;
});

await step('owner: business config persisted', async () => {
  const { data, error } = await state.ownerClient.from('businesses').select('id, name, config, join_code').eq('id', state.business.id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('business not readable by owner');
  if (data.name !== 'Smoke Dairy') throw new Error('biz name mismatch');
  if (!Array.isArray(data.config?.staff) || data.config.staff[0].name !== 'Ramesh') throw new Error('config.staff not stored');
});

// ---------------------------------------------------------------------
// 2. rotate_join_code
// ---------------------------------------------------------------------
await step('owner: rotate_join_code returns new 6-char code', async () => {
  const { data, error } = await state.ownerClient.rpc('rotate_join_code', { biz: state.business.id });
  if (error) throw error;
  if (typeof data !== 'string' || data.length !== 6) throw new Error('rotate_join_code returned ' + JSON.stringify(data));
  if (data === state.joinCode) throw new Error('new code equals old code');
  state.joinCode = data;
});

// ---------------------------------------------------------------------
// 3. Owner re-signin (simulate fresh device) → discover existing biz
// ---------------------------------------------------------------------
await step('owner: signOut + signIn fresh client', async () => {
  await state.ownerClient.auth.signOut();
  const c2 = client();
  const { error } = await c2.auth.signInWithPassword({ email: state.ownerEmail, password: PASSWORD });
  if (error) throw error;
  state.ownerClient = c2;
});

await step('owner: discoverMembership finds existing biz', async () => {
  const { data: sess } = await state.ownerClient.auth.getSession();
  const { data, error } = await state.ownerClient.from('members').select('business_id, role').eq('user_id', sess.session.user.id);
  if (error) throw error;
  if (!data?.length) throw new Error('no membership row');
  if (data[0].business_id !== state.business.id) throw new Error('membership points to wrong biz');
  if (data[0].role !== 'owner') throw new Error('role expected owner, got ' + data[0].role);
});

// ---------------------------------------------------------------------
// 4. Owner re-signUp same email (auth account exists) → graceful path
// ---------------------------------------------------------------------
await step('owner: re-signUp same email → "already registered" / similar', async () => {
  const c2 = client();
  const { error } = await c2.auth.signUp({ email: state.ownerEmail, password: PASSWORD });
  if (!error) {
    // Some Supabase configs return success and just send another confirm
    // email — that's fine; what matters is we can fall back to signIn.
    const { error: e2 } = await c2.auth.signInWithPassword({ email: state.ownerEmail, password: PASSWORD });
    if (e2) throw new Error('signUp succeeded but signIn failed: ' + e2.message);
    return;
  }
  if (!/already (registered|exists)|user_already_exists|email_already_in_use|already been registered/i.test(error.message)) {
    throw new Error('unexpected signUp error: ' + error.message);
  }
  const { error: e2 } = await c2.auth.signInWithPassword({ email: state.ownerEmail, password: PASSWORD });
  if (e2) throw new Error('fallback signIn failed: ' + e2.message);
});

// ---------------------------------------------------------------------
// 5. Worker: signUp + signIn + join_business
// ---------------------------------------------------------------------
await step('worker: signUp', async () => {
  state.workerClient = client();
  const { error } = await state.workerClient.auth.signUp({ email: state.workerEmail, password: PASSWORD });
  if (error) throw error;
});

await step('worker: signIn (post-signup)', async () => {
  const { error } = await state.workerClient.auth.signInWithPassword({ email: state.workerEmail, password: PASSWORD });
  if (error) throw error;
});

await step('worker: join_business with valid code → pending', async () => {
  const { data, error } = await state.workerClient.rpc('join_business', { code: state.joinCode, display: 'Worker R' });
  if (error) throw error;
  if (data !== state.business.id) throw new Error('join_business returned wrong biz id');
  // Worker should now have a pending row visible to themself.
  const { data: sess } = await state.workerClient.auth.getSession();
  const { data: rows, error: e2 } = await state.workerClient.from('members').select('role').eq('user_id', sess.session.user.id).eq('business_id', state.business.id);
  if (e2) throw e2;
  if (!rows?.length || rows[0].role !== 'pending') throw new Error('membership not pending: ' + JSON.stringify(rows));
});

// ---------------------------------------------------------------------
// 6. Worker: join_business with invalid code
// ---------------------------------------------------------------------
await step('worker: join_business with invalid code → expected error', async () => {
  const { error } = await state.workerClient.rpc('join_business', { code: 'XXXXXX', display: 'no' });
  if (!error) throw new Error('expected error but got success');
  if (!/invalid_code/.test(error.message)) throw new Error('unexpected error: ' + error.message);
});

// ---------------------------------------------------------------------
// 7. Owner: approve_member maps worker to staff_id
// ---------------------------------------------------------------------
await step('owner: lists pending members and approves worker', async () => {
  const { data: rows, error } = await state.ownerClient.from('members').select('user_id, role, display_name').eq('business_id', state.business.id).eq('role', 'pending');
  if (error) throw error;
  if (!rows?.length) throw new Error('no pending members visible to owner');
  const pending = rows[0];
  const { error: e2 } = await state.ownerClient.rpc('approve_member', { biz: state.business.id, uid: pending.user_id, assigned_staff_id: 's1' });
  if (e2) throw e2;
});

// ---------------------------------------------------------------------
// 8. Worker: membership now role=worker + staff_id=s1
// ---------------------------------------------------------------------
await step('worker: membership now role=worker, staff_id=s1', async () => {
  const { data: sess } = await state.workerClient.auth.getSession();
  const { data, error } = await state.workerClient.from('members').select('role, staff_id').eq('user_id', sess.session.user.id).eq('business_id', state.business.id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('no membership row');
  if (data.role !== 'worker') throw new Error('role expected worker, got ' + data.role);
  if (data.staff_id !== 's1') throw new Error('staff_id expected s1, got ' + data.staff_id);
});

// ---------------------------------------------------------------------
// 9. Worker writes punch_in event → owner reads it (RLS allows)
// ---------------------------------------------------------------------
await step('worker: insert punch_in event', async () => {
  const { data: sess } = await state.workerClient.auth.getSession();
  const { error } = await state.workerClient.from('events').insert({
    business_id: state.business.id,
    author_id: sess.session.user.id,
    staff_id: 's1',
    kind: 'punch_in',
    payload: { date: '2026-04-23', time: '09:02', at: Date.now() },
  });
  if (error) throw error;
});

await step('owner: reads worker punch_in event', async () => {
  const { data, error } = await state.ownerClient.from('events').select('id, kind, staff_id, payload').eq('business_id', state.business.id).eq('kind', 'punch_in').order('id', { ascending: false }).limit(1);
  if (error) throw error;
  if (!data?.length) throw new Error('owner does not see worker event');
  if (data[0].staff_id !== 's1') throw new Error('event staff_id wrong');
});

// ---------------------------------------------------------------------
// 10. Worker may NOT insert event tagged for a different staff_id
// ---------------------------------------------------------------------
await step('worker: insert event for OTHER staff_id is blocked by RLS', async () => {
  const { data: sess } = await state.workerClient.auth.getSession();
  const { error } = await state.workerClient.from('events').insert({
    business_id: state.business.id,
    author_id: sess.session.user.id,
    staff_id: 's999',
    kind: 'punch_in',
    payload: { date: '2026-04-23' },
  });
  if (!error) throw new Error('expected RLS block but insert succeeded');
});

// ---------------------------------------------------------------------
// 10b. Per-staff invite codes (the new flow). Owner mints a personal
//      code for staff `s2`; a brand-new worker email claims it and
//      becomes role=worker, staff_id=s2 in one shot — no approval.
// ---------------------------------------------------------------------
state.invitedWorkerEmail = stamp('invited');
state.invitedWorkerClient = null;
state.staffInviteCode = null;

await step('owner: create_staff_invite for s2 returns 8-char code', async () => {
  // Add s2 to the config so the invite is mappable.
  const cfg = { ...state.business.config, staff: [
    ...(state.business.config?.staff || []),
    { id: 's2', name: 'Geeta', salaryType: 'monthly', amount: 15000, active: true },
  ]};
  await state.ownerClient.from('businesses').update({ config: cfg }).eq('id', state.business.id);

  const { data, error } = await state.ownerClient.rpc('create_staff_invite', {
    biz: state.business.id, p_staff_id: 's2', p_display_name: 'Geeta',
  });
  if (error) throw error;
  if (typeof data !== 'string' || data.length !== 8) throw new Error('expected 8-char code, got ' + JSON.stringify(data));
  state.staffInviteCode = data;
});

await step('owner: re-issuing invite for s2 revokes the previous code', async () => {
  const old = state.staffInviteCode;
  const { data: fresh, error } = await state.ownerClient.rpc('create_staff_invite', {
    biz: state.business.id, p_staff_id: 's2', p_display_name: 'Geeta',
  });
  if (error) throw error;
  if (fresh === old) throw new Error('new code equals old code');
  // The old one should now be unusable. We need an authenticated client
  // so the not-authenticated branch isn't what trips us up.
  const c = client();
  await c.auth.signInAnonymously();
  const { error: claimErr } = await c.rpc('claim_staff_invite', { p_code: old, p_display_name: 'rogue', p_phone: null });
  if (!claimErr) throw new Error('expected old code to be invalid after rotation');
  state.staffInviteCode = fresh;
});

await step('worker: signUp with invited email', async () => {
  state.invitedWorkerClient = client();
  const { error } = await state.invitedWorkerClient.auth.signUp({
    email: state.invitedWorkerEmail, password: PASSWORD,
  });
  if (error) throw error;
  const { error: e2 } = await state.invitedWorkerClient.auth.signInWithPassword({
    email: state.invitedWorkerEmail, password: PASSWORD,
  });
  if (e2) throw e2;
});

await step('worker: claim_staff_invite → instantly role=worker, staff_id=s2', async () => {
  const { data, error } = await state.invitedWorkerClient.rpc('claim_staff_invite', {
    p_code: state.staffInviteCode, p_display_name: 'Geeta P', p_phone: '+91 98765 11111',
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  const bizId = row?.out_business_id || row?.business_id;
  const staffId = row?.out_staff_id || row?.staff_id;
  if (!row || bizId !== state.business.id) throw new Error('claim returned wrong biz: ' + JSON.stringify(data));
  if (staffId !== 's2') throw new Error('claim returned wrong staff_id: ' + staffId);

  const { data: sess } = await state.invitedWorkerClient.auth.getSession();
  const { data: mem, error: e2 } = await state.invitedWorkerClient.from('members')
    .select('role, staff_id').eq('business_id', state.business.id)
    .eq('user_id', sess.session.user.id).maybeSingle();
  if (e2) throw e2;
  if (!mem) throw new Error('no members row for invited worker');
  if (mem.role !== 'worker') throw new Error('role expected worker, got ' + mem.role);
  if (mem.staff_id !== 's2') throw new Error('staff_id expected s2, got ' + mem.staff_id);
});

await step('owner: sees phone seeded via staff_update event from claim', async () => {
  const { data, error } = await state.ownerClient.from('events')
    .select('staff_id, kind, payload')
    .eq('business_id', state.business.id)
    .eq('kind', 'staff_update')
    .eq('staff_id', 's2')
    .order('id', { ascending: false })
    .limit(5);
  if (error) throw error;
  const seeded = (data || []).find(r => r.payload && /9876511111/.test(JSON.stringify(r.payload)));
  if (!seeded) throw new Error('phone not seeded as staff_update event: ' + JSON.stringify(data));
});

await step('worker: claim_staff_invite same code twice → invalid_or_used_invite', async () => {
  const c = client();
  await c.auth.signInAnonymously();
  const { error } = await c.rpc('claim_staff_invite', {
    p_code: state.staffInviteCode, p_display_name: 'replay', p_phone: null,
  });
  if (!error) throw new Error('expected error replaying used invite');
  if (!/invalid_or_used_invite|invalid_code/i.test(error.message)) throw new Error('unexpected error: ' + error.message);
});

await step('worker: claim_staff_invite with bogus code → invalid_or_used_invite', async () => {
  const { error } = await state.invitedWorkerClient.rpc('claim_staff_invite', {
    p_code: 'NOPENOPE', p_display_name: 'no', p_phone: null,
  });
  if (!error) throw new Error('expected error');
  if (!/invalid_or_used_invite|invalid_code/i.test(error.message)) throw new Error('unexpected: ' + error.message);
});

// ---------------------------------------------------------------------
// 10c. Phone-only anonymous worker login (the new default flow).
//      A brand-new device with NO email account: just signInAnonymously
//      then claim_staff_invite with phone — the worker is in.
// ---------------------------------------------------------------------
state.anonPhoneClient = null;
state.anonPhoneCode = null;
await step('owner: mints fresh code for new staff s3 (for phone-anon test)', async () => {
  const cfg = { ...state.business.config, staff: [
    ...(state.business.config?.staff || []),
    { id: 's3', name: 'Sunita', salaryType: 'monthly', amount: 14000, active: true },
  ]};
  await state.ownerClient.from('businesses').update({ config: cfg }).eq('id', state.business.id);
  const { data, error } = await state.ownerClient.rpc('create_staff_invite', {
    biz: state.business.id, p_staff_id: 's3', p_display_name: 'Sunita',
  });
  if (error) throw error;
  if (typeof data !== 'string' || data.length !== 8) throw new Error('expected 8-char code');
  state.anonPhoneCode = data;
});

await step('worker (phone-only): signInAnonymously succeeds (no email/password)', async () => {
  state.anonPhoneClient = client();
  const { data, error } = await state.anonPhoneClient.auth.signInAnonymously();
  if (error) {
    if (/disabled|provider/i.test(error.message)) {
      throw new Error('Anonymous Sign-Ins is disabled in Supabase → Authentication → Providers. Enable it.');
    }
    throw error;
  }
  if (!data?.user?.id) throw new Error('no anon user id returned');
});

await step('worker (phone-only): claim_staff_invite with phone seeds profile', async () => {
  const { data, error } = await state.anonPhoneClient.rpc('claim_staff_invite', {
    p_code: state.anonPhoneCode,
    p_display_name: null, // first screen does NOT collect name
    p_phone: '+91 90000 22222',
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  const staffId = row?.out_staff_id || row?.staff_id;
  if (!row || staffId !== 's3') throw new Error('claim wrong: ' + JSON.stringify(data));

  // Confirm the seeded staff_update event landed.
  const { data: ev, error: e2 } = await state.ownerClient.from('events')
    .select('payload').eq('business_id', state.business.id)
    .eq('kind', 'staff_update').eq('staff_id', 's3')
    .order('id', { ascending: false }).limit(1).maybeSingle();
  if (e2) throw e2;
  if (!ev || !/9000022222/.test(JSON.stringify(ev.payload || {}))) {
    throw new Error('phone not seeded for s3: ' + JSON.stringify(ev));
  }
});

await step('worker (phone-only): can update OWN profile (staff_update for s3)', async () => {
  const { data: sess } = await state.anonPhoneClient.auth.getSession();
  const { error } = await state.anonPhoneClient.from('events').insert({
    business_id: state.business.id,
    author_id: sess.session.user.id,
    staff_id: 's3', kind: 'staff_update',
    payload: { name: 'Sunita Devi', phone: '+91 90000 33333' },
  });
  if (error) throw error;
});

await step('worker (phone-only): cannot update SOMEONE ELSE (staff_update for s1) → RLS', async () => {
  const { data: sess } = await state.anonPhoneClient.auth.getSession();
  const { error } = await state.anonPhoneClient.from('events').insert({
    business_id: state.business.id,
    author_id: sess.session.user.id,
    staff_id: 's1', kind: 'staff_update',
    payload: { name: 'rogue' },
  });
  if (!error) throw new Error('RLS should have blocked cross-staff update');
});

// Worker self-service: emit a staff_update event for their own staff_id.
// RLS only allows my_staff_id() so this should succeed for s2 and fail for s1.
await step('worker: staff_update event for OWN staff_id succeeds', async () => {
  const { data: sess } = await state.invitedWorkerClient.auth.getSession();
  const { error } = await state.invitedWorkerClient.from('events').insert({
    business_id: state.business.id,
    author_id: sess.session.user.id,
    staff_id: 's2',
    kind: 'staff_update',
    payload: { name: 'Geeta Patel', phone: '+91 99000 00000' },
  });
  if (error) throw error;
});

await step('worker: staff_update event for SOMEONE ELSE → blocked by RLS', async () => {
  const { data: sess } = await state.invitedWorkerClient.auth.getSession();
  const { error } = await state.invitedWorkerClient.from('events').insert({
    business_id: state.business.id,
    author_id: sess.session.user.id,
    staff_id: 's1',
    kind: 'staff_update',
    payload: { name: 'hacker' },
  });
  if (!error) throw new Error('expected RLS block but insert succeeded');
});

await step('owner: lists staff_invites and sees both used + unused entries', async () => {
  const { data, error } = await state.ownerClient.from('staff_invites')
    .select('staff_id, code, used_at')
    .eq('business_id', state.business.id);
  if (error) throw error;
  if (!data?.length) throw new Error('owner sees no invites');
  const usedRow = data.find(r => r.staff_id === 's2' && r.used_at);
  if (!usedRow) throw new Error('used invite for s2 not visible to owner');
});

await step('owner: revoke_staff_invite removes any unclaimed codes', async () => {
  // Mint a fresh code, then revoke it — should return 1.
  await state.ownerClient.rpc('create_staff_invite', { biz: state.business.id, p_staff_id: 's2', p_display_name: 'Geeta' });
  const { data, error } = await state.ownerClient.rpc('revoke_staff_invite', { biz: state.business.id, p_staff_id: 's2' });
  if (error) throw error;
  if (Number(data) < 1) throw new Error('revoke returned ' + data);
});

await step('non-owner: create_staff_invite → not_owner', async () => {
  const { error } = await state.workerClient.rpc('create_staff_invite', {
    biz: state.business.id, p_staff_id: 's1', p_display_name: 'fake',
  });
  if (!error) throw new Error('expected not_owner error');
  if (!/not_owner/i.test(error.message)) throw new Error('unexpected: ' + error.message);
});

// ---------------------------------------------------------------------
// 11. Anonymous (no auth) cannot read businesses or insert events
// ---------------------------------------------------------------------
await step('anon: cannot list businesses', async () => {
  const c = client();
  const { data, error } = await c.from('businesses').select('id').eq('id', state.business.id);
  // anon sees zero rows (RLS hides), or error — both are acceptable.
  if (error) return;
  if (data?.length) throw new Error('anon sees business it should not');
});

await step('anon: cannot insert events', async () => {
  const c = client();
  const { error } = await c.from('events').insert({ business_id: state.business.id, author_id: '00000000-0000-0000-0000-000000000000', staff_id: 's1', kind: 'punch_in', payload: {} });
  if (!error) throw new Error('expected RLS block but anon insert succeeded');
});

// ---------------------------------------------------------------------
// 12. Wrong password sign-in → friendly error
// ---------------------------------------------------------------------
await step('owner: signIn with wrong password → expected error', async () => {
  const c = client();
  const { error } = await c.auth.signInWithPassword({ email: state.ownerEmail, password: 'definitely-wrong' });
  if (!error) throw new Error('expected error but signed in');
  if (!/invalid|credentials|password/i.test(error.message)) throw new Error('unexpected error: ' + error.message);
});

// ---------------------------------------------------------------------
// 13. Cleanup — owner deletes business (cascades members + events)
// ---------------------------------------------------------------------
await step('owner: delete business cascades members + events', async () => {
  const { error } = await state.ownerClient.from('businesses').delete().eq('id', state.business.id);
  if (error) throw error;
  const { data: members } = await state.ownerClient.from('members').select('user_id').eq('business_id', state.business.id);
  if (members?.length) throw new Error('members not cascaded');
});

// ---------------------------------------------------------------------
console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
process.exit(fail === 0 ? 0 : 1);
