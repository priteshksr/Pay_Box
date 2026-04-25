# PayBox — Supabase Edge Functions

This folder contains the [Supabase Edge Functions](https://supabase.com/docs/guides/functions)
used by PayBox for server-side processing.

## Functions

### `notify-punch`

Sends a native push notification (FCM HTTP v1) to the business owner
whenever a worker punches in or out.

**Trigger:** Database Webhook on `INSERT` into `public.events` where
`kind in ('punch_in', 'punch_out')`.

**Flow:**

1. Receives the webhook payload containing the new event row.
2. Looks up the worker's display name from `public.members`.
3. Queries `public.push_tokens` for all owner device tokens of that business.
4. Mints a short-lived OAuth2 access token from the Firebase service account.
5. Sends the push to each device via the FCM HTTP v1 API.
6. Automatically removes tokens that FCM reports as unregistered/invalid.

## Prerequisites

- A **Firebase project** with Android + iOS apps configured.
- The Firebase **service account JSON** (Project Settings → Service accounts →
  Generate new private key).
- The **Supabase CLI** installed (`npm i -g supabase`).

## Deployment

```bash
# From the repo root:
cd supabase

# Deploy the function
supabase functions deploy notify-punch --project-ref laifbtwnouavnvhyaihh

# Set the Firebase service account secret
supabase secrets set FIREBASE_SERVICE_ACCOUNT="$(cat /path/to/firebase-service-account.json)"
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically by
the Supabase runtime — you do not need to set them.

## Database Webhook setup

In the Supabase Dashboard:

1. Go to **Database → Webhooks → Create a new webhook**.
2. **Name:** `notify-punch-on-event`
3. **Table:** `events`
4. **Events:** `INSERT`
5. **Type:** Supabase Edge Function
6. **Function:** `notify-punch`

Optionally add a condition filter: `kind in ('punch_in','punch_out')` to avoid
invoking the function for other event types (attendance, OT, etc.).

## Testing locally

```bash
supabase start
supabase functions serve notify-punch --env-file .env.local
```

Create a `.env.local` with:

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=<your-local-service-role-key>
FIREBASE_SERVICE_ACCOUNT=<json-string>
```

Then POST a sample webhook payload:

```bash
curl -X POST http://127.0.0.1:54321/functions/v1/notify-punch \
  -H "Content-Type: application/json" \
  -d '{
    "type": "INSERT",
    "table": "events",
    "record": {
      "id": 1,
      "business_id": "your-biz-uuid",
      "author_id": "worker-user-uuid",
      "staff_id": "staff-id",
      "kind": "punch_in",
      "payload": { "date": "2026-04-25", "time": "09:02" },
      "created_at": "2026-04-25T03:32:00Z"
    }
  }'
```
