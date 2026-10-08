#!/usr/bin/env bash
# check-codium.sh <asset name> <file>: the downloaded VSCodium file must have the SHA-256 written in codium.lock.
# Why: each Kural release is only as trustworthy as the VSCodium file it was built from on the day.
set -euo pipefail
cd "$(dirname "$0")/.."
name="$1"; file="$2"
want="$(grep -F -- "$name " codium.lock | grep -v '^#' | awk '{print $2}' | head -1)"
[ -n "$want" ] || { echo "codium.lock has no checksum for $name"; exit 1; }
if command -v sha256sum >/dev/null 2>&1; then got="$(sha256sum "$file" | awk '{print $1}')"; else got="$(shasum -a 256 "$file" | awk '{print $1}')"; fi
[ "$got" = "$want" ] || { echo "VSCodium download checksum mismatch for $name (got $got, codium.lock says $want)"; exit 1; }
echo "VSCodium $name: checksum OK"
