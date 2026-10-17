# RESQ Nepal — Screen Mapping

Maps every reference panel (REF-01…REF-11, panels numbered left→right, top→bottom) to the
RESQ Nepal implementation.

**Legend:** UM = User Mode, DM = Driver Mode, SH = Shared

| Panel | Reference (JoyRide) | RESQ Nepal screen | Mode | Route |
|---|---|---|---|---|
| REF-01.1 | Vehicle tier selection sheet | Ambulance category & selection | UM | `AmbulanceList` |
| REF-01.2 | Trip details + fare breakdown + Request | Booking confirmation | UM | `BookingConfirmation` |
| REF-01.3 | "Where to?" + saved places + bottom nav | Home destination sheet | UM | `Home` / `LocationSearch` |
| REF-02.1 | Splash (logo, loader) | Splash | SH | `Splash` |
| REF-02.2 | Onboarding 1 (map illustration) | Onboarding slide 1 | SH | `Onboarding` |
| REF-02.3 | Onboarding 2 (rides list illustration) | Onboarding slide 2 | SH | `Onboarding` |
| REF-02.4 | Onboarding 3 (driver illustration) | Onboarding slide 3 | SH | `Onboarding` |
| REF-02.5 | Welcome / auth providers | Welcome | SH | `Welcome` |
| REF-02.6 | Phone sign-up (empty) | Phone registration | SH | `PhoneRegistration` |
| REF-02.7 | Phone sign-up (filled + checkbox) | Phone registration — filled state | SH | `PhoneRegistration` |
| REF-02.8 | OTP entry + keypad | OTP verification | SH | `OTP` |
| REF-03.1 | Personal info (empty) | Fill personal info | SH | `PersonalInfo` |
| REF-03.2 | Personal info (filled) | Fill personal info — filled state | SH | `PersonalInfo` |
| REF-03.3 | Login (empty) | Login | SH | `Login` |
| REF-03.4 | Login (filled) | Login — filled state | SH | `Login` |
| REF-03.5 | Location permission dialog | Enable location | SH | `LocationPermission` |
| REF-03.6 | Home — searching location | Home — searching state | UM | `Home` |
| REF-03.7 | Home — "Let's travel together!" | Home — idle state | UM | `Home` |
| REF-03.8 | Home — route + nearby cars | Home — with preview route | UM | `Home` |
| REF-04.1 | Location search + keyboard | Location search | UM | `LocationSearch` |
| REF-04.2 | Search selected + Find a Ride | Pickup/destination selected | UM | `LocationSearch` |
| REF-04.3 | Rides list (driver cards) | Available ambulances | UM | `AmbulanceList` |
| REF-04.4 | Rides list (scrolled) | Available ambulances — scrolled | UM | `AmbulanceList` |
| REF-04.5 | Rides list (scrolled more) | Available ambulances — scrolled | UM | `AmbulanceList` |
| REF-04.6 | Ride details + Book Now | Ambulance details | UM | `AmbulanceDetails` |
| REF-04.7 | Promos / vouchers | Promo list | UM | `PromoList` |
| REF-04.8 | Choose payment method | Payment method selection | UM | `PaymentMethods` |
| REF-05.1 | Processing dialog | Booking processing | UM | `Processing` |
| REF-05.2 | Booking requested | Booking requested state | UM | `BookingStatus` |
| REF-05.3 | Booking accepted + driver card | Booking accepted state | UM | `BookingStatus` |
| REF-05.4 | Chat with driver | Chat | UM | `Chat` |
| REF-05.5 | Voice call | Call (voice mode) | UM | `Call` |
| REF-05.6 | Video call | Call (video mode) | UM | `Call` |
| REF-05.7 | Trip tracking + fare + cancel | Trip tracking | UM | `TripTracking` |
| REF-05.8 | Heading to destination (map) | Trip tracking — en route | UM | `TripTracking` |
| REF-06.1 | En-route map (large) | Trip progress map | UM | `TripTracking` |
| REF-06.2 | "You have arrived!" + mood | Arrival + mood capture | UM | `Arrival` |
| REF-06.3 | Rating (empty stars) | Rating | UM | `Rating` |
| REF-06.4 | Rating (5 stars) | Rating — selected state | UM | `Rating` |
| REF-06.5 | Tip screen | Tip driver | UM | `Tip` |
| REF-06.6 | Thanks for feedback | Feedback confirmation | UM | `Rating` (post-submit) |
| REF-06.7 | Booking rejected dialog | Booking rejected state | UM | `BookingStatus` |
| REF-06.8 | Cancel reasons | Cancel ride | UM | `CancelRide` |
| REF-07.1 | Ride cancelled | Cancellation result | UM | `CancelRide` (post-confirm) |
| REF-07.2 | Promos list | Promo list | UM | `PromoList` |
| REF-07.3 | Promo code entry | Promo redeem | UM | `PromoList` |
| REF-07.4 | Invalid promo dialog | Promo error state | UM | `PromoList` |
| REF-07.5 | Promo applied dialog | Promo applied state | UM | `PromoList` |
| REF-07.6 | Promo detail | Promo detail | UM | `PromoDetail` |
| REF-07.7 | Activity — ongoing | Activity — ongoing tab | UM | `Activity` |
| REF-07.8 | Activity — completed | Activity — completed tab | UM | `Activity` |
| REF-08.1 | Share receipt | Share receipt sheet | UM | `ShareReceipt` |
| REF-08.2 | Activity — cancelled | Activity — cancelled tab | UM | `Activity` |
| REF-08.3 | Activity — top up | Activity — top-up tab | UM | `Activity` |
| REF-08.4 | Top up details | Top-up details | UM | `TopUpDetails` |
| REF-08.5 | Account | Account | UM | `Account` |
| REF-08.6 | Top up (keypad) | Top up | UM | `TopUp` |
| REF-08.7 | Choose top-up method | Choose top-up method | UM | `TopUpMethod` |
| REF-08.8 | Top-up success | Top-up success | UM | `TopUpSuccess` |
| REF-09.1 | Personal info (edit) | Personal info (edit) | UM | `PersonalInfo` |
| REF-09.2 | Notification settings | Notifications | UM | `Notifications` |
| REF-09.3 | Account & security | Security | UM | `Security` |
| REF-09.4 | Linked accounts | Linked accounts (social) | UM | `Security`/`PaymentMethods` |
| REF-09.5 | Data & analytics | Data & analytics | UM | `Security` section |
| REF-09.6 | Payment methods | Payment methods | UM | `PaymentMethods` |
| REF-09.7 | Add new payment | Add payment | UM | `AddPayment` |
| REF-09.8 | App appearance | Appearance | UM | `Appearance` |
| REF-10.1 | Choose theme sheet | Theme selector sheet | UM | `Appearance` |
| REF-10.2 | App language | Language | UM | `Language` |
| REF-10.3 | Help & support | Help & support | UM | `Help` |
| REF-10.4 | FAQ | FAQ | UM | `FAQ` |
| REF-10.5 | Contact support | Contact support | UM | `Help` section |
| REF-10.6 | Privacy policy | Privacy policy | UM | `Help` section |
| REF-10.7 | Terms of service | Terms of service | UM | `Help` section |
| REF-10.8 | Logout dialog | Logout confirmation | UM | `Logout` |
| REF-11.1 | Ride details — booked | Booking details — booked | UM | `BookingStatus` |
| REF-11.2 | Ride details — ongoing | Booking details — ongoing | UM | `BookingStatus`/`TripTracking` |
| REF-11.3 | Ride details — completed | Booking details — completed | UM | `Activity` detail |
| REF-11.4 | Ride details — cancelled | Booking details — cancelled | UM | `Activity` detail |

## Screens added beyond the reference (required by the brief)

| Screen | Mode | Route | Reason |
|---|---|---|---|
| Driver home (online/offline) | DM | `DriverHome` | Driver mode required by brief; pattern adapted from home |
| Driver registration + verification status | DM | `DriverRegistration` | Driver onboarding has no reference equivalent |
| Vehicle management | DM | `VehicleManagement` | Ambulance management required |
| Incoming requests | DM | `DriverRequests` | Request cards reuse booking-card visual language |
| Driver trip progression | DM | `DriverTrip` | Mirrors passenger status timeline |
| Driver earnings | DM | `DriverEarnings` | Wallet/activity patterns adapted |
| Driver settings | DM | `DriverSettings` | Account patterns adapted |
| Change password | UM | `ChangePassword` | Security row expanded to a real screen |
| Device management | UM | `DeviceManagement` | Security row expanded to a real screen |
| Notifications list | UM | `Notifications` | Toggle settings screen + system |
| Booking status timeline | UM | `BookingStatus` | Persistent booking state machine |
| Empty/error/loading states | SH | inline | Required by brief Section 14 |
