#!/usr/bin/env bash
# Builds the Windows 10/11 (x64) versions of Kural from VSCodium:
#   dist/Kural-<ver>-windows-x64-setup.exe   installer (recommended)
#   dist/Kural-<ver>-windows-x64.zip         portable: unzip and run Kural.exe
# Runs on Linux. Needs: curl, unzip, zip, python3 + Pillow, node + npm, makensis (NSIS).
set -euo pipefail
cd "$(dirname "$0")"

CODIUM_VER="${CODIUM_VER:-1.135.06055}"
VER="$(python3 -c 'import json;print(json.load(open("extension/package.json"))["version"])')"
SRC="downloads/VSCodium-win32-x64-$CODIUM_VER.zip"
WORK="build/win"
APP="$WORK/Kural"

mkdir -p downloads dist
if [ ! -f "$SRC" ]; then
  echo "Downloading VSCodium $CODIUM_VER for Windows (x64) ..."
  curl -fL -o "$SRC" "https://github.com/VSCodium/vscodium/releases/download/$CODIUM_VER/VSCodium-win32-x64-$CODIUM_VER.zip"
fi
rm -rf "$WORK" && mkdir -p "$APP"
unzip -q "$SRC" -d "$APP"

echo "Rebranding ..."
python3 scripts/rebrand.py "$APP/resources/app" win
python3 scripts/make-icons.py "$WORK/icons" >/dev/null

# The program itself: Kural.exe with the Kural icon and name
mv "$APP/VSCodium.exe" "$APP/Kural.exe"
mv "$APP/VSCodium.VisualElementsManifest.xml" "$APP/Kural.VisualElementsManifest.xml"
sed -i 's/VSCodium/Kural/g' "$APP/Kural.VisualElementsManifest.xml"
[ -d scripts/node_modules/resedit ] || (cd scripts && npm install --silent --no-audit --no-fund --no-save resedit@3 >/dev/null)
node scripts/win-exe.js "$APP/Kural.exe" "$WORK/icons/icon.ico" "$VER"

# The `kural` command-line launchers
mv "$APP/bin/codium.cmd" "$APP/bin/kural.cmd"
sed -i 's/VSCodium\.exe/Kural.exe/g' "$APP/bin/kural.cmd"
mv "$APP/bin/codium" "$APP/bin/kural"
sed -i -e 's/^APP_NAME="codium"/APP_NAME="kural"/' -e 's/^NAME="VSCodium"/NAME="Kural"/' \
       -e 's/^SERVERDATAFOLDER=".vscodium-server"/SERVERDATAFOLDER=".kural-server"/' "$APP/bin/kural"
[ -f "$APP/bin/codium-tunnel.exe" ] && mv "$APP/bin/codium-tunnel.exe" "$APP/bin/kural-tunnel.exe"

# Windows asks who made a program before it runs it: an unsigned installer gets SmartScreen's "Windows protected your
# PC". With a code signing certificate set up (CI secrets, docs/windows-signing.md), Kural.exe and the tunnel
# program are signed here, the installer and its uninstaller by makensis (installer/sign.nsh). Without one: unsigned,
# as before, with a note.
SIGN="$(pwd)/scripts/sign-win.sh"
SIGN_DEF=()
if [ -n "${KURAL_SIGN_STORETYPE:-}" ]; then
  echo "Signing ..."
  "$SIGN" "$APP/Kural.exe" $([ -f "$APP/bin/kural-tunnel.exe" ] && echo "$APP/bin/kural-tunnel.exe")
  SIGN_DEF=(-DSIGN="$SIGN")
else
  "$SIGN" Kural.exe
fi

echo "Making the portable zip ..."
ZIP="dist/Kural-$VER-windows-x64.zip"
rm -f "$ZIP"
( cd "$WORK" && zip -qr "../../$ZIP" Kural )

echo "Making the installer (takes a few minutes) ..."
SETUP="dist/Kural-$VER-windows-x64-setup.exe"
makensis -V2 -DVERSION="$VER" -DSRC="$(pwd)/$APP" -DICON="$(pwd)/$WORK/icons/icon.ico" -DOUT="$(pwd)/$SETUP" ${SIGN_DEF[@]+"${SIGN_DEF[@]}"} installer/kural.nsi
echo
echo "Built: $SETUP"
echo "       $ZIP"
