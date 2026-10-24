import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canEnterDemoDriverMode } from '../../src/utils/demoDriver.ts';

test('demo driver access requires explicit demo mode', () => {
  assert.equal(canEnterDemoDriverMode(true), true);
  assert.equal(canEnterDemoDriverMode(false), false);
});

test('demo driver session is local and returns to the existing user session', async () => {
  process.env.EXPO_PUBLIC_DEMO_MODE = 'true';
  const [{ useAuthStore }, { useDriverDemoStore }] = await Promise.all([
    import('../../src/store/authStore.ts'),
    import('../../src/store/driverDemoStore.ts'),
  ]);
  const user = {
    id: 'test-user',
    full_name: 'Test Patient',
    email: '',
    phone: '+9779800000000',
    mode: 'user',
    created_at: '',
    updated_at: '',
  };
  useAuthStore.setState({ user, isAuthenticated: true, mode: 'user' });

  assert.equal(useAuthStore.getState().loginDemoDriver(), true);
  assert.equal(useAuthStore.getState().mode, 'driver');
  assert.equal(useAuthStore.getState().isDemoDriver, true);
  assert.equal(useAuthStore.getState().user?.full_name, 'DEMO DRIVER');
  assert.equal(useDriverDemoStore.getState().activeTrip, null);

  useAuthStore.getState().returnToUserMode();
  assert.equal(useAuthStore.getState().mode, 'user');
  assert.equal(useAuthStore.getState().isAuthenticated, true);
  assert.equal(useAuthStore.getState().isDemoDriver, false);
  assert.equal(useAuthStore.getState().user?.id, user.id);

  const authStoreSource = await readFile(
    new URL('../../src/store/authStore.ts', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(authStoreSource, /services\/database|supabase/);
});

test('logout clears a demo driver session and its walkthrough state', async () => {
  process.env.EXPO_PUBLIC_DEMO_MODE = 'true';
  const [{ useAuthStore }, { useDriverDemoStore }] = await Promise.all([
    import('../../src/store/authStore.ts'),
    import('../../src/store/driverDemoStore.ts'),
  ]);
  useAuthStore.getState().loginDemoDriver();
  useDriverDemoStore.getState().setOnline(true);
  useAuthStore.getState().logout();

  assert.equal(useAuthStore.getState().user, null);
  assert.equal(useAuthStore.getState().isAuthenticated, false);
  assert.equal(useAuthStore.getState().mode, 'user');
  assert.equal(useAuthStore.getState().isDemoDriver, false);
  assert.equal(useDriverDemoStore.getState().isOnline, false);
});

test('authentication screens expose Google only and both entry stacks register Driver Login', async () => {
  const base = new URL('../../src/', import.meta.url);
  const [welcome, login, signup, authNavigator, userNavigator, appNavigator, menu] = await Promise.all([
    readFile(new URL('screens/auth/WelcomeScreen.tsx', base), 'utf8'),
    readFile(new URL('screens/auth/LoginScreen.tsx', base), 'utf8'),
    readFile(new URL('screens/auth/PhoneRegistrationScreen.tsx', base), 'utf8'),
    readFile(new URL('navigation/AuthNavigator.tsx', base), 'utf8'),
    readFile(new URL('navigation/UserNavigator.tsx', base), 'utf8'),
    readFile(new URL('navigation/AppNavigator.tsx', base), 'utf8'),
    readFile(new URL('screens/user/MenuDrawerScreen.tsx', base), 'utf8'),
  ]);

  for (const source of [welcome, login, signup]) {
    assert.doesNotMatch(source, /Continue with (?:Apple|Facebook|X|Twitter)/);
  }
  assert.match(welcome, /Continue with Google/);
  assert.match(welcome, /Driver Login/);
  assert.match(authNavigator, /name="DriverLogin"/);
  assert.match(userNavigator, /name="DriverLogin"/);
  assert.match(menu, /accessibilityLabel="Switch to Driver Mode"/);
  assert.match(menu, /onPress=\{handleSwitchToDriverMode\}/);
  assert.match(menu, /navigation\.replace\('DriverLogin'\)/);
  assert.match(appNavigator, /mode === 'driver'/);
  assert.match(appNavigator, /component=\{UserNavigator\}/);
});
