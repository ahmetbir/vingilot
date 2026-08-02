#!/usr/bin/env bash
set -euo pipefail

# Runs the coordinator HTTP server for local dev (workbench, curl, etc).
#
# NOTE on the bind env var: the plan named it COORD_BIND, but main.rs already
# reads it from the environment (not hardcoded) under a different name —
# COORD_HTTP_ADDR — so this script uses the real name rather than adding a
# second, redundant knob.
cd "$(dirname "$0")/../coordinator"

export COORD_DATABASE_URL="${COORD_DATABASE_URL:-postgres://buzz:buzz_dev@localhost:5435/vingilot_coordinator}"
export COORD_AUTH_TOKEN="${COORD_AUTH_TOKEN:-vingilot-dev-token}"
export COORD_HTTP_ADDR="${COORD_HTTP_ADDR:-127.0.0.1:7117}"

exec cargo run -q --bin vingilot-coordinator
