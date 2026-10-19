# RESQ Nepal — QA Evidence Log (2026-10-19 evening pass)

Every result below was produced in this working session on the dates/times shown. Nothing is
extrapolated: items that could not be run are listed with the exact reason in §7.

## 1. Environment

| Item | Value |
|---|---|
| Host | macOS, working copy `resq-nepal-mobile/` (branch `main`, HEAD `0971e76`, all changes uncommitted) |
| Simulator | iPhone 17 Pro, iOS 26.4, UDID `697230A0-A74B-47B4-A5AA-3B58887F06E5` |
| Runtime | Expo Go 58.0.4 (SDK 58), Metro on `:8081`, `EXPO_PUBLIC_DEMO_MODE=true` |
| Simulator location | `27.7172,85.3240` (Kathmandu) — re-set mid-session for the Saved Places flow |
| Maestro | 2.11.0 |
| Final edits validated | `ErrorBoundary`, auth `SIGNED_OUT` listener, focus-gated polling, Reduce Motion radar, `SearchRadar` variable rename |

## 2. Static gates (exact commands)

| # | Command | Result |
|---|---|---|
| G1 | `npx tsc --noEmit` | exit 0, no output (re-run after the final edit) |
| G2 | `npx expo lint` | exit 0 (only the standard `.env` load banner) |
| G3 | `npm run test:unit` | 18 tests, 18 pass, 0 fail — `docs` validator + dialer + image/identity validation |
| G4 | `npx expo export --platform ios` | `Exported: dist`; Hermes bundle `index-e1a56ef71cc080d4f707b67f0f3f8200.hbc` (3.7 MB), 1 metadata file |
| G5 | `git ls-files \| grep '^\\.env'` | only `.env.example` tracked; `.env` ignored (no credential leak) |
| G6 | secret sweep (`service_role`, `sj_secret`, `SUPABASE_SERVICE`) | no matches in `src/`, `supabase/` or `.env.example` |
| G7 | console sweep | one deliberate `__DEV__`-only `console.error` in `ErrorBoundary` (message only, no user data) |
| G8 | Docker / host disk check (for SQL harness) | **BLOCKED** — `/System/Volumes/Data` at 100 % capacity (1.8 GiB free of 228 GiB); Docker daemon engine stopped with `no space left on device`, socket returns no HTTP response. A graceful quit/reopen attempt was ignored; no processes were killed. |

## 3. Maestro flows (interactive, real taps)

All flows started from a clean signed-out state; the demo OTP (`1234`) is local and no network write
occurs. Screenshots live under `~/.maestro/tests/<run>/<flow>/takeScreenshot/`.

| Flow | File | Run directory | Result |
|---|---|---|---|
| A — booking journey | `maestro-verify-booking.yaml` | `2026-10-19_205234` | **PASS** — home → manual pickup → real hospital destination → route preview → compact categories (both selected/reverted) → searching (cancel visible, no payment) → assigned (shared demo guard) → labelled crew card, no `+977` text → demo call guard → back Home |
| A-radar probe | `maestro-evidence-booking-radar.yaml` | `2026-10-19_205428` | **PASS** — two frames captured 1.2 s apart (numeric diff in §4) |
| A-payment probe | `maestro-evidence-confirm-no-payment.yaml` | `2026-10-19_205500` | **PASS** — secondary vehicle flow reaches Service Details → Confirm Booking; `assertNotVisible: Payment Method` |
| B — activity/rating/SOS | `maestro-verify-history-rating-sos.yaml` | `2026-10-19_203324` | **PASS** — sample trips, rating submit guard, notifications list, SOS screen |
| C — drawer/account/settings | `maestro-verify-menu-account.yaml` | `2026-10-19_204535` | **PASS after one environmental retry** (see §5) — saved hospitals star, saved-place location capture, validation guard, settings, about, privacy draft, driver local draft, honest submit blocker |
| D — driver demo | `maestro-verify-driver-demo.yaml` | `2026-10-19_204858` | **PASS** — driver mode, online toggle, sample requests (decline + accept), pickup → arrived → started → completed with “No records were written”, restart restores samples, switch back to user mode |
| Identity | `maestro-verify-identity-demo.yaml` | `2026-10-19_205104` | **PASS** — both entry points show “No application in this mode” / “Demo mode is local-only”; `assertNotVisible Pending verification/Approved` |
| D1 — demo journey | `maestro-d1-demo-journey.yaml` | `2026-10-19_210637` | **PASS** — welcome → OTP → personal info → location → home → account → logout |
| Helper — sign-out | `maestro-signout-demo.yaml` | `2026-10-19_204504` | **PASS** — idempotent signed-out precondition helper (new) |

## 4. Radar animation — numeric evidence

Two screenshots of the searching screen taken 1.2 s apart
(`…/2026-10-19_205428/maestro-evidence-booking-radar/takeScreenshot/after-searching-radar-{a,b}.png`):

| Region | Sampled pixels changed (>8/255 per channel) |
|---|---|
| Map / radar area (top 55 %) | **27 180 / 434 763 = 6.25 %** |
| Bottom status sheet (bottom 30 %) | **174 / 237 582 = 0.07 %** |

This proves the rings are expanding/fading while the status sheet stays visually stable, and rules
out “the timer text changed” as the source of the difference. Reproduced frames are archived at
`docs/booking-ui-audit/after/06a-radar-frame-a.png` and `06b-radar-frame-b.png`.

## 5. Failure analysis (honesty record)

1. **Flow C, first attempt (run `2026-10-19_204009`, step 69):** failed at
   `assertVisible: ".*Recapture location.*"` on the Saved Places screen. Root cause: the simulator
   had no usable location fix — the app showed its own honest amber notice “Could not read the
   device location. Try again somewhere with a clearer signal.” (failure screenshot in the run
   directory). This is an environment failure, and it validated the app’s fallback, not a code
   regression. Fix: `xcrun simctl privacy <udid> grant location-always host.exp.Exponent` +
   `xcrun simctl location <udid> set 27.7172,85.3240`; the flow then passed fully.
2. **Flow C, retry `2026-10-19_203732`:** Maestro’s XCUITest transport dropped
   (`Transport unreachable … viewHierarchy … ConnectException`) mid-flow after step 38. This is a
   tooling/daemon flake, not an app failure; the clean retry passed.
3. **Auth listener regression caught during development:** the first version of the new
   `onAuthStateChange` listener cleared the local demo session when Supabase emitted
   `INITIAL_SESSION:null`. It was corrected to only act on a real `SIGNED_OUT` before any flow was
   signed off; all flows above ran on the corrected version.

## 6. Post-deployment re-run checklist

1. `npx tsc --noEmit`, `npx expo lint`, `npm run test:unit`, `npx expo export --platform ios`.
2. `bash qa/sql/verify_identity_registration.sh` (needs Docker).
2b. `bash qa/sql/verify_booking_state_guard.sh` (new; applies schema + patch + `20261019_booking_state_guard.sql` twice + `test_booking_state_guard.sql`; needs Docker).
3. `maestro test … qa/maestro/maestro-verify-booking.yaml` and the evidence probes.
4. Signup → upload → status smoke on a real account (after OTP + migrations).
5. Two-account live booking: create → accept → crew read → transitions → rating; assert an invalid
   transition is rejected once the state guard ships.
6. Re-run Flow C with a simulator location set (documented in `qa/maestro/README.md`).

## 7. Not run this session (with reasons)

| Item | Reason |
|---|---|
| `qa/sql/verify_identity_registration.sh` | Docker CLI unresponsive (daemon socket hang; `docker ps` timed out twice, 60 s and 150 s). Prior-session PASS is recorded in `docs/identity-registration-status-implementation.md`; not re-claimed here. |
| `maestro-a2-welcome-basics.yaml`, `maestro-a3-signup-validation.yaml`, `maestro-probe-01-onboarding.yaml` | Hosted-config probes; A2/A3 touch the live OTP path which is disabled and must only be run with re-verified SMS safety (see `qa/maestro/README.md`). |
| `maestro-b0/b1-samples`, `maestro-b2/b3` | Require the second sample-mode Metro server on `:8082` (no Supabase env). Not started this session; superseded by the demo-mode flows on `:8081`. |
| `maestro-evidence-home-categories.yaml` | Partial probe (needs a signed-in Home with route set); the same assertions are covered by flow A screenshots `ui-04*`. |
| Physical-device camera/HEIC, Android, tablets, small screens | No devices available; stated as a limitation in every report. |
| Hosted writes (upload/delete, booking insert, RPCs) | Not deployed / not approved; demo mode writes nothing by design. |
