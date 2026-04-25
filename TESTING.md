# PayBox — Manual Test Checklist

A human-runnable checklist that covers every feature in v0.2. Takes ~10 minutes end-to-end.

For automated tests, see [`tests/README.md`](tests/README.md).

---

## Setup

1. Start the server from `My_Box/`:
   ```bash
   python3 -m http.server 8000
   ```
2. Open http://localhost:8000 in Chrome.
3. Open DevTools → Application → Local Storage → `http://localhost:8000`.
4. If `paybox_v2` (or the legacy `mybox_v2` / `mybox_v1`) exists, delete it (right-click → Delete), then hard-reload the page (⌘⇧R / Ctrl+Shift+R).

---

## 1. App shell

- [ ] **1.1** Header shows "M" logo, "PayBox", and "My Business" as subtitle
- [ ] **1.2** Bottom nav shows 4 tabs: Home, Attendance, Staff, Payroll
- [ ] **1.3** Home tab is active by default (icon + label in brand blue)
- [ ] **1.4** Tapping each nav tab switches the view and highlights the tab
- [ ] **1.5** Gradient "This month payroll" card shows ₹0, 0 staff, 0 present today

## 2. Staff — add, edit, delete

### Add first staff
- [ ] **2.1** Go to **Staff** → tap **+ Add**
- [ ] **2.2** Sheet slides up from the bottom
- [ ] **2.3** Fill: Name `Ramesh Kumar`, Role `Cashier`, Phone `9876543210`
- [ ] **2.4** Salary type **Monthly** is selected by default
- [ ] **2.5** Amount `15000`
- [ ] **2.6** Leave OT rate blank
- [ ] **2.7** Tap **Add staff** → sheet closes, toast "Staff added"
- [ ] **2.8** Staff card shows name, "Cashier · 9876543210", "₹15,000/mo"

### Add a daily-wage staff
- [ ] **2.9** Tap **+ Add** again
- [ ] **2.10** Name `Suresh`, Salary type **Daily wage**, Amount `700`
- [ ] **2.11** Card shows "₹700/day"

### Edit an existing staff
- [ ] **2.12** Tap Ramesh's card
- [ ] **2.13** Sheet pre-fills with existing values
- [ ] **2.14** Change amount to `20000` → **Save changes** → toast "Staff updated"
- [ ] **2.15** Card now shows "₹20,000/mo"

### Delete a staff
- [ ] **2.16** Edit Suresh → tap **Delete** → confirm the browser alert → toast "Staff removed"
- [ ] **2.17** Suresh's card disappears

### FAB
- [ ] **2.18** On Staff tab, a floating blue "+" button shows bottom-right
- [ ] **2.19** FAB opens the same add-staff sheet
- [ ] **2.20** FAB is hidden on Home / Attendance / Payroll

## 3. Attendance

- [ ] **3.1** Go to **Attendance**. Date shows today.
- [ ] **3.2** See Ramesh's row with 4 buttons: Present / Absent / Half-day / Leave
- [ ] **3.3** Tap **Present** → button turns green
- [ ] **3.4** Tap **Present** again → green tint removes (toggled off)
- [ ] **3.5** Tap **Half-day** → amber tint, chip at top-right shows "Half-day"
- [ ] **3.6** Tap **Leave** → switches to sky-blue "Leave" chip

### Bulk mark
- [ ] **3.7** Add 2 more staff (e.g. `A` ₹10000/mo, `B` ₹10000/mo) so bulk has effect
- [ ] **3.8** Tap **All present** → toast "Marked all present", every row turns green

### Date navigation
- [ ] **3.9** Tap the left chevron → date shifts to yesterday
- [ ] **3.10** Tap the right chevron twice → advances to tomorrow
- [ ] **3.11** Tap the date input → pick any date → the marks for that date load

### Overtime
- [ ] **3.12** On Ramesh's row, tap **Add OT**
- [ ] **3.13** Enter `3`, tap **Save** → toast "OT updated"
- [ ] **3.14** Row now shows "OT: 3 h"
- [ ] **3.15** Tap **Add OT** again, set to `0` → OT "—" (cleared)

## 4. Payroll

- [ ] **4.1** Go to **Payroll**
- [ ] **4.2** Dark header card shows current month, total = sum of all staff nets
- [ ] **4.3** Each staff has a card with 4 attendance chips (P/H/L/A counts) + net pay
- [ ] **4.4** Mark Ramesh present every day this month → his net should be ≈ ₹20,000 minus deductions for unmarked days (base = present days × daily rate)

### Month picker
- [ ] **4.5** Change the month selector to a past month (e.g. `2025-01`) → totals recalculate
- [ ] **4.6** Return to the current month → totals correct

### Payslip
- [ ] **4.7** Tap Ramesh's payroll card → payslip sheet opens
- [ ] **4.8** Shows: avatar, name, role, month
- [ ] **4.9** "Net Payable" matches the card
- [ ] **4.10** 4-cell stat grid shows Present / Half / Leave / Absent counts
- [ ] **4.11** Breakdown shows "Base pay"; if OT hours exist, "Overtime (3 h) + ₹xxx"

### Share
- [ ] **4.12** Tap **Share** → system share sheet OR toast "Copied to clipboard"
- [ ] **4.13** Paste somewhere (Notes / WhatsApp) → text is a readable payslip

## 5. Adjustments

From the payslip for any staff:

- [ ] **5.1** Tap **Add adjustment**
- [ ] **5.2** Select **Advance**, amount `1000`, note `Festival` → Save
- [ ] **5.3** "Advances" row appears (rose chip); net is reduced by ₹1000
- [ ] **5.4** Payslip breakdown now shows "Advances − ₹1,000"

- [ ] **5.5** Add a **Bonus** of `500` → "Bonus + ₹500"; net increases by 500
- [ ] **5.6** Add a **Deduction** of `200` → "Deductions − ₹200"; net further reduced

### Remove adjustment
- [ ] **5.7** Tap the ✕ next to the advance → net increases by ₹1000

### Cross-month adjustment
- [ ] **5.8** Add an advance, change "Apply to month" to next month → Save
- [ ] **5.9** Payslip for the current month doesn't show it
- [ ] **5.10** Change month picker to next month → advance appears there

## 6. Worker mode

### Switch to worker
- [ ] **6.1** Open Settings (gear top-right)
- [ ] **6.2** Mode → **Worker**, a profile dropdown appears
- [ ] **6.3** Pick "Ramesh Kumar" → Save
- [ ] **6.4** Amber "Worker" chip appears next to the gear
- [ ] **6.5** Bottom nav has 3 tabs: Home, Attendance, Payslip

### Worker Home
- [ ] **6.6** Greeting says "Hi, Ramesh"
- [ ] **6.7** Blue card shows "This month's pay" with net amount
- [ ] **6.8** Mini stats: Base pay, Overtime, Outstanding this month

### Worker Attendance
- [ ] **6.9** Calendar grid for the month
- [ ] **6.10** Days with status show the letter (P/A/H/L) and color
- [ ] **6.11** Days with OT show a small badge in top-right (e.g. "3h")

### Worker Payslip
- [ ] **6.12** Shows payslip for selected month, same as owner's payslip but read-only
- [ ] **6.13** No "Add adjustment" button (it's owner-only)

### Return to owner
- [ ] **6.14** Tap the **Worker** chip at top-right → Settings → Mode → **Owner** → Save
- [ ] **6.15** Back to 4-tab layout; staff list intact

## 7. Internationalization

Open Settings → Language. For each language:

- [ ] **7.1** **हिन्दी** → tabs show "होम / हाज़िरी / स्टाफ़ / पेरोल"
- [ ] **7.2** **मराठी** → tabs show "होम / हजेरी / कर्मचारी / पगार"
- [ ] **7.3** **தமிழ்** → tabs show "முகப்பு / வருகை / ஊழியர் / ஊதியம்"
- [ ] **7.4** **తెలుగు** → tabs show "హోమ్ / హాజరు / సిబ్బంది / వేతనం"
- [ ] **7.5** **English** → reverts to "Home / Attendance / Staff / Payroll"
- [ ] **7.6** All forms, buttons, toasts also translate when switching
- [ ] **7.7** Date labels translate (e.g. "Thursday, April 23" vs "गुरुवार, 23 अप्रैल")

## 8. Settings

- [ ] **8.1** Change Business name → header subtitle updates
- [ ] **8.2** Change Working days per month to `30` → Payroll recalculates (lower per-day rate for monthly staff)
- [ ] **8.3** Change back to `26`
- [ ] **8.4** Tap **Reset all data** → confirm → app returns to empty state

## 9. Persistence

- [ ] **9.1** Add 1 staff, mark 1 attendance, add 1 adjustment
- [ ] **9.2** Hard-reload (⌘⇧R) → all data still there
- [ ] **9.3** Close tab, reopen → still there
- [ ] **9.4** Check `localStorage.paybox_v2` in DevTools — JSON is valid, contains your data

## 10. Export / backup

- [ ] **10.1** Home → **Export data** tile → file downloads as `paybox-backup-YYYY-MM-DD.json`
- [ ] **10.2** Open the file → valid JSON with staff, attendance, overtime, adjustments, settings

## 11. PWA

- [ ] **11.1** DevTools → Application → Manifest → all fields populated, icon preview shows
- [ ] **11.2** DevTools → Application → Service Workers → `sw.js` is "activated and running"
- [ ] **11.3** DevTools → Application → Cache Storage → `paybox-v1` contains index.html, manifest.json, icon.svg
- [ ] **11.4** In the address bar, a small install icon appears (Chrome/Edge on desktop). Click to install.
- [ ] **11.5** Installed app opens in its own window with icon
- [ ] **11.6** Toggle DevTools → Network → **Offline** → reload → app still loads
- [ ] **11.7** In offline mode, adding staff still works (data saves to localStorage)

## 12. Edge cases

- [ ] **12.1** Add a staff with 0 amount → payroll shows ₹0 cleanly (no NaN)
- [ ] **12.2** Mark attendance for a date in the future → still works; included in that month's totals
- [ ] **12.3** Enter a decimal OT like `1.5` → saved; pay reflects 1.5h × rate
- [ ] **12.4** Delete a staff who had attendance → history stays in `state.attendance` (audit trail), but UI no longer shows them
- [ ] **12.5** Try the Share button on a device without `navigator.share` (desktop) → falls back to clipboard with toast

---

## How to report a failure

If a test fails:
1. Note the number (e.g. "Failed 5.3")
2. Describe what happened
3. Open DevTools → Console tab → copy any red errors
4. Optionally export your data (Home → Export) and attach the JSON
