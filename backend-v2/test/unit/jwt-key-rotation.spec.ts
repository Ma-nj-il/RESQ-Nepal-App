import { generateKeyPairSync } from 'node:crypto';

import { EdDsaAccessTokenService } from '../../src/identity-access/infrastructure/crypto/eddsa-access-token.service.js';
import { loadApplicationConfig } from '../../src/shared/infrastructure/config/application-config.js';

const NOW = new Date('2026-11-03T12:00:00.000Z');

describe('Ed25519 access-token key rotation', () => {
  it('publishes a new signing key while retaining and then retiring the grace key', () => {
    const config = loadApplicationConfig({ NODE_ENV: 'test' }, 'api');
    const tokens = new EdDsaAccessTokenService(config);
    const oldKeyId = config.authentication.signingKeyId;
    const oldToken = tokens.issue({
      userId: '018f0000-0000-7000-8000-000000000001',
      sessionId: '018f0000-0000-7000-8000-000000000002',
      assurance: 'AAL1',
      tokenVersion: 1,
      authenticationMethods: ['otp'],
      now: NOW,
      tokenId: '018f0000-0000-7000-8000-000000000003',
    });
    const replacement = generateKeyPairSync('ed25519');

    tokens.installSigningKey('replacement-key', replacement.privateKey, replacement.publicKey);
    const newToken = tokens.issue({
      userId: '018f0000-0000-7000-8000-000000000001',
      sessionId: '018f0000-0000-7000-8000-000000000002',
      assurance: 'AAL2',
      tokenVersion: 1,
      authenticationMethods: ['otp', 'totp'],
      now: NOW,
      tokenId: '018f0000-0000-7000-8000-000000000004',
    });

    expect(tokens.jwks().keys.map((key) => key['kid'])).toEqual(
      expect.arrayContaining([oldKeyId, 'replacement-key']),
    );
    expect(tokens.verify(oldToken.token, NOW).assurance).toBe('AAL1');
    expect(tokens.verify(newToken.token, NOW).assurance).toBe('AAL2');

    tokens.retireVerificationKey(oldKeyId);
    let verificationError: unknown;
    try {
      tokens.verify(oldToken.token, NOW);
    } catch (error: unknown) {
      verificationError = error;
    }
    expect(verificationError).toMatchObject({ code: 'AUTH.ACCESS_TOKEN_INVALID' });
    expect(tokens.verify(newToken.token, NOW).assurance).toBe('AAL2');
  });
});
