#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../coordinator"
# Create the database if the vingilot postgres is up (idempotent, best-effort).
if command -v docker >/dev/null && docker ps --format '{{.Names}}' | grep -q '^vingilot-postgres$'; then
  docker exec vingilot-postgres psql -U buzz -d buzz -tc \
    "SELECT 1 FROM pg_database WHERE datname='vingilot_coordinator'" | grep -q 1 || \
  docker exec vingilot-postgres psql -U buzz -d buzz -c "CREATE DATABASE vingilot_coordinator"
  export COORD_DATABASE_URL="${COORD_DATABASE_URL:-postgres://buzz:buzz_dev@localhost:5435/vingilot_coordinator}"
fi
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
# Single-threaded on purpose: the integration tests share one persistent dev
# database, and a reconciler sweep started by one test is GLOBAL — run in
# parallel, it pauses runs belonging to a concurrently-executing test and
# breaks that test's absolute count assertions. Serial execution makes the
# suite deterministic against shared state; the cost is a few seconds.
#
# This only serializes tests WITHIN this cargo test binary. It does not
# protect against a separately-running `vingilot-coordinator` server (e.g.
# from coordinator-run.sh) pointed at the same COORD_DATABASE_URL — its own
# background reconciler sweeps every 5s and will race tests/reconcile.rs's
# count assertions. Confirm no such process is running before trusting a
# reconcile.rs failure as a regression (see the CAVEAT on `cleanup()` there).
cargo test --workspace -- --test-threads=1
