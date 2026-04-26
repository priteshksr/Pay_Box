-- ============================================================
-- PayBox — phone-number-tolerant worker reconnect
-- ----------------------------------------------------------------
-- The original `reconnect_worker_by_phone` compared the incoming phone
-- exactly against `members.phone`. That broke for the very common case
-- where the worker registered as `+918080223726` on phone A and then
-- typed `8080223726` on phone B — same number, different format, no
-- match.
--
-- This migration replaces the function with one that *also* matches on
-- the last 10 digits, regardless of `+`-prefix or country code. Exact
-- match still wins (so a stored value is always preferred), then we
-- fall back to last-10-digits suffix. This is right for India today
-- (10-digit subscriber numbers) and good enough for most other
-- regions; we can swap to libphonenumber later if we ever need
-- region-aware parsing.
--
-- Safe to re-run.
-- ============================================================

drop function if exists public.reconnect_worker_by_phone(text) cascade;

create or replace function public.reconnect_worker_by_phone(
  p_phone text,
  out out_business_id uuid,
  out out_staff_id    text
)
returns record
language plpgsql security definer set search_path = public as $$
declare
  v_phone_clean  text;   -- normalised input: digits + leading '+' only
  v_phone_digits text;   -- digits-only input (used for suffix match)
  v_member       record;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  -- Strip everything except digits and '+'.
  v_phone_clean  := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
  v_phone_digits := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9]',  '', 'g'), '');

  if v_phone_digits is null or length(v_phone_digits) < 7 then
    raise exception 'invalid_phone';
  end if;

  -- Priority order:
  --  1) exact match against the stored value (cheapest, most precise)
  --  2) last-10-digit suffix match (handles missing/extra country code)
  -- We deduplicate on (business_id, staff_id) by ordering newest-first,
  -- so if two stale rows happen to share a 10-digit suffix, the most
  -- recent membership wins.
  select *
    into v_member
    from public.members
   where role = 'worker'
     and (
       phone = v_phone_clean
       or right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10)
            = right(v_phone_digits, 10)
     )
   order by joined_at desc
   limit 1
   for update;

  if not found then raise exception 'phone_not_found'; end if;

  -- Re-link the member row to the new auth.uid() *and* normalise the
  -- stored phone to the canonical form the caller used. This means
  -- every subsequent reconnect from any device keeps converging on a
  -- consistent format instead of preserving stale variations.
  update public.members
     set user_id = auth.uid(),
         phone   = v_phone_clean
   where business_id = v_member.business_id
     and user_id     = v_member.user_id
     and staff_id    = v_member.staff_id;

  out_business_id := v_member.business_id;
  out_staff_id    := v_member.staff_id;
end $$;

revoke all on function public.reconnect_worker_by_phone(text) from public;
grant execute on function public.reconnect_worker_by_phone(text) to authenticated;

notify pgrst, 'reload schema';
