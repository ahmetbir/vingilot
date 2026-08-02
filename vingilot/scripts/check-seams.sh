#!/usr/bin/env bash
# check-seams.sh — CI guard for the Vingilot upstream seam inventory.
#
# Per ADR-001 decision 6, every fork-owned path lives under vingilot/, and any
# change outside it must be a declared seam in vingilot/seams.yaml. This
# script fails when the working tree or the current branch touches a
# non-vingilot/ path that isn't listed there.
#
# See vingilot/seams.yaml's header for the exact format this script parses.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: vingilot/scripts/check-seams.sh [base-ref]

Fails (exit 1) when the working tree or the current branch changes a path
outside vingilot/ that is not declared in vingilot/seams.yaml.

Compares the union of:
  - commits on the current branch since it diverged from <base-ref>
  - uncommitted changes in the working tree (staged or not)
  - untracked files
against <base-ref>, for modified, added, deleted, and renamed paths (both
sides of a rename/copy are checked).

Arguments:
  base-ref   Git ref to compare against. Defaults to upstream/main (the
             block/buzz remote this fork tracks — NOT origin, which is this
             fork's own remote).

Options:
  -h, --help   Show this help and exit.

Exit status:
  0   no seam violations
  1   one or more violations, or a setup/usage error
EOF
}

case "${1:-}" in
  -h|--help)
    usage
    exit 0
    ;;
esac

if [[ $# -gt 1 ]]; then
  echo "check-seams: too many arguments" >&2
  usage >&2
  exit 1
fi

BASE_REF="${1:-upstream/main}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
SEAMS_FILE="$REPO_ROOT/vingilot/seams.yaml"

cd "$REPO_ROOT"

if [[ ! -f "$SEAMS_FILE" ]]; then
  echo "check-seams: seam inventory not found at vingilot/seams.yaml" >&2
  exit 1
fi

if ! git rev-parse --verify --quiet "${BASE_REF}^{commit}" >/dev/null; then
  {
    echo "check-seams: base ref '$BASE_REF' does not resolve to a commit."
    if [[ "$BASE_REF" == "upstream/main" ]]; then
      echo "The 'upstream' remote (block/buzz) may not be fetched. Try: git fetch upstream"
    else
      echo "Fetch it, or pass a resolvable ref/SHA as an argument."
    fi
  } >&2
  exit 1
fi

# --- load declared seam patterns from vingilot/seams.yaml --------------------
# Parses only lines shaped like:  - path: "<pattern>"
# (see the format block at the top of seams.yaml for the contract).
declare -a SEAM_PATTERNS=()
while IFS= read -r pattern; do
  [[ -n "$pattern" ]] && SEAM_PATTERNS+=("$pattern")
done < <(grep -E '^[[:space:]]*-[[:space:]]*path:[[:space:]]*"' "$SEAMS_FILE" \
           | sed -E 's/^[[:space:]]*-[[:space:]]*path:[[:space:]]*"([^"]*)".*/\1/' || true)

is_allowed() {
  local path="$1"
  case "$path" in
    vingilot/*) return 0 ;;
  esac
  local pattern
  for pattern in "${SEAM_PATTERNS[@]+"${SEAM_PATTERNS[@]}"}"; do
    # Intentionally unquoted: $pattern is used as a case/glob pattern here,
    # not a literal string (see seams.yaml format rule 3).
    case "$path" in
      $pattern) return 0 ;;
    esac
  done
  return 1
}

declare -a OFFENDING=()

check_path() {
  local path="$1"
  [[ -z "$path" ]] && return
  is_allowed "$path" || OFFENDING+=("$path")
}

# Tracked-path changes (modified/added/deleted/renamed/copied). Two passes,
# both needed:
#
# 1. Commits the current branch has made since it diverged from BASE_REF.
#    Uses `A...B` (merge-base) diff, NOT `A B`: BASE_REF is a remote-tracking
#    ref (upstream/main by default) that moves independently of this branch,
#    so a plain two-dot diff against it would also surface every file
#    upstream itself changed after the fork's last sync — noise this script
#    must not treat as a seam violation. `git diff X...Y` diffs
#    merge-base(X,Y) against Y, which isolates just this branch's own
#    commits.
# 2. Uncommitted working-tree state (staged + unstaged), diffed against HEAD
#    — HEAD is a fixed local commit, so a plain two-dot diff is correct and
#    doesn't need merge-base.
parse_diff() {
  while IFS= read -r -d '' status; do
    [[ -z "$status" ]] && continue
    IFS= read -r -d '' path1
    case "$status" in
      R*|C*)
        IFS= read -r -d '' path2
        check_path "$path1"
        check_path "$path2"
        ;;
      *)
        check_path "$path1"
        ;;
    esac
  done
}

# Process substitution, not a pipe: `parse_diff` mutates OFFENDING (a
# variable in this shell), and the reading side of a pipe runs in a subshell
# in bash, which would silently drop those mutations. `< <(...)` keeps
# parse_diff in the current shell.
parse_diff < <(git diff --name-status -z "${BASE_REF}...HEAD")
parse_diff < <(git diff --name-status -z HEAD)

# Untracked files never appear in `git diff`; list them separately.
# --untracked-files=all expands whole untracked directories into their
# individual files (still respecting .gitignore), so entries here are always
# plain "?? <path>" with no rename encoding to worry about.
while IFS= read -r -d '' entry; do
  [[ "${entry:0:2}" == "??" ]] || continue
  check_path "${entry:3}"
done < <(git status --porcelain=v1 -z --untracked-files=all)

if [[ ${#OFFENDING[@]} -eq 0 ]]; then
  exit 0
fi

{
  printf 'check-seams: %d path(s) outside vingilot/ are not declared in vingilot/seams.yaml:\n\n' "${#OFFENDING[@]}"
  for path in "${OFFENDING[@]}"; do
    printf '  %s\n' "$path"
  done
  printf '\nDeclare each path (or a covering glob) as an entry in vingilot/seams.yaml (see its\nformat block), or move the change under vingilot/.\n'
} >&2

exit 1
