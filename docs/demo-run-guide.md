# Demo Run Guide (Expo Go, iOS Simulator)

Short guide to run the app in DEMO MODE with **no SMS, no payments, no map keys**.

## 1. Start the dev server

```bash
cd "resq-nepal-mobile"

EXPO_PUBLIC_DEMO_MODE=true npx expo start --port 8081
```

- Do **not** pass `--dev-client` — the installed app on the simulator is Expo Go,
  and this project has no `expo-dev-client` dependency.
- Do **not** pass `--localhost` — with that flag Metro binds only `[::1]`, while the
  manifest advertises `127.0.0.1`, so bundle downloads hang. Without it, Metro
  binds `*:8081` (IPv4 + IPv6) and both `127.0.0.1` and `localhost` work.
- `EXPO_PUBLIC_DEMO_MODE=true` is the only env var demo mode needs. Real
  Supabase credentials in `.env` may stay; demo auth never claims a real session.

## 2. Open the app in the simulator

```bash
xcrun simctl boot 697230A0-A74B-47B4-A5AA-3B58887F06E5   # iPhone 17 Pro (skip if booted)
xcrun simctl openurl 697230A0-A74B-47B4-A5AA-3B58887F06E5 "exp://127.0.0.1:8081"
```

Or press `i` in the interactive `expo start` terminal.

## 3. Walk the demo journey

1. Welcome — RESQ Nepal logo and "Let's Get Started!" (no demo banner).
2. **Sign in** → phone `9812345678` (any number) → **Sign in**.
3. OTP screen subtitle reads "Demo mode — enter 1234 to continue." Enter **1234**
   (any other code shows an error and stays; `1234` is never accepted outside demo
   mode).
4. Fill Personal Info → Continue (details are kept locally only).
5. Enable Location → **Maybe Later**.
6. Home — map-first booking screen: pickup/destination, the two compact service
   cards and Find Ambulance. Demo/sample states are flagged with a small footnote
   inside the booking screens (status, ratings, saved places), not with banners.
7. Account → Logout → Yes, Logout → back at Welcome (demo state cleared).

Optional identity check: **☰ → Application Status** (or **My Account → Identity
Verification**) shows “No application in this mode” and explains that demo mode
does not upload documents, create applications or read application status. It never
shows a fabricated pending/approved state. Scripted in
`qa/maestro/maestro-verify-identity-demo.yaml`.

The same journey is scripted in `qa/maestro/maestro-d1-demo-journey.yaml`:

```bash
maestro test --udid 697230A0-A74B-47B4-A5AA-3B58887F06E5 qa/maestro/maestro-d1-demo-journey.yaml
```

## 3b. Driver Mode demo walkthrough

The driver side ships its own scripted walkthrough. It runs from the same demo build
(walkthrough mode = demo mode or a build with no Supabase configured) and is fully
in-memory — no request, trip, status or earning is ever written anywhere:

1. Home → **☰** (top-left) → **My Account** → **Switch to Driver Mode**.
2. Driver Home — map-first dashboard with a quiet `DEMO` chip. The blue dot is this
   device's real GPS position ("Your position from this device's GPS"); the summary
   cards read `NPR 0` ("walkthrough — no real earnings"), the walkthrough trip count,
   and `—` for rating ("available after real trips"). Nothing is invented.
3. **Go Online** → **View** → two labelled sample requests: ICU / Emergency (Ram
   Bahadur Thapa) and Basic Transport (Sunita Sharma).
4. Decline one and accept the other → the trip screen walks
   Heading to Pickup → Arrived at Pickup → Trip In Progress → Trip Completed.
   The map is a straight-line preview ("not live GPS"); Call Patient explains that no
   call is placed.
5. Completing the trip shows "Walkthrough trip completed. No records were written and
   no fare is charged." and returns to the dashboard (trip counter increments).
6. **Restart walkthrough** restores the two sample requests and clears the active
   trip; the online toggle is kept. The Earnings / Profile / Vehicle management
   screens show labelled walkthrough samples.
7. **☰ → Switch to User Mode** returns to the patient side.

The whole loop is scripted in `qa/maestro/maestro-verify-driver-demo.yaml`:

```bash
maestro test --udid 697230A0-A74B-47B4-A5AA-3B58887F06E5 qa/maestro/maestro-verify-driver-demo.yaml
```

## 4. What demo mode does and does not do

| Area | Demo behaviour |
| --- | --- |
| OTP | `1234` accepted locally; no Twilio / no Supabase OTP call |
| Auth session | local-only demo user; no real account created |
| Payments / chat / calls / push | not available; labelled honestly in-app |
| Map | static labelled preview, no Google Maps key required |
| Supabase | untouched — real mode still calls `verifyOtp()` and never accepts `1234` |
| Driver Mode | walkthrough on in-memory sample requests/trip; nothing saved, no real patient or driver involved; real requests need a verified driver account |
| Identity / Application Status | no document upload, no application row, no status read; the screen explicitly says demo mode is local-only |

Stop the server: press `Ctrl+C`, or if started detached via `screen -dmS expo8081`
kill the listener on port 8081 (`lsof -nP -iTCP:8081 -sTCP:LISTEN`, then `kill <pid>`).

## 5. Troubleshooting

- **Server starts but the bundle request never finishes; log shows
  `Failed to construct transformer: Cannot find module 'babel-preset-expo'`.**
  A stale `babel.config.js` exists whose `presets: ['babel-preset-expo']` cannot
  be resolved from the project root (npm keeps the preset nested under `expo`).
  SDK 58 applies `babel-preset-expo` internally, so the file must be absent.
  Remove `babel.config.js` and restart. Do not re-add it.
- **`--localhost`**: binds `[::1]` only — Expo Go fails to fetch the bundle from
  the advertised `http://127.0.0.1:8081` URL. Start without it.
- **Port already in use**: check `lsof -nP -iTCP:8081 -sTCP:LISTEN` and kill only
  this project's listener before starting a new server. Never run two Metro
  servers for the same project.
- **A restarted server sits silently at `Use port 8091 instead? (Y/n)`**: it was
  started non-interactively (e.g. from a detached script/screen) while another
  server already owns the port. Nothing answers the prompt, so it waits forever.
  Stop the duplicate listener first, then start one server interactively.

## 6. Evidence

Screenshots from a verified run (iPhone 17 Pro, iOS 26.4, Expo Go 58) are in
`docs/demo-evidence/`:
`01-welcome-demo-mode` · `02-otp-demo-1234` · `03-personal-info` ·
`04-home-demo-map` · `05-logout-welcome` · `identity-01-status-demo-drawer` ·
`identity-02-status-demo-account`.
