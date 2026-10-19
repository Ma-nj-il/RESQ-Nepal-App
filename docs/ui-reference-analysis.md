# RESQ Nepal — UI reference analysis (10-screen flow board)

> **Status:** implemented and verified in Round 7 — see
> `docs/ui-refinement-report.md` §15 for what changed, files, tests and the documented
> deviations.

**Inspected:** 2026-10-19
**Primary reference:** `/Users/manjilbhandari/Downloads/RESQ Nepal Ambulance App Flow (1).png`
(1214 × 1295 px) — the 10-screen RESQ Nepal flow board (white/red brand) with a
feature legend, UI-component list, backend checklist and key notes.
**Secondary (composition only):** `docs/reference-2026-10-19/` — 5 WhatsApp JPEGs
(739 × 1600 px) showing inDrive (dark theme) in Kathmandu. These are interaction
references only; RESQ keeps its red-and-white identity and does **not** copy
inDrive branding, dark theme, colours, or typography. The five JPEGs are analysed
in `docs/booking-flow-reference-analysis.md`.
**Derived inspection crops:** `docs/reference-2026-10-19/board-crops/stepN-raw.png`
and `stepN-2x.png` — per-screen crops of the board produced with `sips` so each
phone mockup could be opened and reviewed at 2× zoom. No GIF exists; the archive
`/Users/manjilbhandari/Downloads/iloveimg-compressed.zip` contains only the five
JPEGs above.

Everything below was taken from actually opening the images, not filenames.

---

## 1. Screen-by-screen reference notes

### Step 1 — Home / map-first booking → `HomeScreen.tsx`
- Regions: status bar (~4%); top bar with hamburger (left), brand logo + “RESQ Nepal”
  wordmark (centre), red SOS pill (right) (~6%); full-bleed map behind (~55% visible);
  bottom sheet (~45%) with rounded top corners, drag handle.
- Sheet contents (top → bottom): “Your location / Lalitpur, Nepal” row (green pin in
  a soft circle, chevron right); “Where to? / Teaching Hospital, Kathmandu” row (red
  pin circle, chevron); two category cards side by side — icon on top, bold title,
  small grey parenthetical (“(Non-Emergency)” / “(Critical Care)”); full-width red
  “Find Ambulance →” pill.
- Map: blue current-location dot with halo, one red destination pin, city labels.
- Interaction: tap either row to edit pickup/destination; tap a card to select a
  category; tap the CTA to route/preview.
- **Product decision applied:** the board’s centre branding is explicitly excluded by
  the task (“remove the unnecessary central/top header branding”); the app keeps
  hamburger + compact SOS only.

### Step 2 — Destination search → `LocationSearchScreen.tsx`
- Regions: slim top row with a back chevron (no header title); full-width rounded
  search field; tab row “Hospitals | Saved | Recent” (active tab red with a red
  underline bar); list of hospital rows; “Choose from map” row pinned at the bottom
  in a light grey rounded container.
- Row anatomy: ~40 px squircle icon (light blue-grey bg, hospital glyph);
  bold dark name; grey address line; right-aligned distance (“2.4 km”) and a light
  chevron. Five hospitals shown: Teaching, Bir, Grande, Norvic, Mediciti.
- Interaction: typing filters; tabs switch source lists; tapping a row sets the
  destination (the app also supports pickup mode); “Choose from map” opens manual
  pin selection.
- **Honesty notes:** distances in the mockup are illustrative — the app computes the
  real straight-line distance from the current pickup. Phone numbers were dropped
  from rows to match the layout (and keep contact hygiene). Sample/demo rows keep
  their “not live records” note. Backend for “Choose from map” is device GPS +
  reverse geocode only (no new tables).

### Step 3 — Route preview & category → `HomeScreen.tsx` (route state)
- Regions: map (~48%) with a white circular back button top-left, green start marker
  labelled “Your Location”, red destination pin labelled with the hospital name,
  straight-ish route line; sheet: two-column location summary (green pin + “Your
  location / Lalitpur, Nepal” | chevron | red pin + destination) with a centred
  “Approx: 5.2 km (straight line)” caption; divider; “Select Ambulance Type” section
  label; two category cards each with icon on top, bold title, “Starting from”,
  and a coloured price (blue “Rs. 1,200” / red “Rs. 2,500”); red “Find a Driver →”
  pill.
- **Honesty notes:** the app labels the same CTA “Find Ambulance →” (existing product
  vocabulary kept; flows anchor on it). Prices come from the real rate card
  (`src/constants/fares.ts`): starting prices NPR 1,500 (Patient Delivery) and
  NPR 3,500 (ICU) — the mockup’s numbers are replaced with real, documented values.
  Distance stays explicitly labelled “straight line”; no road ETA is invented.

### Step 4 — Finding a driver / searching → `BookingStatusScreen.tsx` (pending)
- Regions: map (~50%) with back circle + “•••” button and a translucent red search
  radius circle; bottom sheet: handle; red cross in a soft circle + red bold
  “Searching for driver…”; grey explainer; “Search radius / 5 km” slider; grey
  “This may take a few moments…” pill; a light row “Searching for driver •
  Assigned to you • Real-time” with an expand chevron.
- **Honesty notes (important):** the app does **not** render a search-radius slider,
  a radius value, a countdown, or an “Assigned to you • Real-time” claim — none of
  those are backed by the backend (requests are read once per mount in real mode;
  the demo timeline is in-memory). The app keeps the map visible above a compact,
  scrollable status sheet, shows the real booking status, and keeps its existing
  explicitly-labelled fare-offer preview (“Offering your fare”, “Nothing is sent or
  saved.”) beneath the fold. A static, honest “This may take a few moments…” note is
  carried over.

### Step 5 — Assigned driver & ambulance → `BookingStatusScreen.tsx` (assigned)
- Regions: white background, no map: green check + bold “Booking Confirmed” +
  “Your ambulance is on the way”; driver card (avatar, name, “Driver”, green
  “Verified” pill); vehicle card (ambulance icon, plate, “Ambulance Vehicle”,
  “Type: ICU” pill); two buttons — red “Call Driver” and outline “Track Ambulance”;
  two ⓘ footnotes about the phone number; “Trip Details” section with From/To rows
  joined by a dotted connector.
- **Honesty notes:** “Verified” renders only if the database confirms it; the plate
  and driver name come from the owner-scoped `get_assigned_crew` lookup (RPC not yet
  deployed — the app falls back to the booking’s own row and shows a neutral
  “assigned crew” state). Demo mode uses the clearly-labelled fictional sample crew.
  The phone number is never rendered — it is only handed to the native dialer.
  The mockup’s ⓘ lines are reproduced for real bookings (“Driver’s phone number is
  not shown.” / “You can call directly using the button above.”). The app keeps its
  straight-line map card, timeline, cancel contract and demo notes below the fold.

### Step 6 — Live tracking → `TripTrackingScreen.tsx`
- Regions: map (~55%) with a white back circle; sheet: green tinted banner
  (pin icon + green bold “Ambulance is on the way” + grey “Arriving in ~ 12 min •
  4.8 km”); driver card (avatar, name, “Driver”, Verified); vehicle row (ambulance
  icon, plate, “ICU Ambulance”); red “Call” + outline “Track” buttons.
- **Honesty notes:** driver-side GPS publishing and patient-side consumption are
  **not** implemented end-to-end, so the app does not simulate a moving ambulance
  and never shows an ETA or live distance. The banner shows the real booking status
  and an explicit “no live vehicle location in this version” note (demo: a sample
  trip note). The secondary button is the real “Share trip summary” instead of a
  “Track” action that could not work. Call uses the same native-dialer path as
  Screen 9 (assigned crew lookup → `tel:`; demo → no-call alert).

### Step 7 — Booking in progress (status updates) → `TripTimeline` (shared component)
- Regions: white screen; vertical stepper with 6 rows: completed steps = green
  filled circles with a white check + dark labels (+ grey time); active step = red
  filled circle with icon + red bold label; pending steps = light grey circles with
  grey icons/labels; thin grey connector; bottom summary card with driver name,
  Verified pill, vehicle plate and category.
- **Honesty notes:** per-step timestamps are not stored by the backend, so the app
  intentionally omits times for real bookings (the demo walkthrough shows order
  only, never fake clock times). Labels follow the app’s existing status model.
  The stepper lives inside the scrollable Booking Status / active-trip sheets so the
  map stays visible above — no duplicate booking screens are introduced.

### Step 8 — Trip completed (rating) → `RatingScreen.tsx`
- Regions: centred green circle with white check; bold “Trip Completed”; grey
  “Thank you for using RESQ Nepal!”; light card with “Rate your driver”, 5 large
  stars, and an “Add a comment (optional)” box; full-width red “Submit”; grey
  “Skip” text link.
- Interaction: tap a star (required), optional chips/comment, submit → thank-you
  state; Skip closes.
- **Honesty notes:** the app keeps its real behaviour and selectors (star labels,
  comment persisted through `ratingsService`, skip). The mockup’s fare summary is
  not part of this screen — the final fare stays on the trip receipt/tracking
  screens where the stored record is shown. “Submit” replaces “Submit rating” and
  the header becomes “Trip Completed” (flows updated accordingly).

### Step 9 — Call driver (native dialer) → existing `tel:` integration
- The ninth image is the **native iOS dialer** (masked +977 number, RESQ Nepal
  label, Mute/Keypad/Speaker, red end-call) — illustrative of the OS surface the
  button opens. No in-app VoIP/WhatsApp screen is built; `tel:` hands the call to
  the device so dual-SIM selection stays with the OS. Missing number or dialer
  failure → graceful alert. Demo → “no call is placed” alert (asserted by flows).

### Step 10 — Menu drawer → `MenuDrawerScreen.tsx`
- Regions: white drawer ~86% width over the dimmed map; brand row (logo + “RESQ
  Nepal” + ✕); profile block (avatar, bold name, “Patient”, “View Profile ›”); plain
  rows with small outline icons — Account, Notifications, Privacy & Security, Saved
  Places, Saved Hospitals, Language & Appearance (“Not live”), Settings, About;
  divider; red Logout row.
- **Notes:** the app keeps its existing row set and exact row labels (real counters
  card, My Trips, Ambulance, Safety & SOS, Become a Driver …) because other flows
  and features anchor on them; the visual treatment (brand row, profile block with
  role, plainer rows, plain red logout) follows the reference. The raw phone number
  is removed from the profile block; the role line reads “Patient”. No icon
  dependency is added — the app’s existing emoji icon language is retained
  (deviation documented in the report).

---

## 2. Shared visual language extracted from the board
- Red `#E53935` (existing `colors.primary`) for CTAs, SOS, active states; soft red
  tint `#FEE2E2` for emergency icon circles/badges.
- Blue accent `#3B82F6` / `#DBEAFE` for Patient Delivery accents (matches board).
- Green `#10B981` / `#D1FAE5` for success, verification and completed steps.
- Surfaces: white cards on `#F8F9FA`; borders `#E5E7EB`; secondary text `#6B7280`.
- Radii: sheets ~20, cards ~12–16, pills 999; buttons ~12, 48–52 px tall.
- Type scale: titles 18–24 semibold/bold; body 14–16; captions 12–13 grey.
- Buttons: full-width red pill CTAs; primary red + outline secondary pairs.
- Emoji/asset icons remain the app’s icon system (no icon font is installed and no
  new dependency is added).

## 3. Missing reference information (explicitly not invented)
- Search-radius mechanics (radius size/position per booking) — no backend support.
- Driver ETA / live distance — requires end-to-end driver GPS publishing.
- Per-status timestamps — not stored by the schema.
- Driver profile photo / verification badges — only rendered when real data exists
  (fictional sample crew is clearly labelled in demo mode).
- “Real-time” status delivery — the app has no realtime/push channel; request
  status refreshes are honest about this instead.
