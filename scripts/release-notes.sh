#!/usr/bin/env bash
# Prints the GitHub Release text for one version: its "What's new" block and the install steps,
# both taken from RELEASE_NOTES.md.   Usage: scripts/release-notes.sh 1.1.0
set -euo pipefail
cd "$(dirname "$0")/.."
VER="$1"
new="$(awk -v h="## What's new in $VER" '$0 == h { on = 1; next } /^## / { on = 0 } on' RELEASE_NOTES.md)"
if [ -n "$new" ]; then printf "## What's new\n%s\n\n" "$new"; fi
awk '/^## Downloads/ { on = 1 } on' RELEASE_NOTES.md
