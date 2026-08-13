#!/usr/bin/env bash
# test-relay-image-version.sh — assertions for the relay image publisher.
#
# Two blocks, both cheap enough to be a first CI step:
#
#   1. relay-image-version.sh itself: every accepted shape, and every refusal.
#      The refusals are the point — the failure this guards against is a
#      publisher that invents a version for a branch, or that quietly mangles a
#      version a container tag cannot hold.
#   2. The publisher workflow's contract: that it pushes to the FORK's namespace
#      and never upstream's, that upstream's inherited relay publisher is gone
#      rather than merely edited, that a pull request cannot push, and that the
#      owner guard and the version resolver are both still wired in. A workflow
#      is not compiled by anything, so these greps are the only thing standing
#      between a one-character edit and a publisher that pushes nowhere or
#      pushes to a namespace the fork's token cannot write.
#
# Reads the repo's own files, writes nothing, launches no docker. Run by
# `.github/workflows/vingilot-relay-image.yml`'s `contract` job.
#
# Written for bash 3.2 (the macOS system bash this repo is developed on).
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
resolver="${repo_root}/vingilot/scripts/relay-image-version.sh"
workflow="${repo_root}/.github/workflows/vingilot-relay-image.yml"
upstream_publisher="${repo_root}/.github/workflows/docker.yml"

failures=0

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  failures=$((failures + 1))
}

# The resolver accepts <ref> <input> and prints exactly the two expected lines.
accepts() {
  local ref="$1" input="$2" want_version="$3" want_stable="$4"
  local got want
  want="version=${want_version}
stable=${want_stable}"
  if ! got=$("$resolver" "$ref" "$input" 2>&1); then
    fail "resolver refused ref=\"$ref\" input=\"$input\", which it should accept: $got"
    return
  fi
  if [ "$got" != "$want" ]; then
    fail "ref=\"$ref\" input=\"$input\" resolved to [$got], expected [$want]"
  fi
}

# The resolver refuses, non-zero, and says something about it.
refuses() {
  local ref="$1" input="$2" why="$3"
  local got
  if got=$("$resolver" "$ref" "$input" 2>&1); then
    fail "resolver ACCEPTED ref=\"$ref\" input=\"$input\" ($why) and printed [$got]"
    return
  fi
  case "$got" in
    relay-image-version:*) ;;
    *) fail "refusal for ref=\"$ref\" input=\"$input\" is unlabelled: [$got]" ;;
  esac
}

# The workflow with its comments removed. The contract is about what Actions
# executes, not about the prose above it — and the prose above it quotes both the
# upstream image reference and the `branches:` trigger this file exists to be
# rid of, so a grep over the raw file would fail on the explanation of the very
# thing it is checking for. Full-line and trailing comments both go.
workflow_yaml=""
if [ -f "$workflow" ]; then
  workflow_yaml=$(sed -e 's/[[:space:]]#.*$//' -e 's/^[[:space:]]*#.*$//' "$workflow")
fi

# A grep the workflow's executable half must satisfy.
workflow_has() {
  local pattern="$1" why="$2"
  if ! printf '%s\n' "$workflow_yaml" | grep -Fq -- "$pattern"; then
    fail "the publisher workflow no longer contains \"$pattern\" — $why"
  fi
}

# A grep the workflow's executable half must NOT satisfy.
workflow_lacks() {
  local pattern="$1" why="$2"
  if printf '%s\n' "$workflow_yaml" | grep -Fq -- "$pattern"; then
    fail "the publisher workflow contains \"$pattern\" — $why"
  fi
}

# ── 1. The resolver ─────────────────────────────────────────────────────────

# A tag push: the ref carries the version, and a stable one moves :latest.
accepts "vingilot-v0.2.5" "" "0.2.5" "true"
accepts "vingilot-v10.20.30" "" "10.20.30" "true"
accepts "vingilot-v0.0.0" "" "0.0.0" "true"

# A prerelease publishes its own tag and leaves :latest where it was.
accepts "vingilot-v0.3.0-rc.1" "" "0.3.0-rc.1" "false"
accepts "vingilot-v1.0.0-beta.2" "" "1.0.0-beta.2" "false"

# A dispatch runs from a branch, so the input is the only source of a version.
accepts "main" "0.2.4" "0.2.4" "true"
accepts "vingilot/finding-things" "0.3.0-rc.2" "0.3.0-rc.2" "false"

# The input tolerates a pasted tag name, because that is what gets pasted.
accepts "main" "vingilot-v0.2.4" "0.2.4" "true"

# An input beside a tag wins: that is the rescue path.
accepts "vingilot-v0.2.5" "0.9.9" "0.9.9" "true"

# No version anywhere is a refusal, not a guess.
refuses "main" "" "a branch carries no version"
refuses "vingilot-ci" "" "a branch carries no version"

# Upstream's own release tags must not publish the fork's image.
refuses "relay-v0.2.1" "" "that is upstream's relay tag, not the fork's"
refuses "desktop-v1.2.3" "" "that is upstream's desktop tag"
refuses "v0.2.5" "" "the prefix is vingilot-v, not v"

# Shapes that are not a bare semver version.
refuses "vingilot-v1.2" "" "two components is not semver"
refuses "vingilot-v" "" "the tag carries no version at all"
refuses "vingilot-vv1.2.3" "" "a doubled v is not a version"
refuses "vingilot-v01.2.3" "" "semver forbids leading zeros"
refuses "vingilot-v1.2.3.4" "" "four components is not semver"
refuses "main" "latest" "a channel name is not a version"

# Build metadata cannot become a container tag, so it is refused, not stripped.
refuses "vingilot-v1.2.3+abc" "" "a container tag cannot hold +"
refuses "main" "1.2.3+abc" "a container tag cannot hold +"

# ── 2. The publisher workflow's contract ────────────────────────────────────

if [ ! -f "$workflow" ]; then
  fail "the publisher workflow is missing: $workflow"
else
  workflow_has "ghcr.io/ahmetbir/vingilot-relay" \
    "the fork publishes to its own GHCR namespace and nowhere else"
  workflow_lacks "ghcr.io/block/buzz:" \
    "pushing to upstream's namespace is exactly the permission_denied this workflow replaced"
  workflow_has "vingilot/scripts/relay-image-version.sh" \
    "the version must come from the tested resolver, not from an inline expression"
  workflow_has "vingilot/scripts/test-relay-image-version.sh" \
    "these assertions must run in CI, or they guard nothing"
  workflow_has "packages: write" \
    "pushing to GHCR needs it, and no other secret is involved"
  workflow_has "github.repository_owner == 'ahmetbir'" \
    "without the owner guard a fork-to-upstream PR runs this in block/buzz's CI"
  workflow_has 'vingilot-v*.*.*' \
    "the release trigger is the fork's own tag pattern"
  workflow_has 'push: ${{ github.event_name != '"'"'pull_request'"'"' }}' \
    "a pull request builds the image and must never publish it"
  workflow_has "workflow_dispatch" \
    "the first publish and every rescue happen by hand"
  workflow_lacks "branches:" \
    "a push to main must not publish; that is what made the inherited workflow fail on every commit"
fi

if [ -e "$upstream_publisher" ]; then
  fail "upstream's relay publisher is still present at .github/workflows/docker.yml — it pushes ghcr.io/block/buzz, which this fork's token cannot write, and it fails on every push"
fi

if [ "$failures" -ne 0 ]; then
  printf '\n%d assertion(s) failed.\n' "$failures" >&2
  exit 1
fi

printf 'relay image publisher: all assertions passed.\n'
