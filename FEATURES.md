# PayBox — Features

PayBox is a mobile-first **staff & payroll app for small businesses**. It runs
as a Progressive Web App (installable on any phone) and ships as a native
iOS / Android app via [Capacitor](NATIVE.md). The entire web app is a
**single HTML file** — no bundler, no backend required, everything works
offline.

This document lists every user-facing feature. For developer docs see
[`README.md`](README.md), [`CLOUD_SYNC.md`](CLOUD_SYNC.md),
[`NATIVE.md`](NATIVE.md), and [`TESTING.md`](TESTING.md).

---

## Table of contents

- [Attendance](#1-attendance)
- [Staff management](#2-staff-management)
- [Payroll engine](#3-payroll-engine)
- [Payslips](#4-payslips)
- [Overtime (OT)](#5-overtime-ot)
- [Advances, bonuses, deductions](#6-advances-bonuses-deductions)
- [Loans & EMI](#7-loans--emi)
- [Punch in / punch out](#8-punch-in--punch-out)
- [Shifts & weekly offs](#9-shifts--weekly-offs)
- [Holidays](#10-holidays)
- [Announcements](#11-announcements)
- [UPI payouts](#12-upi-payouts)
- [Reports & exports](#13-reports--exports)
- [Dashboard & analytics](#14-dashboard--analytics)
- [Worker mode](#15-worker-mode)
- [PIN lock & audit log](#16-pin-lock--audit-log)
- [Cloud sync (multi-device)](#17-cloud-sync-multi-device)
- [Platform & UX](#18-platform--ux)
- [Feature matrix at a glance](#feature-matrix-at-a-glance)

---

## 1. Attendance

One-tap daily attendance for every staff member, with four statuses and
live calendar navigation.

| Status | Code | Meaning                                                             |
| ------ | :--: | ------------------------------------------------------------------- |
| Present | `P` | Counted as a full working day                                       |
| Absent  | `A` | No pay; counted toward absentee / chronic-absence reports           |
| Half    | `H` | Half-day pay                                                        |
| Leave   | `L` | Paid leave                                                          |
| Off     | `WO` | Weekly off (auto; see [Shifts & weekly offs](#9-shifts--weekly-offs)) |
| Hol.    | `HOL` | Holiday (auto; see [Holidays](#10-holidays))                       |

**Details**
- **Bulk-mark all Present** in one tap for the current day.
- **Date navigation** — previous / next day arrows, plus a calendar picker
  for any historical date.
- Auto-shows a subtle "Today" badge and greys out future dates.
- **Chronic absentee detector** — top 3 staff ranked by absences this month
  appear on the Home dashboard so you can follow up.

---

## 2. Staff management

Full CRUD for employees with optional photo, role, and contact info.

- **Add / edit / delete** employees from the Staff tab or the floating
  action button.
- Per-employee fields: **name, role, phone, employee code, UPI ID,
  joining date, profile photo**.
- **Salary type**: monthly or daily-wage.
- Optional **custom OT rate** per employee (else the formula below
  applies).
- Optional **assigned shift** — drives the weekly-off calculation.
- **Photo capture** via phone camera (native Capacitor camera on iOS /
  Android, HTML5 `input[capture]` on the web). Images are compressed to
  ≤ 320 px JPEG (≈ 15 kB) before storage.

---

## 3. Payroll engine

Deterministic per-month calculation, no surprises.

```
Net pay =  Base pay
        +  OT pay
        +  Bonus           (+ any "bonus" adjustment)
        +  Incentive
        -  Advances        (any "advance" adjustment)
        -  Deductions      (any "deduction" adjustment)
        -  Loan EMI        (auto, if an active loan exists)
```

- **Base pay**
  - *Monthly staff:* `salary × effectiveDays / workingDaysPerMonth`.
  - *Daily staff:*   `dailyRate × effectiveDays`.
  - `effectiveDays = P + 0.5 × H + L + paidHolidays + paidWeeklyOffs`.
- **Working days per month** is a Settings value (default 26).
- **Month picker** on Payroll + Payslip — scroll back through any
  historical month and the calculation auto-recomputes.
- All monetary values are rounded to the nearest rupee and formatted in
  Indian grouping (`₹1,50,000`).

---

## 4. Payslips

A print-ready payslip per staff per month.

- Breakdown: effective days, base pay, OT hours × OT rate, every
  adjustment, loan EMI, and the final Net Payable.
- **Share** button → native share sheet (iOS / Android) or
  WhatsApp / email on the web.
- **Print / save as PDF** — opens a print-optimised page with your
  business name, address, UPI QR code, and signature block.
- **Inline adjustments** — add an advance / bonus / deduction directly
  from the payslip with a note; it's recorded against that month.
- **UPI Pay** chip (see [UPI payouts](#12-upi-payouts)) starts a real
  bank-to-bank payment flow for the net amount.

---

## 5. Overtime (OT)

Per-day, per-staff OT hours feed directly into the monthly payroll.

- Tap **Add OT** on any attendance row → enter hours.
- If the staff has an **OT rate** set on their profile, it's used.
- Otherwise OT rate defaults to **1.5 × hourly rate**, where hourly =
  - *Monthly staff:* `salary / workingDaysPerMonth / 8`
  - *Daily staff:*   `dailyRate / 8`
- Summary per month appears on Payroll + Payslip. Entering `0` removes
  the OT entry.

---

## 6. Advances, bonuses, deductions

Arbitrary per-month money-moves alongside base salary.

- **Advance** — money lent to the employee; subtracted from this month's
  net pay.
- **Bonus** — extra payout, any reason (festival, performance, etc.);
  added to net pay.
- **Deduction** — one-off reductions (damage, tardiness, uniform cost);
  subtracted from net pay.
- Each adjustment has a **note** so the payslip shows *why*. They're
  tied to a specific `YYYY-MM`; removing an advance / bonus reverses it
  instantly.

---

## 7. Loans & EMI

For longer-running money-owed-to-the-business scenarios, loans are
first-class citizens (separate from one-off "advance" adjustments).

- Create a loan with **principal, monthly EMI, start month**, and an
  optional note.
- The EMI is auto-deducted from every monthly payslip until the
  outstanding reaches zero, at which point the loan closes.
- The Home dashboard surfaces **total outstanding loans** across all
  staff.
- A per-staff loan list appears in the staff form with close / edit
  affordances.

---

## 8. Punch in / punch out

Track actual hours worked per day.

- Each staff can have multiple **punches** (in + out pairs) per day.
- Total worked-hours for the day is shown next to the attendance row.
- The UI flags mismatches (unclosed pair, total < shift duration, etc.).
- Useful for cross-checking attendance and feeding OT calculations
  manually.

---

## 9. Shifts & weekly offs

Define shift templates so weekly offs roll up automatically.

- Create shifts in Settings (e.g. "Day shift: Mon–Sat, 9 AM – 6 PM").
- Assign a shift to each staff member.
- Days marked as **weekly off** in the shift show `WO` on attendance and
  count as **paid** for monthly staff (common Indian convention) and
  **unpaid** for daily-wage staff. Daily-wage weekly offs simply don't
  add to base pay.
- Each staff's monthly payslip shows `wo` (weekly offs) and `hol` (paid
  holidays) next to effective days so you can audit the roll-up.

---

## 10. Holidays

A simple business-wide holiday calendar.

- Add company holidays by date (e.g. Independence Day, Diwali).
- On the attendance screen, holiday dates display a yellow `HOL` chip.
- Monthly staff get a **paid holiday** credit for each holiday; daily
  staff don't (configurable by just not marking it, or marking it `P`).
- Holidays automatically flow into the payroll calculation — no manual
  entry per staff.

---

## 11. Announcements

Pinned messages that show on every worker's Home screen.

- Create an announcement from Settings → Announcements.
- Preview on Owner Home; full list visible to workers.
- Supports a title + body and a timestamp. Latest appears at the top.
- Ideal for salary-day notices, holiday schedules, or policy changes.

---

## 12. UPI payouts

Pay staff directly from their payslip.

- Add the staff member's **UPI ID** (e.g. `ramesh@okicici`) on their
  profile.
- Open the payslip → **UPI Pay** chip → shows a QR code and a
  tap-to-open `upi://pay?...` deep link.
- On a phone, the link opens Google Pay / PhonePe / Paytm / any UPI app
  with the payee, amount, and "Salary – <month>" note pre-filled. The
  user just approves the transaction.
- Works with any UPI-compliant app and any Indian bank.
- Works in browser, PWA, and native shells alike.

---

## 13. Reports & exports

Everything can leave the app, in the format you need.

- **Attendance CSV** — Settings → Export attendance. Columns: staff, day
  1 … N statuses, plus monthly totals (P / A / H / L / OT / WO / HOL).
- **Payroll CSV** — Settings → Export payroll. Columns: staff, code,
  role, UPI, type, rate, effective days, base, OT, bonus, incentive,
  advance, deduction, loan EMI, net payable. Trailing TOTAL row.
- **Payslip PDF** — per-staff printable PDF (via browser print). Bundles
  business name, address, UPI QR, and signature block.
- **Excel workbook (.xlsx)** — Home → Export data. Single file with one
  sheet per data type (Staff, Attendance, Punches, Adjustments, Loans,
  Payroll for the current month, Holidays, Announcements, Settings).
  Opens directly in Excel, Google Sheets, or Numbers. SheetJS is
  lazy-loaded from a CDN on first export so the rest of the app stays
  light; if the device is offline the export silently falls back to a
  full **JSON backup** so no data is ever lost.
- **JSON backup** — automatic offline fallback for the Excel export, and
  the format used for full re-import / restore on another device.

---

## 14. Dashboard & analytics

The Home screen is an at-a-glance health board for the business.

- **Monthly payroll estimate** — sum of all net payables this month.
- **Present today** / **Absent today** counts.
- **Top absentees (chronic)** — top 3 staff by monthly absences with a
  badge.
- **Total outstanding loans** across all staff.
- **30-day pay trend** — lightweight SVG line chart of daily net payout.
- **Role distribution** — SVG bar chart.
- Everything recalculates live as you edit attendance, staff, or
  adjustments.

---

## 15. Worker mode

A read-only view that makes PayBox safe to hand to an employee.

- Switch via Settings → Mode → **Worker** → pick a profile.
- The app reloads with a bottom tab bar showing **Home / Attendance /
  Payslip** — all scoped to that single person.
- Workers can see:
  - Their own attendance calendar (month grid) + OT hours per day.
  - Their own payslip for any month.
  - Their outstanding loans, advances, and current-month earnings.
  - Pinned announcements.
- Workers **cannot** edit anything — every mutation endpoint is hidden
  or no-ops.
- Coming back to Owner mode: tap the **Worker** chip at the top right →
  Settings → Mode → Owner. Gate this with [PIN lock](#16-pin-lock--audit-log)
  to prevent staff from flipping back.

---

## 16. PIN lock & audit log

Security for shared devices.

- **PIN lock** — Settings → Lock. A 4-to-8 digit PIN is hashed with
  SHA-256 (Web Crypto API) before storage.
- When enabled, the app shows a lock screen on every cold start.
- An incorrect PIN lets you retry unlimited times (the app is
  offline-first, so lockout is enforced by the device, not the app).
- Works on `https://` and `localhost` (Web Crypto requirement).
- **Audit log** — Settings → Audit log. Records every material action:
  staff add/edit/delete, attendance mark, payslip share, CSV export,
  cloud push/pull, PIN change, etc. Each entry has an ISO timestamp and
  a short JSON payload.

---

## 17. Cloud sync (multi-device, owner ↔ worker real-time)

Optional Supabase-backed sync with two tiers:

- **v1 (single-account)** — one owner using PayBox on two phones or a
  tablet. A single JSON blob per user, debounced push on save.
- **v2 (business-scoped)** — **multiple devices, multiple users, live
  both directions.** The owner creates a *business*, shares a 6-character
  **join code** with staff, and each worker signs in on their own phone
  with their own account. Every punch / attendance / announcement
  propagates to every device within ~1–2 seconds. This is how PayBox
  answers "who has checked in today?" on the owner's Home screen
  without anyone refreshing anything.

**Capabilities**

- **Zero-config local-first** — the app works 100% offline; cloud sync
  is an opt-in toggle, not a requirement.
- **Your own Supabase project** — configure your `url` + `anonKey` in
  Settings → Cloud sync. You stay in full control of the data (see
  [CLOUD_SYNC.md](CLOUD_SYNC.md)).
- **Email + password** or **magic link** auth for owners; **phone + invite
  code, no password, no SMS** for workers (uses Supabase anonymous
  sign-in under the hood — zero per-login cost).
- **Per-staff invite codes** — when the owner adds a new staff record
  the app instantly mints a one-shot 8-character invite code and offers
  Copy / Share / Rotate / Revoke. The owner sends `code + worker.html
  link` to the worker over WhatsApp / SMS. The worker opens the link,
  enters their phone number + the code, and is **immediately a full
  worker member mapped to that staff record** — no manual approval, no
  email signup, no SMS. The phone number is seeded onto the staff
  record via a `staff_update` event so it appears live on the owner's
  staff list. Codes are one-shot (revoked the moment they're used) and
  rotatable in one tap if a worker loses their phone.
- **Legacy 6-character business join code** (with owner approval) is
  still supported as a fallback for owners who prefer the old flow.
- **Role-aware RLS** — Postgres Row-Level Security enforces that only
  the owner can edit `config`, and workers can only append events for
  their own mapped staff. No client-side honour system.
- **Config + events split** — low-churn settings (staff list, shifts,
  holidays) live in `businesses.config` (owner-writable); high-churn
  actions (punch in/out, selfie, attendance, OT) stream through an
  append-only `events` table that every member subscribes to.
- **Two realtime channels** (`businesses` + `events`) per business,
  filtered by `business_id`. A green **Live** badge shows on Home and
  Cloud sync when subscribed.
- **Home check-ins strip** — owner sees a live "X / N checked in today"
  list with green-pulsing dots, arrival times (`9:02 · 12 min ago`) and
  a one-tap "Mark P" for anyone still missing.
- **Optimistic + offline queue** — punches taken offline are saved to
  `localStorage.biz.pendingWrites` and flushed on reconnect (retried
  every 15 s). Local UI updates instantly; the server is caught up
  whenever the network allows.
- **Idempotent event fold** — each event carries canonical identifiers
  (`staff_id`, `date`), and the client cursor (`lastEventId`) skips
  already-applied rows; applying the same event twice is safe.
- **Auto-migration on first business create** — the owner's existing
  local data (staff, attendance, loans, …) is uploaded into the new
  business row in a single RPC call. No manual export / import.
- **Last-write-wins** for config using a monotonic `updated_at`
  millisecond epoch; events are append-only and therefore never clash.
- **Magic-link deep links** route cleanly back into the native iOS /
  Android shell via `capacitor://localhost` and `paybox://auth/callback`
  URL schemes.
- **First-run welcome / login screen** — on first launch PayBox shows a
  full-screen role picker:
  - **I'm an Owner** → enter email + password + business name → sign up
    and instantly create a business (join code generated for you).
  - **I'm a Worker** → two sub-flows:
    - **First time** (has invite code): tap "First time? I have an
      invite code" → enter phone + invite code → instantly mapped to
      the right staff record. The invite code is one-shot proof of
      identity. The phone is stored on `members.phone` for future
      reconnect.
    - **Returning** (default): enter phone number only → tap "Sign in"
      → the app calls `reconnect_worker_by_phone(phone)` which finds
      the existing `members` row, re-links it to a new anonymous
      session, and restores the worker's business association. No
      invite code needed on subsequent logins.
  - **Use offline** → skip cloud entirely and use PayBox locally (data
    stays on this device).

  Returning owners on a new device simply pick their role and sign in —
  PayBox discovers their existing business membership automatically
  (querying the `members` table) and hydrates their state without
  creating a second business.

- **Worker self-service profile** — after signing in, the worker home
  screen exposes a **My profile** sheet where they can set / edit their
  name, phone, and a selfie photo. Each edit emits a `staff_update`
  event scoped to their own staff_id (RLS-enforced) and propagates to
  the owner's staff list within ~1–2 seconds.

- **Dedicated `worker.html` and `owner.html` entry pages** — share
  `…/worker.html` with staff (or pin it to their phone home screen) and
  the role picker is skipped entirely: the device is locked to the
  worker login flow, with a green theme, a "STAFF" badge on the form,
  no "use offline" escape hatch, and sign-out returns to the worker
  login (not the role picker). A symmetric `owner.html` exists for the
  owner's primary device. The lock is implemented as `?role=worker`
  on `index.html`, so any deep-link works the same way. Owners can copy
  / share the worker URL from **Settings → Cloud sync** with one tap
  (uses the native share sheet on iOS / Android, clipboard on web).

- **Logout** is exposed prominently at the top of Settings (with a
  role-aware confirmation. Workers can sign back in using just their
  phone number — no new invite code needed).

- **Push notifications** — when running as a native app (iOS / Android),
  the owner's device registers for push notifications via FCM / APNs.
  Whenever a worker punches in or out, a Supabase Edge Function
  (`notify-punch`) fires and delivers a system notification to the
  owner — even when the app is in the background or closed. Example:
  *"Ramesh punched in at 9:02 AM"*. Requires a one-time Firebase
  project setup (see [CLOUD_SYNC.md](CLOUD_SYNC.md)). On the web
  (PWA), the same events show as in-app toasts via the realtime
  WebSocket — no Firebase needed.

---

## 18. Platform & UX

PayBox is deliberately built to feel great on a cheap Android phone with
a spotty connection — the target user.

- **Mobile-first UI** with Tailwind CSS (CDN) and Inter / Noto Sans
  type (Devanagari, Tamil, Telugu included). Card-based home screen,
  bottom-sheet flows for every edit.
- **PWA-installable** with maskable icons, Apple-touch icons,
  categories, screenshots, and shortcuts in the manifest so Play Store
  listings and iOS home-screen installs look polished.
- **Service worker** with stale-while-revalidate caching so the app
  opens instantly and works fully offline. Auto-updates via cache
  versioning — users pick up the latest build on their next launch.
- **Native shell** (Capacitor) bundles the same code into an iOS + Android
  app:
  - Safe-area insets respect the notch / Dynamic Island / gesture bar.
  - Android hardware **Back** closes sheets first, then exits.
  - Native **share sheet**, **camera**, **filesystem** (CSVs saved to
    Documents), and **preferences** (mirrors `localStorage` so WKWebView
    purges can't eat your data).
  - Splash screen + theme-coloured status bar.
- **5 languages out of the box** — English, हिन्दी, मराठी, தமிழ்,
  తెలుగు. Switchable live from Settings; every string falls back to
  English if a translation is missing.
- **Keyboard + touch accessibility** — focus rings, ≥ 44 pt tap
  targets, `aria-label` on icon-only buttons, RTL-aware chevrons.
- **Deterministic state** — state lives in `localStorage` under
  `paybox_v2` (with one-time migration from older `mybox_v2` / `mybox_v1`); a `migrate()` function brings forward older shapes so an
  existing user never sees "reset" on an upgrade.
- **Demo data** — Settings → Load demo data (or `?demo=1` in the URL)
  seeds a realistic "Kamal Dairy Farm" dataset: 10 staff, 30 days of
  attendance, loans, advances, holidays, shifts, announcements, audit
  logs. Great for showing the app without typing a thing.
- **Zero build step** — every feature above lives in one HTML file +
  one service worker + one manifest + one SVG. Copy the folder, open
  `index.html`, and it runs.

---

## Feature matrix at a glance

| Area           | Feature                                   | Free / local                                                 | Cloud needed | Native needed |
| -------------- | ----------------------------------------- | :----------------------------------------------------------: | :----------: | :-----------: |
| Attendance     | P / A / H / L + bulk mark + date nav      | ✓                                                            |              |               |
| Attendance     | Weekly offs + holidays                    | ✓                                                            |              |               |
| Attendance     | Punch in / out                            | ✓                                                            |              |               |
| Staff          | Add / edit / delete with photo            | ✓                                                            |              |               |
| Payroll        | Monthly calc + month picker               | ✓                                                            |              |               |
| Payroll        | Overtime (custom rate or 1.5×)            | ✓                                                            |              |               |
| Payroll        | Advances / bonuses / deductions           | ✓                                                            |              |               |
| Payroll        | Loans + auto EMI                          | ✓                                                            |              |               |
| Payslip        | Share (WhatsApp / native sheet)           | ✓                                                            |              |               |
| Payslip        | Print / PDF with UPI QR                   | ✓                                                            |              |               |
| Payslip        | UPI Pay (deep link)                       | ✓                                                            |              |               |
| Reports        | Excel (.xlsx) / Attendance CSV / Payroll CSV / JSON | ✓                                                            |              |               |
| Reports        | Save CSV to iOS Files / Android Documents | ✓                                                            |              | ✓             |
| Dashboard      | Charts, top absentees, loan total         | ✓                                                            |              |               |
| Announcements  | Pinned messages for workers               | ✓                                                            |              |               |
| Worker mode    | Per-staff read-only view                  | ✓                                                            |              |               |
| Security       | PIN lock (SHA-256)                        | ✓                                                            |              |               |
| Security       | Audit log                                 | ✓                                                            |              |               |
| Multi-device   | Push / pull / realtime sync               |                                                              | ✓            |               |
| Multi-device   | Push notifications (punch in/out)         |                                                              | ✓            | ✓             |
| Multi-device   | In-app toast (punch in/out, PWA too)      |                                                              | ✓            |               |
| Multi-device   | Magic-link auth                           |                                                              | ✓            |               |
| Languages      | EN / HI / MR / TA / TE                    | ✓                                                            |              |               |
| Platform       | PWA install, offline, auto-update         | ✓                                                            |              |               |
| Platform       | iOS App Store / TestFlight                |                                                              |              | ✓             |
| Platform       | Google Play Store / Internal Testing      |                                                              |              | ✓             |
| Platform       | Deep-link back from Supabase email        |                                                              | ✓            | ✓             |

---

## What's NOT in PayBox (yet)

Explicit non-goals so expectations stay clear:

- Multi-business login (one owner = one business today).
- Face / fingerprint check-in with liveness detection.
- Statutory reports (PF / ESI / PT / TDS) — India-specific; planned.
- In-app salary advance / lending (fintech layer) — planned.
- AI copilot for anomaly / attrition insights — planned.
