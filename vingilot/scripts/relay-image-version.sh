#!/usr/bin/env bash
# relay-image-version.sh — decide which version the fork's relay image publishes.
#
# The decision layer of .github/workflows/vingilot-relay-image.yml, extracted so
# it can be tested without a runner. The workflow calls it once and appends the
# result straight to $GITHUB_OUTPUT; everything the workflow then does with tags
# is a lookup, not a computation.
#
# Two lines are printed on success, in GITHUB_OUTPUT form:
#
#   version=<bare semver>     the image tag, e.g. 0.2.5
#   stable=true|false         whether this version also moves :latest
#
# Rules, all of them:
#   * An explicit version (the workflow_dispatch input) wins. A leading
#     `vingilot-v` on it is tolerated and stripped, because that is what a
#     person copying a tag name will paste.
#   * Otherwise the version comes from the ref name, which must be a
#     `vingilot-v<semver>` tag. Any other ref is a refusal, not a fallback:
#     inventing a version for a branch is how a floating tag gets published.
#   * Prerelease versions (0.3.0-rc.1) publish their own tag and do NOT move
#     :latest. `stable` is exactly "this version carries no prerelease part".
#   * Semver build metadata (1.2.3+abc) is refused rather than mangled: a
#     container tag cannot hold `+` at all, so there is no honest tag to emit.
#
# Written for bash 3.2 (the macOS system bash this repo is developed on).
set -euo pipefail

TAG_PREFIX="vingilot-v"

die() {
  printf 'relay-image-version: %s\n' "$1" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: vingilot/scripts/relay-image-version.sh <ref-name> [explicit-version]

Prints GITHUB_OUTPUT lines for the relay image version:

  version=<bare semver>
  stable=true|false

Arguments:
  ref-name           The ref the workflow is running at (GITHUB_REF_NAME).
                     Used when no explicit version is given, and must then be
                     a vingilot-v<semver> tag.
  explicit-version   The workflow_dispatch version input. Wins when non-empty;
                     a leading vingilot-v is stripped. Pass "" on a tag push.
EOF
}

case "${1-}" in
  -h | --help)
    usage
    exit 0
    ;;
esac

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  usage >&2
  exit 2
fi

ref_name="$1"
explicit="${2-}"

if [ -n "$explicit" ]; then
  version="${explicit#"$TAG_PREFIX"}"
  origin="the version input \"$explicit\""
else
  case "$ref_name" in
    "$TAG_PREFIX"*)
      version="${ref_name#"$TAG_PREFIX"}"
      origin="the tag \"$ref_name\""
      ;;
    *)
      die "nothing to publish: \"$ref_name\" is not a ${TAG_PREFIX}<semver> tag and no version input was given. Push a ${TAG_PREFIX}<semver> tag, or dispatch with the version input set."
      ;;
  esac
fi

case "$version" in
  *+*)
    die "$origin carries semver build metadata, which a container tag cannot hold (a tag is [A-Za-z0-9_][A-Za-z0-9_.-]* only). Publish \"${version%%+*}\" instead."
    ;;
esac

if [[ ! $version =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$ ]]; then
  die "$origin does not resolve to a bare semver version (got \"$version\"). Expected MAJOR.MINOR.PATCH with an optional -prerelease, e.g. 0.2.5 or 0.3.0-rc.1."
fi

case "$version" in
  *-*) stable="false" ;;
  *) stable="true" ;;
esac

printf 'version=%s\n' "$version"
printf 'stable=%s\n' "$stable"
