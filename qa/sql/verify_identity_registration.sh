#!/usr/bin/env bash
# Local SQL verification for the identity-registration migrations.
#
# Requires Docker. Starts a disposable PostgreSQL 16 container, installs the
# minimum Supabase-compatible stubs (auth.users / auth.uid / storage.objects),
# applies the base schema and both forward migrations twice (idempotency), then
# runs the RLS/RPC/constraint assertions in test_identity_registration.sql.
#
# This does NOT touch the hosted Supabase project and does not prove Storage
# binary upload behaviour. See docs/identity-registration-status-implementation.md.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONTAINER="${RESQ_SQL_CONTAINER:-resq-verify-pg}"
PORT="${RESQ_SQL_PORT:-55432}"
IMAGE="${RESQ_SQL_IMAGE:-postgres:16-alpine}"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if ! command -v docker >/dev/null 2>&1; then
  echo "FAIL: Docker is required for the SQL verification."
  exit 1
fi

cleanup
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=resq_local_only \
  -p "${PORT}:5432" \
  "$IMAGE" >/dev/null

for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then
  echo "FAIL: PostgreSQL did not become ready."
  exit 1
fi

psql_file() {
  docker exec -i "$CONTAINER" psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres < "$1" >/dev/null
}

psql_file "$ROOT/qa/sql/00_stub_supabase.sql"
psql_file "$ROOT/supabase/schema.sql"

# Idempotency: both migrations must be safe to re-run.
psql_file "$ROOT/supabase/migrations/20261019_identity_registration.sql"
psql_file "$ROOT/supabase/migrations/20261019_identity_storage.sql"
psql_file "$ROOT/supabase/migrations/20261019_identity_registration.sql"
psql_file "$ROOT/supabase/migrations/20261019_identity_storage.sql"

docker exec -i "$CONTAINER" psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
  < "$ROOT/qa/sql/test_identity_registration.sql"

echo "PASS: identity registration SQL verification (local PostgreSQL stub)"
