import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.EXPO_PUBLIC_DEMO_MODE = 'false';
const { useAuthStore } = await import('../../src/store/authStore.ts');

test('demo driver login cannot create a session when demo mode is disabled', () => {
  assert.equal(useAuthStore.getState().loginDemoDriver(), false);
  assert.equal(useAuthStore.getState().isAuthenticated, false);
  assert.equal(useAuthStore.getState().isDemoDriver, false);
  assert.equal(useAuthStore.getState().mode, 'user');
});
