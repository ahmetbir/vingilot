#!/usr/bin/env bash
# Stop macOS from re-prompting for the DEV keychain item on every rebuild.
#
# Why the prompt recurs: debug builds are ad-hoc signed, so every `cargo build`
# produces a binary with a new code signature. Keychain ACLs are tied to the
# signature, so each rebuild looks like a brand-new app and "Always Allow"
# only survives until the next compile.
#
# What this does: re-creates every generic-password item under the given DEV
# service with the "-A" ACL — any local application may read the item without
# a prompt. That is a deliberate trade: acceptable for a LOCAL DEV identity
# talking to a local relay, and never applied to the production service
# ("buzz-desktop"), which this script refuses to touch.
#
# Secrets are piped through a shell variable and never printed.
#
# Usage:
#   ./vingilot/scripts/dev-keychain-allow.sh [service]
# Default service: buzz-desktop-dev.vingilot
set -euo pipefail

SERVICE="${1:-buzz-desktop-dev.vingilot}"

case "$SERVICE" in
  buzz-desktop-dev*) ;;
  *)
    echo "refusing: '$SERVICE' is not a dev service (must start with buzz-desktop-dev)" >&2
    exit 1
    ;;
esac

# Enumerate account names for the service from keychain METADATA only.
ACCOUNTS=$(security dump-keychain 2>/dev/null | awk -v svc="\"$SERVICE\"" '
  /"acct"<blob>=/ { gsub(/.*"acct"<blob>="/,""); gsub(/".*/,""); acct=$0 }
  /"svce"<blob>=/ { gsub(/.*"svce"<blob>="/,""); gsub(/".*/,""); if ($0 == substr(svc,2,length(svc)-2) && acct != "") { print acct; acct="" } }
' | sort -u)

if [ -z "$ACCOUNTS" ]; then
  echo "no items under service '$SERVICE' — create your identity in the app first, then rerun."
  exit 0
fi

count=0
while IFS= read -r acct; do
  # Read the secret into a variable; never echoed.
  if ! value=$(security find-generic-password -s "$SERVICE" -a "$acct" -w 2>/dev/null); then
    echo "skip (unreadable): $acct"
    continue
  fi
  security delete-generic-password -s "$SERVICE" -a "$acct" >/dev/null 2>&1
  security add-generic-password -s "$SERVICE" -a "$acct" -w "$value" -A
  unset value
  echo "re-ACL'd (any-app, no prompt): $acct"
  count=$((count + 1))
done <<< "$ACCOUNTS"

echo "done — $count item(s) under '$SERVICE' will no longer prompt, across rebuilds."
