#!/usr/bin/env bash
set -euo pipefail

# Runs the executor's worker loop for local dev: polls a workspace for
# `ready` delegated Runs and executes them one at a time against a real
# git worktree (plan §Task 3).
#
# Usage: vingilot/scripts/executor-run.sh <workspace-id>
cd "$(dirname "$0")/../coordinator"

export COORD_BASE="${COORD_BASE:-http://127.0.0.1:7117}"
export COORD_AUTH_TOKEN="${COORD_AUTH_TOKEN:-vingilot-dev-token}"
export VINGILOT_REPOS="${VINGILOT_REPOS:-buzz=/Users/ahmetyusufbirinci/self-hosted/vingilot}"
export VINGILOT_WORKTREE_ROOT="${VINGILOT_WORKTREE_ROOT:-$HOME/.vingilot/worktrees}"
# VINGILOT_CMD, if set, replaces the default `echo executing: {objective}`
# body of the `sh -c` command template the executor runs per Run.
export VINGILOT_CMD="${VINGILOT_CMD:-}"
[ -n "$VINGILOT_CMD" ] || unset VINGILOT_CMD

WORKSPACE_ID="${1:?usage: executor-run.sh <workspace-id>}"

exec cargo run -q -p vingilot-executor --bin vingilot-executor -- worker --workspace "$WORKSPACE_ID"
