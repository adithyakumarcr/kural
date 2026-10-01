#!/usr/bin/env bash
# Prints the GitHub Release text for one version: its "What's new" block and the install steps,
# both taken from RELEASE_NOTES.md.   Usage: scripts/release-notes.sh 1.1.0   (or 1.1.0-alpha.1)
set -euo pipefail
cd "$(dirname "$0")/.."
VER="$1"
section() { awk -v h="## What's new in $1" '$0 == h { on = 1; next } /^## / { on = 0 } on' RELEASE_NOTES.md; }
case "$VER" in *-*)   # a test version (1.2.0-alpha.1): say so, and use 1.2.0's notes if it has none of its own
  printf '> **This is a test version (%s).** Expect rough edges. Please report problems under **Issues**.\n\n' "${VER#*-}" ;;
esac
new="$(section "$VER")"
case "$VER" in *-*)   # a test version also lists what its final version brings so far
  base="$(section "${VER%%-*}")"
  if [ -n "$new" ] && [ -n "$base" ]; then new="$new"$'\n\n'"**Also in ${VER%%-*}:**"$'\n'"$base"; else new="${new:-$base}"; fi ;;
esac
if [ -n "$new" ]; then printf "## What's new\n%s\n\n" "$new"; fi
awk '/^## Downloads/ { on = 1 } on' RELEASE_NOTES.md
