#!/usr/bin/env bash
# Read-only reconnaissance for the upstream merge ritual (see
# vingilot/docs/upstream-merge.md). Reports, for the range between the
# current merge-base and upstream's head:
#   - how many commits and files are incoming
#   - which incoming files intersect the declared seams in vingilot/seams.yaml
#   - which incoming files the fork has also modified (real conflict candidates)
#   - a one-line verdict: clean / review-needed / risky
#
# This script never modifies the working tree, never merges, and never
# force-pushes or force-fetches. It exits 0 on success regardless of verdict;
# non-zero only on operational failure (not a git repo, bad ref, etc).
set -euo pipefail

# One definition of what a seam pattern means and how the registry is parsed,
# shared with vingilot/scripts/check-seams.sh. See the Seam intersection block
# below for why sharing it is not optional.
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Same guard, same reason as check-seams.sh: the library is a separate file, so
# a commit that stages only tracked edits leaves this script sourcing something
# that is not there. A bash "No such file or directory" under `set -e` does not
# say which of the two it is.
if [[ ! -f "$script_dir/lib/seam-glob.sh" ]]; then
  echo "upstream-merge-dryrun: vingilot/scripts/lib/seam-glob.sh is missing." >&2
  echo "It holds the seam pattern matcher this script decides coverage with." >&2
  echo "  git add vingilot/scripts/lib/seam-glob.sh" >&2
  exit 1
fi
# shellcheck source=lib/seam-glob.sh
. "$script_dir/lib/seam-glob.sh"

# "origin" is this fork's own remote (Vingilot); the real upstream (block/buzz)
# is the "upstream" remote (see vingilot/docs/upstream-merge.md § Remotes).
remote="upstream"
branch="main"
do_fetch=1
verbose=0
quiet=0
seams_file_override=""

usage() {
  cat <<'EOF'
Usage: upstream-merge-dryrun.sh [options]

Read-only check of what upstream has that the fork doesn't yet, before
running the actual merge described in vingilot/docs/upstream-merge.md.

Options:
  --remote <name>       Upstream git remote to compare against (default: upstream)
  --branch <name>       Upstream branch to compare against (default: main)
  --seams-file <path>   Path to seams.yaml (default: <repo>/vingilot/seams.yaml)
  --no-fetch            Don't fetch before comparing; use whatever refs are
                         already local (may be stale)
  --verbose             Also list every incoming commit and file, not just
                         the seam hits and conflict candidates
  --quiet, -q            Print only the VERDICT line
  -h, --help            Show this help and exit

Exit status:
  0   ran successfully, regardless of verdict (see the VERDICT line)
  >0  operational failure: not a git repo, remote/branch not resolvable,
      no common ancestor, or a bad argument

Examples:
  scripts/upstream-merge-dryrun.sh
  scripts/upstream-merge-dryrun.sh --remote upstream --branch main
  scripts/upstream-merge-dryrun.sh --no-fetch --quiet
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --remote) remote="${2:?--remote requires a value}"; shift 2 ;;
    --branch) branch="${2:?--branch requires a value}"; shift 2 ;;
    --seams-file) seams_file_override="${2:?--seams-file requires a value}"; shift 2 ;;
    --no-fetch) do_fetch=0; shift ;;
    --verbose) verbose=1; shift ;;
    --quiet|-q) quiet=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "error: unknown argument: $1" >&2; usage >&2; exit 1 ;;
  esac
done

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "error: not inside a git repository" >&2
  exit 1
}
cd "$repo_root"

upstream_ref="${remote}/${branch}"
seams_file="${seams_file_override:-$repo_root/vingilot/seams.yaml}"

if [ "$do_fetch" -eq 1 ]; then
  if ! git fetch --quiet "$remote" "$branch" 2>/dev/null; then
    echo "warning: 'git fetch $remote $branch' failed; comparing against the last known $upstream_ref (may be stale)" >&2
  fi
fi

if ! git rev-parse --verify --quiet "$upstream_ref" >/dev/null; then
  echo "error: '$upstream_ref' does not resolve locally. Check --remote/--branch, or run without --no-fetch." >&2
  exit 1
fi

if ! merge_base=$(git merge-base HEAD "$upstream_ref" 2>/dev/null); then
  echo "error: no common ancestor between HEAD and $upstream_ref" >&2
  exit 1
fi

upstream_sha=$(git rev-parse "$upstream_ref")
head_sha=$(git rev-parse HEAD)

print_verdict() {
  printf 'VERDICT: %s\n' "$1"
}

# --- Nothing incoming: short-circuit ---
if [ "$merge_base" = "$upstream_sha" ]; then
  if [ "$quiet" -eq 1 ]; then
    print_verdict "clean (up to date, nothing incoming)"
    exit 0
  fi
  print_verdict "clean (up to date, nothing incoming)"
  echo
  echo "Remote:        $upstream_ref"
  echo "HEAD:          $head_sha"
  echo "Merge base:    $merge_base (== $upstream_ref)"
  echo "Nothing to merge."
  echo
  print_verdict "clean (up to date, nothing incoming)"
  exit 0
fi

# --- Incoming commits/files ---
incoming_commit_count=$(git rev-list --count "${merge_base}..${upstream_ref}")
incoming_files=$(git diff --name-only "$merge_base" "$upstream_ref" -- | sort -u)
incoming_file_count=0
[ -n "$incoming_files" ] && incoming_file_count=$(printf '%s\n' "$incoming_files" | wc -l | tr -d ' ')

# --- Fork-side changes: committed since merge-base, plus anything not yet committed ---
fork_committed=$(git diff --name-only "$merge_base" HEAD -- | sort -u)
fork_uncommitted=$(
  {
    git diff --name-only --
    git diff --name-only --cached --
    git status --porcelain=v1 -- 2>/dev/null | awk '/^\?\?/ {print substr($0, 4)}'
  } | sort -u
)
fork_modified=$(printf '%s\n%s\n' "$fork_committed" "$fork_uncommitted" | sed '/^$/d' | sort -u)

conflict_candidates=""
if [ -n "$incoming_files" ] && [ -n "$fork_modified" ]; then
  conflict_candidates=$(comm -12 <(printf '%s\n' "$incoming_files") <(printf '%s\n' "$fork_modified"))
fi
conflict_count=0
[ -n "$conflict_candidates" ] && conflict_count=$(printf '%s\n' "$conflict_candidates" | wc -l | tr -d ' ')

# --- Seam intersection ---
# vingilot/seams.yaml's own format block mandates one shape for every entry:
#   - path: "<pattern>"
#     reason: "..." / owner: "..." / removable_when: "..." / status: "..." / added: "..."
# `path` is always the first key, on the same line as the leading "- ", as a
# single-line double-quoted string (see the file's header for the full
# contract; vingilot/scripts/check-seams.sh enforces the same contract from
# the other direction — our outgoing diffs against it).
#
# Both the parsing and the matching come from vingilot/scripts/lib/seam-glob.sh,
# which check-seams.sh also sources, so the two scripts cannot disagree about
# what a seam pattern covers. They did until 2026-08-11: this script matched
# with bash `case`, where `*` crosses `/`, while the gate had been taught that
# `*` stays inside one path segment — so `desktop/ds-*` "hit" on
# `desktop/ds-x/deep/y.ts` here and would NOT have been authorised there. The
# dry-run's job is to predict the gate's answer, so it has to compute it the
# same way.
#
# The registry is a root file plus vingilot/seams/*.yaml fragments;
# --seams-file overrides the whole set with one file (used by tests).
seams_status="ok"
seam_pattern_count=0
if [ -n "$seams_file_override" ] && [ ! -f "$seams_file_override" ]; then
  echo "error: --seams-file given but not found: $seams_file_override" >&2
  exit 1
fi
seam_registry=""
if [ -n "$seams_file_override" ]; then
  seam_registry="$seams_file_override"
else
  seam_registry=$(seam_registry_files "$repo_root")
fi
if [ ! -f "$seams_file" ]; then
  seams_status="missing"
else
  # $seam_registry is one path per line; split on newlines only, so a fragment
  # path containing a space survives.
  old_ifs="${IFS:-}"
  IFS=$'\n'
  # shellcheck disable=SC2086 # deliberate split: one registry path per line
  seam_load_regexes $seam_registry
  IFS="$old_ifs"
  seam_pattern_count="${#SEAM_REGEXES[@]}"
fi

seam_hits=""
if [ "$seams_status" = "ok" ] && [ -n "$incoming_files" ]; then
  # One compile of the whole registry, then one pass per incoming file. The
  # obvious nesting -- compile a pattern inside the per-file loop -- is ~160
  # subshells per file and took minutes on a real upstream range.
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    if seam_regex_match "$f"; then
      seam_hits="${seam_hits}${f}"$'\n'
    fi
  done < <(printf '%s\n' "$incoming_files")
  seam_hits=$(printf '%s' "$seam_hits" | sed '/^$/d' | sort -u)
fi
seam_hit_count=0
[ -n "$seam_hits" ] && seam_hit_count=$(printf '%s\n' "$seam_hits" | wc -l | tr -d ' ')

# --- Verdict ---
# risky:         upstream and the fork changed the same file since merge-base
#                (or the fork has uncommitted changes there) -- a real git
#                conflict is likely.
# review-needed: no direct conflict, but upstream touched a path this fork
#                has declared as a seam (permanent, marker-commented edit
#                that may predate this merge-base and so wouldn't show up
#                as a "fork changed it recently" diff) -- or seams.yaml is
#                missing, so seam risk could not be checked at all.
# clean:         neither of the above.
if [ "$conflict_count" -gt 0 ]; then
  verdict="risky ($conflict_count file(s) changed on both sides)"
elif [ "$seams_status" = "missing" ]; then
  verdict="review-needed (vingilot/seams.yaml not found; seam risk unchecked)"
elif [ "$seam_hit_count" -gt 0 ]; then
  verdict="review-needed ($seam_hit_count incoming file(s) touch a declared seam)"
else
  verdict="clean"
fi

if [ "$quiet" -eq 1 ]; then
  print_verdict "$verdict"
  exit 0
fi

print_verdict "$verdict"
echo
echo "Remote:            $upstream_ref"
echo "HEAD:               $head_sha"
echo "Merge base:         $merge_base"
echo "Upstream head:      $upstream_sha"
echo "Incoming commits:  $incoming_commit_count"
echo "Incoming files:    $incoming_file_count"
echo

echo "Seam check: $(printf '%s\n' "$seam_registry" | sed "s|^$repo_root/||" | paste -sd' ' -)"
if [ "$seams_status" = "missing" ]; then
  echo "  SKIPPED — file not found at $seams_file"
else
  echo "  $seam_pattern_count seam path(s)/pattern(s) declared"
  if [ "$seam_hit_count" -gt 0 ]; then
    echo "  $seam_hit_count incoming file(s) touch a declared seam:"
    printf '%s\n' "$seam_hits" | sed 's/^/    /'
  else
    echo "  no incoming file touches a declared seam"
  fi
fi
echo

echo "Conflict candidates (changed by upstream AND by the fork since $merge_base):"
if [ "$conflict_count" -gt 0 ]; then
  printf '%s\n' "$conflict_candidates" | sed 's/^/  /'
else
  echo "  none"
fi
echo

if [ "$verbose" -eq 1 ]; then
  echo "All incoming commits:"
  git log --format='  %h %s' "${merge_base}..${upstream_ref}" | sed 's/^/  /'
  echo
  echo "All incoming files:"
  printf '%s\n' "$incoming_files" | sed 's/^/  /'
  echo
fi

print_verdict "$verdict"
