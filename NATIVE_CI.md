# Building PayBox in the cloud (GitHub Actions)

This repo ships two GitHub Actions workflows that build the iOS + Android
apps without you installing anything locally. They work in three modes:

| Secrets configured | What you get on every push |
|--------------------|----------------------------|
| **None** (default) | Debug APK (Android) + unsigned simulator `.app` (iOS) — smoke tests only, can't install on real devices |
| **Android only**   | Debug APK + **signed release AAB** ready for Play Console |
| **iOS only**       | Debug APK + unsigned `.app` + **signed `.ipa`** ready for TestFlight / App Store |
| **Both**           | Everything signed, both stores covered |

Once set up, you build a release by opening a terminal and running
`git push`. The signed binaries show up ~10 minutes later as
"Artifacts" on the GitHub Actions run page.

---

## 1. Push the repo to GitHub (one-time)

From `My_Box/`:

```bash
# Initialise git + ignore the noisy / secret stuff
cd /Users/Pritesh_Singh/Ideas/My_Box

cat > .gitignore <<'EOF'
# Dependencies
node_modules/
native/node_modules/
native/ios/App/Pods/

# Native build outputs
native/android/app/build/
native/android/.gradle/
native/android/local.properties
native/android/keystore.properties
native/release.jks
native/ios/App/build/
native/ios/DerivedData/
build/

# Test output
tests/test-results/
tests/playwright-report/
tests/node_modules/

# Local cruft
.DS_Store
*.log
.env*
EOF

git init -b main
git add .
git commit -m "Initial PayBox commit"

# Create the GitHub repo + push in one shot (uses the gh CLI you
# already have installed at /opt/homebrew/bin/gh):
gh auth login                           # one-time browser login
gh repo create paybox --private --source=. --remote=origin --push
```

After that, `git push` on any future change triggers the workflows.

---

## 2. Android signing secrets (one-time, ~5 minutes)

### 2a. Create a release keystore

On any machine with Java installed (or use an online generator like
Android Studio → Build → Generate Signed Bundle → Create new):

```bash
keytool -genkeypair -v \
  -keystore paybox-release.jks \
  -storetype JKS \
  -alias paybox \
  -keyalg RSA \
  -keysize 2048 \
  -validity 9125
```

Fill in the prompts. **Remember the two passwords** you just typed
(`store password` and `key password`) — losing them means you can
never ship an update with the same app id.

> No Java? Use [this interactive keystore generator](https://keystore-explorer.org/downloads.html)
> (KeyStore Explorer, free) on macOS.

### 2b. Base64-encode the keystore for GitHub

```bash
base64 -i paybox-release.jks | pbcopy     # macOS — puts it in your clipboard
# Linux:  base64 -w 0 paybox-release.jks | xclip -selection clipboard
```

### 2c. Add the four secrets to GitHub

Go to: **https://github.com/YOUR-USER/paybox/settings/secrets/actions → New repository secret**

| Secret name                         | Value                              |
|-------------------------------------|------------------------------------|
| `ANDROID_KEYSTORE_BASE64`           | paste from clipboard (step 2b)     |
| `ANDROID_KEYSTORE_STORE_PASSWORD`   | the store password from step 2a    |
| `ANDROID_KEYSTORE_KEY_ALIAS`        | `paybox`                           |
| `ANDROID_KEYSTORE_KEY_PASSWORD`     | the key password from step 2a      |

**Keep the `paybox-release.jks` file somewhere safe** (password manager,
encrypted backup). If your GitHub secret is ever wiped, you need this
file to re-upload it — and without it, Play Store will refuse to accept
updates.

### 2d. Trigger a build

```bash
git commit --allow-empty -m "ci: trigger Android build"
git push
```

Watch it at `https://github.com/YOUR-USER/paybox/actions`. When green,
click the run → **Artifacts** → download `paybox-release-aab`. Upload
the `.aab` to **Play Console → Internal testing** → Review → Roll out.

---

## 3. iOS signing secrets (one-time, ~10 minutes)

### 3a. Get an Apple Developer account

$99/year — sign up at [developer.apple.com](https://developer.apple.com/programs/enroll/).
You cannot ship to the App Store without this.

### 3b. Create an App Store Connect API key

1. Go to [App Store Connect → Users and Access → Keys](https://appstoreconnect.apple.com/access/api).
2. Click **+**, name it `paybox-ci`, role **App Manager**.
3. Download the `.p8` file (you can only do this once!), note the
   **Key ID** and the **Issuer ID** shown at the top of the page.

### 3c. Register the app id in the portal

1. [developer.apple.com → Certificates, Identifiers & Profiles → Identifiers](https://developer.apple.com/account/resources/identifiers/list).
2. **+** → **App IDs** → **App** → Continue.
3. Description: `PayBox`, Bundle ID: **Explicit** → `in.paybox.app`.
4. Register.

### 3d. Create the App Store Connect app listing

1. [App Store Connect → Apps → +](https://appstoreconnect.apple.com/apps) → New App.
2. Platform: iOS, Name: `PayBox`, Bundle ID: `in.paybox.app`,
   SKU: `paybox-ios-1`.
3. Create.

### 3e. Base64-encode the `.p8`

```bash
base64 -i AuthKey_XXXXXXXXXX.p8 | pbcopy
```

### 3f. Add the four secrets to GitHub

Same secrets page as before:

| Secret name              | Value                                                   |
|--------------------------|---------------------------------------------------------|
| `APPLE_API_KEY_BASE64`   | paste from clipboard (step 3e)                          |
| `APPLE_API_KEY_ID`       | the 10-char Key ID from step 3b                         |
| `APPLE_API_ISSUER_ID`    | the UUID Issuer ID from step 3b                         |
| `APPLE_TEAM_ID`          | your 10-char team id from [Membership page](https://developer.apple.com/account#MembershipDetailsCard) |

### 3g. Trigger a build

```bash
git commit --allow-empty -m "ci: trigger iOS build"
git push
```

When the run is green, download `paybox-release-ipa` from the
**Artifacts** section.

### 3h. Upload to TestFlight

Option A (easiest): drag the `.ipa` onto
[Transporter.app](https://apps.apple.com/app/transporter/id1450874784)
(free, Mac App Store).

Option B (one line, needs Xcode installed):

```bash
xcrun altool --upload-app -f paybox.ipa -t ios \
  --apiKey $APPLE_API_KEY_ID --apiIssuer $APPLE_API_ISSUER_ID
```

---

## 4. Triggering a build manually

No code change needed — go to **Actions** tab → pick **Android build**
or **iOS build** → **Run workflow** → **main** → **Run workflow**.

## 5. Typical release flow

```bash
# 1) Bump the version in both places (they must match Play/App Store)
sed -i '' 's/versionName "1.0"/versionName "1.1"/' native/android/app/build.gradle
sed -i '' 's/MARKETING_VERSION = 1.0/MARKETING_VERSION = 1.1/' native/ios/App/App.xcodeproj/project.pbxproj
sed -i '' 's/versionCode 1/versionCode 2/' native/android/app/build.gradle
sed -i '' 's/CURRENT_PROJECT_VERSION = 1/CURRENT_PROJECT_VERSION = 2/' native/ios/App/App.xcodeproj/project.pbxproj

# 2) Commit + tag
git add -A && git commit -m "Release v1.1"
git tag v1.1
git push && git push --tags

# 3) Wait ~15 minutes, then grab both artifacts from the Actions page
#    Upload .aab → Play Console
#    Upload .ipa → TestFlight via Transporter.app
```

## 6. Debugging a red workflow

- **"No matching keystore"** → one of the 4 Android secrets is wrong.
  Re-check `ANDROID_KEYSTORE_KEY_ALIAS` matches what you passed to
  `keytool -alias`.
- **"No signing certificate found"** → the bundle id `in.paybox.app`
  isn't registered under your Apple team (step 3c), or the API key
  user doesn't have **App Manager** role.
- **"gradle: command not found"** → the `setup-android` action failed
  to install the SDK. Re-run the job; usually a transient network blip.
- **"xcodebuild: error: The workspace cannot be opened"** → `pod
  install` didn't run or the Pods cache is stale. Click **Re-run jobs**
  with `Enable debug logging` ticked.

## 7. Security notes

- Every secret is exposed ONLY to jobs in this repo, never to forks
  or to logs (GitHub auto-masks them).
- The decoded keystore / API key live on the runner's disk for ~2
  minutes, then the runner is destroyed. The workflows also `rm -f`
  them in the final step.
- Make the repo **private** if you can (step 1) — public repos get
  unlimited free minutes but you may prefer not to expose the source.
- Never commit `paybox-release.jks`, `AuthKey_*.p8`, or
  `keystore.properties`. The `.gitignore` from step 1 covers these.
