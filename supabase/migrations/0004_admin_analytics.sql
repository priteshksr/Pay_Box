-- ============================================================
-- PayBox — Admin analytics
--
-- Adds a tiny "super admin" layer **on top of** the existing
-- business-scoped RLS. Regular owners and workers are unaffected:
-- the tables they see today are still RLS-protected exactly as
-- before. The admin page (admin.html) calls the RPCs declared at
-- the bottom of this file, all of which are SECURITY DEFINER and
-- self-check `is_admin()` — so no broad cross-tenant SELECT
-- policy is ever exposed to the regular API.
--
-- Safe to re-run end to end: every statement is idempotent.
-- ============================================================

-- 1) Allow-list of super-admin emails. We keep it as a tiny table
-- (one row per admin) instead of an environment variable so you
-- can grant / revoke admin access from inside Supabase Studio
-- without redeploying the page.
create table if not exists public.admin_users (
  email       text primary key,
  note        text,
  added_at    timestamptz not null default now()
);

-- Lock the table down. Only the postgres role (Studio / service_role)
-- can read or write it — no anon/auth caller should ever see who is
-- in the allow-list, and definitely shouldn't be able to add
-- themselves. RLS with no policies = deny-by-default for non-owner
-- roles.
alter table public.admin_users enable row level security;
drop policy if exists "admin_users no public access" on public.admin_users;
-- Intentionally NO policies — Postgres refuses every SELECT/INSERT/
-- UPDATE/DELETE for anon and authenticated roles.

-- 2) is_admin() — cheap predicate the RPCs use to gate access.
--    Lives in `public` so RPCs (also in public) can call it without
--    a search_path workaround. SECURITY DEFINER so the SELECT bypasses
--    the deny-all RLS on admin_users.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_users a
    where lower(a.email) = lower(coalesce(auth.email(), ''))
  );
$$;

-- 3) Top-line summary card numbers (4 KPIs).
--    Returns a single JSON row so the client can render the cards
--    with one round-trip. We deliberately compute everything inside
--    Postgres — no chance of an admin client mis-counting.
create or replace function public.admin_summary()
returns table (
  total_businesses     bigint,
  total_members        bigint,
  total_workers        bigint,    -- members.role = 'worker'
  total_employees      bigint,    -- staff entries inside businesses.config (most owners care about this)
  total_pending        bigint,    -- members.role = 'pending' (waiting for approval)
  active_businesses_7d bigint,    -- pinged or punched in the last 7 days
  pings_24h            bigint,
  pings_7d             bigint,
  events_24h           bigint,
  signups_24h          bigint,
  signups_7d           bigint,
  fetched_at           timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  return query
    select
      (select count(*) from public.businesses)::bigint                      as total_businesses,
      (select count(*) from public.members where role <> 'pending')::bigint as total_members,
      (select count(*) from public.members where role = 'worker')::bigint   as total_workers,
      coalesce((
        select sum(jsonb_array_length(coalesce(b.config -> 'staff', '[]'::jsonb)))
        from public.businesses b
      ), 0)::bigint                                                          as total_employees,
      (select count(*) from public.members where role = 'pending')::bigint  as total_pending,
      (select count(distinct business_id) from public.location_pings
        where ts > now() - interval '7 days')::bigint                       as active_businesses_7d,
      (select count(*) from public.location_pings
        where ts > now() - interval '24 hours')::bigint                     as pings_24h,
      (select count(*) from public.location_pings
        where ts > now() - interval '7 days')::bigint                       as pings_7d,
      (select count(*) from public.events
        where created_at > now() - interval '24 hours')::bigint             as events_24h,
      (select count(*) from auth.users
        where created_at > now() - interval '24 hours')::bigint             as signups_24h,
      (select count(*) from auth.users
        where created_at > now() - interval '7 days')::bigint               as signups_7d,
      now()                                                                  as fetched_at;
end $$;

-- 4) Per-business detail rows for the leaderboard / table view.
--    `lim` lets the client cap the result; a sensible default of 100
--    keeps the page light even with thousands of businesses.
create or replace function public.admin_business_list(lim int default 100)
returns table (
  id                   uuid,
  name                 text,
  owner_email          text,
  join_code            text,
  staff_count          int,
  member_count         int,
  pending_count        int,
  pings_24h            bigint,
  pings_7d             bigint,
  events_total         bigint,
  last_event_at        timestamptz,
  last_ping_at         timestamptz,
  created_or_updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  return query
    select
      b.id,
      b.name,
      u.email::text                                                              as owner_email,
      b.join_code,
      jsonb_array_length(coalesce(b.config -> 'staff', '[]'::jsonb))::int        as staff_count,
      (select count(*) from public.members m
        where m.business_id = b.id and m.role <> 'pending')::int                 as member_count,
      (select count(*) from public.members m
        where m.business_id = b.id and m.role = 'pending')::int                  as pending_count,
      (select count(*) from public.location_pings p
        where p.business_id = b.id and p.ts > now() - interval '24 hours')::bigint as pings_24h,
      (select count(*) from public.location_pings p
        where p.business_id = b.id and p.ts > now() - interval '7 days')::bigint  as pings_7d,
      (select count(*) from public.events e
        where e.business_id = b.id)::bigint                                       as events_total,
      (select max(e.created_at) from public.events e
        where e.business_id = b.id)                                               as last_event_at,
      (select max(p.ts) from public.location_pings p
        where p.business_id = b.id)                                               as last_ping_at,
      to_timestamp(b.updated_at / 1000.0)                                         as created_or_updated_at
    from public.businesses b
    left join auth.users u on u.id = b.owner_id
    order by b.updated_at desc
    limit greatest(1, coalesce(lim, 100));
end $$;

-- 5) Daily time-series — used by the line charts.
--    `metric` selects between 'pings', 'events', 'signups'. Returns
--    one row per day for the requested window. Day buckets are in
--    UTC; the client renders them in the admin's local zone.
create or replace function public.admin_timeseries(metric text, days int default 30)
returns table (day date, n bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  d_window int := greatest(1, least(coalesce(days, 30), 365));
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  if metric = 'pings' then
    return query
      with cal as (
        select generate_series(
          (now() - (d_window - 1) * interval '1 day')::date,
          now()::date,
          interval '1 day'
        )::date as day
      )
      select cal.day, coalesce(count(p.id), 0)::bigint as n
      from cal
      left join public.location_pings p
        on p.ts >= cal.day and p.ts < cal.day + interval '1 day'
      group by cal.day order by cal.day;
  elsif metric = 'events' then
    return query
      with cal as (
        select generate_series(
          (now() - (d_window - 1) * interval '1 day')::date,
          now()::date,
          interval '1 day'
        )::date as day
      )
      select cal.day, coalesce(count(e.id), 0)::bigint as n
      from cal
      left join public.events e
        on e.created_at >= cal.day and e.created_at < cal.day + interval '1 day'
      group by cal.day order by cal.day;
  elsif metric = 'signups' then
    return query
      with cal as (
        select generate_series(
          (now() - (d_window - 1) * interval '1 day')::date,
          now()::date,
          interval '1 day'
        )::date as day
      )
      select cal.day, coalesce(count(u.id), 0)::bigint as n
      from cal
      left join auth.users u
        on u.created_at >= cal.day and u.created_at < cal.day + interval '1 day'
      group by cal.day order by cal.day;
  elsif metric = 'businesses' then
    return query
      with cal as (
        select generate_series(
          (now() - (d_window - 1) * interval '1 day')::date,
          now()::date,
          interval '1 day'
        )::date as day
      ),
      -- Approximate "created at" using the earliest member row per
      -- business — `businesses.updated_at` is bumped on every owner
      -- save, so it can't tell us the original creation date.
      seeded as (
        select business_id, min(joined_at)::date as created_day
        from public.members where role = 'owner' group by business_id
      )
      select cal.day, coalesce(count(s.business_id), 0)::bigint as n
      from cal
      left join seeded s on s.created_day = cal.day
      group by cal.day order by cal.day;
  else
    raise exception 'unknown_metric: %', metric;
  end if;
end $$;

-- 6) Recent signups feed — shown as a side panel on the dashboard.
create or replace function public.admin_recent_signups(lim int default 25)
returns table (
  user_id          uuid,
  email            text,
  created_at       timestamptz,
  last_sign_in_at  timestamptz,
  business_count   int
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  return query
    select
      u.id            as user_id,
      u.email::text   as email,
      u.created_at,
      u.last_sign_in_at,
      (select count(*)::int from public.members m
        where m.user_id = u.id and m.role = 'owner')                                  as business_count
    from auth.users u
    order by u.created_at desc nulls last
    limit greatest(1, coalesce(lim, 25));
end $$;

-- 7) Grants — the four RPCs above are SECURITY DEFINER, but we still
-- need to allow the `authenticated` role to EXECUTE them. The
-- internal `is_admin()` check then decides whether the caller
-- actually gets a row back. Without these grants you'd see
-- "permission denied for function" in the admin page.
grant execute on function public.is_admin()                       to authenticated;
grant execute on function public.admin_summary()                  to authenticated;
grant execute on function public.admin_business_list(int)         to authenticated;
grant execute on function public.admin_timeseries(text, int)      to authenticated;
grant execute on function public.admin_recent_signups(int)        to authenticated;

-- 8) Bootstrap your first admin.
-- Replace 'you@example.com' with your own login email **before**
-- running this file the first time. Re-running with a different
-- email is fine — the primary key is the lower-cased address.
--
-- Add more later via:
--   insert into public.admin_users(email, note) values('person@x.com','reason');
--
-- Remove via:
--   delete from public.admin_users where lower(email) = 'person@x.com';
-- ⚠️  IMPORTANT: Replace the placeholder email below with a real admin email
--     before deploying to production. The migration will emit a notice if
--     the placeholder is still present.
do $$
begin
  if 'you@example.com' = 'you@example.com' then
    raise notice '⚠️  admin_analytics: bootstrap email is still the placeholder — update 0004 before production deploy!';
  end if;
end $$;

insert into public.admin_users(email, note) values
  ('you@example.com', 'CHANGE ME — replace with real admin email before deploy')
on conflict (email) do nothing;

-- ============================================================
-- Verification (run these manually after applying the file):
--
--   select * from public.admin_users;            -- you should see your email
--   select public.is_admin();                    -- true (when signed in as that email)
--   select * from public.admin_summary();        -- big-number row
--   select * from public.admin_business_list(5); -- top 5 businesses
--   select * from public.admin_timeseries('pings', 14);  -- daily pings
-- ============================================================
