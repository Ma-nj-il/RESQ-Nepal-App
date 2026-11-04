import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidNepaliPhone, normalizeNepaliPhoneInput } from '../../src/utils/format.ts';

test('normalizes local and +977 Nepali mobile input to ten local digits', () => {
  assert.equal(normalizeNepaliPhoneInput('9812345678'), '9812345678');
  assert.equal(normalizeNepaliPhoneInput('+977 98-1234-5678'), '9812345678');
  assert.equal(normalizeNepaliPhoneInput('9771234567'), '9771234567');
});

test('validates supported Nepali mobile prefixes', () => {
  assert.equal(isValidNepaliPhone(normalizeNepaliPhoneInput('+9779812345678')), true);
  assert.equal(isValidNepaliPhone(normalizeNepaliPhoneInput('9612345678')), true);
  assert.equal(isValidNepaliPhone(normalizeNepaliPhoneInput('9512345678')), false);
});
