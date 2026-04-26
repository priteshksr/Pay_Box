# PayBox — Native iOS + Android Build Runbook

PayBox ships as a single-file PWA ([`index.html`](index.html)). This doc
covers how to turn it into installable iOS and Android apps, on two
parallel tracks:

- **Track 1 – PWABuilder TWA (Android only, ~1 day):** fastest path to
  Play Console Internal Testing. Uses the hosted PWA as-is.
- **Track 2 – Capacitor shell (iOS + Android, ~2–3 days):** full native
  control, offline-bundled, lives in [`native/`](native/).

Both tracks consume the same web code. Track 2 is the long-term home.

---

## 0. Prerequisites

Install once on your Mac:

| Tool                        | Purpose                                                   | Install                                                                   |
| --------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Node 18+ / npm**          | build scripts, Capacitor CLI                              | `brew install node` (or already installed from running tests)             |
| **JDK 17**                  | Gradle + keytool                                          | `brew install openjdk@17 && brew link openjdk@17 --force`                 |
| **Android Studio**          | Android SDK, emulator, signing, AAB build                 | [developer.android.com/studio](https://developer.android.com/studio)      |
| **Xcode 15+**               | iOS build + archive                                       | Mac App Store (free, ~10 GB)                                              |
| **Xcode Command Line Tools**| `xcode-select` bits used by Capacitor                     | `xcode-select --install`                                                  |
| **CocoaPods**               | iOS dependency manager                                    | `sudo gem install cocoapods` (or `brew install cocoapods`)                |
| **Apple Developer Program** | TestFlight access                                         | $99/year at [developer.apple.com](https://developer.apple.com)            |
| **Google Play Console**     | Play Store access                                         | $25 one-time at [play.google.com/console](https://play.google.com/console)|

Optional but useful:

- `brew install gh` — GitHub CLI, for opening PRs and deploying to Pages.
- `brew install librsvg` — `rsvg-convert` speeds up icon regeneration.
- `brew install cloudflared` or `ngrok` — fast HTTPS tunnel for testing
  the PWA against a real phone before hosting.

Everything that follows runs from the repo root (`My_Box/`) unless noted.

---

## 1. Track 1 — PWABuilder (Android TWA, fastest)

This path wraps the **hosted** PWA in a [Trusted Web Activity](https://web.dev/articles/trusted-web-activities) — a
lightweight Android shell that opens a Chrome Custom Tab pointing at
your HTTPS URL. No Capacitor, no local builds, but you need a public URL.

### 1.1 Deploy the PWA

Pick one — all are free tier.

- **Netlify drop-zone (fastest):** drag the whole `My_Box/` folder onto
  [app.netlify.com/drop](https://app.netlify.com/drop). You'll get a
  `https://<random>.netlify.app` URL within seconds. The
  [`netlify.toml`](netlify.toml) in this repo sets correct cache
  headers (no-cache for `sw.js` + `manifest.json`).

- **GitHub Pages:** push this repo to GitHub; the workflow at
  [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml)
  deploys on every push to `main`. Enable Pages via **Settings →
  Pages → Source: GitHub Actions**.

- **Vercel:** connect the repo; [`vercel.json`](vercel.json) is
  already configured.

- **Cloudflare Pages:** point at the repo, build command blank,
  output directory `My_Box`.

Verify the deployment:

```bash
curl -I https://paybox.example.com/manifest.json
# → 200 OK, application/manifest+json
```

### 1.2 Generate the AAB at pwabuilder.com

1. Visit [pwabuilder.com](https://www.pwabuilder.com/) → paste the
   URL → **Start**.
2. Review the audit. `manifest.json` should score ≥ 90; the Phase-0
   hardening (`viewport-fit=cover`, full icon set, categories,
   `shortcuts`) already meets this.
3. Click **Package For Stores → Android**. On the modal:
   - **Package ID:** `in.paybox.app` (keep this EXACTLY — it's also
     what Capacitor uses, so you don't double-publish).
   - **App name:** `PayBox`.
   - **Display mode:** Standalone.
   - **Fallback behavior:** Customtabs.
   - **Signing key:** choose **Generate a new signing key** (PWABuilder
     will include the keystore + passwords in the downloaded zip).
     **Save the zip in a password manager — losing the keystore means
     you can never update the app on Play Store.**
4. Download the `.zip`. It contains:
   - `app-release-signed.aab` — upload this to Play Console.
   - `signing.keystore` + `signing-key-info.txt` — move to password
     manager.
   - `assetlinks.json` — **upload this to your site** at
     `/.well-known/assetlinks.json`, replacing the placeholder at
     [`.well-known/assetlinks.json`](.well-known/assetlinks.json). This
     is what proves the Android app and the web origin are the same
     party, so the TWA runs full-screen (no URL bar).

### 1.3 Publish to Play Console Internal Testing

1. [play.google.com/console](https://play.google.com/console) → pay the
   $25 dev fee if you haven't → **Create app**.
2. Fill the declarations. **Testing → Internal testing → Create new
   release → Upload** `app-release-signed.aab`.
3. Add up to 100 tester email addresses (Gmail accounts). They get a
   private opt-in link; apps appear in Play Store ~15 min later.

Re-deploying the PWA updates the app instantly (no new AAB needed).
Only re-submit an AAB when Capacitor-style native config changes.

---

## 2. Track 2 — Capacitor shell (iOS + Android, long-term)

Capacitor bundles the web code inside a real native app. This is the
path for TestFlight + Play Store production.

Everything here lives under [`native/`](native/).

### 2.1 One-time setup

```bash
cd native
npm install            # installs Capacitor core + plugins (already done if you ran the scaffold)
npm run build          # copies ../index.html ../sw.js ../manifest.json ../icon.svg ../icons ../.well-known into www/
npx cap doctor         # optional: prints toolchain health
```

If iOS/Android platform folders don't exist yet:

```bash
npm run add:android    # creates native/android/
npm run add:ios        # creates native/ios/ (requires Xcode + CocoaPods)
```

Both are idempotent — re-running only updates scaffolding if the
version changed.

### 2.2 Daily loop (web edits)

Every time you edit the web app:

```bash
cd native
npm run sync           # copies web → www/ and runs `npx cap sync`
```

Then open the native IDE:

```bash
npm run open:ios       # Xcode
npm run open:android   # Android Studio
```

Hit "Run" to launch on simulator / device.

To hot-reload against your Mac's dev server during development, add a
`server.url` line in [`capacitor.config.ts`](native/capacitor.config.ts)
pointing at `http://<your-mac-lan-ip>:8765` and rerun `npm run sync`.

### 2.3 Icons & splash

Source of truth is [`icon.svg`](icon.svg). Regenerate every derived PNG
with:

```bash
# From repo root — rebuilds icons/icon-192.png, icons/icon-512.png,
# icons/icon-maskable-512.png, icons/apple-touch-icon-180.png.
./scripts/generate-icons.sh

# From native/ — rebuilds the Android launcher icons (mipmap-*) and
# the iOS AppIcon + splash images.
cd native
node scripts/generate-android-icons.js
# iOS AppIcon + splash are regenerated by the same inline Node snippet
# documented at the top of scripts/generate-android-icons.js — or just
# run generate-icons.sh which handles the PWA icons.
```

The generators use `@resvg/resvg-js` so no GUI tools are required.
Alternatively, install [capacitor-assets](https://github.com/ionic-team/capacitor-assets)
(`npm i -D @capacitor/assets` from `native/`) for a richer workflow —
it also produces round Android icons and monochrome adaptive icons.

### 2.4 Android keystore

A release AAB must be signed. Create a keystore ONCE; back it up like a
crown jewel.

```bash
cd native
./scripts/create-keystore.sh
# follow the prompts; pick two strong passwords
# (store password + key password are usually the same for Play Store).
```

This produces `native/release.jks` and
`native/android/keystore.properties`. Both are already in
[`native/.gitignore`](native/.gitignore) so you can't accidentally
commit them.

Store the `.jks` + the two passwords + the alias name in a password
manager (1Password / Bitwarden / an encrypted note).

### 2.5 Build the Android AAB

```bash
cd native
npm run sync:android
cd android
./gradlew bundleRelease
# → app/build/outputs/bundle/release/app-release.aab
```

Upload that `.aab` in Play Console → **Internal testing**.

> **Note:** Keep the Capacitor app id (`in.paybox.app`) in sync with
> whatever PWABuilder used in Track 1. If you change it later, testers
> have to uninstall the old app manually.

### 2.6 Build the iOS archive

```bash
cd native
npm run sync:ios
npm run open:ios       # opens App.xcworkspace in Xcode
```

Inside Xcode:

1. Click the blue **App** project → **Signing & Capabilities**.
2. Set **Team** to your Apple Developer team (drop-down). Xcode auto-
   creates a provisioning profile using the bundle id `in.paybox.app`.
3. Update **Version** (`1.0`) and **Build** (`1`). Bump Build on every
   TestFlight upload; bump Version on user-visible releases.
4. Top bar → scheme **App** → target **Any iOS Device (arm64)**.
5. **Product → Archive**. Wait ~2 min.
6. Organizer opens → select the archive → **Distribute App →
   TestFlight & App Store → Upload**. Xcode handles signing,
   bitcode, etc.
7. Within ~15 min the build appears on
   [App Store Connect](https://appstoreconnect.apple.com) →
   **Apps → PayBox → TestFlight**. Fill the "Test Information"
   form, add testers by email, they get an invite via the TestFlight
   iOS app.

No App Store review is required for **internal** testers (up to 100
across your team). Public/external testing needs a ~24-hour review but
still no full App Store submission.

### 2.7 Deep links for Supabase magic links

Already wired in code ([`index.html`](index.html) listens to
`App.appUrlOpen`). In **Supabase Dashboard → Authentication → URL
Configuration** add the native redirect URLs — see
[`CLOUD_SYNC.md §4a`](CLOUD_SYNC.md#4a-redirect-urls-required-for-native-apps).

---

## 3. Release cadence

```
web change         →  npm run sync            (both platforms get it)
plugin add/update  →  npm install … && npm run sync
icon change        →  ./scripts/generate-icons.sh && npm run sync
Android release    →  ./gradlew bundleRelease && upload AAB
iOS release        →  Xcode Archive → upload to TestFlight
```

For the TWA track (PWABuilder), the **hosted PWA update IS the
release** — no AAB rebuild is needed unless you change the package
id, the allowed origin, or the TWA fallback behaviour.

---

## 4. Smoke checklist (manual, pre-release)

Run this before every TestFlight / Internal Testing upload. Start from
a freshly-installed app.

### Core flow

- [ ] App icon + splash render correctly on the launcher.
- [ ] First launch lands on **Home** with the empty state (no staff).
- [ ] **Load demo data** (Settings → Load demo data) populates 10
      staff and a month of attendance.
- [ ] Toggle attendance P/A/H/L/off for each staff; rows persist after
      a full force-quit + relaunch.
- [ ] Add an advance → net pay drops; add a bonus → net pay rises.
- [ ] Open a payslip → **Share** invokes the native share sheet (iOS)
      or Intent picker (Android), not a browser copy-to-clipboard
      fallback.
- [ ] **Export CSV** (Settings → Export attendance) saves to Files
      (iOS) / Documents (Android) and can be opened.
- [ ] Offline mode: turn on airplane mode → app still fully functional;
      attendance edits sync once online (if Cloud is enabled).

### Native polish

- [ ] iPhone with Dynamic Island / notch: header text is NOT overlapped.
- [ ] Gesture bar doesn't obscure the bottom tab bar.
- [ ] Android hardware **Back** closes the current sheet / bottom
      drawer first; second press exits the app.
- [ ] Android: rotating to landscape is blocked (orientation locked to
      portrait in `capacitor.config.ts`).
- [ ] Status bar is brand-blue with white icons.
- [ ] Tapping a staff photo opens the camera picker with a proper
      permission prompt (iOS: "PayBox would like to access the Camera").

### Live location tracking (optional, Phase 6)

If the owner has enabled "Live location tracking" in Settings:

- [ ] Worker punches in for the first time → consent modal appears.
- [ ] Tapping **Share my location** triggers the native location prompt
      (iOS: "Allow PayBox to use your location? — While Using the App"
      then a follow-up **Always** prompt; Android: foreground prompt
      followed by an **Allow all the time** prompt).
- [ ] On Android 13+ a notification permission prompt is shown so the
      sticky **"PayBox · Sharing your work location until you punch
      out"** notification can render.
- [ ] After punch-in, sticky notification is visible and disappears
      automatically when the worker punches out.
- [ ] Owner's Live Map sheet shows the worker's marker move within
      ~30 s while the app is foregrounded, ~3 min while backgrounded
      (matches the configured min interval).
- [ ] Punch out → tracking stops, notification disappears, no further
      pings appear in `location_pings`.

### Cloud sync (optional)

- [ ] Settings → Cloud sync → enter Supabase URL + anon key → **Create
      account** → magic-link email arrives → tapping the link re-opens
      the app (not Safari / Chrome) and completes sign-in.
- [ ] On a second device, sign in with the same account → **Pull from
      cloud** shows the first device's data.
- [ ] Edit on device A → watch device B update live (green "Live"
      badge must be lit).

### Regression

- [ ] Run the Playwright suite: `cd tests && npx playwright test`. All
      66 tests must pass — the native adapter is gated behind
      `Native.on`, so the web behaviour is unchanged.

---

## 5. Troubleshooting

| Symptom                                              | Fix                                                                                            |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `pod install` fails with "requires Xcode"            | Run `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer` then retry.              |
| `gradlew bundleRelease` fails with "SDK not found"   | Open Android Studio once to let it install the missing SDK packages, then retry.               |
| iOS Archive greyed out                               | Make sure the scheme target is **Any iOS Device (arm64)** — the Simulator target can't archive.|
| "Execution failed: INSTALL_FAILED_UPDATE_INCOMPATIBLE" | Uninstall the TWA build before installing the Capacitor build (or vice-versa). Same app id.  |
| Supabase magic link opens in Safari and stays there  | Redirect URLs missing in Supabase — see [`CLOUD_SYNC.md §4a`](CLOUD_SYNC.md#4a-redirect-urls-required-for-native-apps). |
| iOS: `localStorage` is empty after OS update          | The native build mirrors to `@capacitor/preferences` automatically — relaunch to hydrate. If you still see empty state, Cloud sync + **Pull from cloud** recovers data. |
| Playwright tests fail with `Executable doesn't exist` | Run `cd tests && npx playwright install chromium` once; on Apple Silicon use `arch -arm64 npx playwright test`. |

---

## 6. File map (what-ended-up-where)

Web (unchanged, still the source of truth):

- [`index.html`](index.html) — single-file PWA, includes `Native` adapter.
- [`sw.js`](sw.js) — service worker (browser-only; skipped in native).
- [`manifest.json`](manifest.json) — PWA manifest with PNG icons + screenshots.
- [`icon.svg`](icon.svg) — source of truth for every launcher icon.
- [`icons/`](icons/) — generated PNG set (`generate-icons.sh`).
- [`.well-known/assetlinks.json`](.well-known/assetlinks.json) — TWA
  domain proof (replace the SHA256 placeholder with the one PWABuilder
  gives you).

Hosting configs (optional, pick one):

- [`netlify.toml`](netlify.toml) — Netlify drop-zone headers.
- [`vercel.json`](vercel.json) — Vercel cache headers.
- [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) — GitHub Pages CI.

Native shell (Track 2):

- [`native/package.json`](native/package.json) — Capacitor + plugin deps.
- [`native/capacitor.config.ts`](native/capacitor.config.ts) — app id, plugin config.
- [`native/scripts/sync-web.js`](native/scripts/sync-web.js) — web → www/ copier.
- [`native/scripts/create-keystore.sh`](native/scripts/create-keystore.sh) — one-time Android keystore bootstrap.
- [`native/scripts/generate-android-icons.js`](native/scripts/generate-android-icons.js) — mipmap launcher icons.
- `native/android/` — Gradle project (generated, checked in).
- `native/ios/` — Xcode project (generated, checked in).
- `native/www/` — last synced web bundle (generated, **not** checked in).

Documentation:

- [`CLOUD_SYNC.md`](CLOUD_SYNC.md) — Supabase setup + magic-link redirect URLs.
- [`NATIVE.md`](NATIVE.md) — this file.
- [`TESTING.md`](TESTING.md) — Playwright test suite overview.
