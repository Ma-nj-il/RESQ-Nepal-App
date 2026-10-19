/**
 * AsyncStorage keys for lightweight local preferences.
 * Keep every reader/writer of these keys in sync.
 */
export const ONBOARDING_SEEN_KEY = 'resq.hasSeenOnboarding';
export const LANGUAGE_KEY = 'resq.language';
export const NOTIFICATION_PREFS_KEY = 'resq.notificationPrefs';
/**
 * Trusted emergency contacts are intentionally device-local: they contain
 * personal phone numbers and are only used to prefill the SOS SMS composer.
 * They are never uploaded anywhere.
 */
export const EMERGENCY_CONTACTS_KEY = 'resq.emergencyContacts';
/**
 * Saved hospitals are device-local: the hospital directory is public
 * read-only and there is no per-user saved_hospitals table yet (see
 * docs/future-api-contracts.md), so the starred list lives on this phone
 * only and the UI says so. Saved places use the real `saved_places` table.
 */
export const SAVED_HOSPITALS_KEY = 'resq.savedHospitals';
/**
 * Driver partner applications are collected locally as a draft. Submission
 * must go through the future partner onboarding API (not connected in this
 * build), so the app never fakes a submitted state.
 */
export const DRIVER_APPLICATION_DRAFT_KEY = 'resq.driverApplicationDraft';
