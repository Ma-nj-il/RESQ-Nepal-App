// Native-dialer unit tests — run with:  node --test qa/unit/
//
// `openNativeDialer` receives the URL-opening API as a parameter, so these
// tests exercise the real logic with a mocked `Linking.openURL` — no device
// or simulator is involved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTelUrl, openNativeDialer, toDialableNumber } from '../../src/utils/dialer.ts';

test('toDialableNumber normalises formatting and keeps a leading +', () => {
  assert.equal(toDialableNumber('+977 98-1234-5678'), '+9779812345678');
  assert.equal(toDialableNumber(' 9801234567 '), '9801234567');
  assert.equal(toDialableNumber('(01) 555-0199'), '015550199');
});

test('toDialableNumber rejects missing or impossible numbers', () => {
  assert.equal(toDialableNumber(null), null);
  assert.equal(toDialableNumber(undefined), null);
  assert.equal(toDialableNumber(''), null);
  assert.equal(toDialableNumber('   '), null);
  assert.equal(toDialableNumber('12345'), null); // too short
  assert.equal(toDialableNumber('12345678901234567890'), null); // too long
});

test('buildTelUrl produces the platform tel: URL', () => {
  assert.equal(buildTelUrl('9812345678'), 'tel:9812345678');
  assert.equal(buildTelUrl('+9779812345678'), 'tel:+9779812345678');
  assert.equal(buildTelUrl(null), null);
  assert.equal(buildTelUrl('n/a'), null);
});

test('openNativeDialer calls the URL opener exactly once with the tel: URL', async () => {
  const opened = [];
  const mockOpenUrl = async (url) => {
    opened.push(url);
    return true;
  };
  const result = await openNativeDialer('980-1234567', mockOpenUrl);
  assert.equal(result, 'opened');
  assert.deepEqual(opened, ['tel:9801234567']);
});

test('openNativeDialer never opens anything for a missing/invalid number', async () => {
  const opened = [];
  const mockOpenUrl = async (url) => {
    opened.push(url);
    return true;
  };
  assert.equal(await openNativeDialer(null, mockOpenUrl), 'invalid');
  assert.equal(await openNativeDialer('', mockOpenUrl), 'invalid');
  assert.equal(await openNativeDialer('12', mockOpenUrl), 'invalid');
  assert.deepEqual(opened, []);
});

test('openNativeDialer reports platform failures without throwing', async () => {
  const mockOpenUrl = async () => {
    throw new Error('cannot open url');
  };
  assert.equal(await openNativeDialer('9812345678', mockOpenUrl), 'failed');
});
