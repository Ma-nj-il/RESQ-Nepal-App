# Maestro interactive QA flows — RESQ Nepal

These flows drive the app through **real taps** on an iOS simulator
(iPhone 17 Pro, iOS 26.4, Expo Go 58.0.4) with
[Maestro](https://maestro.mobile.dev) 2.11.0. They were created and executed
for the remediation pass on 2026-10-17; results and per-screen statuses are in
`docs/interactive-qa-checklist.md`.

Two Metro dev servers are used, because the app has two honest runtime modes:

- **Configured mode (port 8081)** — started with the project's normal `.env`
  (hosted Supabase project). Flows: `maestro-probe-01-onboarding.yaml`,
  `maestro-a2-welcome-basics.yaml`, `maestro-a3-signup-validation.yaml`.
- **Sample mode (port 8082)** — started with empty `EXPO_PUBLIC_*` overrides so
  no Supabase credentials are present. Flows: `maestro-b0-sample-to-otp.yaml`,
  `maestro-b1-sample-journey.yaml`.

## Prerequisites

- Booted iOS simulator with Expo Go installed.
- `maestro` CLI (`curl -Ls "https://get.maestro.mobile.dev" | bash`).
- Two Metro servers:

```bash
# configured mode
npx expo start --port 8081

# sample mode — no Supabase credentials
EXPO_PUBLIC_SUPABASE_URL= EXPO_PUBLIC_SUPABASE_ANON_KEY= EXPO_PUBLIC_GOOGLE_MAPS_API_KEY= \
  npx expo start --port 8082
```

## Running

```bash
maestro test --device <simulator-udid> qa/maestro/maestro-probe-01-onboarding.yaml
```

Recommended order: `probe-01` (clears app state and walks onboarding →
Welcome) → `a2` → `a3` (configured mode) → `b0` → `b1` (sample mode).
Screenshots are written to
`~/.maestro/tests/<timestamp>/<flow>/takeScreenshot/`.

## Current flows (2026-10-19 UI + identity pass)

The reproduced UI and the identity/application-status screens are exercised in
**demo mode** on port 8081 (`EXPO_PUBLIC_DEMO_MODE=true`). Demo sign-in accepts
OTP `1234` locally and never uploads documents or writes to Supabase.

| Flow | File | Covers |
|---|---|---|
| Helper | `maestro-signin-demo.yaml` | demo sign-in ending on Home |
| Helper | `maestro-signout-demo.yaml` | idempotent precondition: launches Expo Go, signs out only if signed in, ends on Welcome |
| A | `maestro-verify-booking.yaml` | Home → manual pickup fallback → real hospital destination → route preview → compact category cards → direct “Find Ambulance” → map-first searching (radar, cancel, no payment) → assigned sample state → labelled crew card → demo Call Driver guard → back Home |
| B | `maestro-verify-history-rating-sos.yaml` | activity → completed trip → rating → notifications → SOS |
| C | `maestro-verify-menu-account.yaml` | drawer → saved hospitals/places → settings → about → privacy → driver local draft |
| D | `maestro-verify-driver-demo.yaml` | Driver Mode walkthrough, request accept/decline, trip phases, restart |
| Identity | `maestro-verify-identity-demo.yaml` | drawer + Account → Application Status demo guard (no fake upload/status) |
| D1 | `maestro-d1-demo-journey.yaml` | signup demo → Home → drawer → Account → logout, with screenshots |
| Evidence | `maestro-evidence-booking-radar.yaml` | partial probe: two searching-screen frames 1.2 s apart (preconditions: signed in, Home with pickup + destination) |
| Evidence | `maestro-evidence-confirm-no-payment.yaml` | partial probe: secondary vehicle flow reaches Confirm Booking and `Payment Method` is absent |
| Evidence | `maestro-evidence-home-categories.yaml` | partial probe: compact Home category cards |

Run them on the demo server (port 8081), for example:

```bash
maestro test --udid <sim-udid> qa/maestro/maestro-verify-identity-demo.yaml
```

Evidence probes are **partial flows**: run `maestro-verify-booking.yaml` first so the app is left
signed in on Home with a pickup and destination, then run the radar and no-payment probes
back-to-back without relaunching.

Flow C uses the device location ("Use my current location"). On a simulator,
set a location first or the Saved Places location capture will fail for
environmental reasons:

```bash
xcrun simctl location <sim-udid> set 27.7172,85.3240
```

Legacy sample-mode flows (`maestro-b*`) and the configured-mode probes
(`maestro-probe-01`, `maestro-a2`, `maestro-a3`) are retained; see
`docs/interactive-qa-checklist.md` and `docs/ui-refinement-report.md`.

## SMS safety (important)

`maestro-a3-signup-validation.yaml` taps **Sign up** with the deliberately
dummy number `9800000000`; that calls `signInWithOtp`. Only run it while the
Supabase project has the **phone provider disabled** — the OTP screen then
shows *“Unsupported phone provider”* and no SMS is dispatched. Re-check
`GET <SUPABASE_URL>/auth/v1/settings` → `"phone": false` immediately before
running it, and never run it against a project with a live SMS provider
without accepting the cost of a real message.

`maestro-b1-sample-journey.yaml` is safe in every environment: sample mode
never contacts Supabase for OTP.
