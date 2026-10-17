# RESQ Nepal — Screen Register

Status legend: **Done** = implemented & typechecked · **Partial** = implemented with a documented
limitation · **Pending** = not yet implemented.

Every route below resolves to a real screen in `src/navigation/` — there are no placeholder routes.

## User Mode — authentication

| ID | Reference | Screen | Route / File | Key data | DB ops | States | Status |
|---|---|---|---|---|---|---|---|
| AUTH-01 | REF-02.1 | Splash | `Splash` · `SplashScreen.tsx` | — | — | auto-advance after 2 s | Done |
| AUTH-02 | REF-02.2–4 | Onboarding (3 slides) | `Onboarding` · `OnboardingScreen.tsx` | slide index | — | skip / continue / dots | Done |
| AUTH-03 | REF-02.5 | Welcome | `Welcome` · `WelcomeScreen.tsx` | — | — | provider buttons → dev notice | Done |
| AUTH-04 | REF-02.6–7 | Phone registration | `PhoneRegistration` · `PhoneRegistrationScreen.tsx` | phone, terms | auth sign-up (when configured) | empty/filled/validation | Done |
| AUTH-05 | REF-02.8 | OTP verification | `OTP` · `OTPScreen.tsx` | phone, code | verify + resend | entry/verifying/invalid/timer | Done |
| AUTH-06 | REF-03.1–2 | Fill personal info | `PersonalInfo` · `PersonalInfoScreen.tsx` | name, email, gender, DOB | profile insert/update | empty/filled/validation | Done |
| AUTH-07 | REF-03.3–4 | Login | `Login` · `LoginScreen.tsx` | phone, remember | sign-in | empty/filled/error | Done |
| AUTH-08 | REF-03.5 | Enable location | `LocationPermission` · `LocationPermissionScreen.tsx` | permission | — | grant / later / denied | Done |

## User Mode — booking

| ID | Reference | Screen | Route / File | Key data | DB ops | States | Status |
|---|---|---|---|---|---|---|---|
| USR-01 | REF-03.6–8 | Home (map + search) | `Home` · `HomeScreen.tsx` | current location, saved places | saved_places read | searching / idle / route-preview | Done |
| USR-02 | REF-04.1–2 | Location search | `LocationSearch` · `LocationSearchScreen.tsx` | pickup, destination, distance | saved_places read | results / empty / selecting | Done |
| USR-03 | REF-01.1, 04.3–5 | Available ambulances | `Ambulances`,`AmbulanceList` · `AmbulanceListScreen.tsx` | category, equipment, price, ETA | ambulances select | loading / list / empty / error | Done |
| USR-04 | REF-04.6, 11.1 | Ambulance details | `AmbulanceDetails` · `AmbulanceDetailsScreen.tsx` | model, equipment, hospital, fare | ambulances select | loading / error / ready | Done |
| USR-05 | REF-01.2 | Booking confirmation | `BookingConfirmation` · `BookingConfirmationScreen.tsx` | patient info, category, payment, fare | bookings insert | validation / submitting / error | Done |
| USR-06 | REF-05.1 | Booking processing | `Processing` · `ProcessingScreen.tsx` | booking id | bookings insert + status | processing / requested / failed | Done |
| USR-07 | REF-05.2–3, 06.7, 11.2 | Booking status | `BookingStatus` · `BookingStatusScreen.tsx` | status timeline, driver, ambulance | bookings select/update + history | requested / accepted / rejected / cancelled / assigned | Done |
| USR-08 | REF-05.7–8, 06.1 | Trip tracking | `TripTracking` · `TripTrackingScreen.tsx` | route, ETA, fare | bookings select; trip_locations read | en-route / arrived / cancelled | Done |
| USR-09 | REF-06.2 | Arrival + mood | `Arrival` · `ArrivalScreen.tsx` | duration, distance, speed | bookings update | stats / mood / finish | Done |
| USR-10 | REF-06.3–4 | Rating | `Rating` · `RatingScreen.tsx` | stars, payment summary | ratings insert | rating / submitted / error | Done |
| USR-11 | REF-06.5 | Tip | `Tip` · `TipScreen.tsx` | tip amount | ratings tip update | default / custom / skip | Done |
| USR-12 | REF-06.8, 07.1 | Cancel ride | `CancelRide` · `CancelRideScreen.tsx` | reason | bookings update status=cancelled | reasons / confirmed | Done |
| USR-13 | REF-05.4 | Chat with driver | `Chat` · `ChatScreen.tsx` | messages | local session (see limitations) | typing / sent / empty | Partial |
| USR-14 | REF-05.5–6 | Call / video | `Call` · `CallScreen.tsx` | call timer, mute | — (UI only, documented) | voice / video / ended | Partial |

## User Mode — activity, promos, wallet

| ID | Reference | Screen | Route / File | Key data | DB ops | States | Status |
|---|---|---|---|---|---|---|---|
| ACT-01 | REF-07.7–8, 08.2–3 | Activity (4 tabs) | `Activity` · `ActivityScreen.tsx` | trips, top-ups | bookings select; wallet | ongoing/completed/cancelled/top-up · empty/loading/error | Done |
| PRO-01 | REF-04.7, 07.2–5 | Promo list + redeem | `PromoList` · `PromoListScreen.tsx` | codes, categories | local catalogue (documented) | all/discount/cashback/partnership · invalid/applied | Done |
| PRO-02 | REF-07.6 | Promo detail | `PromoDetail` · `PromoDetailScreen.tsx` | terms, validity, code | — | ready | Done |
| PAY-01 | REF-04.8, 09.6 | Payment methods | `PaymentMethods` · `PaymentMethodsScreen.tsx` | method list | profiles read | list / add / remove | Done |
| PAY-02 | REF-09.7 | Add payment | `AddPayment` · `AddPaymentScreen.tsx` | card fields | (provider-dependent) | validation / saved | Partial |
| WAL-01 | REF-08.6 | Top up | `TopUp` · `TopUpScreen.tsx` | amount, keypad | wallet store | quick amounts / keypad | Done |
| WAL-02 | REF-08.7 | Top-up method | `TopUpMethod` · `TopUpMethodScreen.tsx` | eSewa/Khalti/IME/card/IPS | — | select / confirm | Done |
| WAL-03 | REF-08.8 | Top-up success | `TopUpSuccess` · `TopUpSuccessScreen.tsx` | new balance | wallet store | success | Done |
| WAL-04 | REF-08.4 | Top-up details | `TopUpDetails` · `TopUpDetailsScreen.tsx` | txn id, method, date | wallet store | details / share | Done |
| WAL-05 | REF-08.1 | Share receipt | `ShareReceipt` · `ShareReceiptScreen.tsx` | people, socials | — | sheet | Done |

## User Mode — account & settings

| ID | Reference | Screen | Route / File | Key data | DB ops | States | Status |
|---|---|---|---|---|---|---|---|
| ACC-01 | REF-08.5 | Account | `Account` · `AccountScreen.tsx` | profile, wallet, menu | profiles read | loading / ready / error | Done |
| ACC-02 | REF-09.1 | Personal info (edit) | `PersonalInfo` · `PersonalInfoScreen.tsx` | name, email, gender, DOB | profiles update | loading / editing / saved | Done |
| ACC-03 | REF-09.2 | Notifications | `Notifications` · `NotificationsScreen.tsx` | 13 toggles | local prefs | on/off | Done |
| ACC-04 | REF-09.3 | Security | `Security` · `SecurityScreen.tsx` | biometrics, password, devices | — | toggles / actions | Done |
| ACC-05 | REF-09.4 | Linked accounts | in `Security`/`PaymentMethods` | providers | — | connected/connect | Done |
| ACC-06 | REF-09.5 | Data & analytics | in `Security` | usage, data export | — | rows | Done |
| ACC-07 | REF-09.8, 10.1 | Appearance + theme | `Appearance` · `AppearanceScreen.tsx` | theme, language | local prefs | sheet / selected | Done |
| ACC-08 | REF-10.2 | App language | `Language` · `LanguageScreen.tsx` | language list | local prefs | selected | Done |
| ACC-09 | REF-10.3, 10.5–7 | Help & support | `Help` · `HelpScreen.tsx` | FAQ, contact, legal | — | menu | Done |
| ACC-10 | REF-10.4 | FAQ | `FAQ` · `FAQScreen.tsx` | Q&A, categories | — | search / category / expand | Done |
| ACC-11 | REF-10.8 | Logout | `Logout` · `LogoutScreen.tsx` | confirm | session clear | confirm / cancel | Done |
| ACC-12 | — | Change password | `ChangePassword` · `ChangePasswordScreen.tsx` | passwords | auth provider (documented) | validation / success | Partial |
| ACC-13 | — | Device management | `DeviceManagement` · `DeviceManagementScreen.tsx` | device list | — | list / remove | Done |

## Driver Mode

| ID | Reference | Screen | Route / File | Key data | DB ops | States | Status |
|---|---|---|---|---|---|---|---|
| DRV-01 | adapted REF-03.6–8 | Driver home + online/offline | `DriverHome` · `DriverHomeScreen.tsx` | online state, today stats | drivers/ambulances read | offline / online / loading / error | Done |
| DRV-02 | adapted REF-09.1 | Driver profile | `DriverProfile` · `DriverProfileScreen.tsx` | license, rating, verification | drivers read | pending/verified/rejected | Done |
| DRV-03 | — | Driver registration | `DriverRegistration` · `DriverRegistrationScreen.tsx` | license, vehicle, equipment | drivers + ambulances insert | validation / submitted | Done |
| DRV-04 | — | Vehicle management | `VehicleManagement` · `VehicleManagementScreen.tsx` | ambulance, equipment, status | ambulances update/delete | list / edit / status | Done |
| DRV-05 | adapted REF-04.3 | Incoming requests | `DriverRequests` · `DriverRequestsScreen.tsx` | pickup, patient, fare | bookings select pending + accept RPC | loading / list / empty / expired | Done |
| DRV-06 | adapted REF-08.5 | Driver earnings | `DriverEarnings` · `DriverEarningsScreen.tsx` | daily/weekly totals, trips | bookings select completed | loading / list / empty | Done |
| DRV-07 | adapted REF-05.7 | Driver trip | `DriverTrip` · `DriverTripScreen.tsx` | patient info, route, progression | bookings update + trip_locations insert | to-pickup / arrived / started / completed | Done |
| DRV-08 | adapted REF-10.3 | Driver settings | `DriverSettings` · `DriverSettingsScreen.tsx` | prefs, availability | local prefs | toggles | Done |

## Shared states (Section 14 requirements)

| State | Coverage |
|---|---|
| Loading | Every list/detail screen ships a loading state (`ActivityIndicator` + label) |
| Empty | `Activity` tabs, ambulance list, requests, notifications, FAQ search |
| Error | DB failures surface a message + Retry button on list screens |
| Permission denied | `LocationPermission` screen + graceful fallback on `Home` |
| Session expiry | `AppNavigator` swaps stacks when `isAuthenticated` clears |
| Offline | Driver home shows offline state; lists show DB error + retry |

## Honest implementation notes

- **Chat/Call (USR-13/14):** the reference shows chat and calls. Without a realtime provider
  configured, the screens implement full UI + local message state. Enabling production chat/call
  needs a realtime service (Supabase Realtime or a calling SDK) — documented in
  `known-limitations.md`.
- **Add payment (PAY-02):** card capture needs a payment provider tokenisation flow; the screen
  implements validated form UI but does not store PANs (correct behaviour for PCI).
- **Change password (ACC-12):** calls the Supabase Auth path only when configured; otherwise
  shows a clear "authentication provider not configured" state.
