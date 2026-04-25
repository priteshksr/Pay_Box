# PayBox

A simple, mobile-first staff & payroll app for small businesses — built as a cleaner, smarter alternative to SalaryBox.

**v0.2** is now a full PWA (installable, offline-ready) with worker-side views, overtime, advances/bonuses/deductions, and 5-language support. Still a single HTML file + service worker. Still zero build.

## Features

### For owners
- **Home dashboard** — monthly payroll estimate, staff count, today's presence
- **Staff management** — add / edit / delete employees; monthly or daily-wage salary; optional overtime rate
- **Attendance** — one-tap Present / Absent / Half-day / Leave; bulk-mark; date navigation; **per-day overtime hours**
- **Payroll** — auto-calculated per staff (base + OT + bonus − advances − deductions); month picker
- **Payslip** — full breakdown, shareable; inline add/remove **advances, bonuses, deductions** per month
- **Export** — JSON backup download

### For workers (Worker Mode)
- **Home** — their own name, this month's pay, attendance summary, outstanding advances
- **Attendance calendar** — full-month grid of their own attendance + OT hours per day
- **Payslip** — their own pay breakdown for any month
- Workers can't edit anything — read-only safe view

### Platform
- **5 languages** — English, हिन्दी, मराठी, தமிழ், తెలుగు (switchable in Settings)
- **PWA** — install to home screen on iOS/Android/desktop; full offline support; caches app shell
- **Mobile-first, beautiful UI** — Tailwind + Inter / Noto Sans (Devanagari, Tamil, Telugu)
- **Persistent** — all data in `localStorage`; migrates from v0.1 automatically
- **Zero setup** — no build tools, no backend

## Files

- `index.html` — the whole app (UI + logic + i18n)
- `manifest.json` — PWA manifest
- `sw.js` — service worker (offline caching, stale-while-revalidate)
- `icon.svg` — app icon
- `README.md` — this

## Run it

### Local file (fastest)

```bash
open index.html
```

Note: service worker and the install prompt require serving over `http://` or `https://` (not `file://`). For a full PWA experience, use a local server.

### Local server

```bash
cd My_Box
python3 -m http.server 8000
# open http://localhost:8000
```

Or any static host (Netlify, Vercel, GitHub Pages, Cloudflare Pages).

## Install as an app

1. Open the site on a phone or Chrome/Edge on desktop.
2. A prompt will appear — tap **Install**.
3. On iOS Safari: Share → Add to Home Screen.

After install it launches fullscreen, works offline, and keeps all your data.

## Worker mode (important)

**Settings → Mode → Worker → pick your profile**

This switches the app into a worker-safe view showing only that person's attendance and payslips. To come back to Owner mode, tap the **Worker** chip at the top-right → Settings → Mode → Owner.

> In a future version this will be gated by a PIN/password so workers can't just flip the switch back. For now, it's honor-system — use it for personal demo / on a worker's own phone.

## Overtime — how it works

- Mark OT hours per day per staff from the Attendance screen (tap **Add OT**).
- If the staff has a custom **OT rate** set on their profile, that's used.
- Otherwise OT rate = **1.5× hourly rate**, where hourly rate comes from:
  - Monthly staff: `salary / (working days/month) / 8`
  - Daily staff: `daily wage / 8`

## Adjustments — how they work

Each month, you can add **advances** (deducted), **bonuses** (added), and **deductions** (subtracted) for any staff member. Open a payslip (Payroll → tap a staff card) to see the list and add/remove.

Adjustments are **per-month** — if you give an advance and want to recover it over 3 months, add 3 deductions (one per month) with an appropriate note.

## Data model (localStorage key: `paybox_v2`, with auto-migration from older `mybox_v2` / `mybox_v1` keys)

```json
{
  "business": { "name": "My Business" },
  "staff": [
    {
      "id": "abc123",
      "name": "Ramesh Kumar",
      "role": "Cashier",
      "phone": "9876543210",
      "salaryType": "monthly",
      "amount": 15000,
      "otRate": null,
      "joinedAt": "2026-04-23"
    }
  ],
  "attendance": { "2026-04-23": { "abc123": "P" } },
  "overtime":   { "2026-04-23": { "abc123": 2 } },
  "adjustments": [
    { "id": "x1", "staffId": "abc123", "ym": "2026-04", "type": "advance", "amount": 2000, "note": "Festival", "createdAt": "..." }
  ],
  "settings": {
    "workingDaysPerMonth": 26,
    "language": "en",
    "role": "owner",
    "workerId": null
  }
}
```

Statuses: `P` = Present, `A` = Absent, `H` = Half-day, `L` = Leave (paid).
Adjustment types: `advance`, `bonus`, `deduction`.

## Roadmap

- **Worker PIN** — lock worker mode so staff can't flip back to owner
- **Cloud sync + auth** — multi-device with Supabase or Firebase
- **Face attendance** — on-device face check-in with liveness detection
- **Compliance pack** — PF / ESI / PT / TDS reports (India-specific)
- **Fintech layer** — UPI payouts, salary advances, insurance
- **AI copilot** — anomaly detection, attrition risk, smart scheduling
- **More languages** — Gujarati, Bengali, Kannada, Malayalam, Punjabi, Odia
- **React + Vite rewrite** — once product shape is frozen
