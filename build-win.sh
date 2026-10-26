#!/usr/bin/env bash
# Builds the Windows 10/11 (x64) versions of Kural from VSCodium:
#   dist/Kural-<ver>-windows-x64-setup.exe   installer (recommended)
#   dist/Kural-<ver>-windows-x64.zip         portable: unzip and run Kural.exe
# Runs on Linux. Needs: curl, unzip, zip, python3 + Pillow, node + npm, makensis (NSIS).
# With KURAL_SOURCE=1 it builds VS Code from source instead of unpacking VSCodium's download (scripts/vscode/). That needs a
# Windows computer (VS Code's native modules: Visual Studio 2022's C++ tools and the Windows SDK, Python), this script run in
# Git Bash (Git for Windows), plus node + npm, python (+ Pillow) and makensis (NSIS) on PATH: see the `windows` job of
# .github/workflows/build-from-source.yml. Everything after the app folder is there is the same for both ways.
set -euo pipefail
cd "$(dirname "$0")"
# python3 on Windows is python (actions/setup-python has no python3; the Microsoft Store's python3 is a stub that fails)
python3 -c '' >/dev/null 2>&1 || python3() { python "$@"; }
# On a Windows computer (Git Bash) the programs are Windows programs: they want C:\paths, not /c/paths
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) WINDOWS_HOST=1 ;; *) WINDOWS_HOST=0 ;; esac
winpath() { if [ "$WINDOWS_HOST" = 1 ]; then cygpath -w "$1"; else printf '%s\n' "$1"; fi; }

CODIUM_VER="${CODIUM_VER:-1.143.17183}"
VER="$(python3 -c 'import json;print(json.load(open("extension/package.json"))["version"])')"
SRC="downloads/VSCodium-win32-x64-$CODIUM_VER.zip"
WORK="build/win"
APP="$WORK/Kural"

mkdir -p downloads dist
if [ "${KURAL_SOURCE:-0}" = 1 ]; then
  # Our own build of VS Code from its source plus Kural's patches (scripts/vscode/), not VSCodium's download.
  # (--download-node: VS Code wants one exact Node version; a private copy is kept in build/. build/vscode-out is not
  # compiled again when it is up to date.) The result is the app folder, like the one inside VSCodium's zip.
  [ "$WINDOWS_HOST" = 1 ] || { echo "Error: the Windows source build runs on Windows, in Git Bash (this computer: $(uname -s)): VS Code's native modules need MSVC and the Windows SDK." >&2; exit 1; }
  [ -z "${KURAL_SIGN_STORETYPE:-}" ] || { echo "Error: signing on a Windows computer is not set up (sign-win.sh is run by NSIS and needs Linux or macOS); build unsigned here." >&2; exit 1; }
  echo "Building VS Code from source (scripts/vscode/fetch.sh + build.sh) ..."
  KURAL_OS=windows ./scripts/vscode/fetch.sh
  ./scripts/vscode/build.sh --download-node win32-x64
  rm -rf "$WORK" && mkdir -p "$APP"
  cp -a build/vscode-out/win32-x64/. "$APP/"
else
  if [ ! -f "$SRC" ]; then
    echo "Downloading VSCodium $CODIUM_VER for Windows (x64) ..."
    curl -fL -o "$SRC" "https://github.com/VSCodium/vscodium/releases/download/$CODIUM_VER/VSCodium-win32-x64-$CODIUM_VER.zip"
  fi
  ./scripts/check-codium.sh "$(basename "$SRC")" "$SRC" || exit 1   # (also a file left from an earlier run)
  rm -rf "$WORK" && mkdir -p "$APP"
  unzip -q "$SRC" -d "$APP"
fi
python3 scripts/electron_runtime.py "$APP" win32-x64

echo "Rebranding ..."
python3 scripts/rebrand.py "$APP/resources/app" win
python3 scripts/sbom.py "dist/kural-$VER-windows-x64.cdx.json" --app-root "$APP/resources/app" --platform windows-x64
python3 scripts/make-icons.py "$WORK/icons" >/dev/null

# The program itself: Kural.exe with the Kural icon and name
mv "$APP/VSCodium.exe" "$APP/Kural.exe"
mv "$APP/VSCodium.VisualElementsManifest.xml" "$APP/Kural.VisualElementsManifest.xml"
sed -i 's/VSCodium/Kural/g' "$APP/Kural.VisualElementsManifest.xml"
# resedit (edits the .exe) comes from package-lock.json: one exact version, checked against its recorded checksum, and
# no package install scripts run (this job can hold the signing certificate). `npm ci` every time: a folder left from
# an earlier build is never trusted.
npm ci --ignore-scripts --no-audit --no-fund --silent >/dev/null
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
if command -v zip >/dev/null 2>&1; then
  ( cd "$WORK" && zip -qr "../../$ZIP" Kural )
else   # (Git Bash has no zip program)
  python3 -I - "$WORK" "$ZIP" <<'PYEOF'
import os, sys, zipfile
work, out = sys.argv[1:3]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for dirpath, dirs, files in os.walk(os.path.join(work, "Kural")):
        dirs.sort()
        for f in sorted(files):
            full = os.path.join(dirpath, f)
            z.write(full, os.path.relpath(full, work).replace(os.sep, "/"))
PYEOF
fi

echo "Making the installer (takes a few minutes) ..."
SETUP="dist/Kural-$VER-windows-x64-setup.exe"
MAKENSIS=makensis
if ! command -v makensis >/dev/null 2>&1 && [ -x "/c/Program Files (x86)/NSIS/makensis.exe" ]; then MAKENSIS="/c/Program Files (x86)/NSIS/makensis.exe"; fi   # (NSIS's installer doesn't always add itself to PATH)
"$MAKENSIS" -V2 -DVERSION="$VER" -DSRC="$(winpath "$(pwd)/$APP")" -DICON="$(winpath "$(pwd)/$WORK/icons/icon.ico")" -DOUT="$(winpath "$(pwd)/$SETUP")" ${SIGN_DEF[@]+"${SIGN_DEF[@]}"} installer/kural.nsi
echo
echo "Built: $SETUP"
echo "       $ZIP"
