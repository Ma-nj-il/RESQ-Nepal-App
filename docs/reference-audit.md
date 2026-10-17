# RESQ Nepal — Reference Audit

**Audit date:** 2026-10-17
**Reference source:** `/Users/manjilbhandari/Downloads/iloveimg-compressed.zip` (2.7 MB)
**Extracted to:** `/Users/manjilbhandari/RESQ Nepal App/reference-assets/` (originals preserved, unmodified)

## 1. What was supplied

The ZIP contains **11 PNG screenshots** (not 80–83 standalone files). Each screenshot is a
poster-style composite that shows **multiple phone screens laid out side by side** on a green
background. Counting every phone panel across the 11 composites gives **79 distinct panels**
(3 + 8 × 9 + 4).

The reference application is a ride-sharing app branded **"JoyRide"** (green theme). It is a
Uber/Pathao/inDrive-style product with: onboarding, phone + OTP auth, map home, location search,
driver selection, booking, live tracking, chat/call, ratings, promos, wallet with top-up,
trip history, and a complete account/settings section. The reference contains **no driver-mode
panels** — driver mode in RESQ Nepal was designed by adapting the passenger interaction
patterns to ambulance-driver workflows.

## 2. How the panels are counted

| Screenshot | Panels | Grid |
|---|---|---|
| `19.12.13` | 3 | 3 × 1 |
| `19.14.54` | 8 | 2 × 4 |
| `19.15.05` | 8 | 2 × 4 |
| `19.15.14` | 8 | 2 × 4 |
| `19.15.23` | 8 | 2 × 4 |
| `19.15.31` | 8 | 2 × 4 |
| `19.16.02` | 8 | 2 × 4 |
| `19.16.11` | 8 | 2 × 4 |
| `19.16.19` | 8 | 2 × 4 |
| `19.16.28` | 8 | 2 × 4 |
| `19.16.37` | 4 | 1 × 4 |
| **Total** | **79** | |

The requested "80–83 references" therefore corresponds to these 79 phone panels (alternate
states such as *empty vs. filled* forms are counted as separate panels). There are no
standalone icon/logo/illustration files in the ZIP; all imagery is embedded inside the
composites.

## 3. Reference-to-RESQ adaptation rules applied

1. **Brand:** JoyRide green → RESQ Nepal emergency red (`#E53935`); accent green retained only
   for "success" semantics as permitted by the design system.
2. **Domain:** ride-hailing vocabulary ("ride", "driver", "car") → ambulance vocabulary
   ("ambulance", "driver", "patient transport"). Vehicle cards show ambulance models and
   equipment instead of sedans.
3. **Categories:** the reference's GlideX / Glide XL / Glide Lux tiers map to the two required
   RESQ categories — **Basic Ambulance** and **ICU / Emergency Ambulance**. No third
   user-facing category exists.
4. **Wallet:** JoyRide Wallet → RESQ Nepal Wallet (NPR). Top-up methods are Nepal-appropriate
   (eSewa, Khalti, IME Pay, cards, Connect IPS).
5. **Currency:** USD → NPR throughout.
6. **Layouts:** preserved panel-by-panel (spacing, hierarchy, card structure, bottom bars,
   modals). See `screen-mapping.md` for the complete mapping.
7. **Driver mode:** not present in references; built to mirror passenger patterns
   (map-first home with online/offline state, request cards sharing the booking-card
   component, trip progression mirroring the passenger status timeline).

## 4. Screens the reference does NOT contain

- Driver-mode anything (online/offline, incoming requests, driver trip progression)
- Booking-rejected / request-expired full screens (only a rejection dialog exists)
- OTP invalid-code state (only the entry state is shown)
- Empty/error states for most lists (implemented anyway per Section 14 of the brief)

## 5. Ambiguities and inferences recorded

| Reference | Ambiguity | Inference implemented |
|---|---|---|
| Processing dialog (panel 28) | Modal vs. full screen | Implemented as both: `ProcessingScreen` (full-screen overlay) |
| "Booking Requested/Accepted/Rejected" (29, 30, 42) | Separate screens vs. dialogs | Implemented as dialog states inside `BookingStatusScreen` / `ProcessingScreen` |
| Call & video-call (32, 33) | One screen or two | One `CallScreen` with a video toggle |
| Promo "Use Now" (48) | Destination unclear | Navigates to booking flow with the promo retained in state |
| Top Up keypad (57) | Custom in-app keypad vs. system keyboard | Custom in-app keypad (as drawn) |
| Language list (69) | Whether languages are actually wired | UI implemented; app copy ships in English (see known-limitations) |

## 6. Fidelity verification

Each implemented screen was built against its mapped panel and compared during QA.
See `screen-register.md` for per-panel implementation and test status, and
`testing-report.md` for the actual verification results.
