# seam-glob.sh — the one definition of what a seam pattern means.
#
# Sourced, never executed. Two scripts decide whether a path is covered by an
# entry in the seam registry, and they must decide it the same way:
#
#   vingilot/scripts/check-seams.sh          (outgoing: does this branch touch
#                                             an undeclared upstream path?)
#   vingilot/scripts/upstream-merge-dryrun.sh (incoming: does upstream touch a
#                                             path this fork has declared?)
#
# They did not agree before 2026-08-11. check-seams.sh was taught segment
# semantics (`*` stays inside one path segment) while the dry-run kept matching
# with bash `case`, where `*` crosses `/` — so `desktop/ds-*` matched
# `desktop/ds-x/deep/y.ts` for one script and not the other, and the dry-run
# over-reported seam hits for paths the gate would refuse to authorise. The
# shared definition lives here so the next semantics change cannot land in one
# script only; --self-test asserts both scripts source this file.
#
# Guard: sourcing twice is a no-op, so a script may source it without knowing
# whether a caller already did.
if [[ -n "${SEAM_GLOB_LIB_VERSION:-}" ]]; then
  return 0 2>/dev/null || true
fi
SEAM_GLOB_LIB_VERSION=1

# --- what a seam pattern is --------------------------------------------------
# A seam pattern is a path glob with FILESYSTEM segment semantics, not bash
# case-glob semantics (seams.yaml format rule 3):
#
#   *   matches any run of characters within ONE path segment (never `/`)
#   **  matches any run of characters, crossing `/`
#   ?   matches exactly one character, never `/`
#
# The distinction is the whole point. Under bash `case`, `*` crosses `/`, so an
# entry like `desktop/src/*` silently pre-authorises every file in that tree
# forever and the gate can no longer reject anything there. Declaring a subtree
# is still possible — it just has to say so, with `**`.
#
# Translation is to an anchored POSIX ERE, matched with bash `[[ =~ ]]`. Only
# ERE metacharacters are backslash-escaped; a backslash before an ordinary
# character is undefined in ERE, so ordinary characters are passed through.
glob_to_regex() {
  local pattern="$1"
  local out='^'
  local len=${#pattern}
  local i=0
  local ch
  while ((i < len)); do
    ch="${pattern:i:1}"
    case "$ch" in
      '*')
        if [[ "${pattern:i+1:1}" == '*' ]]; then
          out+='.*'
          i=$((i + 2))
          continue
        fi
        out+='[^/]*'
        ;;
      '?')
        out+='[^/]'
        ;;
      '.' | '[' | ']' | '(' | ')' | '{' | '}' | '+' | '^' | '$' | '|' | '\')
        out+="\\$ch"
        ;;
      *)
        out+="$ch"
        ;;
    esac
    i=$((i + 1))
  done
  printf '%s$' "$out"
}

# True when $1 (a repo-relative path) is covered by seam pattern $2.
#
# Compiles on every call, so it is for one-off questions and assertions, never
# for a loop over many paths: the dry-run compared ~1000 incoming files against
# ~160 patterns this way and spent minutes in subshells. Loop callers compile
# once with seam_load_regexes and ask seam_regex_match.
seam_glob_match() {
  local path="$1" regex
  regex="$(glob_to_regex "$2")"
  # Unquoted on purpose: $regex must be a pattern to [[ =~ ]], not a literal.
  [[ "$path" =~ $regex ]]
}

# --- the many-paths form -----------------------------------------------------
# SEAM_REGEXES holds the compiled registry. A single global rather than a
# caller-supplied array name because bash 3.2 (the macOS system bash this repo
# is developed on) has no namerefs.
declare -a SEAM_REGEXES

# Compiles every pattern in the given registry files once, up front: a
# malformed pattern then fails the whole run rather than one path at a time,
# and the per-path decision stays a plain regex match.
seam_load_regexes() {
  local pattern
  SEAM_REGEXES=()
  while IFS= read -r pattern; do
    [[ -n "$pattern" ]] && SEAM_REGEXES+=("$(glob_to_regex "$pattern")")
  done < <(seam_patterns_from_files "$@")
  return 0
}

# True when $1 is covered by any pattern loaded by seam_load_regexes.
seam_regex_match() {
  local path="$1" regex
  for regex in ${SEAM_REGEXES[@]+"${SEAM_REGEXES[@]}"}; do
    # Unquoted on purpose: $regex must be a pattern to [[ =~ ]], not a literal.
    [[ "$path" =~ $regex ]] && return 0
  done
  return 1
}

# --- where the registry lives ------------------------------------------------
# The registry is a root file plus a directory of fragments. It was one file
# until 2026-08-11, when the rebrand's enumerated entries pushed it past the
# repo's 1000-line-per-file ceiling ("split, never raise"). Fragments are
# ordinary seam files — same format, same parser, no schema_version of their
# own — and are globbed, so adding one needs no change to either script.
#
# Prints one path per line, root file first, then fragments in glob order.
# Missing fragments directory is not an error; a missing root file is the
# caller's to report.
seam_registry_files() {
  local repo_root="$1"
  printf '%s\n' "$repo_root/vingilot/seams.yaml"
  local fragment
  for fragment in "$repo_root"/vingilot/seams/*.yaml; do
    [[ -f "$fragment" ]] && printf '%s\n' "$fragment"
  done
  # Explicit: an unmatched glob leaves the last [[ -f ]] false, and a function
  # whose last command is false returns 1 — which under `set -e` kills the
  # caller's `x=$(seam_registry_files ...)` assignment. It did.
  return 0
}

# --- how the registry is parsed ----------------------------------------------
# Parses only lines shaped like:  - path: "<pattern>"
# (see the format block at the top of seams.yaml for the contract — grep/sed,
# not a YAML library, which is why the format is deliberately narrow).
#
# Prints one pattern per line, in file order, for every file given.
seam_patterns_from_files() {
  [[ $# -eq 0 ]] && return 0
  grep -hE '^[[:space:]]*-[[:space:]]*path:[[:space:]]*"' "$@" \
    | sed -E 's/^[[:space:]]*-[[:space:]]*path:[[:space:]]*"([^"]*)".*/\1/' || true
}
