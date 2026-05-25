# PayBox Supabase Migrations

## Apply Order

Migrations must be applied sequentially:

1. **0001_base_schema.sql** — Core tables (businesses, members, events, staff_invites, push_tokens), RLS policies, helper functions, and RPCs.
2. **0002_location_pings.sql** — Live location tracking table, indexes, RLS, and prune function.
3. **0003_punch_webhook.sql** — Database webhook trigger for push notifications on punch events.
4. **0004_admin_analytics.sql** — Admin dashboard: admin_users table, summary/timeseries RPCs, and RLS.

## How to Apply

### Via Supabase CLI (recommended)

```bash
supabase db push
```

This applies all pending migrations in order.

### Via SQL Editor (manual)

1. Open your Supabase project dashboard → **SQL Editor**
2. Paste and run each file in order (0001 → 0002 → 0003 → 0004)
3. Verify each runs without errors before proceeding to the next

## Required Secrets for Edge Functions

Set these in **Project Settings → Edge Functions → Secrets**:

| Secret | Purpose |
|--------|---------|
| `FIREBASE_SERVICE_ACCOUNT` | JSON key for FCM push notifications (used by `notify-punch`) |
| `WEBHOOK_SECRET` | Shared secret for validating database webhook signatures |

## Pre-deploy Checklist

- [ ] Replace `you@example.com` in `0004_admin_analytics.sql` with a real admin email
- [ ] Set all required secrets in the Supabase dashboard
- [ ] Verify RLS policies with a test user before going live
