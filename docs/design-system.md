# RESQ Nepal — Design System

Source of truth: `src/constants/theme.ts`. All screens import tokens from this file; no screen
defines raw hex values for brand colours.

## 1. Colour tokens

| Token | Value | Usage |
|---|---|---|
| `colors.primary` | `#E53935` | Emergency red — primary buttons, active states, brand |
| `colors.primaryDark` | `#C62828` | Pressed states, emphasis |
| `colors.primaryLight` | `#FF6F60` | Highlights, charts |
| `colors.surface` | `#FFFFFF` | Cards, sheets, headers |
| `colors.background` | `#F8F9FA` | Screen background |
| `colors.text` | `#1A1A2E` | High-contrast body text |
| `colors.textSecondary` | `#6B7280` | Supporting text |
| `colors.textTertiary` | `#9CA3AF` | Placeholders, captions |
| `colors.border` | `#E5E7EB` | Dividers, input borders |
| `colors.input` | `#F3F4F6` | Input fills, chips |
| `colors.success` | `#10B981` | Success semantics (pickup dot, online, completed) |
| `colors.warning` | `#F59E0B` | Surge, pending states |
| `colors.error` | `#EF4444` | Errors, cancellation |
| `colors.info` | `#3B82F6` | Informational badges |
| `colors.offline` | `#9CA3AF` | Offline driver state |
| `colors.overlay` | `rgba(0,0,0,0.5)` | Modal scrims |

Support tints (`greenLight`, `redLight`, `amberLight`, `blueLight`) back the Badge variants.

## 2. Typography

| Token | Size / weight | Usage |
|---|---|---|
| `typography.h1` | 28 / 700 | Screen hero titles ("You have arrived!") |
| `typography.h2` | 24 / 700 | Major section titles |
| `typography.h3` | 20 / 600 | Screen headers |
| `typography.h4` | 18 / 600 | Card titles |
| `typography.body` | 16 / 400 | Body copy |
| `typography.bodySmall` | 14 / 400 | Secondary copy |
| `typography.caption` | 12 / 400 | Meta text |
| `typography.button` | 16 / 600 | Button labels |

System font stack (platform default) — matches the reference's neutral grotesque.

## 3. Spacing scale

`xs 4 · sm 8 · md 12 · lg 16 · xl 20 · xxl 24 · xxxl 32`

Screen padding: `lg (16)`. Card padding: `lg (16)`. Section gaps: `xxl (24)`.

## 4. Radii

`xs 4 · sm 8 · md 12 · lg 16 · xl 20 · xxl 24 · full 9999`

Cards use `lg–xl`, buttons use `full` (pill, as in the reference), inputs use `md`,
bottom sheets use `xl` top corners.

## 5. Shadows / elevation

| Token | Elevation | Usage |
|---|---|---|
| `shadows.sm` | 1 | List cards |
| `shadows.md` | 3 | Floating cards, sheets |
| `shadows.lg` | 5 | Overlays, modals |

## 6. Component library (`src/components/ui/`)

| Component | Variants / props |
|---|---|
| `Button` | primary · secondary · outline · ghost · danger; sm/md/lg; loading; icon; fullWidth |
| `Input` | label, error, icon, rightElement; all `TextInput` props |
| `Card` | elevation sm/md/lg, onPress |
| `Badge` | success · warning · error · info · neutral · primary; style |
| `Header` | title, back, right element |
| `Avatar` | initials fallback, sm·md·lg·xl |
| `Toggle` | controlled on/off (green active — matches reference) |
| `EmptyState` | icon, title, message, action |
| `LoadingOverlay` | modal spinner + message |
| `BottomSheet` | scrim, handle, title |
| `StarRating` | interactive + readonly, sm/md/lg |

## 7. Reference-fidelity rules

1. Pills for primary actions (full radius) — matches reference buttons.
2. Bottom-sheet pattern with grab handle for selection flows.
3. Status ribbons/badges top-right or inline, per reference.
4. Map screens: floating top controls (back / safety) + bottom card.
5. Cards: white surface, 16 px radius, `shadows.sm`, 16 px padding.
6. Pickup dots are green, destination dots red — mirrors the reference's green/red map pins.

## 8. Accessibility

- Touch targets ≥ 44 × 44 (buttons lg = 56, icon buttons 40–44 with hitSlop where needed).
- Contrast: `#1A1A2E` on white ≈ 15:1; white on `#E53935` ≈ 4.9:1 (AA for large/bold text).
- `accessibilityLabel`/`accessibilityRole` set on primary interactive components.
- Dynamic text: layouts use flexible rows; long strings truncate with ellipsis.
