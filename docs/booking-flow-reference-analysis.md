# RESQ Nepal — Booking-flow reference analysis (inDrive screenshots)

**Inspected:** 2026-10-19
**Source archive:** `/Users/manjilbhandari/Downloads/iloveimg-compressed.zip`
**Actual contents:** the archive holds **5 JPEG screenshots** (739 × 1600 px, "WhatsApp Image
2026-10-19 at 00.36.1x"), **not a GIF**. All five were opened and reviewed pixel-by-pixel at
full resolution.

The screenshots show **inDrive (dark theme) being used in Kathmandu**. They are used strictly as
an **interaction-pattern reference** — no inDrive branding, colors, typography, iconography or
visual styling is copied into RESQ Nepal. RESQ keeps its own red-and-white design system,
components and map.

## 1. What each screenshot shows

| # | File | Screen | Key elements observed |
|---|------|--------|------------------------|
| 1 | `…00.36.16.jpeg` | Home, map-first | Full-bleed map; floating menu bubble (top-left) and layers button (top-right); floating pickup pill ("Pickup point · Chunikhel Marg ›") over the map; bottom panel with a vehicle-category icon row (icon, name, seats), one search field **"Where to & for how much?"**, then a recent-destinations list (clock icons). |
| 2 | `…00.36.17.jpeg` | "Enter your route" destination sheet | From row ("Chunikhel Marg"); To row highlighted with clear (×) and "pin on map" buttons; tabs **Search Results / Suggested / Saved**; result rows with the matched substring highlighted, address line, distance ("3.5km") and a bookmark save action; keyboard open. |
| 3 | `…00.36.17 (1).jpeg` | Route preview + category choice | Top summary card with pickup row + destination row ("~16 min"); route polyline drawn between pickup and destination markers; "High demand — fare is higher" banner; **vertical** category rows (icon, name, capacity + ETA, subtitle, price in NPR) with one row highlighted; bottom bar: cash badge + big "Find a driver" CTA + filters icon. |
| 4 | `…00.36.17 (2).jpeg` | Searching for drivers | Countdown (1:58); "All drivers verified"; progress bar; **fare stepper** (NPR 136 with − / +); "More offers at NPR 190" chip; disabled "Confirm"; "High demand. Fewer drivers nearby — longer wait time" card; "Auto-accept an offer…" toggle; "NPR 136 Cash" row. The map above shows the pickup pin with a translucent **search-radius disc**. |
| 5 | `…00.36.18.jpeg` | Offering your fare (expanded sheet) | "3 drivers are viewing your request" with driver avatars; countdown 1:54; "6 drivers nearby"; the same fare stepper and cards; route summary rows; "Cancel request" button. |

## 2. Reference interaction → RESQ Nepal mapping

| Reference pattern | RESQ Nepal implementation | Status |
|---|---|---|
| Map-first home with floating pickup pill | `HomeScreen`: full-bleed map, floating compact sheet with pickup row (green P marker) | Already implemented (this task's Step 1 rework) |
| One field for "where & how much" | Destination row ("Tap to search hospital or destination"). A user-proposed fare is **not supported by the backend**, so no fare entry is shown — see `known-limitations.md` §11 | Partial, by design |
| "Enter your route" search sheet (From/To, Saved) | Existing `LocationSearchScreen` (pickup/destination modes) over the **real hospital directory**, saved hospitals/places, recents | Reused as-is |
| Route preview with summary card and drawn route | `HomeScreen` draws both **real** markers and an "Approx. X km straight line" meta line when both coordinates are real. There is no routing engine, so no route geometry or ETA is invented | Implemented honestly |
| Category selection (reference is a vertical list) | The task specifies **two side-by-side RESQ cards** — Patient Delivery (left) and ICU / Emergency (right) — reusing the existing card design; selection is visual (state only) | Implemented |
| "Find a driver" CTA pinned at the bottom | "Find Ambulance" goes **directly** to the map-first searching state (`Processing`) with the full booking payload — no forced explainer or confirmation screen. The pre-existing Service Details → Confirm Booking path remains reachable from the drawer's ambulance list as a secondary flow | Implemented |
| Searching screen keeps the map + panel with status and cancel | `Processing`/`BookingStatus`: **map-first with an expanding radar** centred on the pickup and a compact bottom sheet (route rows, honest “Demo search — no dispatch server is contacted” copy, cancel). Live rows are polled every 8 s **only while the screen is focused**; the demo timeline is labelled “Sample:” and pauses when unfocused | Implemented (this change) |
| Fare stepper, "More offers", auto-accept toggle, viewer avatars, countdown | No backend support (no `offered_fare` column, no offer statuses, no viewer counts, no countdown semantics). Nothing is faked; the former demo-only fare preview card was **removed entirely** on 2026-10-19 — see `known-limitations.md` §11 | Removed — documented gap |
| Live moving vehicle markers on the map | No driver-side location loop exists yet. The `trip_locations` table, RLS policies and typed service exist but currently have no callers, and Realtime is not enabled on the table. Trip maps show only real pickup/destination markers, labelled as straight-line previews | Not live — `known-limitations.md` §12 |
| "Cancel request" inside the sheet | `BookingStatusScreen` bottom bar "Cancel request" — real cancel for live bookings, local cancel for demo | Reused as-is |

## 3. Deliberately NOT copied

- inDrive branding: logo, dark theme, colors, typography, iconography, exact sheet shapes.
- Countdowns, surge banners, "drivers viewing" avatars, auto-accept toggles and "More offers"
  chips — every one of them would require backend data that does not exist.
- Any user-proposed fare submission (would need schema + offer-status machinery, §11).

## 4. Outcome

The adopted patterns are: map-first booking, floating pickup/destination entry, real-marker
route context at every booking stage, compact two-card category selection, direct entry into a
map-dominant searching state with an honest radar, and explicit cancellation. Everything else in
the reference was either already present in RESQ Nepal or is honestly documented as a backend gap;
no countdown, surge, viewer, offer, ETA or live-tracking element is fabricated.
