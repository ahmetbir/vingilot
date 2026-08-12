#!/usr/bin/env bash
# check-seams.sh — CI guard for the Vingilot upstream seam inventory.
#
# Per ADR-001 decision 6, every fork-owned path lives under vingilot/, and any
# change outside it must be a declared seam in the seam registry
# (vingilot/seams.yaml plus vingilot/seams/*.yaml). This script fails when the
# working tree or the current branch touches a non-vingilot/ path that isn't
# listed there.
#
# It runs in CI from the `seams` job of .github/workflows/vingilot-desktop.yml
# and locally as `just seams`. Both run `--self-test` first: the gate's whole
# value is rejection, so the rejection path is the part that needs a test.
#
# See vingilot/seams.yaml's header for the exact format this script parses, and
# vingilot/scripts/lib/seam-glob.sh for what a seam pattern means.
#
# Written for bash 3.2 (the macOS system bash this repo is developed on), which
# is why arrays are expanded through the `${a[@]+"${a[@]}"}` idiom and no
# assertion returns a value through a command substitution.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: vingilot/scripts/check-seams.sh [base-ref]
       vingilot/scripts/check-seams.sh --check-paths [file]
       vingilot/scripts/check-seams.sh --self-test

Fails (exit 1) when the working tree or the current branch changes a path
outside vingilot/ that is not declared in the seam registry
(vingilot/seams.yaml plus vingilot/seams/*.yaml).

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
  -h, --help          Show this help and exit.
      --check-paths [file]
                      Read repo-relative paths (one per line) from <file> or
                      stdin and report the ones no seam declares. Reads the
                      registry, no git state — the decision layer on its own,
                      which is what makes it testable and scriptable.
      --self-test     Run the gate's own assertions and exit: the pattern
                      matcher, the allow/reject decision, the change-collection
                      pipeline (driven by a stubbed git), the guards on the
                      registry itself, the real registry file set, and that
                      something still invokes this gate. Reads no git HISTORY —
                      it does read the repo's layout, its registry files, the
                      Justfile and the workflow from disk — and writes only its
                      own temp fixtures.

Exit status:
  0   no seam violations
  1   one or more violations, or a setup/usage error
EOF
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# The matcher lives in a sibling file as of 2026-08-11, so this script is no
# longer self-contained and can now fail before its first line of work. The
# named way it does: lib/seam-glob.sh was new and untracked when it was written,
# and the house rule forbids `git add -A`, so a `git add -u` commit stages the
# edit to THIS file and omits the library it needs. Without this check that lands
# as `check-seams.sh: line 68: .../lib/seam-glob.sh: No such file or directory`
# under `set -e` — a bash sourcing error, which reads as a broken script rather
# than an incomplete commit. Say which it is.
if [[ ! -f "$SCRIPT_DIR/lib/seam-glob.sh" ]]; then
  echo "check-seams: vingilot/scripts/lib/seam-glob.sh is missing." >&2
  echo "It holds the seam pattern matcher and this script cannot run without it." >&2
  echo "If this is a fresh clone or checkout, the file was probably never committed:" >&2
  echo "  git add vingilot/scripts/lib/seam-glob.sh" >&2
  exit 1
fi
# shellcheck source=lib/seam-glob.sh
. "$SCRIPT_DIR/lib/seam-glob.sh"

# --- registry ----------------------------------------------------------------

# SEAM_REGEXES and the compilation live in the shared lib, because the incoming
# half of the ritual (upstream-merge-dryrun.sh) has to reach the same verdict.
load_seams() {
  seam_load_regexes "$@"
}

# The house rule is 1000 lines per file, ratcheted, split never raised — and
# the automated ratchet (desktop/scripts/check-file-sizes.mjs) sees only .ts,
# .tsx, .rs and .css under desktop's source roots, so the registry grew past
# the ceiling once with nothing reporting it. The registry is the file set this
# script already reads, so it is the cheapest place to say so. Split a fragment
# out into vingilot/seams/ rather than raising this number.
REGISTRY_LINE_LIMIT=1000

check_registry_size() {
  local file lines over=0
  for file in "$@"; do
    lines=$(wc -l <"$file")
    lines=${lines// /}
    if ((lines > REGISTRY_LINE_LIMIT)); then
      printf 'check-seams: %s is %d lines, over the %d-line ceiling.\n' \
        "$file" "$lines" "$REGISTRY_LINE_LIMIT" >&2
      over=$((over + 1))
    fi
  done
  if ((over > 0)); then
    printf 'Move a block of entries into a new vingilot/seams/<topic>.yaml (fragments are\nglobbed, so no script needs changing) rather than raising the ceiling.\n' >&2
    return 1
  fi
  return 0
}

is_allowed() {
  local path="$1"
  # Prefix rule, not a seam pattern: everything under vingilot/ is fork-owned
  # and always allowed (seams.yaml format rule 4). `*` in a bash case pattern
  # crosses `/`, which is what a prefix test wants.
  case "$path" in
    vingilot/*) return 0 ;;
  esac
  seam_regex_match "$path"
}

# --- change collection -------------------------------------------------------

declare -a OFFENDING=()

check_path() {
  local path="$1"
  [[ -z "$path" ]] && return 0
  is_allowed "$path" || OFFENDING+=("$path")
  return 0
}

# Reads a `git diff --name-status -z` stream: NUL-separated status, path, and
# for renames/copies a second path. Both sides of a rename are checked — moving
# a file out of an undeclared path is still a change to that path.
parse_diff() {
  local status path1 path2
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

# Reads a `git status --porcelain=v1 -z --untracked-files=all` stream and keeps
# only the untracked entries. Untracked files never appear in `git diff`, and
# they are how a brand-new undeclared file arrives. --untracked-files=all
# expands whole untracked directories into individual files (still respecting
# .gitignore), so entries are always plain "?? <path>" with no rename encoding.
parse_untracked() {
  local entry
  while IFS= read -r -d '' entry; do
    [[ "${entry:0:2}" == "??" ]] || continue
    check_path "${entry:3}"
  done
}

# The three sources of changed paths, and all three are needed:
#
# 1. Commits the current branch has made since it diverged from BASE_REF.
#    Uses `A...B` (merge-base) diff, NOT `A B`: BASE_REF is a remote-tracking
#    ref (upstream/main by default) that moves independently of this branch,
#    so a plain two-dot diff against it would also surface every file upstream
#    itself changed after the fork's last sync — noise this script must not
#    treat as a seam violation. `git diff X...Y` diffs merge-base(X,Y) against
#    Y, which isolates just this branch's own commits.
# 2. Uncommitted working-tree state (staged + unstaged), diffed against HEAD —
#    HEAD is a fixed local commit, so a plain two-dot diff is correct and does
#    not need merge-base.
# 3. Untracked files.
#
# Process substitution, not a pipe: the parsers mutate OFFENDING, a variable in
# this shell, and the reading side of a pipe runs in a subshell in bash, which
# would silently drop those mutations. `< <(...)` keeps the parser in the
# current shell.
#
# `git` is called plainly (never `command git`) so --self-test can shadow it
# with a stub function and assert that each of these three sources really
# contributes. Deleting any one of them — or its call site — is a mutation that
# makes the gate accept undeclared paths, and self-test block 3 catches it.
collect_changes() {
  local base_ref="$1"
  parse_diff < <(git diff --name-status -z "${base_ref}...HEAD")
  parse_diff < <(git diff --name-status -z HEAD)
  parse_untracked < <(git status --porcelain=v1 -z --untracked-files=all)
}

report_offenders() {
  if [[ ${#OFFENDING[@]} -eq 0 ]]; then
    return 0
  fi
  {
    printf 'check-seams: %d path(s) outside vingilot/ are not declared in the seam registry:\n\n' "${#OFFENDING[@]}"
    local path
    for path in "${OFFENDING[@]}"; do
      printf '  %s\n' "$path"
    done
    printf '\nDeclare each path (or a covering glob) as an entry in vingilot/seams.yaml or a\nvingilot/seams/*.yaml fragment (see the format block in vingilot/seams.yaml),\nor move the change under vingilot/.\n'
  } >&2
  return 1
}

# --- self-test ---------------------------------------------------------------
# Six blocks, because there are six places a regression hides:
#
#   1. the pattern translation                (glob_to_regex)
#   2. the allow/reject decision              (is_allowed, --check-paths)
#   3. the collection pipeline that feeds it   (collect_changes, stubbed git)
#   4. the guards on the registry file set     (line ceiling, the dry-run's
#                                               agreement with this script)
#   5. the real registry file set             (discovery, and the parser's
#                                               contract with the real files)
#   6. that something still invokes the gate   (the workflow, the Justfile)
#
# Block 1 used to be the whole self-test, and three separate mutations that made
# the gate accept an undeclared path all left it reporting 20/20 passed. Blocks
# 5 and 6 were added for the same reason one block down: with 1-4 in place, a
# mutant that deleted the registry's fragment glob, and a mutant that deleted the
# CI job, each left the self-test fully green.
#
# Blocks 1-4 touch nothing but temp fixtures. Blocks 5 and 6 read four of the
# repo's own files, and read them only — the properties they assert are
# properties OF those files, so a fixture cannot hold them.

SELF_TEST_FAILURES=0
SELF_TEST_ASSERTIONS=0

# Counters are globals, not return values: a `count=$(fn)` would run fn in a
# subshell and lose every failure it recorded.
assertion() {
  SELF_TEST_ASSERTIONS=$((SELF_TEST_ASSERTIONS + 1))
}

fail_assert() {
  printf 'self-test FAIL: %s\n' "$1" >&2
  SELF_TEST_FAILURES=$((SELF_TEST_FAILURES + 1))
}

new_fixture() {
  # BSD mktemp wants the template to END in X's, so no .yaml suffix here; the
  # registry parser keys off content, not extension.
  mktemp "${TMPDIR:-/tmp}/vingilot-seams-fixture.XXXXXX"
}

# A registry fixture in the same narrow format the real files use, so the
# parser under test is the parser in production.
write_fixture_registry() {
  cat >"$1" <<'EOF'
schema_version: 1

seams:
  - path: "desktop/src/features/runs/**"
    reason: "Fixture."
    owner: "self-test"
    removable_when: "Never."
    status: "permanent"
    added: "2026-08-11"

  - path: "desktop/src/app/App.tsx"
    reason: "Fixture."
    owner: "self-test"
    removable_when: "Never."
    status: "permanent"
    added: "2026-08-11"

  - path: "desktop/ds-*"
    reason: "Fixture."
    owner: "self-test"
    removable_when: "Never."
    status: "permanent"
    added: "2026-08-11"
EOF
}

# Block 1: pattern translation, both directions.
self_test_patterns() {
  local case_spec expect pattern path re
  # "<pattern>|<path>|match" or "|nomatch"
  local -a cases=(
    # * stays inside one segment -- the bug this matcher exists to fix
    'desktop/src/*|desktop/src/App.tsx|match'
    'desktop/src/*|desktop/src/app/App.tsx|nomatch'
    'desktop/src/*|desktop/src/features/runs/ui/DeckPane.tsx|nomatch'
    # ** crosses segments
    'desktop/src/**|desktop/src/features/runs/ui/DeckPane.tsx|match'
    'desktop/src/features/runs/**|desktop/src/features/runs/ui/DeckPane.tsx|match'
    'desktop/src/features/runs/**|desktop/src/features/other/x.ts|nomatch'
    # anchored at both ends
    'desktop/src/App.tsx|desktop/src/App.tsx|match'
    'desktop/src/App.tsx|other/desktop/src/App.tsx|nomatch'
    'desktop/src/App.tsx|desktop/src/App.tsx.bak|nomatch'
    'desktop/src/**|other/desktop/src/x.ts|nomatch'
    # file-prefix globs within a segment
    'desktop/ds-*|desktop/ds-entry.tsx|match'
    'desktop/ds-*|desktop/ds/nested.tsx|nomatch'
    'desktop/src/shared/lib/wheelOwner.*|desktop/src/shared/lib/wheelOwner.test.ts|match'
    # literal characters that are regex metacharacters must not act as regex
    'desktop/public/app-icon@*x.png|desktop/public/app-icon@2x.png|match'
    'desktop/public/app-icon@*x.png|desktop/public/app-iconX2x.png|nomatch'
    'desktop/src/a.b.ts|desktop/src/axb.ts|nomatch'
    'desktop/src/a+b.ts|desktop/src/a+b.ts|match'
    'desktop/src/a+b.ts|desktop/src/ab.ts|nomatch'
    # ? is one character, never a separator
    'desktop/src/a?.ts|desktop/src/ab.ts|match'
    'desktop/src/a?.ts|desktop/src/a/.ts|nomatch'
  )
  for case_spec in "${cases[@]}"; do
    IFS='|' read -r pattern path expect <<<"$case_spec"
    re="$(glob_to_regex "$pattern")"
    assertion
    if [[ "$path" =~ $re ]]; then
      [[ "$expect" == "match" ]] && continue
      fail_assert "$(printf 'pattern %-40s should NOT match %s (regex %s)' "$pattern" "$path" "$re")"
    else
      [[ "$expect" == "nomatch" ]] && continue
      fail_assert "$(printf 'pattern %-40s should match %s (regex %s)' "$pattern" "$path" "$re")"
    fi
  done
}

# Block 2: the decision layer. `is_allowed` returning true for everything is
# the single most damaging mutation possible here, and block 1 cannot see it.
self_test_decision() {
  local fixture spec path expect out
  fixture="$(new_fixture)"
  write_fixture_registry "$fixture"
  load_seams "$fixture"

  assertion
  if ((${#SEAM_REGEXES[@]} != 3)); then
    fail_assert "registry parser read ${#SEAM_REGEXES[@]} patterns from the fixture, expected 3"
  fi

  local -a decisions=(
    # fork-owned prefix, allowed without any entry (format rule 4)
    'vingilot/scripts/whatever.sh|allow'
    'vingilot/x|allow'
    # declared subtree
    'desktop/src/features/runs/a/b.txt|allow'
    'desktop/src/features/runs/ui/DeckPane.tsx|allow'
    # declared single file
    'desktop/src/app/App.tsx|allow'
    # the probe: under desktop/src, covered by nothing
    'desktop/src/__probe.txt|reject'
    'desktop/src/app/App.tsx.bak|reject'
    'desktop/src/features/other/x.ts|reject'
    # segment semantics at the decision layer, not just in the translator
    'desktop/ds-entry.tsx|allow'
    'desktop/ds/nested/deep.tsx|reject'
    # a path outside every declared tree
    'crates/buzz-relay/src/lib.rs|reject'
  )
  for spec in "${decisions[@]}"; do
    IFS='|' read -r path expect <<<"$spec"
    assertion
    if is_allowed "$path"; then
      [[ "$expect" == "allow" ]] && continue
      fail_assert "is_allowed said YES to $path, which no fixture entry covers"
    else
      [[ "$expect" == "reject" ]] && continue
      fail_assert "is_allowed said NO to $path, which a fixture entry covers"
    fi
  done

  # --check-paths is this same decision layer through the CLI, so a caller can
  # drive it without git. Assert the two agree, including the exit code.
  assertion
  if out=$(printf '%s\n' 'vingilot/x' 'desktop/src/__probe.txt' \
    | SEAMS_REGISTRY_OVERRIDE="$fixture" "$SCRIPT_DIR/check-seams.sh" --check-paths 2>&1); then
    fail_assert "--check-paths exited 0 with an undeclared path in its input"
  elif [[ "$out" != *"desktop/src/__probe.txt"* ]]; then
    fail_assert "--check-paths did not name the undeclared path (output: $out)"
  elif [[ "$out" == *"vingilot/x"* ]]; then
    fail_assert "--check-paths named a fork-owned path as an offender (output: $out)"
  fi

  rm -f "$fixture"
}

# Block 3: the collection pipeline, driven by a stubbed `git`. Each of the
# three sources contributes exactly one distinctive path, so deleting a source
# — or its call site, which no fixture-based assertion can reach — shows up
# here as a missing offender.
self_test_pipeline() {
  local fixture joined want o
  fixture="$(new_fixture)"
  write_fixture_registry "$fixture"
  load_seams "$fixture"

  git() {
    case "$*" in
      'diff --name-status -z self-test-base...HEAD')
        # source 1: a commit on the branch, plus a declared path that must not
        # be reported
        printf 'M\0desktop/src/__from_branch_commit.txt\0M\0desktop/src/app/App.tsx\0'
        ;;
      'diff --name-status -z HEAD')
        # source 2: working tree, including a rename whose BOTH sides are
        # undeclared, and a fork-owned path that must not be reported
        printf 'R100\0desktop/src/__renamed_from.txt\0desktop/src/__renamed_to.txt\0M\0vingilot/seams.yaml\0'
        ;;
      'status --porcelain=v1 -z --untracked-files=all')
        # source 3: untracked, plus the two kinds of non-`??` entry the filter
        # in parse_untracked has to drop.
        #
        # Both are here because the first version of this stub used
        # ` M desktop/src/app/App.tsx` for the tracked-modified line — a path a
        # fixture entry already declares. Deleting the `??` filter entirely then
        # changed no assertion: the extra path was allowed anyway, so the
        # offender count stayed 4 and the self-test reported 48/48. The line was
        # documented as covering the filter and covered nothing.
        #
        #   ` M <path>`  a tracked modification. Its path is deliberately one NO
        #                fixture entry covers, so without the filter it becomes a
        #                fifth offender.
        #   `R  <new>\0<old>\0`  a staged rename. Porcelain v1 -z emits the old
        #                path as a BARE second NUL field with no status prefix,
        #                so the unfiltered loop's `${entry:3}` chops three real
        #                characters off it and reports `ktop/src/__pcl_old.tsx`
        #                as an undeclared seam. That garbage path is the actual
        #                hazard the filter prevents, and it is why this parser
        #                cannot simply be `parse_diff` with a wider case arm.
        printf '?? desktop/src/__untracked_probe.txt\0 M desktop/src/__tracked_modified.txt\0R  desktop/src/__pcl_new.tsx\0desktop/src/__pcl_old.tsx\0'
        ;;
      *)
        printf 'self-test: unexpected git call: %s\n' "$*" >&2
        return 1
        ;;
    esac
  }

  OFFENDING=()
  collect_changes "self-test-base"
  unset -f git

  local -a expected_present=(
    'desktop/src/__from_branch_commit.txt'
    'desktop/src/__renamed_from.txt'
    'desktop/src/__renamed_to.txt'
    'desktop/src/__untracked_probe.txt'
  )
  # Every one of these is undeclared-and-must-still-not-be-reported, or
  # declared-and-must-not-be-reported. Mixing the two is the point: an assertion
  # that a declared path is absent proves nothing about the code that filtered
  # it, because the decision layer would have allowed it anyway.
  local -a expected_absent=(
    # declared by a fixture entry — the allow path, reached from source 1
    'desktop/src/app/App.tsx'
    # fork-owned prefix — the format-rule-4 path, reached from source 2
    'vingilot/seams.yaml'
    # undeclared, and absent only because parse_untracked drops non-`??` entries
    'desktop/src/__tracked_modified.txt'
    'desktop/src/__pcl_new.tsx'
    'desktop/src/__pcl_old.tsx'
  )
  joined=" "
  for o in ${OFFENDING[@]+"${OFFENDING[@]}"}; do
    joined="$joined$o "
  done
  for want in "${expected_present[@]}"; do
    assertion
    [[ "$joined" == *" $want "* ]] \
      || fail_assert "collect_changes lost $want (offenders:$joined)"
  done
  for want in "${expected_absent[@]}"; do
    assertion
    if [[ "$joined" == *" $want "* ]]; then
      fail_assert "collect_changes reported $want, which is allowed"
    fi
  done
  assertion
  if ((${#OFFENDING[@]} != ${#expected_present[@]})); then
    fail_assert "collect_changes reported ${#OFFENDING[@]} offenders, expected ${#expected_present[@]} (offenders:$joined)"
  fi

  # report_offenders is what turns a non-empty list into exit 1.
  assertion
  if report_offenders 2>/dev/null; then
    fail_assert "report_offenders exited 0 with ${#OFFENDING[@]} offender(s)"
  fi
  assertion
  OFFENDING=()
  report_offenders 2>/dev/null || fail_assert "report_offenders exited non-zero with no offenders"

  rm -f "$fixture"
}

# Block 4: the guards on the registry file set — its line ceiling, and the
# agreement between the two scripts that read it. Both are properties of the
# file set rather than of any one path, and both have already drifted once.
self_test_registry_guards() {
  local big small dryrun
  big="$(new_fixture)"
  small="$(new_fixture)"
  seq 1 $((REGISTRY_LINE_LIMIT + 1)) >"$big"
  seq 1 10 >"$small"
  assertion
  check_registry_size "$small" 2>/dev/null \
    || fail_assert "check_registry_size rejected a 10-line file"
  assertion
  if check_registry_size "$big" 2>/dev/null; then
    fail_assert "check_registry_size accepted a $((REGISTRY_LINE_LIMIT + 1))-line file"
  fi
  rm -f "$big" "$small"

  # Found 2026-08-11: upstream-merge-dryrun.sh matched the same patterns with
  # bash `case`, where `*` crosses `/`, so the two scripts disagreed about what
  # a seam covers and the dry-run over-reported hits. They now share one
  # definition; assert the sibling still uses it rather than growing a copy.
  #
  # The patterns below are anchored at the start of a line and escape the `.` in
  # the filename, and both details were paid for: the first version of this
  # assertion was `grep -q 'lib/seam-glob.sh'`, which a COMMENT in the dry-run
  # satisfies. Repointing the actual `.` line at a private copy of the library
  # left the self-test reporting 46/46 passed.
  dryrun="$SCRIPT_DIR/upstream-merge-dryrun.sh"
  assertion
  if [[ ! -f "$dryrun" ]]; then
    fail_assert "upstream-merge-dryrun.sh not found next to this script"
  elif ! grep -qE '^[[:space:]]*\.[[:space:]]+"\$script_dir/lib/seam-glob\.sh"[[:space:]]*$' "$dryrun"; then
    fail_assert "upstream-merge-dryrun.sh has no line sourcing lib/seam-glob.sh — the two scripts can disagree about what a seam pattern covers"
  fi
  # Sourcing it is not using it. The dry-run must reach its verdict through the
  # shared matcher, so the call site is asserted too.
  assertion
  if ! grep -qE '(if|elif|while|until|&&|\|\|)?[[:space:]]*seam_regex_match[[:space:]]+"' "$dryrun"; then
    fail_assert "upstream-merge-dryrun.sh never calls seam_regex_match — it decides seam coverage some other way"
  fi
  assertion
  if ! grep -qE 'seam_load_regexes[[:space:]]' "$dryrun"; then
    fail_assert "upstream-merge-dryrun.sh never calls seam_load_regexes — it parses the registry some other way"
  fi
  assertion
  if grep -q 'case "\$f" in' "$dryrun"; then
    fail_assert "upstream-merge-dryrun.sh still matches seam patterns with bash case, where * crosses /"
  fi
}

# The repo root, for the two blocks below. The production entry point resolves it
# the same way, but that line runs after --self-test has already exited, so this
# asks git directly. It reads the repository's layout, not its history.
self_test_repo_root() {
  git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || true
}

# Block 5: the REAL registry file set, driven through the real discovery path.
#
# Blocks 1-4 all hand the parser a fixture — a mktemp file, or
# SEAMS_REGISTRY_OVERRIDE on a child invocation — which is right for testing the
# parser and wrong for testing the thing that FINDS the files to parse.
# seam_registry_files had exactly one caller in this script and none in the
# self-test, and deleting its `vingilot/seams/*.yaml` loop left all 48 assertions
# passing while 66 declared brand-sweep paths vanished from the registry. Loud
# here (the gate then rejects paths it declares), silent in the dry-run: its seam
# hit count simply drops and the verdict can read "clean" while upstream is
# editing a declared seam.
self_test_registry_fileset() {
  local repo_root root_registry f frag_count root_only full strict loose keyed
  repo_root="$(self_test_repo_root)"
  assertion
  if [[ -z "$repo_root" ]]; then
    fail_assert "could not resolve the repo root from $SCRIPT_DIR; the real-registry assertions did not run"
    return 0
  fi

  declare -a discovered=()
  while IFS= read -r f; do
    [[ -n "$f" ]] && discovered+=("$f")
  done < <(seam_registry_files "$repo_root")

  root_registry="$repo_root/vingilot/seams.yaml"
  assertion
  if [[ "${discovered[0]:-}" != "$root_registry" ]]; then
    fail_assert "seam_registry_files did not name vingilot/seams.yaml first (got '${discovered[0]:-}')"
  fi

  # At least one fragment, counted rather than named: the assertion has to
  # survive fragments being added, renamed and merged, and hardcoding
  # brand-sweep.yaml would make every future split a self-test failure. What it
  # pins is that the glob still runs at all.
  frag_count=0
  for f in ${discovered[@]+"${discovered[@]}"}; do
    case "$f" in
      "$repo_root"/vingilot/seams/*.yaml) frag_count=$((frag_count + 1)) ;;
    esac
  done
  assertion
  if ((frag_count < 1)); then
    fail_assert "seam_registry_files found no vingilot/seams/*.yaml fragment — either the glob was dropped or a fragment was never committed (git add vingilot/seams/)"
  fi

  # And that the fragments carry entries. A glob that runs over an empty
  # directory is indistinguishable from a glob that was deleted, as far as the
  # registry is concerned.
  seam_load_regexes "$root_registry"
  root_only=${#SEAM_REGEXES[@]}
  seam_load_regexes ${discovered[@]+"${discovered[@]}"}
  full=${#SEAM_REGEXES[@]}
  assertion
  if ((full <= root_only)); then
    fail_assert "the full registry parsed to $full patterns and vingilot/seams.yaml alone to $root_only — the fragments contribute nothing"
  fi

  # --- the parser's contract, cross-checked two independent ways --------------
  # seam_patterns_from_files reads ONE spelling: `- path: "<pattern>"`. Four
  # other YAML-valid ways to write the same entry parse to nothing and the path
  # is then silently undeclared — `- path: 'x'`, `- path : "x"`, `- path: x`, and
  # an entry whose `reason:` comes before its `path:`. Every fixture in this
  # self-test uses the canonical spelling, so nothing above ever asks the parser
  # about a near miss.
  #
  # Neither count below is hardcoded, because the number grows every week. Each
  # is a different way of counting the same entries, so the two must agree.
  #
  #   strict vs loose  catches a quoting or spacing near miss on the path line
  #                    itself: `- path` with anything at all after it is counted
  #                    loosely, and only the canonical form counts strictly.
  #   strict vs keyed  catches an entry whose path is not on the `- ` line at
  #                    all (reason-first), which both path greps miss equally —
  #                    every entry has exactly one removable_when.
  strict=$(grep -hE '^[[:space:]]*-[[:space:]]*path:[[:space:]]*"' ${discovered[@]+"${discovered[@]}"} | wc -l)
  loose=$(grep -hE '^[[:space:]]*-[[:space:]]*path[[:space:]]*:' ${discovered[@]+"${discovered[@]}"} | wc -l)
  keyed=$(grep -hE '^[[:space:]]*removable_when:[[:space:]]*"' ${discovered[@]+"${discovered[@]}"} | wc -l)
  strict=${strict// /}
  loose=${loose// /}
  keyed=${keyed// /}

  assertion
  if ((full != strict)); then
    fail_assert "seam_load_regexes returned $full patterns for $strict canonical path lines — the parser and the files disagree"
  fi
  assertion
  if ((strict != loose)); then
    fail_assert "$loose registry lines start an entry with a path key but only $strict are in the parsed form '- path: \"...\"' — $((loose - strict)) entry/entries is/are silently declaring nothing (single quotes, a space before the colon, or an unquoted value)"
  fi
  assertion
  if ((strict != keyed)); then
    fail_assert "the registry has $keyed entries by removable_when count but only $strict parsable path lines — an entry is missing its path, or its path is not the first key on the '- ' line"
  fi
}

# Block 6: that something still invokes this gate.
#
# This is the regression the repo has actually lived through: for months
# vingilot/seams.yaml's header said the boundary was "enforced in CI" while
# nothing anywhere ran this script — not a workflow, not the justfile, not a git
# hook. Adding the two invocations fixed it; nothing stopped them being deleted
# again, with every other check green, because a gate that runs nowhere still
# passes its own self-test.
#
# Block 4 already applies this technique to the coupling with the dry-run. Same
# shape here, and the same lesson from it: anchor on the command line, because
# the first version of the dry-run assertion was a bare substring grep that a
# COMMENT satisfied. Each pattern below requires the whole line to BE the
# command — a `#` comment or a sentence of prose mentioning the script cannot
# match. The optional `run:` prefix lets the workflow use either an inline
# `run:` or a block scalar without this needing an edit.
self_test_invocations() {
  local repo_root workflow justfile body
  local cmd='(\./)?vingilot/scripts/check-seams\.sh'
  repo_root="$(self_test_repo_root)"
  assertion
  if [[ -z "$repo_root" ]]; then
    fail_assert "could not resolve the repo root from $SCRIPT_DIR; the invocation-site assertions did not run"
    return 0
  fi

  workflow="$repo_root/.github/workflows/vingilot-desktop.yml"
  assertion
  if [[ ! -f "$workflow" ]]; then
    fail_assert "no .github/workflows/vingilot-desktop.yml — CI does not run the seam gate"
  else
    assertion
    if ! grep -qE "^[[:space:]]*(run:[[:space:]]*)?$cmd[[:space:]]+--self-test[[:space:]]*$" "$workflow"; then
      fail_assert "vingilot-desktop.yml has no command line running check-seams.sh --self-test — CI would run the gate without first proving the gate can reject"
    fi
    assertion
    if ! grep -qE "^[[:space:]]*(run:[[:space:]]*)?$cmd[[:space:]]+upstream/main[[:space:]]*$" "$workflow"; then
      fail_assert "vingilot-desktop.yml has no command line running check-seams.sh against upstream/main — the gate itself is not invoked in CI"
    fi
  fi

  # The local half. `just` recipe bodies are the indented lines under the target,
  # so the body is cut out first: a `check-seams.sh` call under some OTHER recipe
  # would satisfy a whole-file grep while `just seams` did nothing.
  justfile="$repo_root/Justfile"
  assertion
  if [[ ! -f "$justfile" ]]; then
    fail_assert "no Justfile at the repo root — cannot check that 'just seams' exists"
    return 0
  fi
  body="$(awk '/^seams:/ { inside = 1; next } inside && /^[^ \t]/ { inside = 0 } inside' "$justfile")"
  assertion
  if [[ -z "$body" ]]; then
    fail_assert "the Justfile has no 'seams:' recipe with a body — 'just seams' is the only local invocation of this gate"
    return 0
  fi
  assertion
  if ! printf '%s\n' "$body" | grep -qE "^[[:space:]]+$cmd[[:space:]]+--self-test[[:space:]]*$"; then
    fail_assert "the Justfile's 'seams:' recipe does not run check-seams.sh --self-test"
  fi
  assertion
  if ! printf '%s\n' "$body" | grep -qE "^[[:space:]]+$cmd[[:space:]]*$"; then
    fail_assert "the Justfile's 'seams:' recipe does not run the gate itself after the self-test"
  fi
}

self_test() {
  self_test_patterns
  self_test_decision
  self_test_pipeline
  self_test_registry_guards
  self_test_registry_fileset
  self_test_invocations
  if ((SELF_TEST_FAILURES > 0)); then
    printf 'check-seams --self-test: %d of %d assertion(s) failed\n' \
      "$SELF_TEST_FAILURES" "$SELF_TEST_ASSERTIONS" >&2
    return 1
  fi
  printf 'check-seams --self-test: %d assertion(s) passed\n' "$SELF_TEST_ASSERTIONS"
  return 0
}

# --- entry points ------------------------------------------------------------

case "${1:-}" in
  -h|--help)
    usage
    exit 0
    ;;
  --self-test)
    if [[ $# -gt 1 ]]; then
      echo "check-seams: --self-test takes no arguments" >&2
      exit 1
    fi
    self_test
    exit $?
    ;;
esac

REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# SEAMS_REGISTRY_OVERRIDE is how --self-test points a child invocation at a
# fixture registry instead of the repo's own. Nothing else sets it.
declare -a REGISTRY_FILES=()
if [[ -n "${SEAMS_REGISTRY_OVERRIDE:-}" ]]; then
  REGISTRY_FILES=("$SEAMS_REGISTRY_OVERRIDE")
else
  while IFS= read -r registry_file; do
    REGISTRY_FILES+=("$registry_file")
  done < <(seam_registry_files "$REPO_ROOT")
fi

if [[ ${#REGISTRY_FILES[@]} -eq 0 || ! -f "${REGISTRY_FILES[0]}" ]]; then
  echo "check-seams: seam inventory not found at vingilot/seams.yaml" >&2
  exit 1
fi

if [[ "${1:-}" == "--check-paths" ]]; then
  if [[ $# -gt 2 ]]; then
    echo "check-seams: --check-paths takes at most one file" >&2
    exit 1
  fi
  load_seams "${REGISTRY_FILES[@]}"
  paths_input="${2:--}"
  if [[ "$paths_input" == "-" ]]; then
    while IFS= read -r input_path; do check_path "$input_path"; done
  else
    if [[ ! -f "$paths_input" ]]; then
      echo "check-seams: no such file: $paths_input" >&2
      exit 1
    fi
    while IFS= read -r input_path; do check_path "$input_path"; done <"$paths_input"
  fi
  report_offenders
  exit $?
fi

if [[ $# -gt 1 ]]; then
  echo "check-seams: too many arguments" >&2
  usage >&2
  exit 1
fi

BASE_REF="${1:-upstream/main}"

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

check_registry_size "${REGISTRY_FILES[@]}"
load_seams "${REGISTRY_FILES[@]}"
collect_changes "$BASE_REF"
report_offenders
exit $?
