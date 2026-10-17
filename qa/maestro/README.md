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
