# Phase 0 — API and schema inventory

This appendix records mechanically countable surfaces and the source paths that define them. Counts
describe source registrations, not production availability. See
[phase-0-discovery.md](./phase-0-discovery.md) for confidence and behavioral findings.

## 1. Go HTTP registration inventory

The scanner counted literal Gin `.GET`, `.POST`, `.PUT`, `.PATCH`, and `.DELETE` registrations in
`backend/cmd/**/*.go` and `backend/internal/**/*.go`. Dynamic routes and mount prefixes can make an
externally reachable path differ from its local literal. Health routes repeated by executables are
counted each time they are registered.

**Total: 508 registrations — 274 GET, 185 POST, 27 PUT, 0 PATCH, 22 DELETE.**

| Source | Total | GET | POST | PUT | DELETE |
|---|---:|---:|---:|---:|---:|
| `backend/cmd/auth/main.go` | 4 | 4 | 0 | 0 | 0 |
| `backend/cmd/fraud/main.go` | 4 | 4 | 0 | 0 | 0 |
| `backend/cmd/geo/main.go` | 4 | 4 | 0 | 0 | 0 |
| `backend/cmd/ml-eta/main.go` | 12 | 8 | 4 | 0 | 0 |
| `backend/cmd/mobile/main.go` | 7 | 5 | 1 | 1 | 0 |
| `backend/cmd/notifications/main.go` | 3 | 3 | 0 | 0 | 0 |
| `backend/cmd/realtime/main.go` | 9 | 7 | 2 | 0 | 0 |
| `backend/cmd/rides/main.go` | 4 | 4 | 0 | 0 | 0 |
| `backend/cmd/scheduler/main.go` | 4 | 4 | 0 | 0 | 0 |
| `backend/internal/admin/routes.go` | 21 | 17 | 4 | 0 | 0 |
| `backend/internal/analytics/module.go` | 3 | 3 | 0 | 0 | 0 |
| `backend/internal/analytics/route.go` | 14 | 14 | 0 | 0 | 0 |
| `backend/internal/auth/route.go` | 4 | 1 | 2 | 1 | 0 |
| `backend/internal/cancellation/handler.go` | 12 | 9 | 3 | 0 | 0 |
| `backend/internal/chat/handler.go` | 5 | 3 | 2 | 0 | 0 |
| `backend/internal/demandforecast/handler.go` | 8 | 3 | 5 | 0 | 0 |
| `backend/internal/disputes/handler.go` | 15 | 9 | 6 | 0 | 0 |
| `backend/internal/documents/handler.go` | 28 | 16 | 12 | 0 | 0 |
| `backend/internal/fraud/handler.go` | 30 | 12 | 14 | 4 | 0 |
| `backend/internal/geo/handler.go` | 15 | 10 | 5 | 0 | 0 |
| `backend/internal/geography/admin_handler.go` | 21 | 9 | 4 | 4 | 4 |
| `backend/internal/geography/handler.go` | 9 | 7 | 2 | 0 | 0 |
| `backend/internal/maps/handler.go` | 16 | 4 | 12 | 0 | 0 |
| `backend/internal/negotiation/handler.go` | 8 | 2 | 5 | 0 | 1 |
| `backend/internal/notifications/handler.go` | 11 | 2 | 9 | 0 | 0 |
| `backend/internal/onboarding/handler.go` | 7 | 5 | 2 | 0 | 0 |
| `backend/internal/pool/handler.go` | 15 | 6 | 9 | 0 | 0 |
| `backend/internal/pricing/admin_handler.go` | 38 | 15 | 10 | 7 | 6 |
| `backend/internal/pricing/handler.go` | 6 | 2 | 4 | 0 | 0 |
| `backend/internal/ratings/handler.go` | 8 | 5 | 3 | 0 | 0 |
| `backend/internal/ridehistory/handler.go` | 8 | 8 | 0 | 0 | 0 |
| `backend/internal/rides/handler.go` | 12 | 6 | 6 | 0 | 0 |
| `backend/internal/ridetypes/admin_handler.go` | 13 | 4 | 3 | 3 | 3 |
| `backend/internal/ridetypes/handler.go` | 1 | 1 | 0 | 0 | 0 |
| `backend/internal/safety/handler.go` | 29 | 11 | 10 | 3 | 5 |
| `backend/internal/scheduling/handler.go` | 12 | 4 | 6 | 1 | 1 |
| `backend/internal/support/handler.go` | 20 | 13 | 5 | 2 | 0 |
| `backend/internal/twofa/handler.go` | 22 | 4 | 16 | 0 | 2 |
| `backend/internal/vehicle/handler.go` | 22 | 12 | 9 | 1 | 0 |
| `backend/internal/verification/handler.go` | 17 | 11 | 6 | 0 | 0 |
| `backend/internal/waittime/handler.go` | 7 | 3 | 4 | 0 | 0 |
| **Total** | **508** | **274** | **185** | **27** | **22** |

### 1.1 Functional route families

The registrations represent these contract families:

| Family | Behaviors present in source | Disposition |
|---|---|---|
| Auth/2FA | register/login/profile, password, OTP/TOTP, backup codes, trusted devices, audit | Redesign with rotating sessions and custom RBAC |
| Administration | dashboard, users, drivers, approvals, rides, audit | Replace global role checks with scoped APIs |
| Geography/maps | locations, geocoding, routes, ETA, traffic, countries/regions/cities/zones | Keep provider ports; Nepal-first reference data |
| Pricing/ride types | estimates, configs, zones, modifiers, versioning, audit | Core NPR fare quote only at first; defer broad pricing console |
| Rides/history | request, match, accept, state, cancellation, list/detail/history | Map to booking/offer/assignment/trip aggregates |
| Pooling/negotiation | shared rides, participants, offers, counters, expiry | Deferred |
| Scheduling/wait time | scheduled rides, reminders, wait records/config | Deferred until core dispatch is stable |
| Safety | contacts, SOS, share links, checks, deviations, incidents, trusted/blocked drivers | Core SOS and active-trip access first |
| Documents/onboarding/verification | upload, types, status, OCR, review, background/selfie checks | Core private docs/review first; external checks deferred |
| Fleet | vehicles, inspections, maintenance, availability | Core ambulance/driver readiness |
| Notifications/chat | push/SMS/email, preferences, messages, WebSocket | Notification delivery first; chat/calls deferred |
| Support/disputes/ratings | tickets, FAQ, fare disputes, tips, reviews | Support and rating after trip core; financial disputes later |
| Fraud/analytics/ML | alerts, patterns, dashboards, forecasts, ETA model statistics | Observability first; product ML/fraud deferred |

The target API deliberately does not promise one-for-one compatibility with these 508
registrations. Compatibility is accepted only for explicitly mapped, tested workflows.

## 2. Declared Go runtime topology

`backend/Makefile` and `backend/docker-compose.yml` declare these 13 application services:

`auth`, `rides`, `geo`, `payments`, `notifications`, `realtime`, `mobile`, `admin`, `promos`,
`scheduler`, `analytics`, `fraud`, and `ml-eta`.

`backend/cmd/` contains only 11 executable directories:

`admin`, `analytics`, `auth`, `fraud`, `geo`, `ml-eta`, `mobile`, `notifications`, `realtime`,
`rides`, and `scheduler`.

`payments` and `promos` are therefore declared deployment units without corresponding executable
source. The target architecture treats the declared topology as intent, not a deployable baseline.

## 3. Portal API inventories

### 3.1 Province portal

`PROVINCE/server.ts` registers 28 API routes: 15 GET and 13 POST. It also registers a production SPA
wildcard that is excluded below.

| Method | Path | Demonstrated purpose |
|---|---|---|
| POST | `/api/auth/login` | Mock password login |
| POST | `/api/auth/verify-mfa` | Simulated MFA completion |
| GET | `/api/auth/me` | In-memory session/user |
| POST | `/api/auth/logout` | Delete in-memory token |
| POST | `/api/auth/switch-demo` | Demo province switch |
| GET | `/api/dashboard/kpis` | Province KPIs |
| GET | `/api/hospitals` | Province-filtered directory |
| GET | `/api/hospitals/:id` | Scoped hospital detail |
| POST | `/api/hospitals/:id/review` | Review/recommend/request info/reject |
| GET | `/api/ambulances` | Scoped fleet directory |
| GET | `/api/ambulances/:id` | Scoped ambulance detail |
| POST | `/api/ambulances/:id/flag` | Compliance/operations flag |
| GET | `/api/drivers` | Scoped driver directory |
| GET | `/api/bookings` | Scoped booking monitoring |
| GET | `/api/bookings/:id` | Booking detail |
| POST | `/api/bookings/:id/escalate` | Escalate operational failure |
| GET | `/api/trips` | Trip history |
| GET | `/api/documents` | Compliance queue |
| POST | `/api/documents/:id/verify` | Verify/flag document |
| GET | `/api/alerts` | Provincial alerts |
| POST | `/api/alerts/:id/update` | Acknowledge/review/resolve/escalate |
| GET | `/api/support` | Support queue |
| POST | `/api/support` | Create/update support work |
| GET | `/api/users` | Province staff |
| POST | `/api/users` | Create staff account |
| POST | `/api/users/:id/toggle-status` | Activate/deactivate staff |
| GET | `/api/audit-logs` | Scoped audit history |
| POST | `/api/test-isolation` | Demonstration-only isolation test |

All records and sessions live in process memory. These routes are acceptance-workflow input, not a
legacy compatibility contract.

### 3.2 Hospital DVR808 proxy

`HOSPITAL/server/index.ts` mounts `server/routes.ts` at `/api/dvr`. The 13 routes are:

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/dvr/status` | Sanitized integration status |
| GET | `/api/dvr/vehicles` | Vendor vehicle list |
| GET | `/api/dvr/vehicles/:terminal` | One allowlisted terminal |
| GET | `/api/dvr/telemetry` | Normalized telemetry |
| GET | `/api/dvr/device-status` | Device/channel status |
| GET | `/api/dvr/alarms` | Alarm list |
| GET | `/api/dvr/history` | Position history |
| POST | `/api/dvr/track-position` | Start/query position tracking |
| POST | `/api/dvr/stream` | Obtain selected stream metadata |
| POST | `/api/dvr/stream/stop` | Stop stream |
| GET | `/api/dvr/recordings` | Recording list |
| POST | `/api/dvr/playback` | Start playback |
| POST | `/api/dvr/playback/control` | Playback control |

The proxy has unit evidence for client/config/normalization/validation but no physical-device
acceptance evidence. The target adapter cannot be marked ready until the gate in the migration
roadmap passes.

### 3.3 Super Admin's real Go client

`SUPER/src/api/backend.ts` calls 13 explicit operations:

- auth login;
- dashboard and dashboard summary;
- users list, suspend, and activate;
- drivers list, pending list, approve, and reject;
- recent rides and ride statistics;
- audit logs.

Every other portal workflow is primarily backed by `mockData.ts` and `AppContext.tsx`. The target
API must satisfy workflow acceptance, not preserve browser `localStorage` token behavior or the Go
response envelope.

## 4. Mobile data API inventory

The mobile app has no HTTP integration with the Go services. Its effective server API is Supabase
Auth + PostgREST + RPC + Storage.

| Capability | Effective call surface | Authorization source |
|---|---|---|
| Phone identity | `signInWithOtp`, `verifyOtp`, session APIs | Supabase Auth |
| Profiles | direct CRUD on `profiles` | RLS owner policy |
| Hospitals | direct select from `hospitals` | public authenticated read policy |
| Driver onboarding | direct `drivers`/`ambulances` mutations | RLS + protected-field trigger |
| Booking | direct `bookings` reads/writes | RLS + optional write-guard migration |
| Acceptance | `accept_booking` RPC | authenticated verified driver + atomic update |
| Identity application | private Storage + metadata + `submit_identity_application` RPC | RLS/storage policy/security-definer function |
| Status timeline | `booking_status_history` | involved-user RLS |
| Tracking | `trip_locations` | involved/active-trip RLS depending on deployed migration |
| Rating | direct insert/read `ratings` | owner/assigned-driver relation |
| Notifications | direct own-row read/insert/update | owner RLS |
| Saved places/support | direct own-row CRUD/create | owner RLS |

The NestJS cutover must remove direct client database writes. RLS remains server-side defense in
depth; clients receive only HTTP/realtime contracts.

## 5. Supabase schema inventory

### 5.1 Base tables

`supabase/schema.sql` defines 12 application tables:

| Table | Purpose | Isolation in source |
|---|---|---|
| `profiles` | Supabase principal profile | own row |
| `hospitals` | public facility directory | all authenticated reads; no client writes |
| `drivers` | driver identity/approval | own row; protected approval fields |
| `driver_verifications` | driver document review metadata | owning driver |
| `ambulances` | driver-owned vehicle | available rows or owner |
| `bookings` | patient request and assignment | patient, assigned driver, or any verified driver while pending |
| `booking_status_history` | status timeline | booking participants |
| `trip_locations` | tracking breadcrumbs | booking participants; hardened migration limits active states |
| `ratings` | one rating per booking | patient and assigned driver |
| `notifications` | user inbox | owner |
| `saved_places` | personal locations | owner |
| `support_requests` | user support request | owner |

The base script also defines trigger/RPC functions for timestamps, profile creation, driver-field
protection, status history, rating aggregation, and booking acceptance.

### 5.2 Additive identity tables

`supabase/migrations/20261019_identity_registration.sql` adds:

- `identity_documents`: private object metadata with account/driver/vehicle ownership checks,
  MIME/size constraints, and soft removal of previous uploads;
- `registration_applications`: one USER or DRIVER application per account with DRAFT,
  SUBMITTED, PENDING_VERIFICATION, APPROVED, REJECTED, and
  ADDITIONAL_INFORMATION_REQUIRED states.

It also adds unique normalized identity indexes and application submission/status-sync functions.
The source explicitly does not implement authenticity checks or an administrator review workflow.

### 5.3 Security migrations

- `20261019_booking_state_guard.sql` restricts inserts, ownership, protected fields, booking
  acceptance, patient cancellation, and assigned-driver transitions.
- `20261019_identity_storage.sql` defines private bucket policies.
- `20261024_secure_active_trip_tracking.sql` limits location reads/writes to active assigned trips
  and binds each point's `driver_id`.

Existing status documentation says these changes are local/predeployment work unless separately
proven on the hosted instance.

## 6. Go PostgreSQL migration inventory

There are 21 upward migration files. They contain **126 `CREATE TABLE` registrations representing
125 unique names**. `wallet_transactions` appears first in migration 1 and is explicitly dropped
with `CASCADE` and recreated in migration 18.

| Migration | Created tables |
|---|---|
| `000001_init_schema` | `users`, `drivers`, `rides`, `wallets`, `payments`, `wallet_transactions`, `notifications` |
| `000002_add_missing_tables` | `favorite_locations`, `driver_locations` |
| `000003_add_promo_codes` | `promo_codes`, `promo_code_uses`, `referral_codes`, `referrals`, `ride_types` |
| `000004_add_scheduled_rides` | none (alters/views/functions) |
| `000005_performance_optimization` | none (indexes/view/materialized view/functions) |
| `000006_ml_eta_tables` | `eta_predictions`, `eta_model_stats`, `eta_model_performance` |
| `000007_fix_notifications_table` | none |
| `000008_add_analytics_materialized_views` | none |
| `000009_fix_demand_zones_unique_index` | none |
| `000010_add_fraud_tables` | `fraud_alerts`, `user_risk_profiles`, `fraud_patterns` |
| `000011_add_audit_logs` | `audit_logs` |
| `000012_multi_country_foundation` | `currencies`, `exchange_rates`, `countries`, `regions`, `cities`, `pricing_zones`, `pricing_config_versions`, `pricing_configs`, `zone_fees`, `time_multipliers`, `weather_multipliers`, `event_multipliers`, `surge_thresholds`, `country_payment_methods`, `pricing_audit_logs`, `pricing_history`, `driver_regions` |
| `000013_negotiation_system` | `negotiation_sessions`, `negotiation_offers`, `driver_pricing_stats`, `route_price_history`, `negotiation_settings`, `negotiation_audit_logs`, `negotiation_participants` |
| `000014_safety_features` | `emergency_alerts`, `emergency_contacts`, `ride_share_links`, `ride_share_recipients`, `safety_settings`, `safety_checks`, `route_deviation_alerts`, `speed_alerts`, `trusted_drivers`, `blocked_drivers`, `safety_incident_reports`, `emergency_alert_notifications` |
| `000015_two_factor_auth` | `otp_verifications`, `backup_codes`, `trusted_devices`, `twofa_pending_logins`, `auth_audit_log`, `otp_rate_limits` |
| `000016_driver_documents` | `document_types`, `driver_documents`, `driver_verification_status`, `document_verification_history`, `document_expiry_notifications`, `ocr_processing_queue` |
| `000017_loyalty_and_gamification` | `loyalty_tiers`, `rider_loyalty`, `loyalty_points_transactions`, `rider_challenges`, `rider_challenge_progress`, `loyalty_rewards_catalog`, `loyalty_redemptions`, `driver_tiers`, `driver_gamification`, `driver_quests`, `driver_quest_progress`, `driver_peak_bonuses`, `driver_achievements`, `driver_earned_achievements`, `driver_leaderboards`, `driver_background_checks`, `background_check_requirements`, `driver_selfie_verifications`, `selfie_verification_settings` |
| `000018_new_feature_tables` | `cancellation_policies`, `cancellation_records`, `support_tickets`, `support_ticket_messages`, `faq_articles`, `fare_disputes`, `fare_dispute_comments`, `tips`, `ratings`, `rating_responses`, `driver_bank_accounts`, `driver_payouts`, `driver_earnings`, `driver_earning_goals`, `vehicles`, `vehicle_inspections`, `maintenance_reminders`, `payment_methods`, `wallet_transactions`, `family_accounts`, `family_members`, `family_invites`, `family_ride_logs`, `gift_cards`, `gift_card_transactions`, `subscription_plans`, `subscriptions`, `subscription_usage_logs`, `rider_preferences`, `ride_preference_overrides`, `driver_capabilities`, `wait_time_configs`, `wait_time_records`, `wait_time_notifications`, `chat_messages`, `chat_quick_replies` |
| `000019_add_ride_list_indexes` | none |
| `000020_ride_types_cleanup` | `country_ride_types`, `city_ride_types` |
| `000021_add_driver_approval_status` | none |

Additional read models include five materialized views (`driver_statistics`,
`eta_accuracy_summary`, `mv_demand_zones`, `mv_driver_performance`, `mv_revenue_metrics`) and four
normal views (`scheduled_rides`, `slow_queries`, `v_pending_document_reviews`,
`v_expiring_documents`). Their presence does not prove refresh scheduling or production use.

## 7. Schema collision and migration rules

The Supabase and Go schemas must not be merged by table name:

- `users` and `profiles` encode different principals;
- `rides` and `bookings` encode different lifecycles;
- Go vehicles are driver-centric while portals require provider/facility ownership;
- source document models use different subject types and states;
- payment/wallet structures are not compatible and include a destructive migration;
- neither schema consistently represents provider tenants, facilities, authority grants, or the
  required permission-role-profile hierarchy.

The migration strategy therefore uses a new schema, source-specific staging tables, explicit
legacy-ID maps, validation reports, and reversible cutover. No legacy migration file is replayed
against the target production database.
