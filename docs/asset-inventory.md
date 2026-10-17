# RESQ Nepal — Asset Inventory

All reference assets live in `/Users/manjilbhandari/RESQ Nepal App/reference-assets/`
(extracted from `/Users/manjilbhandari/Downloads/iloveimg-compressed.zip`). Originals are
unmodified.

## 1. Reference image files

| Asset ID | Filename | Dimensions | Panels | Content |
|---|---|---|---|---|
| REF-01 | `Screenshot 2026-10-16 at 19.12.13.png` | 2000×1283 | 3 | Vehicle selection, trip-details confirmation, "Where to?" sheet |
| REF-02 | `Screenshot 2026-10-16 at 19.14.54.png` | 2000×2033 | 8 | Splash, 3 onboarding slides, welcome, phone sign-up (empty/filled), OTP |
| REF-03 | `Screenshot 2026-10-16 at 19.15.05.png` | 2000×2033 | 8 | Personal info (empty/filled), login (empty/filled), location permission, home states |
| REF-04 | `Screenshot 2026-10-16 at 19.15.14.png` | 2000×2033 | 8 | Location search, search-selected, rides list ×3, ride details, promos, payment methods |
| REF-05 | `Screenshot 2026-10-16 at 19.15.23.png` | 2000×2033 | 8 | Processing, booking requested, booking accepted, chat, call, video call, trip tracking ×2 |
| REF-06 | `Screenshot 2026-10-16 at 19.15.31.png` | 2000×2033 | 8 | Heading-to-destination map, arrived, rating (empty/5-star), tip, feedback, rejected, cancel reasons |
| REF-07 | `Screenshot 2026-10-16 at 19.16.02.png` | 2000×2033 | 8 | Ride cancelled, promos list, promo redeem, invalid promo, promo applied, promo detail, activity ongoing/completed |
| REF-08 | `Screenshot 2026-10-16 at 19.16.11.png` | 2000×2033 | 8 | Share receipt, activity cancelled/top-up, top-up details, account, top-up, top-up method, top-up success |
| REF-09 | `Screenshot 2026-10-16 at 19.16.19.png` | 2000×2033 | 8 | Personal info, notifications, security, linked accounts, data & analytics, payment methods, add payment, appearance |
| REF-10 | `Screenshot 2026-10-16 at 19.16.28.png` | 2000×2033 | 8 | Theme sheet, language, help, FAQ, contact support, privacy, terms, logout |
| REF-11 | `Screenshot 2026-10-16 at 19.16.37.png` | 2000×1283 | 4 | Ride details in 4 states: booked, ongoing, completed, cancelled |

**Total: 11 files, 79 phone panels.** No standalone icon, logo, or illustration files exist in the
ZIP — all such imagery is embedded in the composites.

## 2. Duplicate report

- No byte-identical duplicate files exist among the 11 PNGs.
- Within composites, several panels are **intentional state variations** of one screen
  (e.g. empty vs. filled forms). These are logged as separate states in
  `screen-register.md`, not treated as duplicates.
- The only near-duplicates are the four "Ride Details" state panels in REF-11.

## 3. Application assets (created for RESQ Nepal)

| Asset | Path | Purpose |
|---|---|---|
| App icon | `assets/icon.png` | Expo adaptive icon (template default, recoloured to brand) |
| Splash | `assets/splash.png` | Splash image |
| Adaptive icon | `assets/adaptive-icon.png` | Android adaptive foreground |
| Favicon | `assets/favicon.png` | Web favicon |

The reference PNGs are **not** shipped inside the app bundle — they are design references only.

## 4. Preserved-source policy

- The original ZIP is untouched at its Downloads path.
- `reference-assets/` contains the extracted originals, also untouched.
- No reference file is imported by application code.
