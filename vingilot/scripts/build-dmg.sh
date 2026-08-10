#!/usr/bin/env bash
# Build a distributable Vingilot .dmg, sidecars included.
#
# Why this exists rather than `just desktop-release-build`: that recipe
# `touch`es the five sidecar entries as zero-byte stubs, because Tauri
# validates `externalBin` at compile time and the dev recipes find the real
# binaries on PATH. A bundle built that way installs five empty files, and the
# app fails at runtime with "ACP harness command `buzz-acp` was not found" —
# which is exactly how this was discovered, on a machine with no repo to fall
# back to.
#
# The dev recipes (`just staging` / `just production`) build all five in
# release but copy only `buzz`, for the same reason: on a dev machine the rest
# are already reachable. Nothing in the repo assembles all five, because
# upstream's real releases are produced by a separate pipeline.
#
# Signing is opportunistic and honest: if APPLE_SIGNING_IDENTITY names an
# identity in the keychain, Tauri signs; otherwise the .dmg is unsigned and
# this script says so rather than implying otherwise. Notarization is not
# attempted here — it needs an app-specific password, which belongs to the
# owner and to CI secrets, not to a local build script.

set -euo pipefail

cd "$(dirname "$0")/../.."

SIDECARS=(buzz-acp buzz-agent buzz-dev-mcp git-credential-nostr buzz)
TARGET="${1:-$(rustc -vV | sed -n 's|host: ||p')}"

free_gib=$(df -g /System/Volumes/Data | awk 'NR==2 {print $4}')
if [[ "$free_gib" -lt 25 ]]; then
    echo "Refusing to build: ${free_gib} GiB free, and a release build of this" >&2
    echo "workspace needs headroom. The owner works on this machine." >&2
    exit 1
fi
echo "Disk: ${free_gib} GiB free. Target: ${TARGET}"

echo "==> Building the sidecar binaries (release)"
cargo build --release --target "$TARGET" \
    -p buzz-acp -p buzz-agent -p buzz-dev-mcp -p buzz-cli -p git-credential-nostr

TARGET_DIR=$(cargo metadata --format-version 1 --no-deps \
    | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).target_directory")

echo "==> Placing them where Tauri's externalBin expects"
mkdir -p desktop/src-tauri/binaries
for bin in "${SIDECARS[@]}"; do
    src="${TARGET_DIR}/${TARGET}/release/${bin}"
    dest="desktop/src-tauri/binaries/${bin}-${TARGET}"
    # A missing or empty source here is the whole defect this script exists to
    # prevent, so it fails loudly rather than bundling a stub.
    if [[ ! -s "$src" ]]; then
        echo "Missing or empty: $src" >&2
        exit 1
    fi
    cp "$src" "$dest"
    chmod +x "$dest"
    printf '    %-24s %s bytes\n' "$bin" "$(stat -f %z "$dest")"
done

if [[ -n "${APPLE_SIGNING_IDENTITY:-}" ]]; then
    echo "==> Bundling, signed as: ${APPLE_SIGNING_IDENTITY}"
else
    echo "==> Bundling UNSIGNED (APPLE_SIGNING_IDENTITY is not set)."
    echo "    The .dmg will need: xattr -d com.apple.quarantine /Applications/Vingilot.app"
fi

cd desktop
pnpm tauri build --target "$TARGET" --bundles dmg

dmg=$(ls -t "src-tauri/target/${TARGET}/release/bundle/dmg/"*.dmg | head -1)
echo
echo "==> $dmg"
echo "    $(stat -f %z "$dmg") bytes"
# Ask codesign whether the signature verifies, rather than pattern-matching its
# prose. Both earlier attempts reported a correctly signed .dmg as unsigned: a
# grep for "^Authority" missed the format, and `--verify --quiet` is not an
# option this codesign has, so it exited 2 and the `if` read that as "no". The
# lesson is in how they failed rather than in the flag — an unrecognised option
# and a missed pattern both look exactly like an honest negative, so this one
# was checked against a signed file (exit 0) AND an unsigned one (exit 1)
# before being trusted. A build script that lies about what it produced is
# worse than one that says nothing.
if codesign --verify "$dmg" >/dev/null 2>&1; then
    codesign -dv "$dmg" 2>&1 \
        | grep -E "^(Authority|TeamIdentifier|Timestamp)" | sed 's/^/    /'
    echo "    Signed, and NOT notarized — Gatekeeper will still ask on a"
    echo "    machine that did not build it. Clear it with:"
    echo "      xattr -d com.apple.quarantine /Applications/Vingilot.app"
else
    echo "    Unsigned — set APPLE_SIGNING_IDENTITY to a Developer ID identity"
    echo "    (see: security find-identity -v -p codesigning) and rebuild."
fi
