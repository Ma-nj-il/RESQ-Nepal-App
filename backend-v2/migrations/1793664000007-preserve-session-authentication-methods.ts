import type { MigrationInterface, QueryRunner } from 'typeorm';

export const SESSION_AUTHENTICATION_METHODS_SQL = String.raw`
ALTER TABLE identity.auth_sessions
  ADD COLUMN authentication_methods varchar(16)[];

-- Historical sessions predate persisted AMR. OTP is the only provenance that can be asserted
-- without inventing password or TOTP evidence; active clients rotate into an exact value.
UPDATE identity.auth_sessions SET authentication_methods = ARRAY['otp']::varchar[];

ALTER TABLE identity.auth_sessions
  ALTER COLUMN authentication_methods SET NOT NULL,
  ADD CONSTRAINT auth_session_authentication_methods CHECK (
    cardinality(authentication_methods) BETWEEN 1 AND 3
    AND authentication_methods <@ ARRAY['otp','password','totp']::varchar[]
    AND cardinality(array_positions(authentication_methods, 'otp'::varchar)) <= 1
    AND cardinality(array_positions(authentication_methods, 'password'::varchar)) <= 1
    AND cardinality(array_positions(authentication_methods, 'totp'::varchar)) <= 1
  );
`;

export class PreserveSessionAuthenticationMethods1793664000007 implements MigrationInterface {
  readonly name = 'PreserveSessionAuthenticationMethods1793664000007';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(SESSION_AUTHENTICATION_METHODS_SQL);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error('Forward-only migration: rollback is intentionally unsupported'),
    );
  }
}
