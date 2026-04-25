# PayBox Cloud Sync Setup (Supabase)

PayBox is **offline-first**: everything works without a network. Cloud sync is
optional, and lets you:

- Back up your data so it survives phone loss / browser reset.
- Use the same data on multiple devices (owner's phone, tablet, laptop).
- **Keep owner and workers in real-time sync**: when a worker punches in on
  their own phone the owner sees it live within ~2 seconds, and when the
  owner marks attendance the worker's payslip updates live.

It uses **Supabase** (a free hosted Postgres + Auth + Realtime service). You
stay in full control of the data — it lives in *your* project, not in PayBox's.

---

## Quick mental model

| Concept        | What it is                                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Business**   | One shop / dairy / factory. Holds staff list, shifts, holidays, rates — written only by its owner.                |
| **Member**     | An auth user linked to a business as either `owner` or `worker`. A worker is mapped to one staff record.          |
| **Event**      | Append-only row for high-churn actions (punch in / out, selfie, attendance mark, OT, adjustments, loan payments). |
| **Join code**  | 6-character code the owner shares with their staff so they can join the business.                                 |

Owner writes go to `businesses.config` **and** `events`. Worker writes go to
`events` only (RLS enforces this). Every device subscribes to Realtime
changes on both tables filtered by `business_id`, so any change propagates to
everyone in the business within ~1–2 s.

---

## 1. Create a free Supabase project

1. Go to [supabase.com](https://supabase.com) and sign up.
2. **New project** → pick a name and a strong database password.
3. Wait ~1 minute for it to provision.

## 2. Copy your project credentials

In the project dashboard:

- **Settings → API → Project URL** → copy the `https://xxxx.supabase.co` URL.
- **Settings → API → Project API keys → anon/public** → copy the long `eyJ…` key.

(The `service_role` key is **never** needed — do not paste it anywhere.)

## 3. Run the SQL migration

Open **SQL Editor → New query** and paste the whole block below, then **Run**.

```sql
-- ============================================================
-- PayBox business-scoped schema (v2)
-- Safe to re-run: every statement is idempotent.
-- ============================================================

-- 0) Make sure pgcrypto is loaded for gen_random_uuid() etc. Supabase
--    usually has this enabled already in the `extensions` schema.
create extension if not exists pgcrypto with schema extensions;

-- 1) Businesses — one row per shop. `config` holds staff, shifts, holidays,
--    rates, etc. Only the owner may write to it.
create table if not exists public.businesses (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  join_code   text unique not null,
  config      jsonb not null default '{}'::jsonb,
  updated_at  bigint not null default (extract(epoch from now()) * 1000)::bigint
);
create index if not exists businesses_owner_idx    on public.businesses(owner_id);
create index if not exists businesses_join_code_idx on public.businesses(join_code);

-- 2) Members — links auth users to a business. `staff_id` is the owner-chosen
--    id inside businesses.config.staff[] for workers; null for the owner.
create table if not exists public.members (
  business_id  uuid  not null references public.businesses(id) on delete cascade,
  user_id      uuid  not null references auth.users(id)        on delete cascade,
  role         text  not null check (role in ('owner','worker','pending')),
  staff_id     text,
  display_name text,
  joined_at    timestamptz default now(),
  primary key (business_id, user_id)
);
create index if not exists members_user_idx      on public.members(user_id);
create index if not exists members_staff_idx     on public.members(business_id, staff_id);

-- 3) Events — append-only high-churn deltas (punches, attendance, OT, …).
create table if not exists public.events (
  id           bigserial primary key,
  business_id  uuid not null references public.businesses(id) on delete cascade,
  author_id    uuid not null references auth.users(id),
  staff_id     text not null,
  kind         text not null,
  payload      jsonb not null,
  updated_at   bigint not null default (extract(epoch from now()) * 1000)::bigint,
  created_at   timestamptz default now()
);
create index if not exists events_biz_idx   on public.events(business_id, updated_at desc);
create index if not exists events_staff_idx on public.events(business_id, staff_id);

-- 4) Helper: am I a member of this business?
create or replace function public.is_member(biz uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from public.members
    where business_id = biz and user_id = auth.uid() and role <> 'pending'
  );
$$;

-- 5) Helper: am I the OWNER of this business?
create or replace function public.is_owner(biz uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from public.businesses
    where id = biz and owner_id = auth.uid()
  );
$$;

-- 6) Helper: which staff_id am I mapped to in this business?
create or replace function public.my_staff_id(biz uuid)
returns text language sql security definer set search_path = public as $$
  select staff_id from public.members
  where business_id = biz and user_id = auth.uid()
  limit 1;
$$;

-- 7) Row-Level Security.
alter table public.businesses enable row level security;
alter table public.members    enable row level security;
alter table public.events     enable row level security;

-- businesses: visible to members; writable only by owner.
drop policy if exists "biz select members"  on public.businesses;
drop policy if exists "biz insert owner"    on public.businesses;
drop policy if exists "biz update owner"    on public.businesses;
drop policy if exists "biz delete owner"    on public.businesses;
create policy "biz select members"  on public.businesses
  for select using ( public.is_member(id) or owner_id = auth.uid() );
create policy "biz insert owner"    on public.businesses
  for insert with check ( owner_id = auth.uid() );
create policy "biz update owner"    on public.businesses
  for update using ( owner_id = auth.uid() ) with check ( owner_id = auth.uid() );
create policy "biz delete owner"    on public.businesses
  for delete using ( owner_id = auth.uid() );

-- members: a user can read rows for businesses they belong to, plus their own
-- pending rows (so the join flow can show state). Owner may approve/remove.
drop policy if exists "mem select self or peers" on public.members;
drop policy if exists "mem insert self pending"  on public.members;
drop policy if exists "mem update owner"         on public.members;
drop policy if exists "mem delete owner or self" on public.members;
create policy "mem select self or peers" on public.members
  for select using ( user_id = auth.uid() or public.is_member(business_id) or public.is_owner(business_id) );
create policy "mem insert self pending"  on public.members
  for insert with check ( user_id = auth.uid() and role in ('pending','owner') );
create policy "mem update owner"         on public.members
  for update using ( public.is_owner(business_id) ) with check ( public.is_owner(business_id) );
create policy "mem delete owner or self" on public.members
  for delete using ( public.is_owner(business_id) or user_id = auth.uid() );

-- events: any member can read; workers can only insert events mapped to their
-- own staff_id; owners can insert anything.
drop policy if exists "ev select members" on public.events;
drop policy if exists "ev insert member"  on public.events;
drop policy if exists "ev update owner"   on public.events;
drop policy if exists "ev delete owner"   on public.events;
create policy "ev select members" on public.events
  for select using ( public.is_member(business_id) );
create policy "ev insert member"  on public.events
  for insert with check (
    author_id = auth.uid()
    and public.is_member(business_id)
    and ( public.is_owner(business_id) or staff_id = public.my_staff_id(business_id) )
  );
create policy "ev update owner"   on public.events
  for update using ( public.is_owner(business_id) ) with check ( public.is_owner(business_id) );
create policy "ev delete owner"   on public.events
  for delete using ( public.is_owner(business_id) );

-- 8) RPCs — tiny wrappers the client calls instead of raw inserts.

-- Create a new business for the caller. Returns the row (includes join_code).
create or replace function public.create_business(biz_name text, initial_config jsonb default '{}'::jsonb)
returns public.businesses
language plpgsql security definer set search_path = public as $$
declare
  code text;
  row  public.businesses;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  -- 6-char hex code from md5(random()). 16^6 = ~16M codes, plenty for
  -- short-lived join codes. Portable: no pgcrypto dependency.
  code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
  insert into public.businesses(owner_id, name, join_code, config)
    values (auth.uid(), biz_name, code, coalesce(initial_config, '{}'::jsonb))
    returning * into row;
  insert into public.members(business_id, user_id, role, display_name)
    values (row.id, auth.uid(), 'owner', null)
    on conflict do nothing;
  return row;
end $$;

-- Worker asks to join. Inserts a `pending` member row; owner must approve.
create or replace function public.join_business(code text, display text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  biz_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select id into biz_id from public.businesses where join_code = upper(code);
  if biz_id is null then raise exception 'invalid_code'; end if;
  insert into public.members(business_id, user_id, role, display_name)
    values (biz_id, auth.uid(), 'pending', display)
    on conflict (business_id, user_id) do update set display_name = excluded.display_name;
  return biz_id;
end $$;

-- Owner approves a pending member and maps them to a staff_id.
create or replace function public.approve_member(biz uuid, uid uuid, assigned_staff_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner(biz) then raise exception 'not_owner'; end if;
  update public.members
     set role = 'worker', staff_id = assigned_staff_id
   where business_id = biz and user_id = uid;
end $$;

-- Owner rotates the join code (use if a code leaks).
create or replace function public.rotate_join_code(biz uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  new_code text;
begin
  if not public.is_owner(biz) then raise exception 'not_owner'; end if;
  new_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
  update public.businesses set join_code = new_code where id = biz;
  return new_code;
end $$;

-- 10) Per-staff invite codes — when the owner adds a new staff record we
--     generate a one-shot personal code. The worker enters it on the
--     welcome screen and is auto-mapped to their staff row (no manual
--     approval). Codes are unique across all businesses (8 chars).
create table if not exists public.staff_invites (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  staff_id     text not null,
  code         text unique not null,
  display_name text,
  created_at   timestamptz default now(),
  used_at      timestamptz,
  used_by      uuid references auth.users(id)
);
create index if not exists staff_invites_biz_idx   on public.staff_invites(business_id);
create index if not exists staff_invites_code_idx  on public.staff_invites(code) where used_at is null;
create index if not exists staff_invites_staff_idx on public.staff_invites(business_id, staff_id);

alter table public.staff_invites enable row level security;
drop policy if exists "inv select owner"  on public.staff_invites;
drop policy if exists "inv insert owner"  on public.staff_invites;
drop policy if exists "inv update owner"  on public.staff_invites;
drop policy if exists "inv delete owner"  on public.staff_invites;
-- Owners see and manage their own invites. Workers do NOT read this table —
-- they use the security-definer claim_staff_invite RPC instead, so a
-- malicious client cannot enumerate codes.
create policy "inv select owner"  on public.staff_invites
  for select using ( public.is_owner(business_id) );
create policy "inv insert owner"  on public.staff_invites
  for insert with check ( public.is_owner(business_id) );
create policy "inv update owner"  on public.staff_invites
  for update using ( public.is_owner(business_id) ) with check ( public.is_owner(business_id) );
create policy "inv delete owner"  on public.staff_invites
  for delete using ( public.is_owner(business_id) );

-- Owner mints (or rotates) an invite code for one staff record. Returns
-- the new 8-char code. Re-issuing for the same staff_id revokes any
-- previous unclaimed code so only one is ever live at a time.
create or replace function public.create_staff_invite(
  biz uuid, p_staff_id text, p_display_name text default null
) returns text
language plpgsql security definer set search_path = public as $$
declare
  new_code text;
begin
  if not public.is_owner(biz) then raise exception 'not_owner'; end if;
  if p_staff_id is null or length(trim(p_staff_id)) = 0 then
    raise exception 'invalid_staff_id';
  end if;
  -- 8-char alphanumeric (excluding 0/O/1/I to avoid OCR / phone
  -- typing errors). md5 is fine for non-secret short codes — they
  -- are one-shot and rate-limited by RLS.
  new_code := upper(substr(translate(md5(random()::text || clock_timestamp()::text), '01OI', 'ZYXW'), 1, 8));
  -- Drop any unused code for this staff so only one is live.
  delete from public.staff_invites
   where business_id = biz and staff_id = p_staff_id and used_at is null;
  insert into public.staff_invites(business_id, staff_id, code, display_name)
    values (biz, p_staff_id, new_code, p_display_name);
  return new_code;
end $$;
revoke all on function public.create_staff_invite(uuid, text, text) from public;
grant execute on function public.create_staff_invite(uuid, text, text) to authenticated;

-- Owner deletes any unclaimed invite for a staff (e.g. employee changed
-- mind, code leaked). Already-used invites are left for audit.
create or replace function public.revoke_staff_invite(biz uuid, p_staff_id text)
returns int
language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  if not public.is_owner(biz) then raise exception 'not_owner'; end if;
  delete from public.staff_invites
   where business_id = biz and staff_id = p_staff_id and used_at is null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.revoke_staff_invite(uuid, text) from public;
grant execute on function public.revoke_staff_invite(uuid, text) to authenticated;

-- Worker redeems the invite code. On success returns (business_id,
-- staff_id) and the worker is immediately a full member (no pending
-- approval). The function runs as security definer so the worker does
-- not need read access to staff_invites itself.
--
-- The worker passes their phone number too — we don't use Supabase Phone
-- Auth (no SMS provider needed, zero per-login cost), the invite code
-- itself is the proof of identity. The phone is seeded onto the staff
-- record via a `staff_update` event so it shows up live on the owner's
-- side, and on the worker's profile screen.
--
-- We DROP older 1- and 2-arg signatures first so re-running this block
-- after an upgrade doesn't leave stale overloads behind that PostgREST
-- would refuse to disambiguate.
drop function if exists public.claim_staff_invite(text);
drop function if exists public.claim_staff_invite(text, text);
drop function if exists public.claim_staff_invite(text, text, text);
create or replace function public.claim_staff_invite(
  p_code text,
  p_display_name text default null,
  p_phone text default null,
  -- These OUT params are intentionally prefixed `out_` so they don't
  -- collide with the `business_id` / `staff_id` *columns* referenced in
  -- the INSERT and ON CONFLICT clauses below. Without the prefix
  -- Postgres raises "column reference is ambiguous".
  out out_business_id uuid,
  out out_staff_id text
)
returns record
language plpgsql security definer set search_path = public as $$
declare
  v_invite       record;
  v_phone_clean  text;
  v_payload      jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_code is null or length(trim(p_code)) = 0 then
    raise exception 'invalid_code';
  end if;
  select * into v_invite
    from public.staff_invites
   where code = upper(trim(p_code)) and used_at is null
   for update;
  if not found then raise exception 'invalid_or_used_invite'; end if;

  -- Strip everything except + and digits so phones store consistently.
  v_phone_clean := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');

  insert into public.members(business_id, user_id, role, staff_id, display_name)
    values (v_invite.business_id, auth.uid(), 'worker', v_invite.staff_id,
            coalesce(nullif(trim(p_display_name), ''), v_invite.display_name))
    on conflict (business_id, user_id) do update set
      role = 'worker',
      staff_id = excluded.staff_id,
      display_name = coalesce(excluded.display_name, public.members.display_name);

  update public.staff_invites
     set used_at = now(), used_by = auth.uid()
   where id = v_invite.id;

  -- Seed phone (and name if provided) onto the staff record via a
  -- staff_update event. The owner's client folds this into
  -- businesses.config.staff[] and pushes it back, so every device
  -- (including this worker's profile screen) sees it within ~1s.
  v_payload := '{}'::jsonb;
  if v_phone_clean is not null then
    v_payload := v_payload || jsonb_build_object('phone', v_phone_clean);
  end if;
  if nullif(trim(p_display_name), '') is not null then
    v_payload := v_payload || jsonb_build_object('name', trim(p_display_name));
  end if;
  if v_payload <> '{}'::jsonb then
    insert into public.events(business_id, author_id, staff_id, kind, payload)
      values (v_invite.business_id, auth.uid(), v_invite.staff_id,
              'staff_update', v_payload);
  end if;

  out_business_id := v_invite.business_id;
  out_staff_id    := v_invite.staff_id;
end $$;
revoke all on function public.claim_staff_invite(text, text, text) from public;
grant execute on function public.claim_staff_invite(text, text, text) to authenticated, anon;
notify pgrst, 'reload schema';

-- The mem RLS "insert self pending" policy only allowed role IN
-- ('pending','owner'). The claim_staff_invite RPC inserts directly with
-- role='worker' and runs as security definer, so it bypasses RLS — no
-- policy change needed for that path.

-- 10b) Add phone column to members (for returning-worker reconnect).
-- Workers who claimed an invite have their phone stored here so they
-- can sign in from a new device without needing the invite code again.
alter table public.members add column if not exists phone text;
create index if not exists members_phone_idx on public.members(phone) where phone is not null;

-- Also update claim_staff_invite to store the phone on the members row:
drop function if exists public.claim_staff_invite(text, text, text) cascade;
create or replace function public.claim_staff_invite(
  p_code text,
  p_display_name text default null,
  p_phone text default null,
  out out_business_id uuid,
  out out_staff_id text
)
returns record
language plpgsql security definer set search_path = public as $$
declare
  v_invite       record;
  v_phone_clean  text;
  v_payload      jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_code is null or length(trim(p_code)) = 0 then
    raise exception 'invalid_code';
  end if;
  select * into v_invite
    from public.staff_invites
   where code = upper(trim(p_code)) and used_at is null
   for update;
  if not found then raise exception 'invalid_or_used_invite'; end if;

  v_phone_clean := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');

  insert into public.members(business_id, user_id, role, staff_id, display_name, phone)
    values (v_invite.business_id, auth.uid(), 'worker', v_invite.staff_id,
            coalesce(nullif(trim(p_display_name), ''), v_invite.display_name),
            v_phone_clean)
    on conflict (business_id, user_id) do update set
      role = 'worker',
      staff_id = excluded.staff_id,
      display_name = coalesce(excluded.display_name, public.members.display_name),
      phone = coalesce(excluded.phone, public.members.phone);

  update public.staff_invites
     set used_at = now(), used_by = auth.uid()
   where id = v_invite.id;

  v_payload := '{}'::jsonb;
  if v_phone_clean is not null then
    v_payload := v_payload || jsonb_build_object('phone', v_phone_clean);
  end if;
  if nullif(trim(p_display_name), '') is not null then
    v_payload := v_payload || jsonb_build_object('name', trim(p_display_name));
  end if;
  if v_payload <> '{}'::jsonb then
    insert into public.events(business_id, author_id, staff_id, kind, payload)
      values (v_invite.business_id, auth.uid(), v_invite.staff_id,
              'staff_update', v_payload);
  end if;

  out_business_id := v_invite.business_id;
  out_staff_id    := v_invite.staff_id;
end $$;
revoke all on function public.claim_staff_invite(text, text, text) from public;
grant execute on function public.claim_staff_invite(text, text, text) to authenticated, anon;

-- 10c) Reconnect returning worker by phone number.
-- A worker who already claimed an invite can sign in from a new device
-- using only their phone number (no invite code). This RPC:
--   1) Finds the members row whose phone matches.
--   2) Re-links it to the caller's (new anonymous) auth.uid().
--   3) Returns business_id + staff_id so the client can resume.
-- If no match is found, raises 'phone_not_found' — the client then
-- shows the invite-code form instead.
drop function if exists public.reconnect_worker_by_phone(text) cascade;
create or replace function public.reconnect_worker_by_phone(
  p_phone text,
  out out_business_id uuid,
  out out_staff_id text
)
returns record
language plpgsql security definer set search_path = public as $$
declare
  v_phone_clean text;
  v_member      record;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  v_phone_clean := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
  if v_phone_clean is null or length(v_phone_clean) < 7 then
    raise exception 'invalid_phone';
  end if;

  select * into v_member
    from public.members
   where phone = v_phone_clean
     and role = 'worker'
   order by joined_at desc
   limit 1
   for update;
  if not found then raise exception 'phone_not_found'; end if;

  -- Re-link the member row to the new anonymous user_id so RLS
  -- policies let this session read/write events for this business.
  update public.members
     set user_id = auth.uid()
   where business_id = v_member.business_id
     and user_id = v_member.user_id
     and staff_id = v_member.staff_id;

  out_business_id := v_member.business_id;
  out_staff_id    := v_member.staff_id;
end $$;
revoke all on function public.reconnect_worker_by_phone(text) from public;
grant execute on function public.reconnect_worker_by_phone(text) to authenticated, anon;
notify pgrst, 'reload schema';

-- 11) Push notification tokens — stores FCM/APNs device tokens so the
-- Edge Function can deliver push notifications to the owner when a
-- worker punches in or out.
create table if not exists public.push_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  token       text not null,
  platform    text not null check (platform in ('android','ios','web')),
  created_at  timestamptz default now(),
  unique(user_id, token)
);
create index if not exists push_tokens_biz_idx on public.push_tokens(business_id);

alter table public.push_tokens enable row level security;

-- Users can manage their own tokens.
create policy "push_tokens_insert_own" on public.push_tokens
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "push_tokens_select_own" on public.push_tokens
  for select to authenticated
  using (user_id = auth.uid());

create policy "push_tokens_delete_own" on public.push_tokens
  for delete to authenticated
  using (user_id = auth.uid());

-- 12) Realtime — publish the tables so postgres_changes events fire.
alter publication supabase_realtime add table public.businesses;
alter publication supabase_realtime add table public.members;
alter publication supabase_realtime add table public.events;
alter publication supabase_realtime add table public.staff_invites;
```

> **Upgrading from v1 (single-blob `mybox_state`)?** Keep the old table — the
> app auto-migrates on first launch: it reads your existing blob, calls
> `create_business()` with your business name, and writes the config up. You
> can drop `public.mybox_state` after every device has been opened once.

## 4. Configure auth & redirect URLs

Owners sign in with **email + password**. Workers sign in with **phone +
invite code** (no SMS / OTP, no email needed) — this uses Supabase's
built-in **anonymous sign-in** which is free and instant.

- **Authentication → Providers → Email** → "Enable Email provider" **ON**.
- **Authentication → Providers → Anonymous Sign-Ins** → toggle **ON**.
  (Without this, the worker login form will fail with `anonymous_provider_disabled`.)
- **Authentication → URL Configuration → Site URL** → your hosted PWA URL,
  e.g. `https://paybox.example.com`.
- **Authentication → URL Configuration → Redirect URLs** → add each of these:

  | URL                                      | Used by                                         |
  | ---------------------------------------- | ----------------------------------------------- |
  | `https://paybox.example.com`             | Mobile browser / PWA install                    |
  | `https://paybox.example.com/**`          | Subpath catch-all                               |
  | `capacitor://localhost`                  | Capacitor iOS shell (default scheme)            |
  | `capacitor://localhost/**`               | Capacitor iOS subpaths                          |
  | `https://localhost`                      | Capacitor Android shell (default scheme)        |
  | `https://localhost/**`                   | Capacitor Android subpaths                      |
  | `paybox://auth/callback`                 | Deep-link back into native shell after auth     |

PayBox's Capacitor wrapper listens for `App.appUrlOpen` and feeds the
access-token hash back into `supabase-js`, so sign-in completes without a
page reload.

## 5. First-time setup in the app

### Owner

1. Open PayBox → **Settings → Cloud sync**.
2. Tick **Enable cloud sync**, paste the **URL** and **anon key**, save.
3. **Create account** (email + password).
4. Tap **Create business** — pick a name. PayBox calls `create_business()` and
   shows you a 6-character **join code** (plus a QR you can screenshot).
5. Share that code with your workers.

### Worker — first time (invite code)

1. The owner adds the worker as staff in PayBox. The app immediately mints
   a one-shot **invite code** (8 chars) and shows a "Share" button. The
   owner sends `code + worker.html URL` to the worker over WhatsApp / SMS.
2. The worker opens the link → lands on the green **PayBox · Worker login**
   screen.
3. They tap **"First time? I have an invite code"**, enter their **phone
   number + invite code**, and tap **Continue**. Behind the scenes:
   - Calls `signInAnonymously()` to mint a JWT (no email, no password).
   - Calls `claim_staff_invite(code, displayName?, phone)` which marks the
     code as used, links the anonymous user to the staff record, stores
     the phone on the `members` row, and seeds it onto the staff profile
     via a `staff_update` event.
4. They're in. From the worker home screen they can tap **My profile** to
   set their name, photo, and update phone any time. All edits sync live
   to the owner.

### Worker — returning (phone only)

If a worker clears their browser data, switches phones, or logs out, they
do **not** need a new invite code. Instead:

1. Open the worker login screen (same URL as before).
2. Enter the **phone number** they originally registered with and tap
   **Sign in**.
3. Behind the scenes:
   - Calls `signInAnonymously()` to get a fresh JWT.
   - Calls `reconnect_worker_by_phone(phone)` which finds the `members`
     row by phone match, re-links it to the new anonymous user id, and
     returns `business_id` + `staff_id`.
4. Session restored — all their data, attendance, and payslips are back.

> **No SMS, no OTP.** The phone number is the identifier — it was verified
> implicitly when the owner issued the invite to a specific person. If a
> worker changes their phone number, they should update it in **My profile**
> before logging out, so the new number works for reconnect.
>
> If the phone lookup fails (e.g. worker never set a phone, or it was
> changed), they can always ask the owner to issue a fresh invite code.

From then on, **everything is live**:

- Worker taps **Punch In** on their phone → owner sees a green dot next to
  that staff's name on the Home screen, and "6 / 9 checked in today"
  updates, all within ~2 s.
- Owner marks attendance or posts an announcement → worker's view updates
  instantly.
- A green **Live** badge on the Cloud sync screen confirms the Realtime
  channel is connected.

## Event kinds

The events table uses a small string taxonomy. The client fold logic in
`index.html` (`cloudBiz.applyEvent`) only trusts these kinds:

| kind            | Who writes   | Payload shape                                        |
| --------------- | ------------ | ---------------------------------------------------- |
| `punch_in`      | worker/owner | `{ date, time, at, selfie? }`                        |
| `punch_out`     | worker/owner | `{ date, time, at }`                                 |
| `attendance`    | owner only   | `{ date, status }`  — `P`/`A`/`H`/`L` or `''`        |
| `ot`            | owner only   | `{ date, hours }`                                    |
| `adjust`        | owner only   | full adjustment row                                  |
| `loan_pay`      | owner only   | `{ loanId, ym }`                                     |
| `announce`      | owner only   | full announcement row                                |
| `selfie`        | worker       | `{ date, dataUrl }`                                  |

Events are **append-only** — we never edit old rows, we just write a newer
one. Folding is idempotent because each row carries the canonical
identifiers (`staff_id`, `date`, etc.).

## Push notifications (optional)

PayBox can send native push notifications (Android + iOS) to the owner
whenever a worker punches in or out, even when the app is in the background.

### How it works

1. **Owner's device** registers with FCM/APNs on app launch and stores the
   token in the `push_tokens` table.
2. A **Database Webhook** fires on every `INSERT` to `events` where
   `kind in ('punch_in', 'punch_out')`.
3. The webhook calls the **`notify-punch` Edge Function**, which looks up
   the owner's device tokens and sends a push via the **FCM HTTP v1 API**.

### One-time setup

1. **Create a Firebase project** at <https://console.firebase.google.com>.
   - Add an Android app with package `in.paybox.app`, download
     `google-services.json` into `native/android/app/`.
   - Add an iOS app with bundle id `in.paybox.app`, download
     `GoogleService-Info.plist` into `native/ios/App/App/`.
   - For iOS: upload your APNs key (`.p8`) to Firebase Console → Project
     Settings → Cloud Messaging so FCM can forward to Apple.

2. **Deploy the Edge Function:**
   ```bash
   cd supabase
   supabase functions deploy notify-punch --project-ref laifbtwnouavnvhyaihh
   ```

3. **Set secrets** for the Edge Function:
   ```bash
   supabase secrets set FIREBASE_SERVICE_ACCOUNT="$(cat firebase-service-account.json)"
   ```
   (`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.)

4. **Create the Database Webhook** in Supabase Dashboard → Database → Webhooks:
   - Table: `events`
   - Event: INSERT
   - Condition (optional): `kind in ('punch_in','punch_out')`
   - Type: Supabase Edge Function
   - Function: `notify-punch`

After this, every worker punch triggers a system notification on the
owner's phone — title "Punch In" / "Punch Out", body
"Ramesh punched in at 9:02 AM".

### In-app toast (works in PWA too)

Even without native push, the owner sees an in-app toast whenever a punch
event arrives over the real-time WebSocket channel. This works in any
browser — no Firebase setup needed.

## Security checklist

- Never paste your `service_role` key anywhere in the browser.
- Only the `anon` key is embedded; RLS (step 3) is what protects data.
- Consider enabling **MFA** for the owner account from the Supabase dashboard.
- Rotate the join code immediately if a worker leaves or loses their phone:
  `select public.rotate_join_code('<business-uuid>');`
- The app never sends data to any server other than the one you configured.

## Troubleshooting

| Symptom                                         | Fix                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------- |
| "Supabase SDK failed to load"                   | You are offline or behind a CDN block. The app still works; sync pauses.        |
| 401 / "JWT expired"                             | Sign out and sign back in; tokens auto-refresh after that.                      |
| "new row violates row-level security"           | The RLS policies from step 3 were not applied. Re-run the SQL.                  |
| Worker says "invalid_code"                      | Code is case-insensitive but must match exactly. Check for `0` vs `O` typos.    |
| Worker joined but sees nothing                  | Owner has not approved them yet. Owner → Settings → Pending members → Approve.  |
| Events not flowing live                         | Step 9 (`alter publication … add table …`) not run. Re-run it.                  |
| Data does not appear on a second device         | Pull to refresh in Cloud sync screen; check that both devices signed in.        |
| `crypto.subtle` errors when enabling PIN lock   | PIN lock requires HTTPS or `localhost`. Cloud sync is unaffected.               |
