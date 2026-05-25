# PayBox

A mobile-first staff & payroll app for small businesses — built as a cleaner, smarter alternative to SalaryBox.

PayBox is deployed as a **Progressive Web App** (installable, offline-ready), with native **Android** and **iOS** builds via Capacitor, and a separate **Admin analytics dashboard**.

## Features

### For owners
- **Home dashboard** — monthly payroll estimate, staff count, today's presence
- **Staff management** — add / edit / delete employees; monthly, daily-wage, or piece-rate salary; optional overtime rate
- **Attendance** — one-tap Present / Absent / Half-day / Leave; bulk-mark; date navigation; per-day overtime hours
- **Payroll** — auto-calculated per staff (base + OT + bonus − advances − deductions); month picker
- **Payslip** — full breakdown, shareable; inline add/remove advances, bonuses, deductions per month
- **Export** — Excel workbook (.xlsx) download with attendance + payroll sheets
- **Live location tracking** — real-time GPS stream while workers are clocked in (opt-in, consent-gated)
- **Cloud sync** — multi-device real-time sync via Supabase (owner + workers see changes within ~2s)
- **Push notifications** — owner is notified when workers punch in/out (via FCM/APNs)
- **Tasks & announcements** — assign tasks to staff, post business announcements

### For workers (Worker Mode)
- **Self-service punch in/out** — with optional selfie + GPS verification
- **Attendance calendar** — full-month grid with OT hours per day
- **Payslip** — own pay breakdown for any month (read-only)
- **Staff invite codes** — join a business by entering an 8-character code
- **Phone reconnect** — sign in from a new device using just a phone number

### Platform
- **5 languages** — English, हिन्दी, मराठी, தமிழ், తెలుగు (switchable in Settings)
- **PWA** — install to home screen on iOS/Android/desktop; full offline support
- **Native apps** — Capacitor-based Android APK and iOS app with background location
- **Mobile-first UI** — Tailwind CSS + Inter / Noto Sans (Devanagari, Tamil, Telugu)
- **Persistent** — all data in localStorage with cloud backup via Supabase
- **Admin dashboard** — separate analytics view for platform administrators

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        PayBox Client                         │
│  index.html (PWA)  ──or──  Capacitor Native Shell           │
│                                                             │
│  ┌──────────┐ ┌──────────┐ ┌────────┐ ┌────────────────┐  │
│  │cloudSync │ │ cloudBiz │ │tracker │ │  reportError   │  │
│  │(legacy)  │ │  (v2)    │ │(GPS)   │ │  (monitoring)  │  │
│  └────┬─────┘ └────┬─────┘ └───┬────┘ └────────────────┘  │
│       │             │           │                           │
└───────┼─────────────┼───────────┼───────────────────────────┘
        │             │           │
        ▼             ▼           ▼
┌─────────────────────────────────────────────────────────────┐
│                    Supabase (Postgres)                       │
│  businesses │ members │ events │ location_pings │ push_tokens│
│  + RLS policies + Realtime subscriptions                    │
│  + Edge Functions (notify-punch)                            │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

### Local development

```bash
# Install dependencies (for Tailwind CSS build)
npm install

# Build the CSS (required before serving)
npm run build:css

# Start a local server
python3 -m http.server 8765

# Or use the watch mode for CSS during development
npm run dev:css
```

Open http://localhost:8765 in your browser.

### Run tests

```bash
cd tests
npm install
npx playwright install chromium
npm test
```

### Native development

See [`NATIVE.md`](NATIVE.md) for full native build instructions (Android/iOS).

```bash
cd native
npm install
npm run sync      # copies web assets to www/
npx cap sync      # syncs plugins + web assets
npx cap open android  # or ios
```

### Cloud sync setup

See [`CLOUD_SYNC.md`](CLOUD_SYNC.md) for Supabase configuration and database schema.

## Project Structure

```
Pay_Box/
├── index.html              # Main app (UI + logic + i18n)
├── sw.js                   # Service worker (offline caching)
├── manifest.json           # PWA manifest
├── admin.html              # Admin analytics dashboard
├── dist/tailwind.css       # Pre-built Tailwind CSS
├── tailwind.config.js      # Tailwind configuration
├── package.json            # Root dependencies (Tailwind CLI)
├── native/                 # Capacitor native shell
│   ├── android/            # Android project
│   ├── ios/                # iOS project
│   ├── scripts/sync-web.js # Web → native asset sync
│   └── www/                # Bundled web assets (generated)
├── supabase/               # Database & edge functions
│   ├── migrations/         # SQL schema migrations (0001-0004)
│   ├── functions/          # Edge functions (notify-punch)
│   └── config.toml         # Project config
├── tests/                  # Playwright E2E tests
├── .github/workflows/      # CI/CD (tests, deploy, Android build)
├── CLOUD_SYNC.md           # Cloud sync setup guide
├── NATIVE.md               # Native build documentation
├── TESTING.md              # Manual test checklist
└── RUNBOOK.md              # Production operations guide
```

## Deployment

- **PWA**: Pushed to GitHub Pages via CI (tests must pass first)
- **Android APK**: Built via GitHub Actions, distributed as direct APK download
- **iOS**: Built locally via Xcode (requires Apple Developer account)

## License

ISC
