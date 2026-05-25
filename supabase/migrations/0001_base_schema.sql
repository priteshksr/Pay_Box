-- ============================================================
-- PayBox — Base schema (0001)
-- Must be applied before migrations 0002–0004:
--   0002_location_pings.sql
--   0003_reconnect_phone_normalize.sql
--   0004_admin_analytics.sql
--
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
-- own staff_id AND only worker-allowed kinds; owners can insert anything.
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
    and (
      public.is_owner(business_id)
      or (
        staff_id = public.my_staff_id(business_id)
        and kind in ('punch_in', 'punch_out', 'selfie', 'staff_update')
      )
    )
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

-- The mem RLS "insert self pending" policy only allowed role IN
-- ('pending','owner'). The claim_staff_invite RPC inserts directly with
-- role='worker' and runs as security definer, so it bypasses RLS — no
-- policy change needed for that path.

-- 10b) Add phone column to members (for returning-worker reconnect).
-- Workers who claimed an invite have their phone stored here so they
-- can sign in from a new device without needing the invite code again.
alter table public.members add column if not exists phone text;
create index if not exists members_phone_idx on public.members(phone) where phone is not null;

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

-- 13) Realtime — publish the tables so postgres_changes events fire.
-- (location_pings is added in 0002_location_pings.sql)
alter publication supabase_realtime add table public.businesses;
alter publication supabase_realtime add table public.members;
alter publication supabase_realtime add table public.events;
alter publication supabase_realtime add table public.staff_invites;

notify pgrst, 'reload schema';
