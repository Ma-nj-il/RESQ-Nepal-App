import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('User drawer keeps relevant destinations and removes redundant navigation entries', async () => {
  const base = new URL('../../src/', import.meta.url);
  const [drawer, navigator] = await Promise.all([
    readFile(new URL('screens/user/MenuDrawerScreen.tsx', base), 'utf8'),
    readFile(new URL('navigation/UserNavigator.tsx', base), 'utf8'),
  ]);

  for (const route of [
    'Home',
    'Activity',
    'SavedHospitals',
    'SavedPlaces',
    'Notifications',
    'PersonalInfo',
    'Account',
    'Settings',
    'ApplicationStatus',
    'Help',
    'PrivacyPolicy',
    'About',
    'DriverLogin',
  ]) {
    assert.match(drawer, new RegExp(`route: '${route}'|replace\\('${route}'\\)`));
    assert.match(navigator, new RegExp(`name="${route}"`));
  }
  for (const removedLabel of ['Tips', 'Ambulance', 'Safety & SOS', 'Become a Driver']) {
    assert.doesNotMatch(drawer, new RegExp(`label="${removedLabel}"|label: '${removedLabel}'`));
  }
  assert.match(drawer, /accessibilityLabel="Switch to Driver Mode"/);
  assert.match(drawer, /accessibilityLabel="Log out"/);
  assert.match(drawer, /navigation\.popTo/);
  assert.match(drawer, /navigation\.replace/);
});

test('trip history separates local sample fixtures, production errors, and empty history', async () => {
  const screen = await readFile(
    new URL('../../src/screens/user/ActivityScreen.tsx', import.meta.url),
    'utf8',
  );
  assert.match(screen, /isDemoMode\(\) \|\| !isSupabaseConfigured/);
  assert.match(screen, /bookingsService\.getByUser\(userId\)/);
  assert.match(screen, /Demo mode — sample trips, not your real history/);
  assert.match(screen, /Trip history unavailable/);
  assert.match(screen, /No trip history yet/);
  assert.match(screen, /Return to Home/);
  assert.match(screen, /final_fare \?\? booking\.estimated_fare/);
  assert.match(screen, /formatCategory\(item\.category\)/);
  assert.match(screen, /My Trips History/);
});
