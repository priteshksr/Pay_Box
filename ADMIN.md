# PayBox Admin Console

A separate, dark-themed analytics dashboard for **you** (the project
operator), totally independent from the worker / owner mobile app.

It tells you:

- How many **businesses** are signed up.
- How many **employees** they collectively manage.
- How many **active workers** vs **pending** members are linked to those businesses.
- Daily **location-pings** and **signups** trend (line charts).
- A **leaderboard** of every business with last-activity timestamps.
- A **recent-signups** feed.

The page is `admin.html` in the same repo and deploys with the rest of
the site to GitHub Pages — but lives at a separate URL
(`https://<your-pages>/admin.html`) and never registers the PayBox
service worker, so it can't accidentally clobber a worker's session.

---

## How it works (architecture)

```
┌──────────────┐          ┌─────────────────┐
│  admin.html  │ ──RPC──▶ │  Postgres RPCs  │
│ (dark-theme) │          │  is_admin()     │
│  Supabase    │          │  admin_summary  │
│  magic-link  │          │  admin_business │
│  auth        │          │  admin_…        │
└──────────────┘          └─────────────────┘
                                   │
                                   │  reads
                                   ▼
                          ┌──────────────────┐
                          │ businesses, members,
                          │ events, location_pings,
                          │ auth.users
                          └──────────────────┘
```

- `admin.html` signs the admin in with the **same Supabase project**
  the main app uses, but stores the session under a separate
  `storageKey` so it doesn't fight with the worker / owner session in
  a side-by-side tab.
- After sign-in it calls `is_admin()` — a `SECURITY DEFINER` function
  that checks whether the caller's email is in the `public.admin_users`
  table. **Only admins get past this point.**
- The four `admin_*` RPCs aggregate data inside Postgres and return
  pre-counted rows. Because they're `SECURITY DEFINER`, regular RLS on
  `businesses` / `members` / `events` is bypassed *for those calls
  only* — but each one re-checks `is_admin()` first, so a regular
  worker hitting the RPC just gets `42501 / not_admin`.
- The page polls every 30 seconds while visible. Charts are rendered
  with Chart.js (lazy-loaded from jsDelivr).

---

## One-time setup

### 1. Apply the SQL migration

Open Supabase Studio → **SQL Editor** → **New query**, paste the
contents of [`supabase/migrations/0004_admin_analytics.sql`](supabase/migrations/0004_admin_analytics.sql), and click **Run**.

This creates:

- `public.admin_users` — the allow-list table (RLS-locked, no public access).
- `public.is_admin()` — predicate used by every RPC.
- `public.admin_summary()` — KPI counts.
- `public.admin_business_list(lim int)` — leaderboard rows.
- `public.admin_timeseries(metric, days)` — line-chart data.
- `public.admin_recent_signups(lim int)` — recent-signups list.

The script is **idempotent** — re-running it is safe.

### 2. Add yourself to the allow-list

Still in **SQL Editor**, run (replacing the email):

```sql
insert into public.admin_users(email, note)
values('your.real.email@example.com', 'first admin')
on conflict (email) do nothing;
```

> Tip: the email **must** match the Supabase auth user's email exactly
> (case is normalized by `is_admin()` so capitalization doesn't matter,
> but typos do).

To grant another teammate later:

```sql
insert into public.admin_users(email, note) values('helper@example.com', 'on-call');
```

To revoke:

```sql
delete from public.admin_users where lower(email) = 'someone@example.com';
```

### 3. Open the page

Locally:

```bash
# from the repo root
python3 -m http.server 8000
# then visit http://localhost:8000/Pay_Box/admin.html
```

Deployed (GitHub Pages):

```
https://<user>.github.io/Pay_Box/admin.html
```

The first time you load it, it asks for your email, sends a Supabase
magic link, and reloads signed-in. If your email is on the allow-list
you get the dashboard. If not, you get a friendly "not authorized"
screen with the SQL to fix it.

---

## What the dashboard shows

| Block | Source | Notes |
|---|---|---|
| **KPI cards** (Businesses · Employees · Active workers · Pings 24h) | `admin_summary()` | Computed in Postgres in one round-trip. |
| **Daily location pings** chart | `admin_timeseries('pings', 30)` | Rolling 30-day window with zero-filled days. |
| **Daily new signups** chart | `admin_timeseries('signups', 30)` | Counts `auth.users.created_at` per day. |
| **Businesses leaderboard** | `admin_business_list(100)` | Sorted by `businesses.updated_at desc` — most-recently-touched first. Filter box on the right is client-side over name / owner email / join code. |
| **Recent signups** feed | `admin_recent_signups(25)` | Last 25 users; shows business count if they own one. |

A "**Refresh**" button forces an immediate re-fetch; the page also
auto-refreshes every 30 seconds while it's the active tab.

---

## Adding new metrics

The pattern is:

1. Add a new function in `0004_admin_analytics.sql` (or a `0005_…sql`
   if you want clean migration history). Keep the `is_admin()` guard
   and a `grant execute … to authenticated;` line at the bottom.
2. Add a `fetchX()` helper inside `admin.html`'s `<script type="module">` block, modelled after `fetchSummary()`.
3. Render it inside `refreshAll()` and add a card / table / chart for it in the `<main>` section.

Example — "events per kind, last 7 days":

```sql
-- in 0004_admin_analytics.sql (or a new migration)
create or replace function public.admin_events_by_kind(days int default 7)
returns table (kind text, n bigint)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  return query
    select e.kind, count(*)::bigint as n
    from public.events e
    where e.created_at > now() - (greatest(1, coalesce(days, 7)) || ' days')::interval
    group by e.kind order by n desc;
end $$;
grant execute on function public.admin_events_by_kind(int) to authenticated;
```

```js
// in admin.html
async function fetchEventsByKind(days = 7) {
  const { data, error } = await supabase.rpc('admin_events_by_kind', { days });
  if (error) throw error;
  return data || [];
}
```

---

## Security model recap

- **Anon API**: cannot see `admin_users`. RLS denies everything.
- **Authenticated API**: can `EXECUTE` the four `admin_*` functions (because of the explicit `grant`), but each one immediately checks `is_admin()` and raises if the caller isn't on the list — so regular owners / workers get a clean 403-ish error and **no data**.
- **Allow-list management**: only the `postgres` role (i.e. you in Studio, or a service-role key) can read or write `admin_users`. There is **no UI** for adding admins from the front-end — it's deliberately SQL-only so you can't accidentally grant access through a misconfigured app screen.
- **Storage isolation**: the admin page uses `storageKey: 'paybox-admin-auth'`. Opening `admin.html` and `index.html` side-by-side in two tabs gives you two distinct sessions.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "Not authorized" on every email | You haven't run the migration, or your email isn't in `admin_users`. | Run the migration; insert your email into `admin_users`. |
| KPI cards stuck on `—` | RPC error — open browser DevTools console. | Most often `permission denied for function` — re-run the `grant execute …` lines from the migration. |
| Charts blank but cards populated | Chart.js failed to load (network / CSP). | Check Network tab; whitelist `cdn.jsdelivr.net` in any CSP. |
| Magic link goes to a different machine | Browsers protect against email-link hijack. | Open the email on the same device where you triggered it. |
| Sign-in works but the dashboard says "Auth check failed" | `is_admin()` doesn't exist yet (migration not applied). | Re-run `0004_admin_analytics.sql`. |

---

## Future ideas (not built — happy to add on request)

- **Owner drill-in**: click a business row → modal with its event log + ping map.
- **Cohort analysis**: signups bucketed by month + 7/30-day retention.
- **Anomaly chips**: highlight businesses whose ping volume dropped >50 % week-over-week.
- **CSV export** of the leaderboard.
- **Slack / email alerts** when a brand-new business joins or a paying business goes silent.
