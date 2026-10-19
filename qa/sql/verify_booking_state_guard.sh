#!/usr/bin/env bash
# Local SQL verification for the booking state-machine and authorization guard.
#
# Requires Docker. Starts a disposable PostgreSQL 16 container, applies the
# base schema, the new booking guard migration (20261019_booking_state_guard.sql),
# runs it twice for idempotency, and executes test_booking_state_guard.sql.
#
# Marked BLOCKED when Docker / disk infrastructure is unavailable.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONTAINER="${RESQ_SQL_CONTAINER:-resq-verify-booking-pg}"
PORT="${RESQ_SQL_PORT:-55433}"
IMAGE="${RESQ_SQL_IMAGE:-postgres:16-alpine}"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if ! command -v docker >/dev/null 2>&1; then
  echo "BLOCKED: Docker CLI not found."
  exit 0
fi

if ! docker version >/dev/null 2>&1; then
  echo "BLOCKED: Docker daemon is not responding (disk full / VM stopped)."
  exit 0
fi

cleanup
if ! docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=resq_local_only \
  -p "${PORT}:5432" \
  "$IMAGE" >/dev/null 2>&1; then
  echo "BLOCKED: Could not start container (likely disk capacity limit)."
  exit 0
fi

for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then
  echo "BLOCKED: PostgreSQL container did not become ready."
  exit 0
fi

psql_file() {
  docker exec -i "$CONTAINER" psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres < "$1" >/dev/null
}

psql_file "$ROOT/qa/sql/00_stub_supabase.sql"
psql_file "$ROOT/supabase/schema.sql"

# Apply hardening patch and migration twice (idempotency check)
psql_file "$ROOT/supabase/patches/accept_booking_ownership_guard.sql"
psql_file "$ROOT/supabase/migrations/20261019_booking_state_guard.sql"
psql_file "$ROOT/supabase/migrations/20261019_booking_state_guard.sql"

docker exec -i "$CONTAINER" psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
  < "$ROOT/qa/sql/test_booking_state_guard.sql"

echo "PASS: booking state guard SQL verification"
