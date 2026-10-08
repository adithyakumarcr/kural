#!/usr/bin/env bash
# update-codium.sh <version>: use another VSCodium version. Downloads the three files, checks each against the checksum
# file VSCodium publishes beside it (<file>.sha256), rewrites codium.lock and CODIUM_VER in the three build scripts.
set -euo pipefail
cd "$(dirname "$0")/.."
ver="${1:?usage: scripts/update-codium.sh <version>, e.g. 1.135.06055}"
[[ "$ver" =~ ^[0-9]+(\.[0-9]+)+$ ]] || { echo "that doesn't look like a VSCodium version: $ver"; exit 1; }
base="https://github.com/VSCodium/vscodium/releases/download/$ver"
assets=("codium_${ver}_amd64.deb" "VSCodium-darwin-arm64-${ver}.zip" "VSCodium-win32-x64-${ver}.zip")
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
hash() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi; }
{
  echo "# VSCodium $ver. Update with: ./scripts/update-codium.sh <version>"
  for a in "${assets[@]}"; do
    echo "Downloading $a ..." >&2
    curl -fL -o "$tmp/$a" "$base/$a"
    curl -fL -o "$tmp/$a.sha256" "$base/$a.sha256"
    got="$(hash "$tmp/$a")"; theirs="$(awk '{print $1}' "$tmp/$a.sha256" | head -1)"
    [ "$got" = "$theirs" ] || { echo "$a: checksum does not match the one VSCodium publishes" >&2; exit 1; }
    echo "$a  $got"
  done
} > "$tmp/codium.lock"
mv "$tmp/codium.lock" codium.lock
for f in make-deb.sh build-mac.sh build-win.sh; do
  sed -i.bak -E "s/(CODIUM_VER=\"\\$\\{CODIUM_VER:-)[0-9.]+(\\}\")/\\1$ver\\2/" "$f" && rm -f "$f.bak"
done
echo "codium.lock and the build scripts now use VSCodium $ver"
