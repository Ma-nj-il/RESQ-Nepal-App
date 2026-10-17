# RESQ Nepal — Mobile App

Ambulance booking for Nepal, in the style of a ride-hailing app: one Expo /
React Native application with **User Mode** (book an ambulance) and **Driver
Mode** (accept and run trips). Branded RESQ Nepal — red (#E53935) and white.

This app talks **directly to a Supabase database** (client SDK + SQL schema +
row-level security). There is **no custom backend** in this repository — see
[No backend](#no-backend) for how that shapes the design.

## Requirements

- Node.js 20+
- npm
- Expo Go on a device, or an iOS simulator / Android emulator
- Optional: a Supabase project (without it the app runs in labelled sample mode)

## Quick start

```bash
cd resq-nepal-mobile
npm install
cp .env.example .env    # fill in values (see Configuration)
npx expo start          # press i / a, or scan the QR in Expo Go
```

The app opens on the onboarding screen. Without Supabase credentials it runs
normally but every data screen shows a **"Sample mode — database not
configured"** banner and nothing is saved.

## Configuration

All values are public client values — never commit secrets.

| Variable | Purpose |
| --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon (public) key — protected by RLS |
| `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` | Google Maps key for live map tiles (iOS + Android keys as needed) |

After editing `.env`, restart `npx expo start` (Expo reads env at bundle time).

### Apply the database schema

1. Create a project at [supabase.com](https://supabase.com) (free tier is fine).
2. In the Supabase dashboard, open **SQL Editor**.
3. Paste the entire contents of [`supabase/schema.sql`](supabase/schema.sql) and run it.
   This creates 12 tables, triggers, RLS policies, the `accept_booking()`
   atomic-assignment function, and hospital seed data. It is idempotent.
   The script begins with a preflight check: it refuses to run — with an
   explicit "RESQ Nepal schema conflict" message — if the project already
   contains another app's tables. Use a dedicated project; on a disposable
   dev project you can run the destructive
   [`supabase/reset.sql`](supabase/reset.sql) first
   (see [`docs/database-setup.md`](docs/database-setup.md) §10).
4. Copy the project URL and anon key into `.env`.
5. Full walkthrough, including how an administrator verifies a driver:
   [`docs/database-setup.md`](docs/database-setup.md).

### Maps

Maps render through `react-native-maps`. Live tiles need a Google Maps key
(Android: `app.json`; iOS: dev-build required). Without a key the app shows a
clearly-labelled schematic preview instead of fake tiles. Setup details:
[`docs/maps-setup.md`](docs/maps-setup.md).

## Running the app

| Command | What it does |
| --- | --- |
| `npx expo start` | Dev server + QR for Expo Go |
| `npx expo start --ios` / `--android` | Open in a simulator/emulator |
| `npx tsc --noEmit` | Typecheck (must be 0 errors) |
| `npx expo lint` | Lint (must exit 0) |
| `npx expo export --platform ios` | Production bundle smoke test |

Note: after adding a native library, Expo Go may not include it — use a
development build (`npx expo run:ios|android`) or an EAS dev build.

## Testing the app by hand

1. **Without Supabase configured** — walk the whole user flow; every data
   screen shows the sample-mode banner and nothing persists. This is the
   honest default state.
2. **With Supabase configured**:
   - Sign in and book an ambulance (Basic or ICU/Emergency).
   - The booking row is created on the Processing screen; Booking Status polls
     its real status every 8 seconds.
   - To see the driver side: create a driver via the Driver Mode registration
     screen, then set `status = 'verified'` as an administrator with the SQL in
     `docs/database-setup.md` §7 (drivers **cannot** self-verify — a trigger and
     RLS policy block it).
   - Sign in from a second device/account as the verified driver, go online,
     and accept the request. Only one driver can win the request
     (`accept_booking()` compare-and-set).
3. Driver trip phase buttons (arrive → start → complete) persist to the
   booking in real time; the user side sees status changes on its next poll.

## Project structure

```
resq-nepal-mobile/
├── App.tsx                  # providers + root navigator
├── index.ts                 # registerRootComponent entry
├── app.json                 # Expo config (name, icons, permissions)
├── supabase/schema.sql      # full database schema — apply in SQL Editor
├── supabase/reset.sql       # destructive reset (dedicated dev projects only)
├── docs/                    # design, database, maps, testing, limitations
└── src/
    ├── components/ui/       # Button, Card, Input, Header, Badge, …
    ├── constants/           # theme tokens, fare rate card
    ├── navigation/          # Auth / User / Driver navigators
    ├── screens/
    │   ├── auth/            # onboarding, phone, OTP, registration, …
    │   ├── user/            # 36 user-mode screens
    │   └── driver/          # 8 driver-mode screens
    ├── services/
    │   ├── auth/            # authService
    │   └── database/        # Supabase client + one module per table
    ├── store/               # zustand: auth, booking, wallet
    └── utils/               # currency/date/phone formatting (NPR, +977)
```

## No backend

Deliberate consequence of the "no custom backend" rule: anything that
structurally needs a trusted server is **not faked**. Instead it is either
implemented in the database itself (schema + RLS + SQL functions, which the
Supabase platform enforces) or openly documented as unimplemented:

- **Race-safe assignment** is real: `accept_booking()` is a database-side
  compare-and-set, so two drivers cannot take the same booking.
- **Driver verification is server-enforced**: a trigger prevents
  self-verification; an administrator runs a documented SQL statement.
- **Not built** (needs a trusted server): nearest-vehicle dispatch matching,
  push notification delivery, SMS OTP, payment capture/payouts, account
  deletion of the auth user. Each is listed in
  [`docs/known-limitations.md`](docs/known-limitations.md) and surfaced
  in-app rather than simulated as working.

## Documentation

| Document | Contents |
| --- | --- |
| `docs/reference-audit.md` | Audit of the 11 supplied reference screenshots |
| `docs/asset-inventory.md` | Inventory of all reference assets (79 panels) |
| `docs/screen-mapping.md` | Reference panel → implemented screen mapping |
| `docs/screen-register.md` | Every screen, route, and state it implements |
| `docs/design-system.md` | Colors, type, spacing, components |
| `docs/database-setup.md` | Supabase setup, admin verification SQL |
| `docs/database-schema.md` | Tables, relationships, RLS summary |
| `docs/maps-setup.md` | Google Maps keys, config states |
| `docs/testing-report.md` | What was verified, how, and the results |
| `docs/implementation-checklist.md` | Requirement-by-requirement status |
| `docs/known-limitations.md` | Honest boundaries of this build |

## License

Private project — all rights reserved.
