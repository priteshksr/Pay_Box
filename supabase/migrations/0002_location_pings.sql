-- ============================================================
-- PayBox — Live location tracking (location_pings)
-- Adds an in-shift GPS stream table used by the Live Map and
-- Today's Route features. Punch-time GPS continues to live on
-- `events.payload` — this table is *only* for the moving-dot
-- stream while a worker is clocked in.
--
-- Safe to re-run: every statement is idempotent.
-- ============================================================

-- 1) Table
create table if not exists public.location_pings (
  id           bigserial primary key,
  business_id  uuid       not null references public.businesses(id) on delete cascade,
  staff_id     text       not null,
  author_id    uuid       not null references auth.users(id),
  ts           timestamptz not null default now(),
  lat          double precision not null,
  lng          double precision not null,
  acc          real,
  speed        real,
  heading      real,
  battery      real,
  src          text       not null default 'web' check (src in ('web','android','ios','manual'))
);

-- Hot path index: live map (most-recent-per-staff) and route replay
-- both query "(business, staff, time desc)".
create index if not exists location_pings_biz_staff_ts_idx
  on public.location_pings(business_id, staff_id, ts desc);

-- Day-bucket index for fast route queries when a date filter is used.
create index if not exists location_pings_biz_day_idx
  on public.location_pings(business_id, (date_trunc('day', ts)));

-- 2) Row-Level Security
alter table public.location_pings enable row level security;

-- Drop any prior policy versions so re-running this block is safe.
drop policy if exists "loc select members"     on public.location_pings;
drop policy if exists "loc insert author"      on public.location_pings;
drop policy if exists "loc update owner"       on public.location_pings;
drop policy if exists "loc delete owner"       on public.location_pings;

-- Owners can read every ping in their business. Workers can read only
-- their own pings (mapped by my_staff_id). Members who aren't mapped
-- to a staff record see nothing.
create policy "loc select members" on public.location_pings
  for select using (
    public.is_owner(business_id)
    or (
      public.is_member(business_id)
      and staff_id = public.my_staff_id(business_id)
    )
  );

-- A user may only insert pings for *their own* staff_id, and only into
-- a business they're an active member of. Owners may insert for any
-- staff in their own business (used during owner-side device tests).
create policy "loc insert author" on public.location_pings
  for insert with check (
    author_id = auth.uid()
    and public.is_member(business_id)
    and (
      public.is_owner(business_id)
      or staff_id = public.my_staff_id(business_id)
    )
  );

-- Only owners can mutate / prune. Workers can never delete their own
-- pings — that's a per-business audit decision the owner makes.
create policy "loc update owner" on public.location_pings
  for update using (public.is_owner(business_id))
  with check (public.is_owner(business_id));
create policy "loc delete owner" on public.location_pings
  for delete using (public.is_owner(business_id));

-- 3) Realtime — postgres_changes for fallback subscribers.
-- The primary live transport is the `paybox_loc:<bizId>` Broadcast
-- channel (cheaper, no DB round trip), but we still publish the
-- table so a freshly-opened owner client can hydrate by querying.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'location_pings'
  ) then
    alter publication supabase_realtime add table public.location_pings;
  end if;
end $$;

-- 4) Optional retention helper. Owners can prune old pings to keep
-- their database small (free tier is 500 MB). 30 days is the default
-- but the owner can pass any value. Returns the number of rows
-- deleted.
create or replace function public.prune_location_pings(biz uuid, days int default 30)
returns int
language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  if not public.is_owner(biz) then raise exception 'not_owner'; end if;
  delete from public.location_pings
   where business_id = biz
     and ts < now() - make_interval(days => greatest(1, days));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.prune_location_pings(uuid, int) from public;
grant execute on function public.prune_location_pings(uuid, int) to authenticated;

notify pgrst, 'reload schema';
