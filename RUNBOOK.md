# PayBox Production Runbook

Operations guide for deploying, maintaining, and troubleshooting PayBox in production.

---

## Deploying a New Version

### PWA (GitHub Pages)

1. Merge changes to `main` branch
2. GitHub Actions automatically:
   - Runs Playwright tests
   - Builds Tailwind CSS
   - Auto-versions the service worker cache (uses git commit hash)
   - Deploys to GitHub Pages
3. Users receive the update within 24h (SW checks for updates on each visit)

### Android APK

1. Ensure web assets are up to date:
   ```bash
   npm run build:css
   cd native && npm run sync && npx cap sync android
   ```
2. Bump `versionCode` and `versionName` in `native/android/app/build.gradle`
3. Push to `main` — the `android-build.yml` workflow produces a signed APK
4. Download the APK artifact from GitHub Actions and distribute

### iOS

1. Sync web assets: `cd native && npm run sync && npx cap sync ios`
2. Open `npx cap open ios` in Xcode
3. Archive → Distribute (Ad Hoc or App Store)

---

## Running Supabase Migrations

### Via Supabase CLI

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

### Via SQL Editor (manual)

Apply files in order in the Supabase SQL Editor:
1. `supabase/migrations/0001_base_schema.sql`
2. `supabase/migrations/0002_location_pings.sql`
3. `supabase/migrations/0003_punch_webhook.sql`
4. `supabase/migrations/0004_admin_analytics.sql`

---

## Managing Admin Users

### Add an admin
```sql
INSERT INTO public.admin_users(email, note)
VALUES ('admin@yourdomain.com', 'Added by ops team');
```

### Remove an admin
```sql
DELETE FROM public.admin_users WHERE lower(email) = 'admin@yourdomain.com';
```

### List admins
```sql
SELECT * FROM public.admin_users;
```

---

## Rotate Join Code / Revoke Invites

### Rotate a business join code
If a join code has leaked, the owner can rotate it from the app. To do it manually via SQL:
```sql
SELECT public.rotate_join_code('<business-uuid>');
```

### Revoke unclaimed staff invite
```sql
SELECT public.revoke_staff_invite('<business-uuid>', '<staff-id>');
```

---

## Rollback Procedure

### PWA rollback
1. Revert the commit on `main`
2. Push — CI will redeploy the previous version
3. Users get the rollback on next SW update check

### APK rollback
1. Distribute the previous APK version (users must manually install)
2. Ensure the new APK has a higher `versionCode` than the current installed one

### Database rollback
Supabase doesn't support automatic migration rollback. For critical issues:
1. Identify the problematic migration
2. Write a manual reversal SQL script
3. Test in a staging project first
4. Apply via SQL Editor

---

## Common Issues & Diagnostics

### Users not getting updates (stale cache)
- The SW cache is auto-versioned per deploy (commit hash)
- If stuck: ask user to clear site data (Settings → Privacy → Clear data for this site)
- Check: `Application → Service Workers` in DevTools — should show "waiting to activate"

### Cloud sync not working
1. Check Supabase project status at https://app.supabase.com
2. Verify RLS policies: `SELECT * FROM pg_policies WHERE tablename = 'businesses';`
3. Check Edge Function logs: `supabase functions logs notify-punch`
4. Client-side: check `reportError.getQueue()` in browser console

### Push notifications not delivering
1. Verify `FIREBASE_SERVICE_ACCOUNT` secret is set in Supabase Edge Functions
2. Check `push_tokens` table has valid tokens for the user
3. Check Edge Function logs for errors
4. Ensure `WEBHOOK_SECRET` matches between webhook config and Edge Function env

### Android app crashes on launch
1. Enable USB debugging and run `adb logcat | grep -i paybox`
2. Common cause: outdated web assets (run `sync-web.js` + `cap sync`)
3. Check that `webContentsDebuggingEnabled` is `false` in release but `true` for debug

### Location tracking not working
1. Check Android permissions: Location (Always), Background location
2. Verify `@capacitor-community/background-geolocation` is in `capacitor.plugins.json`
3. Check `location_pings` table for recent entries
4. Client-side: `cloudBiz.tracker.status()` in console

---

## Monitoring

### Error queue (client-side)
In the browser console:
```js
reportError.getQueue()  // shows recent errors
reportError.clear()     // clears the queue
```

### Database health
```sql
-- Active businesses (last 7 days)
SELECT count(*) FROM public.businesses
WHERE updated_at > (extract(epoch from now() - interval '7 days') * 1000)::bigint;

-- Event volume (last 24h)
SELECT count(*) FROM public.events
WHERE created_at > now() - interval '24 hours';

-- Location ping volume
SELECT count(*) FROM public.location_pings
WHERE ts > now() - interval '24 hours';
```

---

## Secrets Reference

| Secret | Where | Purpose |
|--------|-------|---------|
| `FIREBASE_SERVICE_ACCOUNT` | Supabase Edge Functions | FCM push notification delivery |
| `WEBHOOK_SECRET` | Supabase Edge Functions + Webhook config | Validates database webhook calls |
| `ANDROID_KEYSTORE_*` | GitHub Actions secrets | Signs release APK |
| `SUPABASE_URL` | Built into app (DEFAULT_CLOUD) | Supabase project endpoint |
| `SUPABASE_ANON_KEY` | Built into app (DEFAULT_CLOUD) | Supabase public API key |
