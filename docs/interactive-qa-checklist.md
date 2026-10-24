# Interactive QA Checklist — RESQ Nepal (2026-10-17)

> **Map update (2026-10-23):** this checklist records the pre-OSM build. The app now renders
> real OpenStreetMap tiles through `react-native-webview`; map observations below are historical.

Status per screen, tested via **Maestro 2.11.0** driving **Expo Go 58.0.4** on **iPhone 17 Pro (iOS 26.4)**. Two Metro dev servers:
- **Configured mode** (port 8081, hosted Supabase project `biormfaekazzwwyxympq`) — flows `a2`, `a3`.
- **Sample mode** (port 8082, empty `EXPO_PUBLIC_*`) — flows `b0`, `b1`, `b2`, `b3`.

Legend: **PASS** = executed & observed · **CODE-VERIFIED** = code review + static gates · **PARTIAL** = some paths real, some stubbed · **NOT TESTED** = not exercised.

---

## 1. Auth Stack (8 screens)

| Screen | Mode | Status | Evidence |
|--------|------|--------|----------|
| SplashScreen | both | CODE-VERIFIED | boots, no crash after client fix |
| OnboardingScreen | both | **PASS** | probe flow: 3 slides → "Let's Get Started" → Welcome; skip also works |
| WelcomeScreen | configured | **PASS** | a2: persistence, social alerts, legal links |
| WelcomeScreen | sample | **PASS** | b1: reached from OTP sample path |
| PhoneRegistrationScreen | configured | **PASS** | a3: empty/invalid/valid phone, terms checkbox, "Sign up" → OTP |
| PhoneRegistrationScreen | sample | NOT TESTED | sample mode bypasses OTP send |
| LoginScreen | configured | **PASS** | a3/b0: invalid/valid phone, "Sign in" → OTP |
| LoginScreen | sample | **PASS** | b1/b2/b3: valid phone → OTP sample path |
| OTPScreen | configured | **PASS** | a3: "Unsupported phone provider" (no SMS), wrong code "1234" → friendly error, no advance |
| OTPScreen | sample | **PASS** | b1: notice "Sample mode…", keypad 1-2-3-4 → sample alert → Continue → PersonalInfo |
| PersonalInfoScreen (auth) | sample | **PASS** | b1: name + email + gender dropdown (Male/Female) → Continue → LocationPermission |
| LocationPermissionScreen | sample | **PASS** | b1: "Maybe Later" → Home (no permission prompt) |

---

## 2. User Stack (36 screens — interactive coverage)

| Screen | Mode | Status | Evidence |
|--------|------|--------|----------|
| HomeScreen | sample | **PASS** | b1: "Let's travel together!", schematic map, saved-place card, bottom nav, Safety, menu ☰ |
| HomeScreen | configured | NOT TESTED | needs authenticated session (OTP blocked) |
| AmbulanceListScreen | sample | **PASS** | b3: "3 ambulances available", honest sample banner, cards show driver/vehicle/equipment/fare |
| AmbulanceDetailsScreen | sample | **PASS** | b3 cont: full card, Book Now → BookingConfirmation |
| BookingConfirmationScreen | sample | **PASS** | b3 cont2: "Not specified" / "Distance not recorded" labels, Confirm Booking → BookingStatus |
| BookingStatusScreen | sample | **PASS** | b3 cont3: screen rendered (polls, no mock success) |
| ActivityScreen | sample | **PASS** | b1: sample banner "example bookings", Ongoing/Completed/Canceled/Top Up tabs |
| AccountScreen | sample | **PASS** | b1: wallet (demo), Switch to Driver Mode, bottom nav (Home/Ambulances/Activity/Account), Logout |
| Logout (from Account) | sample | **PASS** | b1: confirm alert → "Yes, Logout" → Welcome |
| LocationSearchScreen | sample | **PASS** | b2: reached via saved-place card; swipe back works |
| LegalScreen (Privacy) | configured | **PASS** | a2: "Draft — this document describes…" |
| LegalScreen (Terms) | configured | **PASS** | a2: "Draft — these terms summarise…" |
| Settings screens (Appearance, Language, Notifications, Security, DeviceManagement, Help, FAQ, ChangePassword, etc.) | both | CODE-VERIFIED | handlers exist, honest limits stated, no dead buttons |
| TripTrackingScreen | sample | NOT TESTED | needs live booking |
| CancelRideScreen | sample | NOT TESTED | needs live booking |
| ArrivalScreen / RatingScreen | sample | NOT TESTED | needs completed booking |
| ChatScreen | sample | CODE-VERIFIED | demo conversation labelled "realtime messaging not implemented" |
| CallScreen | sample | CODE-VERIFIED | UI only, "no telephony provider" notice |
| Payment / TopUp screens | both | CODE-VERIFIED | demo-labelled, no money captured |
| Promo screens | sample | CODE-VERIFIED | listed, demo |

---

## 3. Driver Stack (8 screens)

| Screen | Mode | Status | Evidence |
|--------|------|--------|----------|
| DriverRegistrationScreen | sample | NOT TESTED | needs authenticated driver |
| DriverHomeScreen | sample | NOT TESTED | needs driver record |
| DriverRequestsScreen | sample | NOT TESTED | needs pending bookings |
| DriverTripScreen | sample | NOT TESTED | needs assigned trip |
| DriverEarningsScreen | sample | NOT TESTED | needs history |
| DriverProfileScreen | sample | NOT TESTED | needs driver record |
| DriverSettingsScreen | sample | NOT TESTED | needs driver record |
| VehicleManagementScreen | sample | NOT TESTED | needs driver record |

---

## 4. Key primary actions actually tapped (evidence)

| Action | Flow | Mode | Screenshot |
|--------|------|------|------------|
| Onboarding → Continue (×3) → Let's Get Started | probe | both | probe-01/02/03 |
| Welcome → Continue with Google → alert OK | a2 | configured | a2-02 |
| Welcome → Privacy Policy → back ← | a2 | configured | a2-03 |
| Welcome → Terms of Service → back ← | a2 | configured | a2-04 |
| PhoneRegistration: invalid phone → Sign up (blocked) | a3 | configured | a3-02 |
| PhoneRegistration: valid + terms → Sign up → OTP | a3 | configured | a3-03 → a3-04 |
| OTP (hosted) → "Unsupported phone provider" shown | a3 | configured | a3-04 |
| OTP (hosted) → wrong code 1-2-3-4 → error, no advance | a3 | configured | a3-05 |
| OTP (sample) → 1-2-3-4 → sample alert → Continue | b1 | sample | b1-01 |
| PersonalInfo → name+email+gender(Female) → Continue | b1 | sample | b1-02 |
| LocationPermission → Maybe Later → Home | b1 | sample | b1-03/04 |
| Home → Safety → alert OK | b1 | sample | b1-08 |
| Home → Ambulances → list | b1 | sample | b1-05 |
| Home → Activity → list | b1 | sample | b1-06 |
| Home → Account → Logout → confirm → Welcome | b1 | sample | b1-07/09/10 |
| Home → saved-place card → LocationSearch | b2 | sample | b2-01 |
| Home → ☰ menu → alert OK | b2 | sample | b2-02 |
| Home → Ambulances (list with pickup) → Book Now (card) | b3 | sample | b3-01 |
| AmbulanceDetails → Book Now → BookingConfirmation | b3 cont | sample | b3-02 |
| BookingConfirmation → Confirm Booking → BookingStatus | b3 cont2 | sample | b3-03/04 |

---

## 5. Honesty / labelling evidence captured

- **Sample mode banners** on every data screen (Home, Activity, Account, AmbulanceList, BookingConfirmation, BookingStatus).
- **OTP screen (hosted):** "Unsupported phone provider" + "Resend code available" — no SMS sent, no advance.
- **OTP screen (sample):** "Sample mode — no SMS is sent. Enter any 4 digits to preview the flow."
- **PersonalInfo (sample):** no persistence; navigates local path.
- **Home map:** "Searching your location…", "Google Maps API key required for live tiles", schematic only.
- **AmbulanceList/Details:** "Sample mode — database not configured. Showing example ambulances."
- **BookingConfirmation:** "Not specified", "Distance not recorded" instead of fabricated values.
- **Account wallet:** "(demo) — no real money is stored in this build."
- **Safety / Social / Menu / Chat / Call / Payments:** all show "not available in this build" / "not implemented" alerts.
- **Driver verification:** DB-enforced, cannot be self-approved (tested in live DB run).

---

## 6. Remaining manual steps for production

| Step | Owner | Note |
|------|-------|------|
| Apply `supabase/patches/accept_booking_ownership_guard.sql` via Supabase SQL Editor | RESQ team | hardens `accept_booking` RPC; not yet applied to hosted |
| Enable phone provider on hosted project (Twilio credentials) | RESQ team | Dashboard → Auth → Providers → Phone → enable |
| Verify real SMS OTP send + receive on a real device | QA | use a test number you control; cost applies |
| Finalise Privacy Policy / Terms of Service copy | Legal | currently marked "Draft" |
| Rotate Supabase service-role key | Ops | was handled during setup |
| Run EAS production builds (`eas build --platform ios/android --profile production`) | Release | not tested in this audit |
| Complete on-device interactive QA on production builds | QA | includes push, maps, payments stubs |

---

## 7. Command summary (run order)

```bash
# Terminal 1 — configured mode
npx expo start --port 8081

# Terminal 2 — sample mode
EXPO_PUBLIC_SUPABASE_URL= EXPO_PUBLIC_SUPABASE_ANON_KEY= \
  npx expo start --port 8082

# Terminal 3 — Maestro runs (simulator UDID: 697230A0-A74B-47B4-A5AA-3B58887F06E5)
maestro test --device 697230A0-A74B-47B4-A5AA-3B58887F06E5 qa/maestro/maestro-probe-01-onboarding.yaml
maestro test --device 697230A0-A74B-47B4-A5AA-3B58887F06E5 qa/maestro/maestro-a2-welcome-basics.yaml
maestro test --device 697230A0-A74B-47B4-A5AA-3B58887F06E5 qa/maestro/maestro-a3-signup-validation.yaml
maestro test --device 697230A0-A74B-47B4-A5AA-3B58887F06E5 qa/maestro/maestro-b0-sample-to-otp.yaml
maestro test --device 697230A0-A74B-47B4-A5AA-3B58887F06E5 qa/maestro/maestro-b1-sample-journey.yaml
maestro test --device 697230A0-A74B-47B4-A5AA-3B58887F06E5 qa/maestro/maestro-b2-sample-home-actions.yaml
maestro test --device 697230A0-A74B-47B4-A5AA-3B58887F06E5 qa/maestro/maestro-b3-book-now.yaml
```

All screenshots in `~/.maestro/tests/<timestamp>/<flow>/takeScreenshot/`.